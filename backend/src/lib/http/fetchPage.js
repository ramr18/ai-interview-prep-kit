import { validateExternalUrl, resolveRelative } from "./urlSafety.js";
import { isAllowedByRobots, USER_AGENT } from "./robots.js";

/** Uniform, structured failure for a page we could not retrieve. */
export class PageFetchError extends Error {
  constructor(code, url, detail = "", opts = {}) {
    super(`${code}: ${url} ${detail}`.trim());
    this.name = "PageFetchError";
    this.code = code;
    this.url = url;
    this.detail = detail;
    /** Should the caller retry once? (transient network / 5xx / rate limit) */
    this.retryable = opts.retryable ?? false;
    this.retryAfterMs = opts.retryAfterMs ?? 0;
  }
}

const TEXT_TYPES = ["text/html", "text/plain", "application/xhtml+xml", "application/xml"];

/**
 * Download a single page safely:
 *  - validates the URL (SSRF guard) and every redirect hop,
 *  - respects robots.txt (cached per origin),
 *  - enforces the per-host politeness gate,
 *  - caps response size and rejects non-text content types,
 *  - treats HTTP errors as structured PageFetchError.
 */
export async function fetchPage(
  rawUrl,
  {
    gate,
    allowPrivate = false,
    maxBytes = 2 * 1024 * 1024,
    timeoutMs = 12000,
    maxRedirects = 5,
    contentTypeAllowlist = TEXT_TYPES,
    onEvent = null,
  } = {}
) {
  let current = rawUrl;
  const redirects = [];

  for (let hop = 0; hop <= maxRedirects; hop++) {
    let validated;
    try {
      validated = await validateExternalUrl(current, { allowPrivate });
    } catch (e) {
      throw new PageFetchError("blocked_url", current, e.message);
    }
    const url = validated.url;
    const host = validated.host;

    // Robots.txt is checked BEFORE taking the per-host request slot: the
    // robots fetch acquires the same slot, so nesting the two would deadlock
    // the politeness gate. The robots result is cached per origin (10 min).
    let robots;
    try {
      robots = await isAllowedByRobots(gate, validated);
    } catch {
      robots = { allowed: true, unknown: true };
    }
    if (!robots.allowed) {
      throw new PageFetchError("robots_disallowed", url, "robots.txt disallows this URL");
    }
    if (robots.unknown && onEvent) {
      onEvent({ type: "source", url, status: "note", reason: "robots.txt unreachable; fetched anyway" });
    }

    const release = await gate.acquire(host); // politeness gate may back off
    let res;
    try {
      res = await fetch(url, {
        redirect: "manual",
        headers: { "user-agent": USER_AGENT, accept: contentTypeAllowlist.join(", ") },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      release();
      gate.recordFailure(host);
      throw new PageFetchError("network", url, e.message, { retryable: true });
    }

    try {
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const location = res.headers.get("location");
        const next = location ? resolveRelative(url, location) : null;
        if (!next) throw new PageFetchError("bad_redirect", url, "no usable Location header");
        redirects.push(next);
        current = next;
        continue;
      }
      if (res.status === 404) throw new PageFetchError("http_404", url, "Not found");
      if (res.status >= 400 && res.status < 500) {
        throw new PageFetchError(`http_${res.status}`, url, `HTTP ${res.status}`);
      }
      if (res.status >= 500) {
        const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
        throw new PageFetchError(`http_${res.status}`, url, `HTTP ${res.status}`, {
          retryable: true,
          retryAfterMs: retryAfter,
        });
      }
      if (!res.ok) throw new PageFetchError(`http_${res.status}`, url, `HTTP ${res.status}`);

      const ctype = (res.headers.get("content-type") || "").toLowerCase();
      if (ctype && !contentTypeAllowlist.some((t) => ctype.startsWith(t))) {
        throw new PageFetchError("unsupported_type", url, ctype.slice(0, 80));
      }
      const declared = Number(res.headers.get("content-length") || 0);
      if (declared > maxBytes) {
        throw new PageFetchError("too_large", url, `content-length ${declared}`);
      }

      const buffer = await readCapped(res, maxBytes);
      gate.recordSuccess(host);
      return {
        url,
        finalUrl: res.url,
        status: res.status,
        contentType: ctype,
        bytes: buffer.length,
        body: buffer.toString("utf8"),
        redirects,
      };
    } catch (e) {
      if (e instanceof PageFetchError && e.retryable) gate.recordFailure(host);
      throw e;
    } finally {
      release();
    }
  }
  throw new PageFetchError("too_many_redirects", current, `more than ${maxRedirects} redirects`);
}

/**
 * Read a fetch response body up to maxBytes. Uses async iteration (the most
 * compatible way to consume Node's fetch body across versions) and enforces
 * the cap.
 */
async function readCapped(res, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of res.body) {
    const buf = typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
    total += buf.length;
    if (total > maxBytes) {
      throw new PageFetchError("too_large", res.url, `body exceeded ${maxBytes} bytes`);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

function parseRetryAfter(header) {
  if (!header) return 0;
  const seconds = parseInt(header, 10);
  if (Number.isFinite(seconds)) return Math.max(0, seconds) * 1000;
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}