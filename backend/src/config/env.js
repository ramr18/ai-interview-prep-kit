import "dotenv/config";

/** Read an env var, returning a fallback when it is unset or empty. */
function readEnv(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

function readInt(name, fallback) {
  const n = parseInt(readEnv(name, String(fallback)), 10);
  return Number.isFinite(n) ? n : fallback;
}

export const env = {
  nodeEnv: readEnv("NODE_ENV", "development"),
  port: readInt("PORT", 4000),
  sessionSecret: readEnv("SESSION_SECRET", "dev-unsafe-secret-change-me"),
  origin: readEnv("ORIGIN", ""),
  // SSRF guard for fetched external URLs. Must stay false in production.
  allowPrivateUrls: readEnv("ALLOW_PRIVATE_URLS", "false") === "true",
  allowedOrigins: readEnv("ALLOWED_ORIGINS", "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  repository: readEnv("REPOSITORY", "mongo"),
  mongoUri: readEnv("MONGODB_URI", "mongodb://localhost:27017/ai_prep_kit"),

  llm: {
    provider: readEnv("LLM_PROVIDER", "gemini"),
    model: readEnv("LLM_MODEL", "gemini-2.0-flash"),
    geminiApiKey: readEnv("GEMINI_API_KEY", ""),
    openaiCompatible: {
      baseUrl: readEnv("OPENAI_COMPATIBLE_BASE_URL", ""),
      apiKey: readEnv("OPENAI_COMPATIBLE_API_KEY", ""),
      model: readEnv("OPENAI_COMPATIBLE_MODEL", ""),
    },
    rpm: readInt("LLM_RPM", 15),
    tpm: readInt("LLM_TPM", 150000),
    tpmWindowMinutes: readInt("LLM_TPM_WINDOW_MIN", 1),
    maxRetries: readInt("LLM_MAX_RETRIES", 4),
    timeoutMs: readInt("LLM_TIMEOUT_MS", 120000),
  },

  http: {
    pageMaxBytes: readInt("PAGE_MAX_BYTES", 2 * 1024 * 1024),
    fetchTimeoutMs: readInt("FETCH_TIMEOUT_MS", 12000),
    crawlDelayMs: readInt("CRAWL_DELAY_MS", 450),
    maxPagesPerSite: readInt("MAX_PAGES_PER_SITE", 24),
    maxCandidates: readInt("MAX_CANDIDATES", 8),
  },
};

export const isProduction = env.nodeEnv === "production";