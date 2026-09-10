import { searchWeb, SearchError } from "../../lib/http/search.js";
import { fetchPage, PageFetchError } from "../../lib/http/fetchPage.js";
import { htmlToText } from "../../lib/text/clean.js";
import { env } from "../../config/env.js";

/**
 * Step - public discussion.
 *
 * Looks for "how people say <company> interviews" using a no-key web search,
 * fetches the most promising non-company results (blogs, forums, review
 * sites), and has the model summarise what they say. Every individual fetch
 * failure is recorded and skipped; a total failure to search turns into an
 * honest "no discussion found" note rather than aborting the run.
 */
export async function stepDiscussion(
  ctx,
  { companyName, companyUrl, allowPrivate = env.allowPrivateUrls }
) {
  const host = safeHostname(companyUrl);
  const friendly = companyName || host || "this company";
  const queries = [
    `"${friendly}" interview process`,
    `${friendly} interview questions experience`,
    `${friendly} hiring process how we hire`,
  ];

  ctx.emit({ type: "phase", name: "discussion", status: "start" });

  let results = [];
  for (const query of queries) {
    if (results.length >= 4) break;
    try {
      const r = await searchWeb(query, { limit: 5 });
      results.push(...r);
    } catch (e) {
      if (e instanceof SearchError && e.code === "blocked") {
        ctx.emit({ type: "phase", name: "discussion", status: "note", detail: "search engine blocked; skipping search" });
        break;
      }
      // Keep trying the next query; a flaky engine is not fatal.
    }
    // Give the search engine a beat between queries.
    await new Promise((r) => setTimeout(r, 800));
  }

  // De-duplicate, drop the company's own domain (we already have their site),
  // keep results we could plausibly read.
  const seen = new Set();
  const candidates = [];
  for (const r of results) {
    const key = r.url.replace(/\/$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      if (sameHost(r.url, companyUrl)) continue;
    } catch {
      /* keep it */
    }
    candidates.push(r);
    if (candidates.length >= 4) break;
  }

  const texts = [];
  const sources = [];
  for (const cand of candidates) {
    try {
      const fetched = await fetchPage(cand.url, {
        gate: ctx.gate,
        allowPrivate,
        timeoutMs: 12000,
        maxBytes: env.http.pageMaxBytes,
      });
      const text = htmlToText(fetched.body, { maxChars: 6000 });
      if (text.trim().length < 60) {
        sources.push({ url: cand.url, kind: "discussion", title: cand.title, skipped: true, reason: "page was empty" });
        continue;
      }
      texts.push(text);
      sources.push({
        url: cand.url,
        kind: "discussion",
        title: cand.title,
        accessedAt: new Date().toISOString(),
      });
    } catch (e) {
      sources.push({
        url: cand.url,
        kind: "discussion",
        title: cand.title || "",
        skipped: true,
        reason: e instanceof PageFetchError ? e.code : "fetch failed",
      });
    }
  }

  if (texts.length === 0) {
    ctx.emit({ type: "phase", name: "discussion", status: "ok", detail: "nothing found" });
    return { discussion: { found: false, summary: "", themes: [] }, sources };
  }

  let discussion;
  try {
    discussion = await ctx.gen({
      step: "discussion",
      payload: { companyName: friendly, texts: texts.slice(0, 3).map((t) => t.slice(0, 5000)) },
      maxOutputTokens: 1500,
    });
  } catch (e) {
    discussion = { found: true, summary: texts[0].slice(0, 400), themes: [] };
  }

  ctx.emit({
    type: "phase",
    name: "discussion",
    status: "ok",
    detail: `${texts.length} sourc${texts.length === 1 ? "e" : "es"} summarised`,
  });

  return {
    discussion: {
      found: Boolean(discussion.found) || texts.length > 0,
      summary: String(discussion.summary || "").slice(0, 1500),
      themes: Array.isArray(discussion.themes) ? discussion.themes.slice(0, 8).map(String) : [],
    },
    sources,
  };
}

function safeHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function sameHost(a, b) {
  try {
    return new URL(a).hostname.toLowerCase() === new URL(b).hostname.toLowerCase();
  } catch {
    return false;
  }
}