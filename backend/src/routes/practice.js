import { Router } from "express";
import { getRepository } from "../repos/repo.js";
import { requireAuth, requireKitOwnership } from "./middleware.js";

export const practiceRouter = Router();

practiceRouter.use(requireAuth);

/**
 * Record a confidence rating (0-5) for a flashcard. The next session is
 * ordered by lowest confidence first (a simple confidence-weighted sort).
 */
practiceRouter.post("/:id/rate/:cardId", requireKitOwnership, async (req, res) => {
  const repo = req.app.locals.repo || (await getRepository());
  const kit = req.kit;
  const confidence = Math.min(5, Math.max(0, parseInt(req.body?.confidence, 10) || 0));

  kit.flashcards = (kit.flashcards || []).map((f) => {
    if (f.id !== req.params.cardId) return f;
    return {
      ...f,
      practice: {
        confidence,
        reviewCount: (f.practice?.reviewCount || 0) + 1,
        lastReviewedAt: new Date().toISOString(),
      },
    };
  });
  const updated = await repo.updateKit(kit.id, {
    flashcards: kit.flashcards,
    updatedAt: new Date().toISOString(),
  });
  res.json({ kit: updated });
});

/**
 * Get the practice session: flashcards ordered by lowest confidence first,
 * with coverage stats.
 */
practiceRouter.get("/:id/session", requireKitOwnership, async (req, res) => {
  const kit = req.kit;
  const cards = (kit.flashcards || []).slice().sort((a, b) => {
    const ca = a.practice?.confidence || 0;
    const cb = b.practice?.confidence || 0;
    if (ca !== cb) return ca - cb;
    return (a.practice?.reviewCount || 0) - (b.practice?.reviewCount || 0);
  });
  const reviewed = cards.filter((c) => (c.practice?.reviewCount || 0) > 0).length;
  res.json({
    cards,
    total: cards.length,
    reviewed,
    unreviewed: cards.length - reviewed,
    averageConfidence: cards.length
      ? cards.reduce((a, c) => a + (c.practice?.confidence || 0), 0) / cards.length
      : 0,
  });
});
