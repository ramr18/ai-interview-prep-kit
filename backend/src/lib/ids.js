import { createHash } from "node:crypto";

/**
 * Stable identifiers inside a kit: r1, r2, ... q1, q2, ...
 *
 * Ids are assigned in code (never by the model) so that coverage can be
 * checked mechanically and references stay valid across regeneration.
 * makeIdGen starts past any ids that already exist so a section can be
 * regenerated without clashing.
 */
export function makeIdGen(prefix, existing = []) {
  let max = 0;
  const re = new RegExp(`^${prefix}(\\d+)$`);
  for (const id of existing) {
    const m = re.exec(id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  let n = max;
  return () => {
    n += 1;
    return `${prefix}${n}`;
  };
}

/** Stable sha-256 hex digest over arbitrary content. */
export function hashText(text) {
  return createHash("sha256").update(String(text)).digest("hex");
}

/** Short stable hash used to detect duplicate submissions (jd + company). */
export function submissionHash(jd, companyUrl) {
  return hashText(
    `${String(companyUrl).trim().toLowerCase()}\u0000${String(jd).trim()}`
  ).slice(0, 24);
}