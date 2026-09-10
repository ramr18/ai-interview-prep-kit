import { Router } from "express";
import bcrypt from "bcryptjs";
import { getRepository } from "../repos/repo.js";

export const authRouter = Router();

function publicUser(u) {
  if (!u) return null;
  return { id: u.id || u._id, email: u.email, createdAt: u.createdAt };
}

/** Current session user. */
authRouter.get("/me", async (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const repo = req.app.locals.repo || (await getRepository());
  const u = await repo.findUserById(req.session.userId);
  res.json({ user: publicUser(u) });
});

/** Register. */
authRouter.post("/register", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "invalid_email", message: "A valid email is required" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "weak_password", message: "Password must be at least 8 characters" });
  }
  const repo = req.app.locals.repo || (await getRepository());
  const passwordHash = await bcrypt.hash(password, 10);
  try {
    const u = await repo.createUser({ email, passwordHash });
    req.session.userId = u.id || u._id;
    res.status(201).json({ user: publicUser(u) });
  } catch (e) {
    if (e?.code === 11000) {
      return res.status(409).json({ error: "email_taken", message: "An account with that email already exists" });
    }
    throw e;
  }
});

/** Login. */
authRouter.post("/login", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const repo = req.app.locals.repo || (await getRepository());
  const u = await repo.findUserByEmail(email);
  if (!u) return res.status(401).json({ error: "invalid_credentials", message: "Invalid email or password" });
  const ok = await bcrypt.compare(password, u.passwordHash);
  if (!ok) return res.status(401).json({ error: "invalid_credentials", message: "Invalid email or password" });
  req.session.userId = u.id || u._id;
  res.json({ user: publicUser(u) });
});

/** Logout. */
authRouter.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("prepkit.sid");
    res.json({ ok: true });
  });
});
