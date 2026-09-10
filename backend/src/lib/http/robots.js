import { sleep } from "./rateLimiter.js";

const USER_AGENT =
  process.env.USER_AGENT ||
  "PrepKitBot/1.0 (+https://example.com/prepkit; interview-preparation research; contact: local-dev)";

export { USER_AGENT };

/**
 * Minimal robots.txt parser (RFC 9309-style, practical subset).
 *
 * RULE = { group: [segments] } where a rule matches a path when the path
 * starts with the first segment, ends with the last (when the pattern has no
 * trailing '*'), and contains intermediate segments in order. '*' is a
 * wildcard segment. A trailing '$' requires an exact match.
 * Longest (most specific) matching rule wins; disallow wins ties.
 */
function parseRobots(text) {
  const rules = [];
  let currentAgent = null;
  let groups = new Map(); // agent -> rules[]
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "user-agent") {
      currentAgent = value.toLowerCase();
      if (!groups.has(currentAgent)) groups.set(currentAgent, []);
    } else if (key === "allow" || key === "disallow") {
      if (!currentAgent) continue;
      groups.get(currentAgent).push({ allow: key === "allow", pattern: value || "/" });
    }
  }

  const wildcard = groups.get("*") || [];
  const pick = (agent) => groups.get(agent) || wildcard;

  return { apply(path, agent) {
    const candidates = [...pick(agent), ...wildcard];
    if (candidates.length === 0) return true;
    let best = null;
    for (const rule of candidates) {
      if (matches(path, rule.pattern)) {
        if (best === null || rule.pattern.length > best.pattern.length) best = rule;
      }
    }
    if (best === null) return true;
    return best.allow;
  } };
}

function matches(path, pattern) {
  if (pattern === "" || pattern === "/") return true;
  const exact = pattern.endsWith("$");
  let p = exact ? pattern.slice(0, -1) : pattern;
  if (p === "") return true;
  const segs = p.split("*");
  if (segs.length === 1) {
    return exact ? path === segs[0] : path.startsWith(segs[0]);
  }
  if (!path.startsWith(segs[0]) && segs[0] !== "") return false;
  const tail = segs[segs.length - 1];
  if (!(exact ? path.endsWith(tail) : tail === "" || path.endsWith(tail))) return false;
  let rest = path.slice(segs[0].length);
  for (let i = 1; i < segs.length - 1; i++) {
    const seg = segs[i];
    const idx = rest.indexOf(seg);
    if (idx < 0) return false;
    rest = rest.slice(idx + seg.length);
  }
  return true;
}

const cache = new Map(); // origin -> { rules, fetchedAt, failed }
const TTL_MS = 10 * 60 * 1000;
const BOT_AGENT = "prepkitbot";

/**
 * Fetch + parse robots.txt for an origin once (cached). Errors are non-fatal:
 * on failure we default to allowing (and remember the failure) so a blocked
 * robots.txt never takes the whole crawl down.
 */
export async function loadRobots(client, origin) {
  const hit = cache.get(origin);
  if (hit && Date.now() - hit.fetchedAt < TTL_MS) return hit;

  // eslint-disable-next-line no-unused-vars
  const file = `${origin}/robots.txt`;
  let result = { rules: null, failed: false };
  try {
    const release = await client.acquire(new URL(origin).host);
    try {
      const res = await fetch(file, {
        redirect: "follow",
        headers: { "user-agent": USER_AGENT, accept: "text/plain" },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok && (res.headers.get("content-type") || "text/plain").startsWith("text/plain")) {
        const text = await res.text();
        // Any body is acceptable here; parseRobots ignores junk lines, and a
        // missing file (404) simply yields "no rules" -> everything allowed.
        result.rules = parseRobots(text);
      } else {
        // Non-text response (e.g. an SPA returning robots.txt as HTML).
        result.rules = parseRobots("");
      }
    } finally {
      release();
    }
    client.recordSuccess(new URL(origin).host);
  } catch {
    client.recordFailure(new URL(origin).host);
    result = { rules: null, failed: true };
  }
  result.fetchedAt = Date.now();
  cache.set(origin, result);
  return result;
}

/** Is the given (already validated) URL allowed by the site's robots.txt? */
export async function isAllowedByRobots(client, validatedUrl) {
  const { origin, url } = validatedUrl;
  const robots = await loadRobots(client, origin);
  if (!robots.rules) return { allowed: true, unknown: robots.failed };
  const path = new URL(url).pathname || "/";
  const query = new URL(url).search || "";
  const allowed = robots.rules.apply(path + query, BOT_AGENT);
  return { allowed, unknown: false };
}