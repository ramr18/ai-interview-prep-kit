import * as cheerio from "cheerio";
import { squash } from "../text/clean.js";
import { USER_AGENT } from "./robots.js";

export class SearchError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "SearchError";
    this.code = code;
  }
}

/**
 * Public web search via the DuckDuckGo HTML endpoint - no API key needed,
 * which keeps every provider in this assessment on a genuine free tier.
 * A blocked/failed search raises SearchError; the caller turns that into an
 * honest "no public discussion found" note rather than aborting the run.
 */
export async function searchWeb(query, { limit = 5, timeoutMs = 15000 } = {}) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  let res;
  try {
    res = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new SearchError("network", `search failed: ${e.message}`);
  }
  if (res.status === 202 || res.status === 403 || res.status === 429) {
    throw new SearchError("blocked", `DuckDuckGo refused the search (HTTP ${res.status})`);
  }
  if (!res.ok) throw new SearchError(`http_${res.status}`, `search HTTP ${res.status}`);
  const ctype = (res.headers.get("content-type") || "").toLowerCase();
  if (!ctype.startsWith("text/html")) throw new SearchError("not_html", `search returned ${ctype}`);

  const html = await res.text();
  const $ = cheerio.load(html);
  const results = [];

  for (const el of $(".result").toArray()) {
    const a = $(el).find(".result__a").first();
    const snippetEl = $(el).find(".result__snippet").first();
    const rawHref = a.attr("href") || "";
    let href = rawHref;
    try {
      const parsed = new URL(rawHref, "https://duckduckgo.com");
      const uddg = parsed.searchParams.get("uddg");
      if (uddg && /^https?:\/\//i.test(uddg)) href = uddg;
    } catch {
      /* keep raw */
    }
    const title = squash(a.text() || "");
    const snippet = squash(snippetEl.text() || "");
    if (/^https?:\/\//i.test(href) && title) {
      results.push({ title, url: href, snippet });
    }
  }

  // De-duplicate by URL (case-insensitive, drop trailing slash differences).
  const seen = new Set();
  const out = [];
  for (const r of results) {
    const key = r.url.toLowerCase().replace(/\/$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}