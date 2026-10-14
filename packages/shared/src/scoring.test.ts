import { describe, expect, it } from "vitest";
import { applyGate, baseTier, execScoreFromRelationship, overallScore, DEFAULT_WEIGHTS } from "./scoring";
import { DIMENSION_KEYS } from "./types";

const all = (score: number) => DIMENSION_KEYS.map((key) => ({ key, score }));

describe("overallScore", () => {
  it("maps all-1 to 0 and all-5 to 100", () => {
    expect(overallScore(all(1), DEFAULT_WEIGHTS)).toBe(0);
    expect(overallScore(all(5), DEFAULT_WEIGHTS)).toBe(100);
  });
  it("respects weights", () => {
    const dims = [{ key: "exec_relationship" as const, score: 5 }, { key: "ai_impact" as const, score: 1 }];
    expect(overallScore(dims, { exec_relationship: 90, ai_impact: 10 })).toBe(90);
  });
});

describe("tiers and gate", () => {
  it("assigns base tiers by threshold", () => {
    expect(baseTier(80)).toBe("Pursue now");
    expect(baseTier(50)).toBe("Nurture");
    expect(baseTier(10)).toBe("Deprioritize");
  });
  it("caps audit-restricted clients at advisory-only", () => {
    expect(applyGate("Pursue now", { status: "restricted" })).toBe("Nurture (advisory-only)");
  });
  it("blocks Pursue now while unresolved", () => {
    expect(applyGate("Pursue now", { status: "unresolved" })).toBe("Nurture");
  });
  it("relabels a plain Nurture as advisory-only when restricted", () => {
    expect(applyGate("Nurture", { status: "restricted" })).toBe("Nurture (advisory-only)");
    expect(applyGate("Nurture", { status: "unresolved" })).toBe("Nurture");
  });
  it("never raises a tier", () => {
    expect(applyGate("Deprioritize", { status: "restricted" })).toBe("Deprioritize");
  });
  it("leaves tier alone when no gate applies", () => {
    expect(applyGate("Pursue now", { status: "none" })).toBe("Pursue now");
    expect(applyGate("Pursue now", { status: "cleared" })).toBe("Pursue now");
  });
});

describe("exec relationship score", () => {
  it("is high for strong CEO access and low for none", () => {
    expect(execScoreFromRelationship({ seniority: "CEO", quality: "Strong", receptiveness: "Yes" })).toBe(5);
    expect(execScoreFromRelationship({ seniority: "None", quality: "Weak", receptiveness: "Unknown" })).toBe(1);
  });
});
