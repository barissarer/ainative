import { describe, expect, it } from "vitest";
import { DEFAULT_GATE_RULES, DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS, DIMENSION_KEYS, type Gate, type LeaderInput } from "@ainative/shared";
import { aggregate, applyLeaderInputs, deriveGate, latestPerAuthor } from "./leaders";

const now = "2026-01-01T00:00:00.000Z";
const gate0: Gate = { type: "audit_independence", status: "unresolved", set_by: "system", reason: "x", cleared_by: null, updated_at: now };
const baseQ = (aiScore = 4): any => ({
  client_id: "c", weights: DEFAULT_WEIGHTS, overall_score: 0, ai_tier: "Nurture", tier: "Nurture", confidence: "Low",
  headline_why: "", pitch_readiness: "", risks: [], entry_point: { buyer_persona: "", hook: "", first_conversation_angle: "" }, open_questions: [], gate: gate0, override: null, created_by: "u", evidence: [],
  dimensions: DIMENSION_KEYS.map((key) => ({ key, score: aiScore, rationale: "r", confidence: "Med", origin: "AI-estimated", evidence_ids: [] })),
});
const li = (id: string, o: Partial<LeaderInput> = {}): LeaderInput => ({
  id: `li_${id}`, qualification_id: "q1", client_id: "c", author: { id, name: id.toUpperCase(), role: "account_leader" },
  brand_permission: { rating: "Strong" }, audit_status: { status: "not_audit_client" },
  exec_relationship: { seniority: "CEO", quality: "Strong", receptiveness: "Yes" }, source: "structured", confirmed: true, created_at: now, ...o,
});
const run = (q: any, inputs: LeaderInput[], mode: "conservative" | "median" = "conservative") =>
  applyLeaderInputs(q, inputs, { rules: DEFAULT_GATE_RULES, thresholds: DEFAULT_THRESHOLDS, mode, now });

describe("leader input", () => {
  it("overrides the AI estimate, labels it Leader-informed and keeps the AI score", () => {
    const q = run(baseQ(3), [li("a")]);
    const d = q.dimensions.find((x) => x.key === "exec_relationship")!;
    expect(d.origin).toBe("Leader-informed");
    expect(d.score).toBe(5);
    expect(d.ai_score).toBe(3);
    expect(q.evidence.some((e) => e.type === "Leader-informed")).toBe(true);
  });

  it("ignores unconfirmed input and keeps only the latest view per author", () => {
    const older = li("a", { created_at: "2025-01-01T00:00:00Z", brand_permission: { rating: "Weak" } });
    const newer = li("a", { created_at: "2025-06-01T00:00:00Z" });
    expect(latestPerAuthor([older, newer])).toHaveLength(1);
    expect(latestPerAuthor([li("b", { confirmed: false })])).toHaveLength(0);
  });

  it("surfaces disagreement explicitly and scores conservatively by default", () => {
    const weak = li("c", { exec_relationship: { seniority: "Director", quality: "Weak", receptiveness: "No" } });
    const q = run(baseQ(), [li("a"), li("b"), weak]);
    expect(q.leader_summary.disagreements.join(" ")).toContain("2 of 3 rate executive access as Strong; 1 rates it Weak");
    expect(q.dimensions.find((d) => d.key === "exec_relationship")!.score).toBe(1);
    const med = run(baseQ(), [li("a"), li("b"), weak], "median");
    expect(med.dimensions.find((d) => d.key === "exec_relationship")!.score).toBe(5);
  });

  it("flags a conflict between the AI view and the leader", () => {
    const q = run(baseQ(5), [li("a", { brand_permission: { rating: "Weak" } })]);
    expect(q.leader_summary.conflicts.map((c: { dimension: string }) => c.dimension)).toContain("brand_permission");
  });

  it("Unknown brand rating leaves the AI estimate in place", () => {
    const q = run(baseQ(4), [li("a", { brand_permission: { rating: "Unknown" } })]);
    expect(q.dimensions.find((d) => d.key === "brand_permission")!.origin).toBe("AI-estimated");
  });

  it("describes pitch readiness in plain language", () => {
    const q = run(baseQ(5), [li("a", { exec_relationship: { seniority: "Director", quality: "Weak", receptiveness: "No" } })]);
    expect(q.pitch_readiness).toMatch(/executive access is weak/);
    expect(q.pitch_readiness).toMatch(/sector-insight conversation/);
  });
});

describe("audit gate from leader input", () => {
  it("restricts and caps the tier at advisory-only", () => {
    const q = run(baseQ(5), [li("a", { audit_status: { status: "audit_client" } })]);
    expect(q.gate.status).toBe("restricted");
    expect(q.tier).toBe("Nurture (advisory-only)");
  });
  it("most restrictive answer wins across leaders", () => {
    const g = deriveGate(gate0, [li("a"), li("b", { audit_status: { status: "related_entity_audit_client" } })], now);
    expect(g.status).toBe("restricted");
  });
  it("unsure keeps Pursue now blocked", () => {
    const q = run(baseQ(5), [li("a", { audit_status: { status: "unsure" } })]);
    expect(q.gate.status).toBe("unresolved");
    expect(q.tier).not.toBe("Pursue now");
  });
  it("all-clear from leaders removes the default unresolved gate", () => {
    expect(deriveGate(gate0, [li("a")], now).status).toBe("none");
  });
  it("leaders cannot loosen a gate that Risk set, but can tighten it", () => {
    const riskRestricted: Gate = { ...gate0, status: "restricted", set_by: "risk:Riley Risk" };
    expect(deriveGate(riskRestricted, [li("a")], now).status).toBe("restricted");
    const riskCleared: Gate = { ...gate0, status: "cleared", set_by: "risk:Riley Risk", cleared_by: "Riley Risk" };
    expect(deriveGate(riskCleared, [li("a")], now).status).toBe("cleared");
    const later = "2026-02-01T00:00:00.000Z";
    expect(deriveGate(riskCleared, [li("a", { audit_status: { status: "audit_client" }, created_at: later })], now).status).toBe("restricted");
    // an answer given before Risk's decision does not re-tighten it
    expect(deriveGate(riskCleared, [li("a", { audit_status: { status: "audit_client" }, created_at: "2025-12-01T00:00:00.000Z" })], now).status).toBe("cleared");
  });
});

describe("aggregate", () => {
  it("handles empty, conservative and median", () => {
    expect(aggregate([], "median")).toBeNull();
    expect(aggregate([5, 1, 4], "conservative")).toBe(1);
    expect(aggregate([5, 1, 4], "median")).toBe(4);
  });
});
