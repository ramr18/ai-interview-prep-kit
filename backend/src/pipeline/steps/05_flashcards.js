import { makeIdGen } from "../../lib/ids.js";
import { GENERATED_STATE } from "../sectionMerge.js";

/**
 * Step 6 - flashcards.
 *
 * One flashcard per key question (front = short question, back = condensed
 * answer outline) plus at most a couple of company-fact cards. requirementIds
 * are carried through so a card is still traceable to coverage.
 */
export async function stepFlashcards(ctx, { requirements, questions, research }) {
  ctx.emit({ type: "phase", name: "flashcards", status: "start" });

  const cardId = makeIdGen("f");
  const companyFacts = [
    research.aboutSummary,
    research.whatTheyDo,
    research.hiringProcess?.summary ? `How they hire: ${research.hiringProcess.summary}` : "",
    research.companyName ? `Company: ${research.companyName}` : "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 1200);

  let raw = [];
  try {
    const res = await ctx.gen({
      step: "flashcards",
      payload: { requirements, questions, companyFacts },
      maxOutputTokens: 4000,
    });
    raw = Array.isArray(res?.flashcards) ? res.flashcards : [];
  } catch (e) {
    ctx.emit({ type: "phase", name: "flashcards", status: "error", code: e.code || "generation_failed" });
    raw = [];
  }

  const seen = new Set();
  const requirementIds = new Set(requirements.map((requirement) => requirement.id));
  const flashcards = [];
  for (const card of raw) {
    const front = String(card?.front || "").trim();
    const back = String(card?.back || "").trim();
    if (!front || !back) continue;
    const key = front.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    flashcards.push({
      id: cardId(),
      front,
      back,
      requirementIds: Array.isArray(card?.requirementIds)
        ? card.requirementIds.filter((id) => requirementIds.has(id))
        : [],
      state: GENERATED_STATE,
      practice: { confidence: 0, reviewCount: 0 },
    });
  }

  // Never ship an empty flashcard deck when we have questions - fall back to
  // one honest card per generated question built in code.
  if (flashcards.length === 0 && questions.length > 0) {
    for (const q of questions.slice(0, 10)) {
      flashcards.push({
        id: cardId(),
        front: q.text.length > 120 ? `${q.text.slice(0, 117)}...` : q.text,
        back: q.answerOutline || "Answer outline missing - review your notes.",
        requirementIds: q.requirementIds,
        state: GENERATED_STATE,
        practice: { confidence: 0, reviewCount: 0 },
      });
    }
  }

  ctx.emit({
    type: "phase",
    name: "flashcards",
    status: "ok",
    detail: `${flashcards.length} card${flashcards.length === 1 ? "" : "s"}`,
  });
  return flashcards;
}