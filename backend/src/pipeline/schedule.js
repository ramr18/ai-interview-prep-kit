/**
 * Schedule allocation - PURE arithmetic, never handed to the model.
 *
 * Rules enforced here (and re-checked by the validator + tests):
 *   - exactly the requested number of days (clamped to 1..60),
 *   - every day has a focus string and an integer duration in minutes,
 *   - EVERY must-have requirement appears in some day's requirementIds,
 *   - hardest / highest-priority material lands earlier, not the night before,
 *   - leftover questions are spread across the later half as review.
 */

export const CATEGORY_WEIGHT = { technical: 4, process: 3, product: 3, behavioural: 2, other: 1 };

export function clampDays(days) {
  return Math.min(60, Math.max(1, Number.isInteger(days) ? days : 1));
}

export function allocateSchedule({ days, requirements, questions }) {
  const numDays = clampDays(days);
  const mustIds = new Set(requirements.filter((r) => r.priority === "must").map((r) => r.id));

  // requirement -> questions covering it (best first: covers most must ids)
  const byReq = new Map();
  for (const q of questions) {
    for (const rid of q.requirementIds || []) {
      if (!byReq.has(rid)) byReq.set(rid, []);
      byReq.get(rid).push(q);
    }
  }
  const mustCoverage = (q) => q.requirementIds.filter((id) => mustIds.has(id)).length;

  // One "study unit" per requirement, tied to its best question.
  const units = requirements.map((req) => {
    const qs = (byReq.get(req.id) || []).slice().sort((a, b) => mustCoverage(b) - mustCoverage(a));
    return { req, questionId: qs.length ? qs[0].id : null };
  });

  // Hardest + most important first: must > nice, then category weight, then order in posting.
  const score = (u) =>
    (u.req.priority === "must" ? 100_000 : 0) + (CATEGORY_WEIGHT[u.req.category] || 1) * 1000;
  units.sort((a, b) => {
    const d = score(b) - score(a);
    return d !== 0 ? d : requirements.indexOf(a.req) - requirements.indexOf(b.req);
  });

  const dayData = Array.from({ length: numDays }, (_, i) => ({
    day: i + 1,
    questionIds: new Set(),
    requirementIds: new Set(),
  }));

  // Contiguous chunks of the sorted (hardest-first) list: earlier days get the
  // harder material, later days the lighter weight.
  const bucket = (index) =>
    Math.min(numDays - 1, Math.max(0, Math.floor((index / units.length) * numDays)));

  units.forEach((u, i) => {
    const d = dayData[bucket(i)];
    d.requirementIds.add(u.req.id);
    if (u.questionId) d.questionIds.add(u.questionId);
  });

  // Leftover questions (company-fit, process, ...) go into the later half as
  // review material - never stacked onto the night before as something new.
  const planned = new Set(units.map((u) => u.questionId).filter(Boolean));
  const remaining = questions.filter((q) => !planned.has(q.id));
  const laterCount = Math.max(1, Math.floor(numDays / 2));
  const laterStart = Math.max(0, numDays - laterCount);
  remaining.forEach((q, i) => {
    const d = Math.min(numDays - 1, laterStart + (i % laterCount));
    dayData[d].questionIds.add(q.id);
  });

  const reqById = new Map(requirements.map((r) => [r.id, r]));

  const schedule = dayData.map((d) => {
    const reqs = [...d.requirementIds].map((id) => reqById.get(id)).filter(Boolean);
    const focus = buildFocus(reqs, d.questionIds.size);
    let mins =
      reqs.reduce((acc, r) => acc + (r.priority === "must" ? 25 : 15), 0) +
      d.questionIds.size * 5;
    if (numDays === 1) mins = Math.min(240, Math.max(45, mins));
    else if (reqs.length === 0 && d.questionIds.size === 0) mins = Math.min(30, Math.max(10, mins));
    else mins = Math.min(240, Math.max(15, mins));
    return {
      day: d.day,
      focus,
      questionIds: [...d.questionIds],
      requirementIds: [...d.requirementIds],
      durationMinutes: mins, // integer minutes, guaranteed by construction
    };
  });

  return {
    schedule,
    daysCount: numDays,
    totalMinutes: schedule.reduce((a, d) => a + d.durationMinutes, 0),
    unitsScheduled: units.length,
  };
}

export function buildFocus(reqs, questionCount) {
  const MAX = 160;
  let text = reqs.map((r) => shorten(r.text, 46)).join("; ");
  if (!text) text = questionCount > 0 ? "Question review" : "Review & weak spots";
  let focus = text;
  if (questionCount > 0) {
    const suffix = ` + ${questionCount} question${questionCount === 1 ? "" : "s"}`;
    focus = shorten(text, MAX - suffix.length) + suffix;
  }
  return focus.slice(0, MAX);
}

export function shorten(text, n) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (s.length <= n) return s;
  const cut = s.slice(0, n - 1);
  const at = cut.lastIndexOf(" ");
  return (at > n * 0.5 ? cut.slice(0, at) : cut) + "\u2026";
}