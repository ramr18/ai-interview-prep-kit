/** Thrown when a model response cannot be parsed as the expected JSON. */
export class JsonParseError extends Error {
  constructor(message) {
    super(message);
    this.name = "JsonParseError";
    this.code = "INVALID_JSON";
  }
}

/**
 * Extract a JSON value (object or array) from a model reply.
 * Strips markdown fences, then finds the outermost balanced JSON construct and
 * parses it. String-aware and escape-aware so stray braces inside strings do
 * not break the balancing.
 */
export function extractJson(text) {
  if (!text) throw new JsonParseError("Empty model response");
  const cleaned = String(text)
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");

  let start = -1;
  let startChar = "";
  for (let i = 0; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (c === "{" || c === "[") {
      start = i;
      startChar = c;
      break;
    }
    if (c === "}" || c === "]") break; // closes before any open -> invalid
  }
  if (start < 0) throw new JsonParseError("No JSON object/array found in model response");

  const endChar = startChar === "{" ? "}" : "]";
  const OPEN = new Set(["\"", "'", "`", "{", "[", "(", "<"]);
  const closeFor = { "{": "}", "[": "]", "(": ")", "<": ">" };

  let depth = 0;
  let i = start;
  let inString = null; // quote char when inside a string
  let escaped = false;
  let end = -1;

  for (; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === "\\") {
        escaped = true;
        continue;
      }
      if (c === inString) inString = null;
      continue;
    }
    if (c === "\"" || c === "'" || c === "`") {
      inString = c;
      continue;
    }
    if (c === startChar && depth === 0) {
      depth = 1;
      continue;
    }
    if (c === startChar) depth += 1;
    else if (c === endChar) {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    } else if (OPEN.has(c)) {
      // treat other paired brackets as depth-agnostic; only our start/end
      // bracket matters for correctness of the outermost value.
      continue;
    }
  }

  if (end < 0) throw new JsonParseError("Unbalanced JSON in model response");
  const candidate = cleaned.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch (e) {
    throw new JsonParseError(`Model returned invalid JSON: ${e.message}`);
  }
}