import * as cheerio from "cheerio";

/**
 * Best-effort HTML -> plain text. Removes script/style/nav boilerplate and
 * injects newlines at block boundaries so list items and paragraphs read as
 * separate lines. Output is truncated to maxChars at a word boundary.
 */
export function htmlToText(html, { maxChars = 20000 } = {}) {
  if (!html) return "";
  const $ = cheerio.load(html);
  $(
    "script,style,noscript,svg,canvas,iframe,audio,video,form,nav,footer,header,aside,button,select,textarea"
  ).remove();

  const container = $("main").first().length
    ? $("main").first()
    : $("article").first().length
      ? $("article").first()
      : $("body");

  const containerHtml = container.html() || "";

  const withBreaks = containerHtml
    .replace(
      /<\/(p|li|h[1-6]|blockquote|tr|dt|dd|section|article|div|ul|ol|table|pre)>/gi,
      "\n"
    )
    .replace(/<br\s*\/?>/gi, "\n");

  let text = cheerio.load(withBreaks).text() || "";

  text = text
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return truncateText(text, maxChars);
}

/** Truncate to maxChars at the nearest word boundary. */
export function truncateText(text, maxChars) {
  if (text.length <= maxChars) return text;
  let cut = text.slice(0, maxChars);
  const boundary = cut.lastIndexOf(" ");
  if (boundary > maxChars * 0.6) cut = cut.slice(0, boundary);
  return `${cut.trim()}\n[truncated]`;
}

/** Rough token estimate (about 4 chars per token) used for LLM budgets. */
export function estimateTokens(text) {
  return Math.ceil((text ? String(text).length : 0) / 4);
}

/** Collapse runs of whitespace into a single space (single-line mode). */
export function squash(text) {
  return String(text).replace(/\s+/g, " ").trim();
}