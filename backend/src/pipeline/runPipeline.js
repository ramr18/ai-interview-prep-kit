import { env } from "../config/env.js";
import { makeHostGate } from "./steps/02_research.js";
import { stepExtract } from "./steps/01_extract.js";
import { stepResearch } from "./steps/02_research.js";
import { stepDiscussion } from "./steps/03_discussion.js";
import { stepQuestions } from "./steps/04_questions.js";
import { stepFlashcards } from "./steps/05_flashcards.js";
import { stepSections } from "./steps/06_sections.js";
import { allocateSchedule } from "./schedule.js";
import { validateKit } from "./kitSchema.js";
import { submissionHash } from "../lib/ids.js";
import { generateJson } from "../lib/llm/provider.js";

/**
 * The research + generation pipeline, as a deliberate sequence of steps.
 *
 *   1. extract       - requirements from the pasted JD only (no retrieval),
 *   2. research      - crawl the company site (ranked BFS), classify pages,
 *                      summarise what they do + how they hire,
 *   3. discussion    - public web search for how the company interviews,
 *   4. questions     - per-category generation + deterministic coverage
 *                      check + second pass gap-fill + recheck,
 *   5. flashcards    - condensed study cards,
 *   6. sections      - company brief + role breakdown,
 *   7. schedule      - arithmetical allocation across exactly N days, plus
 *   8. schema validation with meaningful errors.
 *
 * The schedule allocation and the coverage check are PURE code and are never
 * handed to the model (the brief is exact on that point).
 */
export async function runPipeline(input, {
  kitId = "kit-" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36),
  userId = null,
  caseId = null,
  emit = null,
  gen = generateJson,
} = {}) {
  const events = [];
  const onEvent = (e) => {
    events.push(e);
    if (emit) try { emit(e); } catch { /* never let a UI callback break a run */ }
  };

  const ctx = {
    emit: onEvent,
    gen,
    gate: makeHostGate(),
    allowPrivate: env.allowPrivateUrls,
  };

  const started = new Date().toISOString();
  const fail = (status, code, message, notes = {}) => {
    base.status = status;
    base.valid = false;
    base.validationErrors = [message];
    base.updatedAt = new Date().toISOString();
    Object.assign(base.notes, notes);
    return { kit: base, ok: false, error: { code, message }, events };
  };

  const base = {
    id: kitId,
    caseId,
    userId,
    status: "draft",
    createdAt: started,
    updatedAt: started,
    input: {
      jd: input.jd,
      companyUrl: input.companyUrl,
      days: clampDays(input.days),
      jdHash: submissionHash(input.jd, input.companyUrl),
    },
    company: { name: "", website: input.companyUrl, brief: "", briefState: "generated", hiringProcess: { found: false, summary: "", stages: [] } },
    role: { title: "", summary: "", summaryState: "generated", requirements: [] },
    questions: [],
    flashcards: [],
    schedule: [],
    notes: { thinDescription: false, noHiringPage: false, noDiscussion: false, message: "" },
    research: {
      aboutSummary: "",
      whatTheyDo: "",
      values: [],
      hiringSummary: "",
      hiringStages: [],
      discussionSummary: "",
      discussionThemes: [],
    },
    gaps: [],
    valid: false,
    validationErrors: [],
    sources: [],
  };

  try {
    onEvent({ type: "phase", name: "pipeline", status: "start", kitId });
    // ---- 1. extract (pasted text: no retrieval needed) ----
    const extraction = await stepExtract(ctx, { jd: input.jd });
    base.role.title = extraction.title;
    base.role.requirements = extraction.requirements;
    base.notes.thinDescription = extraction.thinDescription;
    base.notes.message = extraction.thinDescription
      ? "The job description is thin; the kit reflects only what the posting actually contains."
      : "";

    // ---- 2. research the company site ----
    let research;
    try {
      research = await stepResearch(ctx, { companyUrl: input.companyUrl });
    } catch (e) {
      research = {
        crawl: { pages: [], failures: [] },
        companyName: "",
        aboutSummary: "",
        whatTheyDo: "",
        values: [],
        aboutText: "",
        hiringText: "",
        hiringPageFound: false,
        hiringProcess: { found: false, summary: "", stages: [] },
        discussion: { found: false, summary: "", themes: [] },
        sources: [{ url: input.companyUrl, kind: "site", skipped: true, reason: e.message }],
      };
      base.notes.noHiringPage = true;
      base.notes.message = combine(base.notes.message, "Could not retrieve the company site.");
    }
    base.sources.push(...research.sources);
    base.company.name = research.companyName || safeHostname(input.companyUrl);
    base.company.hiringProcess = research.hiringProcess;
    base.research.aboutSummary = research.aboutSummary || "";
    base.research.whatTheyDo = research.whatTheyDo || "";
    base.research.values = research.values || [];
    base.research.hiringSummary = research.hiringProcess?.summary || "";
    base.research.hiringStages = research.hiringProcess?.stages || [];
    base.notes.noHiringPage = !research.hiringPageFound && research.crawl?.crawledCount > 0;

    // ---- 3. public discussion ----
    let discussion = { found: false, summary: "", themes: [] };
    if (research.hiringPageFound || research.crawl?.crawledCount > 0) {
      try {
        const d = await stepDiscussion(ctx, {
          companyName: base.company.name,
          companyUrl: input.companyUrl,
        });
        discussion = d.discussion;
        base.sources.push(...d.sources);
      } catch (e) {
        discussion = { found: false, summary: "", themes: [] };
      }
    }
    base.notes.noDiscussion = !discussion.found;
    base.research.discussionSummary = discussion.summary || "";
    base.research.discussionThemes = discussion.themes || [];

    // ---- 4. question bank (per-category + second pass) ----
    const q = await stepQuestions(ctx, { requirements: extraction.requirements, research: { ...research, companyUrl: input.companyUrl } });
    base.questions = q.questions;
    base.gaps = q.gaps;

    // ---- 5. flashcards ----
    base.flashcards = await stepFlashcards(ctx, {
      requirements: extraction.requirements,
      questions: q.questions,
      research: { ...research, companyUrl: input.companyUrl },
    });

    // ---- 6. brief + role breakdown ----
    const sections = await stepSections(ctx, {
      input,
      extraction,
      research: { ...research, companyUrl: input.companyUrl },
      discussion,
      sources: base.sources,
      questions: q.questions,
      gaps: q.gaps,
    });
    base.company.brief = sections.brief;
    base.company.briefState = sections.briefState;
    base.role.summary = sections.roleSummary;
    base.role.summaryState = sections.roleSummaryState;

    // ---- 7. schedule (arithmetic, in code) ----
    const sched = allocateSchedule({ days: input.days, requirements: extraction.requirements, questions: q.questions });
    base.schedule = sched.schedule;
    base.input.days = sched.daysCount;

    base.status = "complete";
    base.updatedAt = new Date().toISOString();

    // ---- 8. validate ----
    const check = validateKit(base, { expectedDays: base.input.days });
    base.valid = check.valid;
    base.validationErrors = check.errors;
    if (!check.valid) {
      base.status = "partial";
      base.notes.message = combine(
        base.notes.message,
        `Validation left ${check.errors.length} issue(s): ${check.errors.slice(0, 3).join("; ")}`
      );
    }

    onEvent({ type: "phase", name: "pipeline", status: "done", valid: check.valid, errors: check.errors.length });
    return { kit: base, ok: true, error: null, events, validation: check };
  } catch (e) {
    const code = e?.code || "pipeline_failed";
    const message = e?.message || String(e);
    onEvent({ type: "phase", name: "pipeline", status: "error", code, message });
    base.status = "failed";
    base.valid = false;
    base.validationErrors = [message];
    base.updatedAt = new Date().toISOString();
    return { kit: base, ok: false, error: { code, message }, events };
  }
}

export function clampDays(days) {
  if (!Number.isInteger(days)) return 1;
  return Math.min(60, Math.max(1, days));
}

export function combine(a, b) {
  return [a, b].filter(Boolean).join(" ");
}

function safeHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}