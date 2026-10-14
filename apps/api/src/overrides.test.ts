import { describe, expect, it } from "vitest";
import { DEFAULT_GATE_RULES, DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS, DIMENSION_KEYS, type Gate } from "@ainative/shared";
import { carryOverrides, clearOverride, overrideDimension, overrideTier, recompute } from "./leaders";
import { buildApp } from "./app";
import { openDb } from "./db";
import { MockProvider } from "./llm/mock";

const now = "2026-01-01T00:00:00.000Z";
const gate = (status: Gate["status"]): Gate => ({ type: "audit_independence", status, set_by: "system", reason: "x", cleared_by: null, updated_at: now });
const baseQ = (g = gate("none")): any => ({
  client_id: "c", weights: DEFAULT_WEIGHTS, overall_score: 0, ai_tier: "Nurture", tier: "Nurture", confidence: "Low", headline_why: "", pitch_readiness: "", risks: [],
  entry_point: { buyer_persona: "", hook: "", first_conversation_angle: "" }, open_questions: [], gate: g, override: null, created_by: "u", evidence: [],
  dimensions: DIMENSION_KEYS.map((key) => ({ key, score: 3, rationale: "r", confidence: "Med", origin: "AI-estimated", evidence_ids: [] })),
});
const rc = (q: any) => recompute(q, { rules: DEFAULT_GATE_RULES, thresholds: DEFAULT_THRESHOLDS });

describe("override logic", () => {
  it("overrides a dimension, keeps the AI score and records the reason as evidence", () => {
    const q = overrideDimension(baseQ(), "ai_impact", 5, "Client told us they have 40 live use cases", "Casey", now);
    const d = q.dimensions.find((x: any) => x.key === "ai_impact")!;
    expect(d).toMatchObject({ score: 5, origin: "Human override", ai_score: 3 });
    expect(q.evidence.some((e: any) => e.snippet.includes("40 live use cases"))).toBe(true);
  });
  it("a tier override never lifts the audit cap", () => {
    const q = rc(overrideTier(baseQ(gate("restricted")), "Pursue now", "Partner insists", "Casey", now));
    expect(q.override?.tier).toBe("Pursue now");
    expect(q.tier).toBe("Nurture (advisory-only)");
    expect(rc(overrideTier(baseQ(gate("none")), "Pursue now", "ok", "Casey", now)).tier).toBe("Pursue now");
  });
  it("clearing restores the AI estimate", () => {
    const q = clearOverride(overrideDimension(baseQ(), "sector_dynamics", 5, "r", "C", now), { kind: "dimension", key: "sector_dynamics" });
    expect(q.dimensions.find((x: any) => x.key === "sector_dynamics")).toMatchObject({ score: 3, origin: "AI-estimated" });
    expect(clearOverride(overrideTier(baseQ(), "Pursue now", "r", "C", now), { kind: "tier" }).override).toBeNull();
  });
  it("carries overrides onto a fresh AI result", () => {
    const prev = overrideTier(overrideDimension(baseQ(), "ai_impact", 5, "r", "C", now), "Deprioritize", "r2", "C", now);
    const out = carryOverrides(prev, baseQ());
    expect(out.dimensions.find((x: any) => x.key === "ai_impact")).toMatchObject({ score: 5, origin: "Human override" });
    expect(out.override?.tier).toBe("Deprioritize");
    expect(out.evidence.length).toBe(1);
  });
});

describe("override API", () => {
  it("requires a reason and a permitted role, logs AI view + override, and survives an AI re-run", async () => {
    const db = await openDb("memory://");
    const app = await buildApp(db, new MockProvider());
    await app.listen({ port: 0 });
    const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
    const call = async (path: string, user: string, body: unknown) => {
      const r = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json", "x-user": user }, body: JSON.stringify(body) });
      return { status: r.status, text: await r.text() };
    };
    const first = JSON.parse((await call("/api/chat", "casey", { message: "Qualify Acme Insurance" })).text.match(/event: result\ndata: (.*)\n/)![1]);
    const cid = first.client.id;

    expect((await call(`/api/clients/${cid}/override`, "casey", { kind: "dimension", key: "ai_impact", score: 5, reason: " " })).status).toBe(400);
    expect((await call(`/api/clients/${cid}/override`, "lee", { kind: "dimension", key: "ai_impact", score: 5, reason: "x" })).status).toBe(403);
    expect((await call(`/api/clients/${cid}/override`, "riley", { kind: "tier", tier: "Pursue now", reason: "x" })).status).toBe(403);

    const ok = await call(`/api/clients/${cid}/override`, "casey", { kind: "dimension", key: "ai_impact", score: 1, reason: "Peers have no live deployments" });
    expect(ok.status).toBe(200);
    const q = JSON.parse(ok.text).qualification;
    expect(q.dimensions.find((d: any) => d.key === "ai_impact")).toMatchObject({ score: 1, origin: "Human override" });

    // Tier override: gate is unresolved by default, so Pursue now is capped, and the response says so
    const t = JSON.parse((await call(`/api/clients/${cid}/override`, "casey", { kind: "tier", tier: "Pursue now", reason: "Strategic account" })).text);
    expect(t.capped_by_gate).toBe(true);
    expect(t.qualification.tier).not.toBe("Pursue now");
    expect(t.qualification.override.tier).toBe("Pursue now");

    // AI re-run keeps overrides
    const re = JSON.parse((await call("/api/chat", "casey", { message: "Weight sector dynamics higher", client_id: cid })).text.match(/event: result\ndata: (.*)\n/)![1]);
    expect(re.qualification.dimensions.find((d: any) => d.key === "ai_impact")).toMatchObject({ score: 1, origin: "Human override" });
    expect(re.qualification.override.tier).toBe("Pursue now");

    const log = await (await fetch(`${base}/api/audit-log`)).json();
    const entry = log.find((x: any) => x.action === "override.dimension");
    expect(entry.reason).toBe("Peers have no live deployments");
    expect(entry.detail.ai_view).toBeTruthy();
    expect(entry.detail.override).toEqual({ score: 1 });

    const versions = await (await fetch(`${base}/api/clients/${cid}/versions`)).json();
    expect(versions[0].reason).toBeTruthy();

    const cleared = JSON.parse((await call(`/api/clients/${cid}/override/clear`, "casey", { kind: "dimension", key: "ai_impact", reason: "Mistake" })).text);
    expect(cleared.qualification.dimensions.find((d: any) => d.key === "ai_impact").origin).toBe("AI-estimated");
    await app.close();
  });
});
