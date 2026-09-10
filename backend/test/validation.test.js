import { describe, it, expect } from "vitest";
import { validateKit } from "../src/pipeline/kitSchema.js";

function makeKit(overrides = {}) {
  return {
    id: "kit-1",
    status: "complete",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    input: { jd: "test", companyUrl: "https://example.com", days: 3, jdHash: "abc" },
    company: { name: "Ex", website: "https://example.com", brief: "Brief", briefState: "generated", hiringProcess: { found: false, summary: "", stages: [] } },
    role: { title: "Eng", summary: "Summary", summaryState: "generated", requirements: [
      { id: "r1", text: "React", priority: "must", category: "technical" },
      { id: "r2", text: "Node", priority: "must", category: "technical" },
    ] },
    questions: [
      { id: "q1", category: "technical", requirementIds: ["r1"], text: "Q1", answerOutline: "", state: "generated" },
      { id: "q2", category: "technical", requirementIds: ["r2"], text: "Q2", answerOutline: "", state: "generated" },
    ],
    flashcards: [{ id: "f1", front: "F", back: "B", requirementIds: ["r1"], state: "generated", practice: { confidence: 0, reviewCount: 0 } }],
    schedule: [
      { day: 1, focus: "Day 1", questionIds: ["q1"], requirementIds: ["r1"], durationMinutes: 60 },
      { day: 2, focus: "Day 2", questionIds: ["q2"], requirementIds: ["r2"], durationMinutes: 60 },
      { day: 3, focus: "Review", questionIds: [], requirementIds: [], durationMinutes: 30 },
    ],
    notes: { thinDescription: false, noHiringPage: false, noDiscussion: false, message: "" },
    gaps: [],
    valid: true,
    validationErrors: [],
    sources: [],
    ...overrides,
  };
}

describe("validateKit", () => {
  it("passes for a well-formed kit", () => {
    const result = validateKit(makeKit(), { expectedDays: 3 });
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  it("rejects a schedule with the wrong number of days", () => {
    const kit = makeKit({ schedule: makeKit().schedule.slice(0, 2) });
    const result = validateKit(kit, { expectedDays: 3 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("expected 3"))).toBe(true);
  });

  it("rejects a schedule that is not contiguous from day 1", () => {
    const kit = makeKit({
      schedule: [
        { day: 1, focus: "D1", questionIds: ["q1"], requirementIds: ["r1"], durationMinutes: 60 },
        { day: 3, focus: "D3", questionIds: ["q2"], requirementIds: ["r2"], durationMinutes: 60 },
        { day: 4, focus: "D4", questionIds: [], requirementIds: [], durationMinutes: 30 },
      ],
    });
    const result = validateKit(kit, { expectedDays: 3 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("out of sequence"))).toBe(true);
  });

  it("rejects when a must-have requirement is missing from the schedule", () => {
    const kit = makeKit({
      schedule: [
        { day: 1, focus: "D1", questionIds: ["q1"], requirementIds: ["r1"], durationMinutes: 60 },
        { day: 2, focus: "D2", questionIds: [], requirementIds: [], durationMinutes: 30 },
        { day: 3, focus: "D3", questionIds: [], requirementIds: [], durationMinutes: 30 },
      ],
    });
    const result = validateKit(kit, { expectedDays: 3 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("must-have") && e.includes("r2"))).toBe(true);
  });

  it("rejects when a must-have requirement has no question coverage", () => {
    const kit = makeKit({
      questions: [{ id: "q1", category: "technical", requirementIds: ["r1"], text: "Q1", answerOutline: "" }],
    });
    const result = validateKit(kit, { expectedDays: 3 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("not covered by any question") && e.includes("r2"))).toBe(true);
  });

  it("rejects duplicate question ids", () => {
    const kit = makeKit({
      questions: [
        { id: "q1", category: "technical", requirementIds: ["r1"], text: "Q1", answerOutline: "" },
        { id: "q1", category: "technical", requirementIds: ["r2"], text: "Q2", answerOutline: "" },
      ],
    });
    const result = validateKit(kit, { expectedDays: 3 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("duplicate"))).toBe(true);
  });

  it("rejects a question referencing an unknown requirement", () => {
    const kit = makeKit({
      questions: [
        { id: "q1", category: "technical", requirementIds: ["r99"], text: "Q1", answerOutline: "" },
        { id: "q2", category: "technical", requirementIds: ["r2"], text: "Q2", answerOutline: "" },
      ],
    });
    const result = validateKit(kit, { expectedDays: 3 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("unknown requirement"))).toBe(true);
  });
});
