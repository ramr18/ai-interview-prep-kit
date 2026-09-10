import { env } from "../config/env.js";
import { createFileRepository } from "./fileRepo.js";
import { createMongoRepository } from "./mongoRepo.js";

let cached = null;

/**
 * Repository factory. Env: REPOSITORY=mongo|file.
 * The file repository is a zero-dependency fallback (useful for quick local
 * demos and tests); mongo is canonical for the deployed app.
 */
export async function getRepository({ force = false } = {}) {
  if (cached && !force) return cached;
  if (env.repository === "mongo") {
    cached = createMongoRepository(env.mongoUri);
    try {
      await cached._connection();
      return cached;
    } catch (e) {
      if (env.nodeEnv === "production") throw e;
      console.log("[repo] MongoDB unavailable, falling back to file repository");
      cached = createFileRepository();
      return cached;
    }
  }
  cached = createFileRepository();
  return cached;
}

export async function resetRepositoryForTests() {
  cached = null;
}