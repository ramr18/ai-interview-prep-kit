/** Structured, retryable LLM error. */
export class LlmError extends Error {
  constructor(code, message, { retryable = true, retryAfterMs = 0 } = {}) {
    super(`${code}: ${message}`);
    this.name = "LlmError";
    this.code = code;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

function parseRetryAfterSeconds(header) {
  if (!header) return 0;
  const seconds = parseInt(header, 10);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, (date - Date.now()) / 1000) : 0;
}

/**
 * Google Gemini provider over plain REST (free tier). Key from
 * https://aistudio.google.com/apikey ; the model defaults to a fast flash
 * model so the batch command can finish five cases inside fifteen minutes.
 */
export function makeGeminiProvider({ apiKey, model = "gemini-2.0-flash", timeoutMs = 120000 } = {}) {
  return {
    name: "gemini",
    async call(spec) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      const generationConfig = {
        temperature: spec.temperature ?? 0.4,
        maxOutputTokens: spec.maxOutputTokens ?? 4096,
      };
      if (spec.json) generationConfig.responseMimeType = "application/json";

      const body = {
        contents: [{ role: "user", parts: [{ text: spec.prompt }] }],
        generationConfig,
      };
      if (spec.system) body.systemInstruction = { parts: [{ text: spec.system }] };

      let res;
      try {
        res = await fetch(endpoint, {
          method: "POST",
          headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) {
        throw new LlmError("network", `gemini request failed: ${e.message}`);
      }

      if (res.status === 429) {
        throw new LlmError("rate_limited", "gemini rate limited", {
          retryAfterMs: parseRetryAfterSeconds(res.headers.get("retry-after")) * 1000,
        });
      }
      if (res.status >= 500) throw new LlmError("server_error", `gemini HTTP ${res.status}`);
      if (!res.ok) {
        const snippet = await res.text().catch(() => "");
        throw new LlmError("api_error", `gemini HTTP ${res.status}: ${snippet.slice(0, 200)}`, {
          retryable: false,
        });
      }

      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts
        ?.filter((p) => typeof p.text === "string")
        .map((p) => p.text)
        .join("") || "";
      if (!text) {
        throw new LlmError("api_error", "gemini returned empty content", { retryable: false });
      }
      return {
        text,
        usage: {
          inputTokens: data?.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: data?.usageMetadata?.candidatesTokenCount ?? 0,
        },
      };
    },
  };
}