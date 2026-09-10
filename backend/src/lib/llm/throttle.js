import { sleep } from "../http/rateLimiter.js";

/**
 * Sliding-window budget. acquire() sleeps until a slot frees up so callers
 * never race ahead of the provider's free-tier request/token limits.
 */
class SlidingWindow {
  constructor({ windowMs, limit }) {
    this.windowMs = windowMs;
    this.limit = limit;
    this.stamps = []; // timestamps (or token amounts) within the window
  }

  prune(now) {
    const cutoff = now - this.windowMs;
    let first = 0;
    while (first < this.stamps.length && this.stamps[first] <= cutoff) first++;
    if (first > 0) this.stamps.splice(0, first);
  }

  async acquireTokens(weight, maxWaitMs = 120_000) {
    const now = Date.now();
    this.prune(now);
    const used = this.stamps.reduce((a, b) => a + b, 0);
    if (used + weight <= this.limit) {
      this.stamps.push(weight);
      return;
    }
    // We need the window to slide far enough that the oldest entries age out.
    const oldest = this.stamps[0];
    const target = oldest + this.windowMs;
    const wait = target - now;
    if (wait > maxWaitMs) throw new Error("LLM budget exhausted; giving up this call");
    await sleep(wait + 25);
    // Recurse once the window has slid.
    await this.acquireTokens(weight, maxWaitMs - wait);
  }
}

/**
 * Combined request + token budget for LLM calls. Calls acquire() before every
 * request and report() the actual usage after it returns.
 */
export class LlmBudget {
  constructor({ rpm = 15, tpm = 150000, tpmWindowMinutes = 1 } = {}) {
    this.requests = new SlidingWindow({ windowMs: 60_000, limit: Math.max(1, rpm) });
    this.tokens = new SlidingWindow({
      windowMs: tpmWindowMinutes * 60_000,
      limit: Math.max(100, tpm),
    });
  }

  /** Acquire a slot, weighting by an estimate of the tokens we will send. */
  async acquire(estimatedTokens, maxWaitMs = 120_000) {
    await this.requests.acquireTokens(1, maxWaitMs);
    await this.tokens.acquireTokens(Math.max(1, estimatedTokens), maxWaitMs);
  }

  /** Record actual usage from the provider (also substitutes the estimate). */
  report(usage = {}) {
    const out = usage.outputTokens || 0;
    // do not over-count; keep an entry so future estimates account for it.
    this.tokens.prune(Date.now());
    this.tokens.stamps.push(Math.max(0, out));
  }
}

/** Simple jittered exponential backoff in ms. */
export function backoffMs(attempt, base = 1500, cap = 60000) {
  const exp = base * 2 ** Math.max(0, attempt - 2);
  const jitter = Math.random() * 500;
  return Math.min(cap, exp + jitter);
}