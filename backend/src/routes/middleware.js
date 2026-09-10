/**
 * Require an authenticated session. Attaches req.userId.
 */
export function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "unauthenticated", message: "You must be signed in" });
  }
  req.userId = req.session.userId;
  next();
}

/** Ensure the kit belongs to the signed-in user. */
export async function requireKitOwnership(req, res, next) {
  const repo = req.app.locals.repo;
  const kit = await repo.findKitById(req.params.id);
  if (!kit) return res.status(404).json({ error: "not_found", message: "Kit not found" });
  if (kit.userId !== req.userId) {
    return res.status(403).json({ error: "forbidden", message: "This kit belongs to another user" });
  }
  req.kit = kit;
  next();
}
