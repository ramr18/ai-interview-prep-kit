import { HostGate } from "../../lib/http/rateLimiter.js";
import { crawlSite, CrawlError } from "./crawlSite.js";
import { fetchPage } from "../../lib/http/fetchPage.js";
import { htmlToText } from "../../lib/text/clean.js";
import { env } from "../../config/env.js";

/** Shared gate for politeness + backoff across the whole process. */
export function makeHostGate() {
  return new HostGate({ minIntervalMs: env.http.crawlDelayMs });
}

/**
 * Step 2+3 - research phase.
 *
 *   a) crawl the company site (ranked BFS),
 *   b) an LLM classifies which crawled pages are "about" / "hiring process",
 *   c) summarise what the company does and - when a hiring page was found -
 *      how they hire.
 *
 * Every individual page failure is recorded (sources with skipped=true) and
 * reflected honestly in the brief; a total failure to reach the site raises
 * CrawlError which the orchestrator turns into an honest "no research" kit.
 */
export async function stepResearch(
  ctx,
  { companyUrl, allowPrivate = env.allowPrivateUrls }
) {
  ctx.emit({ type: "phase", name: "research", status: "start" });

  const gate = ctx.gate;
  let crawl;
  try {
    crawl = await crawlSite(companyUrl, {
      gate,
      allowPrivate,
      maxPages: env.http.maxPagesPerSite,
      onEvent: ctx.emit,
    });
  } catch (e) {
    ctx.emit({ type: "phase", name: "research", status: "error", code: e.code || "crawl_failed", detail: e.message });
    throw new CrawlError(e.code || "crawl_failed", `Could not crawl ${companyUrl}: ${e.message}`);
  }
  ctx.emit({
    type: "phase",
    name: "research",
    status: "crawled",
    detail: `${crawl.crawledCount} page${crawl.crawledCount === 1 ? "" : "s"}`,
  });

  const crawledPages = crawl.pages.map((p) => ({
    id: p.id,
    url: p.url,
    title: p.title,
    snippet: p.snippet.replace(/\s+/g, " ").slice(0, 300),
  }));

  if (crawledPages.length === 0) {
    ctx.emit({ type: "phase", name: "research", status: "ok", detail: "no pages retrievable" });
    return {
      crawl,
      companyName: "",
      aboutSummary: "",
      whatTheyDo: "",
      values: [],
      aboutText: "",
      hiringText: "",
      hiringPageFound: false,
      hiringProcess: { found: false, summary: "", stages: [] },
      discussion: { found: false, summary: "", themes: [] },
      sources: [
        { url: companyUrl, kind: "site", skipped: true, reason: "site could not be retrieved" },
      ],
    };
  }

  // b) classify which pages are worth reading (LLM call with the urls+titles,
  // NOT the full page text - keeps tokens low and failure surface small).
  let classification;
  try {
    classification = await ctx.gen({
      step: "classify",
      payload: { pages: crawledPages },
      maxOutputTokens: 1500,
    });
  } catch (e) {
    // Heuristic fallback: the model failed, so pick by keyword score in code.
    classification = {
      aboutPageId: crawledPages[0]?.id,
      hiringPageId:
        crawledPages.find((p) =>
          /career|job|hiring|join|work[- ]with|handbook|interview/i.test(`${p.url} ${p.title}`)
        )?.id || null,
      hiringProcessFound: false,
      relevantPageIds: crawledPages.slice(0, 3).map((p) => p.id),
    };
  }

  const byId = new Map(crawl.pages.map((p) => [p.id, p]));
  const pick = (id) => (id && byId.get(id)) || null;
  const aboutPage = pick(classification?.aboutPageId) || crawl.pages[0];
  const hiringPage = pick(classification?.hiringPageId);
  const relevant = (classification?.relevantPageIds || [])
    .map((id) => byId.get(id))
    .filter(Boolean)
    .filter((p) => p !== aboutPage && p !== hiringPage);
  const hiringProcessFound = hiringPage !== null;

  const aboutText = aboutPage?.text || "";
  let hiringText = hiringPage?.text || "";
  if (hiringPage && hiringText.trim().length < 200) {
    // Slim text - try a fuller fetch of the hiring page (it may be split).
    try {
      const fresh = await fetchPage(hiringPage.url, {
        gate,
        allowPrivate,
        timeoutMs: 12000,
        maxBytes: 2 * 1024 * 1024,
      });
      hiringText = htmlToText(fresh.body, { maxChars: 18000 });
    } catch {
      /* keep the crawled text */
    }
  }

  // c) summarise (LLM) - researchPrompt decides how to phrase the process.
  let research;
  try {
    research = await ctx.gen({
      step: "research",
      payload: {
        companyUrl,
        aboutText: aboutText.slice(0, 8000),
        hiringText: hiringText.slice(0, 10000),
        hiringPageFound: hiringProcessFound,
        companyName: "",
      },
      maxOutputTokens: 2500,
    });
  } catch (e) {
    research = {
      companyName: "",
      aboutSummary: aboutText.slice(0, 300),
      whatTheyDo: aboutText.slice(0, 300),
      values: [],
      hiringProcess: {
        found: hiringProcessFound,
        summary: hiringProcessFound ? hiringText.slice(0, 300) : "",
        stages: [],
      },
    };
  }

  const sources = [
    {
      url: aboutPage?.url || companyUrl,
      kind: "site",
      title: aboutPage?.title || "",
      accessedAt: new Date().toISOString(),
    },
    ...(hiringPage
      ? [{
          url: hiringPage.url,
          kind: "site",
          title: hiringPage.title,
          accessedAt: new Date().toISOString(),
        }]
      : [{ url: companyUrl, kind: "site", skipped: true, reason: "no hiring page found" }]),
    ...crawl.failures.slice(0, 5).map((f) => ({
      url: f.url,
      kind: "site",
      skipped: true,
      reason: `${f.code}: ${f.detail}`,
    })),
  ];

  ctx.emit({
    type: "phase",
    name: "research",
    status: "ok",
    detail: `hiring page ${hiringProcessFound ? "found" : "not found"}`,
  });

  return {
    crawl,
    companyName: String(research.companyName || "").trim().slice(0, 120),
    aboutSummary: String(research.aboutSummary || "").slice(0, 1500),
    whatTheyDo: String(research.whatTheyDo || "").slice(0, 1500),
    values: Array.isArray(research.values) ? research.values.slice(0, 6).map(String) : [],
    aboutText: aboutText.slice(0, 8000),
    hiringText: hiringText.slice(0, 10000),
    hiringPageFound: hiringProcessFound,
    hiringProcess: {
      found: Boolean(research.hiringProcess?.found),
      summary: String(research.hiringProcess?.summary || "").slice(0, 1500),
      stages: Array.isArray(research.hiringProcess?.stages)
        ? research.hiringProcess.stages
            .slice(0, 8)
            .map((s) => ({
              name: String(s.name || "").slice(0, 100),
              description: String(s.description || "").slice(0, 500),
            }))
        : [],
    },
    sources,
  };
}