import { describe, it, expect } from "vitest";
import {
  regenerateCategoryQuestions,
  regenerateFlashcards,
  regenerateScalar,
  PROTECTED_STATES,
} from "../src/pipeline/sectionMerge.js";

describe("regenerateCategoryQuestions", () => {
  it("replaces generated questions in the target category, keeps others", () => {
    const current = [
      { id: "q1", category: "technical", text: "Old tech", state: "generated" },
      { id: "q2", category: "behavioural", text: "Keep me", state: "generated" },
    ];
    const fresh = [{ id: "q3", category: "technical", text: "New tech", state: "generated" }];
    const result = regenerateCategoryQuestions(current, "technical", fresh);
    expect(result.find((q) => q.id === "q1")).toBeUndefined();
    expect(result.find((q) => q.id === "q2")).toBeTruthy();
    expect(result.find((q) => q.id === "q3")).toBeTruthy();
  });

  it("preserves edited/created/pinned questions in the target category", () => {
    const current = [
      { id: "q1", category: "technical", text: "Edited by user", state: "edited" },
      { id: "q2", category: "technical", text: "Generated, will be replaced", state: "generated" },
    ];
    const fresh = [{ id: "q3", category: "technical", text: "Fresh", state: "generated" }];
    const result = regenerateCategoryQuestions(current, "technical", fresh);
    expect(result.find((q) => q.id === "q1").text).toBe("Edited by user");
    expect(result.find((q) => q.id === "q2")).toBeUndefined();
    expect(result.find((q) => q.id === "q3")).toBeTruthy();
  });
});

describe("regenerateFlashcards", () => {
  it("keeps protected cards and adds fresh ones, deduped by front", () => {
    const current = [
      { id: "f1", front: "Keep me", back: "B", state: "edited" },
      { id: "f2", front: "Replace me", back: "B", state: "generated" },
    ];
    const fresh = [
      { id: "f3", front: "Keep me", back: "Duplicate", state: "generated" },
      { id: "f4", front: "New card", back: "B", state: "generated" },
    ];
    const result = regenerateFlashcards(current, fresh);
    expect(result.find((f) => f.id === "f1")).toBeTruthy();
    expect(result.filter((f) => f.front === "Keep me").length).toBe(1);
    expect(result.find((f) => f.id === "f4")).toBeTruthy();
  });
});

describe("regenerateScalar", () => {
  it("replaces a generated value", () => {
    const r = regenerateScalar("old", "generated", "new");
    expect(r.value).toBe("new");
    expect(r.state).toBe("generated");
  });

  it("preserves an edited value", () => {
    const r = regenerateScalar("user edit", "edited", "new");
    expect(r.value).toBe("user edit");
    expect(r.state).toBe("edited");
  });
});
