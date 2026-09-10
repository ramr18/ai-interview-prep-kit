/**
 * Coverage checking - PURE code, never handed to the model.
 *
 * A requirement is "covered" when at least one question references its id in
 * question.requirementIds. Only 'must' requirements count for pass/fail, but
 * the checker can be asked to scan any priority subset.
 */
export function checkCoverage(requirements, questions, { priorities = ["must"] } = {}) {
  const wanted = requirements.filter((r) => priorities.includes(r.priority));

  const questionByRequirement = new Map();
  for (const q of questions) {
    for (const rid of q.requirementIds || []) {
      if (!questionByRequirement.has(rid)) questionByRequirement.set(rid, []);
      questionByRequirement.get(rid).push(q);
    }
  }

  const covered = [];
  const gaps = [];
  for (const req of wanted) {
    const qs = questionByRequirement.get(req.id) || [];
    if (qs.length > 0) {
      covered.push({ requirementId: req.id, requirementText: req.text, questionIds: qs.map((q) => q.id) });
    } else {
      gaps.push({ requirementId: req.id, requirementText: req.text, category: req.category });
    }
  }

  return {
    covered,
    gaps,
    allCovered: gaps.length === 0,
    total: wanted.length,
    coveredCount: covered.length,
  };
}

/** Which questions cover at least one of the given requirement ids. */
export function questionsCovering(questions, requirementIds) {
  const wanted = new Set(requirementIds);
  return questions.filter((q) => q.requirementIds?.some((rid) => wanted.has(rid)));
}

/** Deterministic ordering key: category weight then requirement text. */
export function coverageKey(requirement) {
  const WEIGHTS = { technical: 4, process: 3, product: 3, behavioural: 2, other: 1 };
  return `${WEIGHTS[requirement.category] || 1}-${requirement.text}`;
}