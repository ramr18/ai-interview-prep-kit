import * as cheerio from "cheerio";
import { fetchPage, PageFetchError } from "../../lib/http/fetchPage.js";
import { resolveRelative, sameHost, validateExternalUrl } from "../../lib/http/urlSafety.js";
import { htmlToText, squash } from "../../lib/text/clean.js";

export class CrawlError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "CrawlError";
    this.code = code;
  }
}

/**
 * URL ranking - this is the "interesting half" the brief calls out. A fixed
 * path list is NOT sufficient, so we crawl breadth-first and score every link
 * by how likely it is to be (a) something a candidate must read before an
 * interview and (b) something that describes how the company hires.
 *
 * Path/title signals are weighted; a careers-at-X link inside the crawl bowl
 * or an engineering-blog article titled "how we interview" scores highly even
 * though its path was never hard-coded.
 */
export function scoreUrl({ url, title = "", snippet = "", depth }) {
  let score = 1.0;
  let lowerUrl;
  let lowerTitle;
  try {
    lowerUrl = url.toLowerCase();
    lowerTitle = `${title} ${snippet}`.toLowerCase();
  } catch {
    return 0;
  }

  const BONUS = [
    [/\/careers?\b|\/jobs?\b|\/hiring\b|\/join-?us\b|\/work-?(with|at)-?\w/i, 90],
    [/\bcareers?\b|\bopen roles?\b|\bjobs?\b|\bpositions?\b|\bhiring\b/i, 60],
    [/\binterview\b|\binterviewing\b|\bhiring process\b|\bhow we hire\b|\brecruit\b/i, 75],
    [/\bhandbook\b|\bplaybook\b|\blife ?at\b|\bculture\b/i, 40],
    [/\/about\b|\/about-?us\b|\/company\b|\/mission\b|\/team\b|\/story\b/i, 35],
    [/\babout\b|\bmission\b|\bwho we are\b|\bour story\b|\bcontact\b/i, 18],
    [/\/blog\b|\/engineering\b|\/news\b|\/resources\b/i, 12],
    [/\.pdf$|\.docx?$|\.pptx?$/i, -30],
    [/\?(.*)?(utm_|fbclid|gclid|ref=)/i, -15],
    [/\/cdn\//, -20],
  ];

  for (const [re, pts] of BONUS) {
    if (re.test(lowerUrl) || re.test(lowerTitle)) {
      score += pts;
    }
  }

  // Homepage, top-level segments and shallow pages are cheap and worth a peek.
  const segments = url.replace(/^https?:\/\/[^/]+/, "").split("/").filter(Boolean).length;
  if (segments === 0) score += 25;
  else if (segments <= 1) score += 8;

  // Depth penalty: deep crawls are where noise lives.
  if (depth > 3) score -= 8 * (depth - 3);

  score = Math.max(0.6, score);
  return Math.min(150, score);
}

const ALLOWED_EXT = /\.(html?|shtml|asp|aspx|php|jsp|md|txt|htm|cfm)(#.*)?$/i;
const BLOCKED_EXT = /\.(png|jpe?g|gif|svg|webp|ico|css|js|mjs|json|xml|rss|atom|zip|gz|tgz|tar|pdf|docx?|pptx?|xlsx?|mp4|webm|mp3|woff2?|ttf|eot)(\?.*)?$/i;

/**
 * A link is fetchable when it is not obviously a binary/static asset.
 * Extensionless paths (/careers, /about, an essay-style blog post) are
 * exactly the pages this crawler exists to find.
 */
function looksFetchable(url) {
  const path = new URL(url).pathname.toLowerCase();
  if (!path || path === "/") return true;
  if (BLOCKED_EXT.test(path)) return false;
  if (ALLOWED_EXT.test(path)) return true;
  const lastSegment = path.split("/").pop();
  if (!lastSegment.includes(".")) return true; // extensionless path
  return Boolean(ALLOWED_EXT.exec(path)); // known text extension
}

function stripFragment(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString();
  } catch {
    return url;
  }
}

function extractLinks(html, baseUrl, origin) {
  const $ = cheerio.load(html || "");
  const out = [];
  const seen = new Set();
  for (const el of $("a[href]").toArray()) {
    const href = $(el).attr("href");
    const resolved = href ? resolveRelative(baseUrl, href) : null;
    if (!resolved) continue;
    const clean = stripFragment(resolved);
    if (seen.has(clean)) continue;
    seen.add(clean);
    if (!/^https?:/i.test(clean)) continue;
    if (!sameHost(clean, origin)) continue;
    out.push({
      url: clean,
      title: squash($(el).text() || "").slice(0, 120),
    });
  }
  return out;
}

async function fetchWithRetry(item, opts) {
  try {
    return await fetchPage(item.url, opts);
  } catch (e) {
    if (e instanceof PageFetchError && e.retryable) {
      // One retry for a transient failure on the seed page specifically.
      try {
        return await fetchPage(item.url, opts);
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** Never let one bad URL kill the whole crawl. */
async function safeFetch(item, opts, pushFailure) {
  try {
    return await fetchWithRetry(item, opts);
  } catch (e) {
    pushFailure(item.url, e);
    return null;
  }
}

/**
 * Crawl a company site breadth-first, respect robots.txt, follow relative
 * links, keep to the same host, cap the number of pages, and return a ranked
 * list of candidate pages for the classifier step.
 *
 * A site that cannot be reached at all raises CrawlError (fatal for the
 * research phase, but the caller records it and still ships a kit). A site
 * that loads but yields no useful links simply produces a small candidate
 * list, which the classifier handles honestly.
 */
export async function crawlSite(
  rawUrl,
  {
    gate,
    allowPrivate = false,
    maxPages = 24,
    delayMs = 450,
    onEvent = null,
  } = {}
) {
  let seed;
  try {
    seed = await validateExternalUrl(rawUrl, { allowPrivate });
  } catch (e) {
    throw new CrawlError("invalid_seed", e.message);
  }
  const origin = seed.origin;

  const emit = onEvent || (() => {});
  const queue = [{ url: seed.url, depth: 0, title: "", snippet: "" }];
  const visited = new Set();
  const pages = []; // fetched pages in fetch order
  const failures = [];

  while (queue.length > 0 && pages.length < maxPages) {
    // Always expand the highest-scoring candidate first.
    queue.sort((a, b) => scoreUrl(b) - scoreUrl(a));
    const item = queue.shift();
    if (visited.has(stripFragment(item.url))) continue;
    visited.add(stripFragment(item.url));

    const fetched = await safeFetch(
      item,
      {
        gate,
        allowPrivate,
        timeoutMs: 12000,
        maxBytes: 2 * 1024 * 1024,
      },
      (url, e) => failures.push({ url, code: e?.code || "fetch_failed", detail: String(e?.message || e) })
    );
    if (!fetched) continue;

    emit({ type: "crawl", url: fetched.url, status: "fetched", bytes: fetched.bytes });
    const text = htmlToText(fetched.body, { maxChars: 18000 });
    pages.push({
      id: `p${pages.length + 1}`,
      url: fetched.url,
      title: item.title,
      snippet: text.slice(0, 1200),
      text,
    });

    if (pages.length >= maxPages) break;

    const links = extractLinks(fetched.body, fetched.url, origin);
    for (const link of links) {
      if (!looksFetchable(link.url)) continue;
      if (visited.has(stripFragment(link.url))) continue;
      if (queue.some((q) => stripFragment(q.url) === stripFragment(link.url))) continue;
      queue.push({ ...link, depth: item.depth + 1 });
    }
    // Additional politeness spacing between requests to the same site.
    if (queue.length > 0 && delayMs > 0) {
      await new Promise((r) => setTimeout(r, Math.min(delayMs, 300)));
    }
  }

  pages.sort(
    (a, b) =>
      scoreUrl({ url: b.url, title: b.title, snippet: b.snippet, depth: 1 }) -
      scoreUrl({ url: a.url, title: a.title, snippet: a.snippet, depth: 1 })
  );

  return {
    origin,
    seed: seed.url,
    pages,
    failures,
    crawledCount: pages.length,
    skippedCount: failures.length,
  };
}