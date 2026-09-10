import "dotenv/config";
import express from "express";
import session from "express-session";
import cookieParser from "cookie-parser";
import cors from "cors";
import MongoStore from "connect-mongo";
import { pathToFileURL } from "node:url";
import { env, isProduction } from "./config/env.js";
import { getRepository } from "./repos/repo.js";
import { authRouter } from "./routes/auth.js";
import { kitsRouter } from "./routes/kits.js";
import { practiceRouter } from "./routes/practice.js";

export async function createServer() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  // ---- CORS (only when the client calls the API directly) ----
  if (env.allowedOrigins.length > 0) {
    app.use(
      cors({
        origin: (origin, cb) => {
          if (!origin || env.allowedOrigins.includes(origin)) return cb(null, true);
          cb(new Error("Not allowed by CORS"));
        },
        credentials: true,
      })
    );
  }

  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());

  // ---- Session ----
  const sessionOpts = {
    name: "prepkit.sid",
    secret: env.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: isProduction ? "none" : "lax",
      secure: isProduction,
      maxAge: 1000 * 60 * 60 * 24 * 14, // 14 days
    },
  };
  if (env.repository === "mongo") {
    sessionOpts.store = MongoStore.create({ mongoUrl: env.mongoUri, ttl: 60 * 60 * 24 * 14 });
  }
  app.use(session(sessionOpts));

  // ---- Health check ----
  app.get("/api/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

  // ---- Routes ----
  app.use("/api/auth", authRouter);
  app.use("/api/kits", kitsRouter);
  app.use("/api/practice", practiceRouter);

  // ---- Error handler ----
  app.use((err, _req, res, _next) => {
    console.error("[error]", err?.message || err);
    if (err?.message === "Not allowed by CORS") {
      return res.status(403).json({ error: "cors", message: "Origin not allowed" });
    }
    res.status(err.status || 500).json({ error: "server_error", message: err.message || "Internal error" });
  });

  return app;
}

// Only listen when run directly (not when imported by tests/batch).
const launchedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (launchedDirectly) {
  const repo = await getRepository();
  const app = await createServer();
  app.locals.repo = repo;
  app.listen(env.port, () => {
    console.log(`[server] listening on :${env.port} (env=${env.nodeEnv}, repo=${env.repository})`);
  });
}
