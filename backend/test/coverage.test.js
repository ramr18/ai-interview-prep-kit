import { describe, it, expect } from "vitest";
import { checkCoverage, questionsCovering } from "../src/pipeline/coverage.js";

describe("checkCoverage", () => {
  const requirements = [
    { id: "r1", text: "React", priority: "must", category: "technical" },
    { id: "r2", text: "Node", priority: "must", category: "technical" },
    { id: "r3", text: "Bonus AWS", priority: "nice", category: "technical" },
  ];

  it("flags must-have requirements with no question as gaps", () => {
    const questions = [
      { id: "q1", category: "technical", requirementIds: ["r1"], text: "Q1", answerOutline: "" },
    ];
    const result = checkCoverage(requirements, questions, { priorities: ["must"] });
    expect(result.allCovered).toBe(false);
    expect(result.gaps.length).toBe(1);
    expect(result.gaps[0].requirementId).toBe("r2");
    expect(result.coveredCount).toBe(1);
    expect(result.total).toBe(2);
  });

  it("passes when every must-have is covered", () => {
    const questions = [
      { id: "q1", category: "technical", requirementIds: ["r1"], text: "Q1", answerOutline: "" },
      { id: "q2", category: "technical", requirementIds: ["r2"], text: "Q2", answerOutline: "" },
    ];
    const result = checkCoverage(requirements, questions, { priorities: ["must"] });
    expect(result.allCovered).toBe(true);
    expect(result.gaps.length).toBe(0);
  });

  it("ignores nice requirements when priorities=[must]", () => {
    const questions = [
      { id: "q1", category: "technical", requirementIds: ["r1"], text: "Q1", answerOutline: "" },
      { id: "q2", category: "technical", requirementIds: ["r2"], text: "Q2", answerOutline: "" },
    ];
    const result = checkCoverage(requirements, questions, { priorities: ["must"] });
    expect(result.allCovered).toBe(true);
  });

  it("can check both must and nice", () => {
    const questions = [
      { id: "q1", category: "technical", requirementIds: ["r1"], text: "Q1", answerOutline: "" },
      { id: "q2", category: "technical", requirementIds: ["r2"], text: "Q2", answerOutline: "" },
    ];
    const result = checkCoverage(requirements, questions, { priorities: ["must", "nice"] });
    expect(result.allCovered).toBe(false);
    expect(result.gaps[0].requirementId).toBe("r3");
  });
});

describe("questionsCovering", () => {
  it("returns questions that cover at least one of the given requirements", () => {
    const questions = [
      { id: "q1", requirementIds: ["r1"], text: "Q1" },
      { id: "q2", requirementIds: ["r2"], text: "Q2" },
      { id: "q3", requirementIds: ["r1", "r2"], text: "Q3" },
    ];
    const result = questionsCovering(questions, ["r1"]);
    expect(result.map((q) => q.id).sort()).toEqual(["q1", "q3"]);
  });
});
