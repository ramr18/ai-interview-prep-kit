import { z } from "zod";

/** Canonical kit schema. Extensible, but these fields are fixed (Appendix A). */

export const CATEGORIES = ["technical", "behavioural", "product", "process", "company", "other"];
export const PRIORITIES = ["must", "nice"];
export const ITEM_STATES = ["generated", "edited", "created", "pinned"];

export const requirementSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  priority: z.enum(PRIORITIES),
  category: z.enum(CATEGORIES).or(z.string()),
});

export const questionSchema = z
  .object({
    id: z.string().min(1),
    category: z.enum(CATEGORIES),
    requirementIds: z.array(z.string()),
    text: z.string().min(1),
    answerOutline: z.string().default(""),
    state: z.enum(ITEM_STATES).default("generated"),
  })
  .passthrough();

export const flashcardSchema = z
  .object({
    id: z.string().min(1),
    front: z.string().min(1),
    back: z.string().min(1),
    requirementIds: z.array(z.string()),
    state: z.enum(ITEM_STATES).default("generated"),
    practice: z
      .object({
        confidence: z.number().int().min(0).max(5).default(0),
        reviewCount: z.number().int().min(0).default(0),
        lastReviewedAt: z.string().optional(),
      })
      .passthrough()
      .default({}),
  })
  .passthrough();

export const daySchema = z.object({
  day: z.number().int().min(1),
  focus: z.string(),
  questionIds: z.array(z.string()),
  requirementIds: z.array(z.string()),
  durationMinutes: z.number().int().min(1).max(1440),
});

export const sourceSchema = z
  .object({
    url: z.string(),
    kind: z.enum(["site", "discussion"]),
    title: z.string().default(""),
    accessedAt: z.string().optional(),
    skipped: z.boolean().default(false),
    reason: z.string().default(""),
  })
  .passthrough();

export const hiringProcessSchema = z
  .object({
    found: z.boolean().default(false),
    summary: z.string().default(""),
    stages: z.array(z.object({ name: z.string(), description: z.string().default("") })).default([]),
  })
  .passthrough();

export const kitSchema = z
  .object({
    schemaVersion: z.string().default("1.0.0"),
    id: z.string().min(1),
    caseId: z.string().optional().nullable(),
    userId: z.string().optional().nullable(),
    status: z.enum(["draft", "complete", "partial", "failed"]).default("draft"),
    createdAt: z.string(),
    updatedAt: z.string(),
    input: z
      .object({
        jd: z.string(),
        companyUrl: z.string(),
        days: z.number().int().min(1).max(60),
        jdHash: z.string().optional().default(""),
      })
      .passthrough(),
    company: z
      .object({
        name: z.string().default(""),
        website: z.string().default(""),
        brief: z.string().default(""),
        briefState: z.string().optional().default("generated"),
        hiringProcess: hiringProcessSchema.default({}),
      })
      .passthrough(),
    role: z
      .object({
        title: z.string().default(""),
        summary: z.string().default(""),
        summaryState: z.string().optional().default("generated"),
        requirements: z.array(requirementSchema).default([]),
      })
      .passthrough(),
    questions: z.array(questionSchema).default([]),
    flashcards: z.array(flashcardSchema).default([]),
    schedule: z.array(daySchema).default([]),
    notes: z
      .object({
        thinDescription: z.boolean().default(false),
        noHiringPage: z.boolean().default(false),
        noDiscussion: z.boolean().default(false),
        message: z.string().default(""),
      })
      .passthrough()
      .default({}),
    research: z
      .object({
        aboutSummary: z.string().default(""),
        whatTheyDo: z.string().default(""),
        values: z.array(z.string()).default([]),
        hiringSummary: z.string().default(""),
        hiringStages: z.array(z.object({ name: z.string(), description: z.string().default("") })).default([]),
        discussionSummary: z.string().default(""),
        discussionThemes: z.array(z.string()).default([]),
      })
      .passthrough()
      .default({}),
    gaps: z.array(z.object({ requirementId: z.string(), text: z.string() })).default([]),
    valid: z.boolean().default(false),
    validationErrors: z.array(z.string()).default([]),
    sources: z.array(sourceSchema).default([]),
  })
  .passthrough();

function zodErrors(error) {
  const out = [];
  for (const issue of error.issues || []) {
    out.push(`${issue.path.join(".")}: ${issue.message}`);
  }
  if (out.length === 0) out.push(error.message || "validation failed");
  return out;
}

/**
 * Validate a kit against the schema AND the cross-field rules that make kits
 * comparable between submissions:
 *   - ids unique per collection, requirement references valid,
 *   - schedule spans exactly `expectedDays` contiguous days (1..N),
 *   - every must-have requirement appears somewhere in the schedule,
 *   - every must-have requirement is covered by a question,
 *   - schedule question ids exist, durations are integer minutes.
 *
 * @returns {{valid:boolean, errors:string[], value?:object}}
 */
export function validateKit(kit, { expectedDays = null } = {}) {
  const parsed = kitSchema.safeParse(kit);
  if (!parsed.success) {
    return { valid: false, errors: zodErrors(parsed.error), value: null };
  }
  const value = parsed.data;
  const errors = [];

  const reqIds = new Set(value.role.requirements.map((r) => r.id));
  const qIds = new Set(value.questions.map((q) => q.id));

  assertUnique("question", value.questions.map((q) => q.id), errors);
  assertUnique("flashcard", value.flashcards.map((f) => f.id), errors);
  assertUnique("requirement", value.role.requirements.map((r) => r.id), errors);

  for (const q of value.questions) {
    for (const rid of q.requirementIds) {
      if (!reqIds.has(rid)) errors.push(`question ${q.id} references unknown requirement ${rid}`);
    }
  }
  for (const f of value.flashcards) {
    for (const rid of f.requirementIds) {
      if (!reqIds.has(rid)) errors.push(`flashcard ${f.id} references unknown requirement ${rid}`);
    }
  }

  // Schedule rules ---------------------------------------------------------
  const wantDays = expectedDays ?? value.input?.days;
  if (wantDays) {
    if (value.schedule.length !== wantDays) {
      errors.push(`schedule has ${value.schedule.length} days, expected ${wantDays}`);
    } else {
      value.schedule.forEach((d, i) => {
        if (d.day !== i + 1) errors.push(`schedule day ${d.day} out of sequence (expected ${i + 1})`);
        for (const qid of d.questionIds) {
          if (!qIds.has(qid)) errors.push(`day ${d.day} references unknown question ${qid}`);
        }
      });
    }
  }

  const mustIds = new Set(value.role.requirements.filter((r) => r.priority === "must").map((r) => r.id));
  const coveredReqIds = new Set(value.questions.flatMap((q) => q.requirementIds));
  for (const mid of mustIds) {
    if (!coveredReqIds.has(mid)) {
      errors.push(`must-have requirement ${mid} is not covered by any question`);
    }
  }
  const scheduledReqIds = new Set(value.schedule.flatMap((d) => d.requirementIds));
  for (const mid of mustIds) {
    if (!scheduledReqIds.has(mid)) {
      errors.push(`must-have requirement ${mid} does not appear anywhere in the schedule`);
    }
  }

  const notes = value.notes || {};
  if (value.role.requirements.length === 0 && !notes.thinDescription) {
    // A zero-requirement kit is only honest when the description is thin.
    errors.push("kit has no requirements but notes.thinDescription is false");
  }

  const valid = errors.length === 0;
  return {
    valid,
    errors,
    value: valid ? value : null,
  };
}

function assertUnique(kind, ids, errors) {
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) errors.push(`duplicate ${kind} id ${id}`);
    seen.add(id);
  }
}

/** Normalise an enumerated value with a fallback. */
export function orEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}