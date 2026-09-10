import { env } from "../../config/env.js";
import { makeGeminiProvider, LlmError } from "./gemini.js";
import { makeOpenAiCompatibleProvider } from "./openaiCompat.js";
import { makeMockProvider } from "./mock.js";
import { extractJson, JsonParseError } from "./jsonParse.js";
import { LlmBudget, backoffMs } from "./throttle.js";
import { estimateTokens } from "../text/clean.js";
import { sleep } from "../http/rateLimiter.js";
import * as prompts from "./prompts.js";

/** Build the provider configured by the environment (falls back to mock). */
export function resolveProvider() {
  const llm = env.llm;
  if (llm.provider === "openai") {
    if (!llm.openaiCompatible.baseUrl || !llm.openaiCompatible.apiKey) {
      console.warn?.("OPENAI_COMPATIBLE_* not fully configured; using mock");
      return makeMockProvider();
    }
    return makeOpenAiCompatibleProvider({
      baseUrl: llm.openaiCompatible.baseUrl,
      apiKey: llm.openaiCompatible.apiKey,
      model: llm.openaiCompatible.model || llm.model,
      timeoutMs: llm.timeoutMs,
    });
  }
  if (llm.provider === "gemini" && llm.geminiApiKey) {
    return makeGeminiProvider({ apiKey: llm.geminiApiKey, model: llm.model, timeoutMs: llm.timeoutMs });
  }
  if (llm.provider !== "mock") {
    console.log(`[llm] LLM_PROVIDER=${llm.provider} but no key configured; falling back to mock`);
  }
  return makeMockProvider();
}

// Process-global budget, shared by every concurrent job so one kit cannot
// burst through the free-tier limits and starve another.
const budget = new LlmBudget({
  rpm: env.llm.rpm,
  tpm: env.llm.tpm,
  tpmWindowMinutes: env.llm.tpmWindowMinutes,
});

let cachedProvider = null;
function provider() {
  if (!cachedProvider) cachedProvider = resolveProvider();
  return cachedProvider;
}

/**
 * Run one model step with the configured provider, a request/token budget,
 * exponential backoff + Retry-After honouring, and one JSON-repair attempt.
 *
 * @param {object} spec
 * @param {string} spec.step       pipeline step key (also used by mock)
 * @param {object} spec.payload    structured data for this step
 * @param {number} [spec.temperature]
 * @param {number} [spec.maxOutputTokens]
 * @param {(e: object)=>void} [spec.onEvent]
 */
export async function generateJson(spec) {
  const builder = prompts[`${spec.step}Prompt`];
  if (!builder) throw new LlmError("no_prompt", `no prompt builder for step "${spec.step}"`, { retryable: false });
  const { system, prompt } = builder(spec.payload);

  const maxTokens = spec.maxOutputTokens ?? 4096;
  const estimatedIn = estimateTokens(prompt) + 64;
  await budget.acquire(estimatedIn);

  const onEvent = spec.onEvent || (() => {});
  const maxAttempts = Math.max(2, env.llm.maxRetries + 1);
  let recoverHint = "";
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      const delay = Math.max(
        backoffMs(attempt),
        lastError instanceof LlmError && lastError.retryAfterMs ? lastError.retryAfterMs : 0
      );
      onEvent({ type: "llm", step: spec.step, status: "retry", attempt: attempt - 1, delayMs: Math.round(delay) });
      await sleep(delay);
    }
    onEvent({ type: "llm", step: spec.step, status: "start", attempt });
    try {
      const result = await provider().call({
        step: spec.step,
        payload: spec.payload,
        system,
        prompt: recoverHint ? prompt + recoverHint : prompt,
        json: true,
        temperature: spec.temperature ?? 0.4,
        maxOutputTokens: maxTokens,
      });
      budget.report(result.usage);
      try {
        const parsed = extractJson(result.text);
        onEvent({ type: "llm", step: spec.step, status: "ok", attempt });
        return parsed;
      } catch (e) {
        if (e instanceof JsonParseError) {
          onEvent({ type: "llm", step: spec.step, status: e.code, attempt });
          if (!recoverHint) {
            recoverHint =
              "\n\nYour previous reply was not valid JSON. Return ONLY the JSON value itself, no prose, no fences, no markdown.";
            lastError = new LlmError("invalid_json", e.message);
            onEvent({ type: "llm", step: spec.step, status: "repair", attempt });
            continue;
          }
          throw new LlmError("invalid_json", `Invalid JSON after repair attempt: ${e.message}`, { retryable: false });
        }
        throw e;
      }
    } catch (e) {
      lastError = e instanceof LlmError ? e : new LlmError("unknown", String(e.message || e));
      onEvent({ type: "llm", step: spec.step, status: "error", attempt, code: lastError.code });
      if (!lastError.retryable || attempt >= maxAttempts) throw lastError;
    }
  }
  throw lastError;
}

/** Raw text generation (currently unused; kept for future steps). */
export async function generateText(spec) {
  const { system, prompt } = prompts[`${spec.step}Prompt`]?.(spec.payload) ?? { system: "", prompt: spec.prompt || "" };
  const estimatedIn = estimateTokens(prompt) + 64;
  await budget.acquire(estimatedIn);
  const result = await provider().call({
    step: spec.step,
    payload: spec.payload,
    system,
    prompt,
    json: false,
    temperature: spec.temperature ?? 0.4,
    maxOutputTokens: spec.maxOutputTokens ?? 2048,
  });
  budget.report(result.usage);
  return result.text;
}

export { LlmError };

/** Reset cached provider (used by tests). */
export function _resetProviderForTests() {
  cachedProvider = null;
}