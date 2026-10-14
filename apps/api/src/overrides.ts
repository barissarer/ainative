import type { FastifyInstance } from "fastify";
import type { Client, Qualification } from "@ainative/shared";
import { audit, type Db } from "./db";
import { latest, save } from "./app";
import { clearOverride, overrideDimension, overrideTier, recompute, type TierName } from "./leaders";
import { actorOf, applyAllLeaderInputs, redactForRole } from "./routes";
import { loadGateRules, loadMethodology } from "./config";

type Q = Omit<Qualification, "id" | "version" | "created_at">;
const TIERS: TierName[] = ["Pursue now", "Nurture", "Deprioritize"];
const CAN_OVERRIDE = ["consultant", "account_leader", "admin"];

/**
 * Human overrides. Any dimension score or the tier can be overridden with a reason; the audit gate cannot, and it still
 * caps the tier even when a tier override is set. The AI view is kept in the record and in the audit log.
 */
export function registerOverrideRoutes(app: FastifyInstance, db: Db) {
  const rules = () => ({ rules: loadGateRules(), thresholds: loadMethodology().thresholds });

  app.post<{ Params: { id: string }; Body: { kind: "dimension" | "tier"; key?: string; score?: number; tier?: TierName; reason?: string } }>(
    "/api/clients/:id/override",
    async (req, reply) => {
      const actor = actorOf(req);
      if (!CAN_OVERRIDE.includes(actor.role)) return reply.code(403).send({ error: "Your role cannot override scores." });
      const { kind, key, score, tier, reason } = req.body ?? ({} as any);
      if (!reason?.trim()) return reply.code(400).send({ error: "A reason is required. It is saved with the change." });
      const prev = await latest(db, req.params.id);
      const client = (await db.query<any>("select * from clients where id=$1", [req.params.id])).rows[0] as Client | undefined;
      if (!prev || !client) return reply.code(404).send({ error: "Client not found" });
      const { id: _i, version: _v, created_at: _c, ...base } = prev;
      const now = new Date().toISOString();
      let next: Q;
      let detail: Record<string, unknown>;

      if (kind === "dimension") {
        const d = base.dimensions.find((x) => x.key === key);
        if (!d) return reply.code(400).send({ error: "Unknown dimension." });
        if (typeof score !== "number" || score < 1 || score > 5) return reply.code(400).send({ error: "Score must be 1 to 5." });
        detail = { dimension: key, ai_view: { score: d.ai_score ?? d.score, origin: d.origin }, override: { score: Math.round(score) } };
        next = overrideDimension(base, key!, score, reason.trim(), actor.name, now);
      } else if (kind === "tier") {
        if (!tier || !TIERS.includes(tier)) return reply.code(400).send({ error: "Tier must be Pursue now, Nurture or Deprioritize." });
        detail = { ai_view: { score: base.overall_score, tier: base.ai_tier }, override: { tier } };
        next = overrideTier(base, tier, reason.trim(), actor.name, now);
      } else return reply.code(400).send({ error: "kind must be dimension or tier." });

      next = recompute(await applyAllLeaderInputs(db, req.params.id, next), rules());
      next = { ...next, created_by: actor.name };
      const saved = await save(db, client, next, `Override (${kind}${key ? ` ${key}` : ""}): ${reason.trim()}`);
      await audit(db, { actor: actor.name, action: `override.${kind}`, entity: "qualification", entity_id: saved.id, detail: { ...detail, effective_tier: next.tier, capped_by_gate: kind === "tier" && next.tier !== tier }, reason: reason.trim() });
      return { qualification: redactForRole(saved, actor.role), capped_by_gate: kind === "tier" && next.tier !== tier };
    },
  );

  app.post<{ Params: { id: string }; Body: { kind: "dimension" | "tier"; key?: string; reason?: string } }>("/api/clients/:id/override/clear", async (req, reply) => {
    const actor = actorOf(req);
    if (!CAN_OVERRIDE.includes(actor.role)) return reply.code(403).send({ error: "Your role cannot change overrides." });
    const { kind, key, reason } = req.body ?? ({} as any);
    if (!reason?.trim()) return reply.code(400).send({ error: "A reason is required." });
    const prev = await latest(db, req.params.id);
    const client = (await db.query<any>("select * from clients where id=$1", [req.params.id])).rows[0] as Client | undefined;
    if (!prev || !client) return reply.code(404).send({ error: "Client not found" });
    const { id: _i, version: _v, created_at: _c, ...base } = prev;
    const cleared = clearOverride(base, kind === "tier" ? { kind: "tier" } : { kind: "dimension", key: key! });
    let next = recompute(await applyAllLeaderInputs(db, req.params.id, cleared), rules());
    next = { ...next, created_by: actor.name };
    const saved = await save(db, client, next, `Override removed (${kind}${key ? ` ${key}` : ""}): ${reason.trim()}`);
    await audit(db, { actor: actor.name, action: `override.${kind}.cleared`, entity: "qualification", entity_id: saved.id, detail: { dimension: key }, reason: reason.trim() });
    return { qualification: redactForRole(saved, actor.role) };
  });
}
