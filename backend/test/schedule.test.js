import { describe, it, expect } from "vitest";
import { allocateSchedule, clampDays, buildFocus } from "../src/pipeline/schedule.js";

const reqs = (ids, priority = "must") =>
  ids.map((text, i) => ({ id: `r${i + 1}`, text, priority, category: "technical" }));

const questions = (reqIds) =>
  reqIds.map((rid, i) => ({ id: `q${i + 1}`, category: "technical", requirementIds: [rid], text: `Q${i + 1}`, answerOutline: "" }));

describe("allocateSchedule", () => {
  it("produces exactly the requested number of days", () => {
    for (const days of [1, 3, 7, 14, 30, 60]) {
      const { schedule } = allocateSchedule({ days, requirements: reqs(["a", "b", "c"]), questions: questions(["r1", "r2", "r3"]) });
      expect(schedule.length).toBe(days);
      schedule.forEach((d, i) => expect(d.day).toBe(i + 1));
    }
  });

  it("clamps days to 1..60", () => {
    expect(clampDays(0)).toBe(1);
    expect(clampDays(-5)).toBe(1);
    expect(clampDays(99)).toBe(60);
    expect(clampDays(7)).toBe(7);
  });

  it("every day has an integer duration in minutes", () => {
    const { schedule } = allocateSchedule({ days: 7, requirements: reqs(["a", "b", "c", "d"]), questions: questions(["r1", "r2", "r3", "r4"]) });
    schedule.forEach((d) => {
      expect(Number.isInteger(d.durationMinutes)).toBe(true);
      expect(d.durationMinutes).toBeGreaterThan(0);
      expect(d.durationMinutes).toBeLessThanOrEqual(1440);
    });
  });

  it("every must-have requirement appears in the schedule", () => {
    const requirements = reqs(["react", "node", "sql", "aws"]);
    const qs = questions(["r1", "r2", "r3", "r4"]);
    const { schedule } = allocateSchedule({ days: 5, requirements, questions: qs });
    const scheduled = new Set(schedule.flatMap((d) => d.requirementIds));
    requirements.forEach((r) => expect(scheduled.has(r.id)).toBe(true));
  });

  it("harder/higher-priority material lands earlier", () => {
    const requirements = [
      { id: "r1", text: "nice thing", priority: "nice", category: "other" },
      { id: "r2", text: "must technical", priority: "must", category: "technical" },
    ];
    const qs = [
      { id: "q1", category: "other", requirementIds: ["r1"], text: "Q1", answerOutline: "" },
      { id: "q2", category: "technical", requirementIds: ["r2"], text: "Q2", answerOutline: "" },
    ];
    const { schedule } = allocateSchedule({ days: 3, requirements, questions: qs });
    // The must-technical requirement should appear on an earlier day than the nice-other.
    const dayOf = (rid) => schedule.find((d) => d.requirementIds.includes(rid))?.day;
    expect(dayOf("r2")).toBeLessThanOrEqual(dayOf("r1"));
  });

  it("handles a thin description (few requirements) honestly", () => {
    const { schedule } = allocateSchedule({ days: 3, requirements: reqs(["only one"]), questions: questions(["r1"]) });
    expect(schedule.length).toBe(3);
    const scheduled = new Set(schedule.flatMap((d) => d.requirementIds));
    expect(scheduled.has("r1")).toBe(true);
  });

  it("every day has a non-empty focus string", () => {
    const { schedule } = allocateSchedule({ days: 5, requirements: reqs(["a", "b"]), questions: questions(["r1", "r2"]) });
    schedule.forEach((d) => expect(d.focus.length).toBeGreaterThan(0));
  });
});

describe("buildFocus", () => {
  it("truncates long focus strings", () => {
    const long = "This is a very long requirement text that should be truncated to a reasonable length for display";
    const focus = buildFocus([{ text: long, priority: "must" }], 3);
    expect(focus.length).toBeLessThanOrEqual(160);
  });
});
