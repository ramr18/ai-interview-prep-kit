/**
 * State model for the builder.
 *
 * Every mutable item carries a state:
 *   generated - produced by the pipeline, may be replaced by a regeneration
 *   edited    - the user changed it; regeneration MUST keep it as-is
 *   created   - the user added it by hand; regeneration keeps it
 *   pinned    - the user explicitly pinned it; regeneration keeps it
 *
 * Regeneration is always scoped to ONE section (a question category, the
 * flashcards, one scalar). It only replaces items whose state is
 * "generated", so edits made anywhere else in the kit survive untouched.
 * This is pure code so it is unit-tested and shared by the API and any future
 * batch "regenerate" mode.
 */

export const PROTECTED_STATES = new Set(["edited", "created", "pinned"]);
export const GENERATED_STATE = "generated";

/** Regenerate one question category: keep protected items, drop stale ones. */
export function regenerateCategoryQuestions(currentQuestions, category, freshQuestions) {
  const kept = currentQuestions.filter(
    (q) => q.category !== category || PROTECTED_STATES.has(q.state)
  );
  const fresh = (freshQuestions || [])
    .filter((q) => q && String(q.text || "").trim().length > 0)
    .map((q) => ({ ...q, state: GENERATED_STATE }));
  return [...kept, ...fresh];
}

/** Regenerate flashcards: keep protected cards, add fresh (deduped by front). */
export function regenerateFlashcards(current, fresh) {
  const kept = current.filter((f) => PROTECTED_STATES.has(f.state));
  const keptFronts = new Set(kept.map((f) => normalizeKey(f.front)));
  const added = (fresh || [])
    .filter((f) => f && !keptFronts.has(normalizeKey(f.front)))
    .map((f) => ({ ...f, state: GENERATED_STATE }));
  return [...kept, ...added];
}

/** Regenerate a scalar section (brief / role summary) honouring its state. */
export function regenerateScalar(currentValue, currentState, freshValue) {
  if (PROTECTED_STATES.has(currentState)) return { value: currentValue, state: currentState };
  return { value: freshValue, state: GENERATED_STATE };
}

/** Fresh questions get stable ids appended past any existing ones. */
export function assignStates(items, state = GENERATED_STATE) {
  return items.map((it) => ({ ...it, state }));
}

export function normalizeKey(s) {
  return String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
}