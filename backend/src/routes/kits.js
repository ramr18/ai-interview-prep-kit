import { Router } from "express";
import { getRepository } from "../repos/repo.js";
import { runPipeline, clampDays } from "../pipeline/runPipeline.js";
import { orEnum } from "../pipeline/kitSchema.js";
import { allocateSchedule } from "../pipeline/schedule.js";
import { regenerateCategoryQuestions, regenerateFlashcards, regenerateScalar, GENERATED_STATE } from "../pipeline/sectionMerge.js";
import { makeIdGen } from "../lib/ids.js";
import { generateJson } from "../lib/llm/provider.js";
import { requireAuth, requireKitOwnership } from "./middleware.js";

export const kitsRouter = Router();
kitsRouter.use(requireAuth);

kitsRouter.get("/", async (req, res) => {
  const repo = req.app.locals.repo || (await getRepository());
  res.json({ kits: await repo.findKitsByUser(req.userId) });
});

kitsRouter.get("/:id", requireKitOwnership, async (req, res) => {
  res.json({ kit: req.kit });
});

kitsRouter.delete("/:id", requireKitOwnership, async (req, res) => {
  const repo = req.app.locals.repo || (await getRepository());
  await repo.deleteKit(req.params.id);
  res.json({ ok: true });
});

kitsRouter.post("/", async (req, res) => {
  const jd = String(req.body?.jd || "").trim();
  const companyUrl = String(req.body?.companyUrl || "").trim();
  const days = clampDays(parseInt(req.body?.days, 10));
  if (!jd) return res.status(400).json({ error: "missing_jd", message: "Job description is required" });
  if (!companyUrl || !/^https?:\/\/.+/i.test(companyUrl)) {
    return res.status(400).json({ error: "invalid_url", message: "A valid company URL is required" });
  }
  const repo = req.app.locals.repo || (await getRepository());
  const kitId = "kit-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e6).toString(36);
  await repo.insertKit({
    id: kitId, userId: req.userId, status: "draft",
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    input: { jd, companyUrl, days },
    company: { name: "", website: companyUrl, brief: "", hiringProcess: { found: false, summary: "", stages: [] } },
    role: { title: "", summary: "", requirements: [] },
    questions: [], flashcards: [], schedule: [], notes: {}, gaps: [], valid: false, validationErrors: [], sources: [],
  });
  res.status(202).json({ id: kitId, status: "accepted" });
});

kitsRouter.get("/:id/stream", requireAuth, async (req, res) => {
  const repo = req.app.locals.repo || (await getRepository());
  const kit = await repo.findKitById(req.params.id);
  if (!kit) return res.status(404).end();
  if (kit.userId && kit.userId !== req.userId) return res.status(403).end();
  if (kit.status === "complete" || kit.status === "partial" || kit.status === "failed") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write("event: kit\ndata: " + JSON.stringify(kit) + "\n\n");
    res.write("event: done\ndata: {}\n\n");
    return res.end();
  }
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" });
  res.write("event: ready\ndata: {}\n\n");
  if (req.flushHeaders) req.flushHeaders();
  try {
    const result = await runPipeline(
      { jd: kit.input.jd, companyUrl: kit.input.companyUrl, days: kit.input.days },
      { kitId: kit.id, userId: req.userId, emit: (e) => res.write("event: " + e.type + "\ndata: " + JSON.stringify(e) + "\n\n"), gen: generateJson }
    );
    await repo.updateKit(kit.id, result.kit);
    res.write("event: kit\ndata: " + JSON.stringify(result.kit) + "\n\n");
    res.write("event: done\ndata: " + JSON.stringify({ ok: result.ok }) + "\n\n");
  } catch (e) {
    const failed = { ...kit, status: "failed", valid: false, validationErrors: [e.message || String(e)], updatedAt: new Date().toISOString() };
    await repo.updateKit(kit.id, failed);
    res.write("event: kit\ndata: " + JSON.stringify(failed) + "\n\n");
    res.write("event: done\ndata: " + JSON.stringify({ ok: false, error: e.message }) + "\n\n");
  } finally {
    res.end();
  }
});

kitsRouter.patch("/:id", requireKitOwnership, async (req, res) => {
  const repo = req.app.locals.repo || (await getRepository());
  const kit = req.kit;
  const patch = {};
  const body = req.body || {};

  if (body.editQuestion) {
    const { id, text, answerOutline, category, requirementIds } = body.editQuestion;
    kit.questions = (kit.questions || []).map((q) => {
      if (q.id !== id) return q;
      const next = { ...q, state: "edited" };
      if (text !== undefined) next.text = String(text);
      if (answerOutline !== undefined) next.answerOutline = String(answerOutline);
      if (category !== undefined) next.category = orEnum(category, ["technical", "behavioural", "product", "process", "company", "other"], q.category);
      if (requirementIds !== undefined) next.requirementIds = requirementIds;
      return next;
    });
    patch.questions = kit.questions;
  }

  if (body.editFlashcard) {
    const { id, front, back, requirementIds } = body.editFlashcard;
    kit.flashcards = (kit.flashcards || []).map((f) => {
      if (f.id !== id) return f;
      const next = { ...f, state: "edited" };
      if (front !== undefined) next.front = String(front);
      if (back !== undefined) next.back = String(back);
      if (requirementIds !== undefined) next.requirementIds = requirementIds;
      return next;
    });
    patch.flashcards = kit.flashcards;
  }

  if (body.brief !== undefined) {
    kit.company = { ...kit.company, brief: String(body.brief), briefState: "edited" };
    patch.company = kit.company;
  }

  if (body.roleSummary !== undefined) {
    kit.role = { ...kit.role, summary: String(body.roleSummary), summaryState: "edited" };
    patch.role = kit.role;
  }

  if (Array.isArray(body.reorderQuestions)) {
    const ids = new Set(body.reorderQuestions);
    const byId = new Map((kit.questions || []).map((q) => [q.id, q]));
    const reordered = body.reorderQuestions.map((id) => byId.get(id)).filter(Boolean);
    for (const q of kit.questions || []) if (!ids.has(q.id)) reordered.push(q);
    kit.questions = reordered;
    patch.questions = kit.questions;
  }

  if (body.addQuestion) {
    const idGen = makeIdGen("q", (kit.questions || []).map((q) => q.id));
    kit.questions = [...(kit.questions || []), {
      id: idGen(),
      category: orEnum(body.addQuestion.category, ["technical", "behavioural", "product", "process", "company", "other"], "other"),
      requirementIds: Array.isArray(body.addQuestion.requirementIds) ? body.addQuestion.requirementIds : [],
      text: String(body.addQuestion.text),
      answerOutline: String(body.addQuestion.answerOutline || ""),
      state: "created",
    }];
    patch.questions = kit.questions;
  }

  if (body.deleteQuestionId) {
    kit.questions = (kit.questions || []).filter((q) => q.id !== body.deleteQuestionId);
    patch.questions = kit.questions;
  }

  if (body.addFlashcard) {
    const idGen = makeIdGen("f", (kit.flashcards || []).map((f) => f.id));
    kit.flashcards = [...(kit.flashcards || []), {
      id: idGen(), front: String(body.addFlashcard.front), back: String(body.addFlashcard.back),
      requirementIds: Array.isArray(body.addFlashcard.requirementIds) ? body.addFlashcard.requirementIds : [],
      state: "created", practice: { confidence: 0, reviewCount: 0 },
    }];
    patch.flashcards = kit.flashcards;
  }

  if (body.deleteFlashcardId) {
    kit.flashcards = (kit.flashcards || []).filter((f) => f.id !== body.deleteFlashcardId);
    patch.flashcards = kit.flashcards;
  }

  if (body.editDay) {
    const { day, focus, questionIds, requirementIds, durationMinutes } = body.editDay;
    kit.schedule = (kit.schedule || []).map((d) => {
      if (d.day !== day) return d;
      const next = { ...d };
      if (focus !== undefined) next.focus = String(focus);
      if (questionIds !== undefined) next.questionIds = questionIds;
      if (requirementIds !== undefined) next.requirementIds = requirementIds;
      if (durationMinutes !== undefined) next.durationMinutes = parseInt(durationMinutes, 10);
      return next;
    });
    patch.schedule = kit.schedule;
  }

  patch.updatedAt = new Date().toISOString();
  const updated = await repo.updateKit(kit.id, patch);
  res.json({ kit: updated });
});

kitsRouter.post("/:id/regenerate/:section", requireKitOwnership, async (req, res) => {
  const repo = req.app.locals.repo || (await getRepository());
  const kit = req.kit;
  const section = req.params.section;
  const body = req.body || {};
  const patch = {};

  if (section === "brief") {
    const fresh = await generateJson({
      step: "brief",
      payload: {
        companyName: kit.company?.name || "", companyUrl: kit.input?.companyUrl || "",
        aboutSummary: kit.research?.aboutSummary || "",
        hiringSummary: kit.company?.hiringProcess?.found ? kit.company.hiringProcess.summary : "",
        discussionSummary: kit.research?.discussionSummary || "", sources: kit.sources || [],
      },
      maxOutputTokens: 1200,
    });
    const result = regenerateScalar(kit.company?.brief, kit.company?.briefState, fresh.brief || "");
    patch.company = { ...kit.company, brief: result.value, briefState: result.state };
  } else if (section === "roleSummary") {
    const fresh = await generateJson({
      step: "roleSummary",
      payload: {
        title: kit.role?.title || "", jd: kit.input?.jd || "",
        requirements: kit.role?.requirements || [], thinDescription: kit.notes?.thinDescription || false,
        gapCount: kit.gaps?.length || 0,
      },
      maxOutputTokens: 1200,
    });
    const result = regenerateScalar(kit.role?.summary, kit.role?.summaryState, fresh.summary || "");
    patch.role = { ...kit.role, summary: result.value, summaryState: result.state };
  } else if (section === "flashcards") {
    const fresh = await generateJson({
      step: "flashcards",
      payload: {
        requirements: kit.role?.requirements || [], questions: kit.questions || [],
        companyFacts: [kit.research?.aboutSummary, kit.company?.hiringProcess?.summary].filter(Boolean).join("\n"),
      },
      maxOutputTokens: 4000,
    });
    const idGen = makeIdGen("f", (kit.flashcards || []).map((f) => f.id));
    const freshCards = (fresh.flashcards || []).map((c) => ({
      id: idGen(), front: c.front, back: c.back, requirementIds: c.requirementIds || [],
      state: GENERATED_STATE, practice: { confidence: 0, reviewCount: 0 },
    }));
    patch.flashcards = regenerateFlashcards(kit.flashcards || [], freshCards);
  } else if (section === "schedule") {
    const sched = allocateSchedule({
      days: kit.input?.days || 7, requirements: kit.role?.requirements || [], questions: kit.questions || [],
    });
    patch.schedule = sched.schedule;
  } else if (section === "questions") {
    const category = String(body.category || "other");
    const reqs = (kit.role?.requirements || []).filter((r) => r.category === category);
    const fresh = await generateJson({
      step: "questions",
      payload: {
        category, requirements: reqs, companyName: kit.company?.name || "",
        companyContext: [kit.research?.aboutSummary, kit.research?.whatTheyDo].filter(Boolean).join("\n"),
        hiringContext: kit.company?.hiringProcess?.summary || "",
      },
      maxOutputTokens: 4000,
    });
    const idGen = makeIdGen("q", (kit.questions || []).map((q) => q.id));
    const freshQs = (fresh.questions || []).map((q) => ({
      id: idGen(), category, requirementIds: q.requirementIds || [],
      text: q.text, answerOutline: q.answerOutline || "", state: GENERATED_STATE,
    }));
    patch.questions = regenerateCategoryQuestions(kit.questions || [], category, freshQs);
  } else {
    return res.status(400).json({ error: "unknown_section", message: "Cannot regenerate \"" + section + "\"" });
  }

  patch.updatedAt = new Date().toISOString();
  const updated = await repo.updateKit(kit.id, patch);
  res.json({ kit: updated });
});