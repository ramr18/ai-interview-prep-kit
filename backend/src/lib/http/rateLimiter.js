/**
 * Per-host politeness gate.
 *
 * Enforces a minimum interval between requests to the same host, at most one
 * in-flight request per host, and an exponential per-host backoff after
 * consecutive failures (5xx or network / rate-limit) so we do not hammer a
 * struggling site.
 */
export class HostGate {
  constructor({ minIntervalMs = 450, maxConcurrent = 1 } = {}) {
    this.minIntervalMs = minIntervalMs;
    this.maxConcurrent = maxConcurrent;
    this.lastRequest = new Map(); // host -> timestamp
    this.inFlight = new Map(); // host -> count
    this.failures = new Map(); // host -> consecutive failure count
    this.baseBackoffMs = 1000;
    this.maxBackoffMs = 30000;
  }

  async acquire(host) {
    for (;;) {
      const inFlight = this.inFlight.get(host) || 0;
      if (inFlight >= this.maxConcurrent) {
        await sleep(150);
        continue;
      }
      const last = this.lastRequest.get(host) || 0;
      const backoff = Math.min(this.maxBackoffMs, this.baseBackoffMs * 2 ** (this.failures.get(host) || 0));
      const waitUntil = Math.max(last + this.minIntervalMs, Date.now() + backoff);
      const wait = waitUntil - Date.now();
      if (wait > 0) await sleep(wait);
      this.inFlight.set(host, inFlight + 1);
      this.lastRequest.set(host, Date.now());
      return () => this.release(host);
    }
  }

  release(host) {
    this.inFlight.set(host, Math.max(0, (this.inFlight.get(host) || 0) - 1));
  }

  recordSuccess(host) {
    this.failures.set(host, 0);
  }

  recordFailure(host) {
    this.failures.set(host, Math.min(6, (this.failures.get(host) || 0) + 1));
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}