import { LlmError } from "./gemini.js";

function parseRetryAfterSeconds(header) {
  if (!header) return 0;
  const seconds = parseInt(header, 10);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, (date - Date.now()) / 1000) : 0;
}

/**
 * OpenAI-compatible chat completions provider (Groq, OpenRouter, ...).
 * Activated with LLM_PROVIDER=openai and the OPENAI_COMPATIBLE_* vars.
 */
export function makeOpenAiCompatibleProvider({ baseUrl, apiKey, model, timeoutMs = 120000 }) {
  const base = String(baseUrl).replace(/\/+$/, "");
  return {
    name: "openai-compatible",
    async call(spec) {
      const endpoint = `${base}/chat/completions`;
      const body = {
        model,
        messages: [
          { role: "system", content: spec.system || "You are a helpful assistant." },
          { role: "user", content: spec.prompt },
        ],
        temperature: spec.temperature ?? 0.4,
        max_tokens: spec.maxOutputTokens ?? 4096,
        stream: false,
      };
      if (spec.json) body.response_format = { type: "json_object" };

      let res;
      try {
        res = await fetch(endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) {
        throw new LlmError("network", `request failed: ${e.message}`);
      }

      if (res.status === 429) {
        throw new LlmError("rate_limited", "provider rate limited", {
          retryAfterMs: parseRetryAfterSeconds(res.headers.get("retry-after")) * 1000,
        });
      }
      if (res.status >= 500) throw new LlmError("server_error", `HTTP ${res.status}`);
      if (!res.ok) {
        const snippet = await res.text().catch(() => "");
        throw new LlmError("api_error", `HTTP ${res.status}: ${snippet.slice(0, 200)}`, {
          retryable: false,
        });
      }
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content || "";
      if (!text) throw new LlmError("api_error", "empty content", { retryable: false });
      return {
        text,
        usage: {
          inputTokens: data?.usage?.prompt_tokens ?? 0,
          outputTokens: data?.usage?.completion_tokens ?? 0,
        },
      };
    },
  };
}