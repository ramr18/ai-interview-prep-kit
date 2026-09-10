import { makeIdGen } from "../../lib/ids.js";
import { checkCoverage } from "../coverage.js";
import { GENERATED_STATE } from "../sectionMerge.js";

/**
 * Step 4+5 - question bank.
 *
 * One generation per category with its own tailored instructions (technical,
 * behavioural, product, process, company) - the "genuine sequencing" the
 * brief requires. Then the SECOND PASS: the coverage check runs in code, and
 * any must-have requirement still uncovered triggers a dedicated gap-fill
 * call, after which coverage is checked again. We stop after the second call
 * because the gap-fill prompt already receives the full gap list: a second
 * iteration would only recover from a failed single call, which the repair
 * loop already handles, and burning more free-tier tokens for a marginally
 * better edge case is not a good trade.
 */
export async function stepQuestions(ctx, { requirements, research }) {
  ctx.emit({ type: "phase", name: "questions", status: "start" });

  const questionId = makeIdGen("q");
  const qId = () => questionId();

  const companyContext = buildCompanyContext(research);
  const hiringContext = research.hiringProcess?.summary || "";

  // Categories present in the posting, plus one company-fit category.
  const categories = [...new Set(requirements.map((r) => r.category))].filter(
    (c) => c !== "company"
  );
  if (categories.length === 0) categories.push("other");
  categories.push("company");

  const allQuestions = [];
  const categoryQuestions = new Map(); // category -> questions

  for (const category of categories) {
    const reqs = requirements.filter((r) => r.category === category);
    let questions = [];
    try {
      questions = await generateOne(ctx, {
        step: "questions",
        category,
        reqs,
        companyContext,
        hiringContext,
        research,
        qId,
      });
    } catch (e) {
      // A category failing entirely is recorded and the run continues - a
      // partial question bank is still a usable kit (and the gaps stay
      // visible in the notes).
      ctx.emit({ type: "phase", name: "questions", status: "error", category, code: e.code || "generation_failed" });
      questions = [];
    }
    const withState = questions.map((q) => ({ ...q, state: GENERATED_STATE }));
    categoryQuestions.set(category, withState);
    allQuestions.push(...withState);
  }

  // SECOND PASS -----------------------------------------------------------------
  let coverage = checkCoverage(requirements, allQuestions, { priorities: ["must"] });
  let gapPass = 0;
  const gapFills = [];
  while (!coverage.allCovered && gapPass < 1) {
    gapPass += 1;
    ctx.emit({
      type: "phase",
      name: "questions",
      status: "gap",
      attempt: gapPass,
      detail: `${coverage.gaps.length} must requirement${coverage.gaps.length === 1 ? "" : "s"} uncovered`,
    });
    const gapReqs = coverage.gaps.map((g) => ({
      id: g.requirementId,
      text: g.requirementText,
      category: g.category,
      priority: "must",
    }));
    let fresh = [];
    try {
      fresh = await generateOne(ctx, {
        step: "gapquestions",
        category: "other",
        reqs: gapReqs,
        companyContext,
        hiringContext,
        research,
        qId,
      });
    } catch (e) {
      ctx.emit({ type: "phase", name: "questions", status: "error", category: "gap", code: e.code || "gap_failed" });
      fresh = [];
    }
    const freshWithState = fresh.map((q) => ({ ...q, state: GENERATED_STATE }));
    gapFills.push(...freshWithState);
    allQuestions.push(...freshWithState);
    coverage = checkCoverage(requirements, allQuestions, { priorities: ["must"] });
  }

  // Re-categorise gap questions by the first requirement they cover so the
  // builder stays tidy.
  const reqByCategory = new Map(requirements.map((r) => [r.id, r]));
  for (const q of allQuestions) {
    const better = q.requirementIds
      .map((id) => reqByCategory.get(id)?.category)
      .find(Boolean);
    if (better && better !== "company") q.category = better;
  }
  for (const [cat] of categoryQuestions) {
    categoryQuestions.set(cat, allQuestions.filter((q) => q.category === cat));
  }

  ctx.emit({
    type: "phase",
    name: "questions",
    status: "ok",
    detail: `${allQuestions.length} questions; ${coverage.gaps.length} residual gap${coverage.gaps.length === 1 ? "" : "s"}`,
  });

  return {
    questions: allQuestions,
    categoryQuestions,
    gaps: coverage.gaps.map((g) => ({
      requirementId: g.requirementId,
      text: g.requirementText,
    })),
    gapFills,
    coverage,
  };
}

async function generateOne(
  ctx,
  { step, category, reqs, companyContext, hiringContext, research, qId }
) {
  const res = await ctx.gen({
    step,
    payload: {
      category,
      requirements: reqs,
      gaps: reqs,
      companyName: research.companyName || safeHostname(research.companyUrl || "") || "the company",
      companyContext,
      hiringContext,
    },
    maxOutputTokens: 4000,
  });
  const raw = Array.isArray(res?.questions) ? res.questions : [];
  const questions = [];
  const seen = new Set();
  const requirementIds = new Set(reqs.map((requirement) => requirement.id));
  for (const q of raw) {
    const text = String(q?.text || "").trim();
    if (text.length < 8) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    questions.push({
      id: qId(),
      category,
      requirementIds: Array.isArray(q.requirementIds)
        ? q.requirementIds.filter((id) => requirementIds.has(id))
        : [],
      text,
      answerOutline: String(q?.answerOutline || "").trim(),
    });
  }
  return questions;
}

function buildCompanyContext(research) {
  const parts = [];
  if (research.aboutText) parts.push(research.aboutText.slice(0, 2000));
  if (research.whatTheyDo) parts.push(`What they do: ${research.whatTheyDo}`);
  if (research.values?.length) parts.push(`Values: ${research.values.join(", ")}`);
  const hiring = research.hiringProcess;
  if (hiring?.found && hiring.stages?.length) {
    parts.push(`Interview stages: ${hiring.stages.map((s) => s.name).join(" -> ")}.`);
  }
  return parts.join("\n").slice(0, 2600) || "No retrievable company details.";
}

function safeHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}