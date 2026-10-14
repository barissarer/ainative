import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { DEMO_USERS, applyGate, type Client, type Gate, type LeaderInput, type Qualification } from "@ainative/shared";
import { audit, type Db } from "./db";
import type { LlmProvider } from "./llm/types";
import { id, latest, save } from "./app";
import { applyLeaderInputs, latestPerAuthor, pitchReadiness } from "./leaders";
import { leaderAggregation, loadGateRules, loadIndependence, loadMethodology } from "./config";

type Q = Omit<Qualification, "id" | "version" | "created_at">;

/** Demo identity: no login yet. The role always comes from the server-side user table, never from a header. */
export function actorOf(req: FastifyRequest) {
  const uid = String(req.headers["x-user"] ?? "casey");
  return DEMO_USERS.find((u) => u.id === uid) ?? DEMO_USERS[0];
}

/** Leader commentary can be candid: leadership (read-only reporting) sees the ratings but not the comments. */
export function redactForRole<T extends Partial<Qualification>>(q: T, role: string): T {
  if (role !== "leadership") return q;
  return {
    ...q,
    evidence: q.evidence?.map((e) => (e.type === "Leader-informed" ? { ...e, snippet: "Restricted: leader commentary is not shown in reporting views." } : e)),
    dimensions: q.dimensions?.map((d) => (d.origin === "Leader-informed" ? { ...d, rationale: "Based on leader input (commentary restricted)." } : d)),
  };
}

function rowToInput(r: any): LeaderInput {
  return {
    id: r.id, qualification_id: r.qualification_id, client_id: r.client_id,
    author: { id: r.author_id, name: r.author_name, role: r.author_role },
    brand_permission: r.brand_permission, audit_status: r.audit_status, exec_relationship: r.exec_relationship,
    source: r.source, confirmed: r.confirmed, created_at: new Date(r.created_at).toISOString(),
  };
}

export async function loadInputs(db: Db, clientId: string): Promise<LeaderInput[]> {
  const r = await db.query<any>("select * from leader_inputs where client_id=$1 order by created_at", [clientId]);
  return r.rows.map(rowToInput);
}

/** Re-apply every confirmed leader input to a qualification. Used after any AI re-run so leader views persist. */
export async function applyAllLeaderInputs(db: Db, clientId: string, q: Q): Promise<Q> {
  const inputs = await loadInputs(db, clientId);
  if (inputs.length === 0) return q;
  return applyLeaderInputs(q, inputs, { rules: loadGateRules(), thresholds: loadMethodology().thresholds, mode: leaderAggregation(), now: new Date().toISOString() });
}

const Lens = z.object({
  brand_permission: z.object({ rating: z.enum(["Strong", "Moderate", "Weak", "Unknown"]), comment: z.string().optional() }),
  audit_status: z.object({ status: z.enum(["not_audit_client", "audit_client", "related_entity_audit_client", "unsure"]), audit_lead: z.string().nullish().transform((v) => v ?? undefined), comment: z.string().optional() }),
  exec_relationship: z.object({
    seniority: z.enum(["CEO", "C-suite", "VP", "Director", "None"]),
    quality: z.enum(["Strong", "Moderate", "Weak"]),
    receptiveness: z.enum(["Yes", "Maybe", "No", "Unknown"]),
    owner: z.string().nullish().transform((v) => v ?? undefined),
    comment: z.string().optional(),
  }),
  source: z.enum(["structured", "conversational"]).default("structured"),
});

async function notify(db: Db, user_id: string, kind: string, payload: object) {
  await db.query<any>("insert into notifications (id,user_id,kind,payload) values ($1,$2,$3,$4)", [id("n"), user_id, kind, JSON.stringify(payload)]);
}

async function getClient(db: Db, clientId: string): Promise<Client | undefined> {
  return (await db.query<any>("select * from clients where id=$1", [clientId])).rows[0] as Client | undefined;
}

export function registerLeaderRoutes(app: FastifyInstance, db: Db, llm: LlmProvider) {
  app.get("/api/users", async () => DEMO_USERS);
  app.get("/api/me", async (req) => actorOf(req));

  app.get<{ Params: { id: string } }>("/api/clients/:id/suggested-leaders", async () =>
    DEMO_USERS.filter((u) => u.role === "account_leader").map((u) => ({ ...u, reason: u.title })),
  );

  // ---- requests -----------------------------------------------------------
  app.post<{ Params: { id: string }; Body: { assignee_ids: string[] } }>("/api/clients/:id/leader-requests", async (req, reply) => {
    const actor = actorOf(req);
    if (!["consultant", "account_leader", "admin"].includes(actor.role)) return reply.code(403).send({ error: "Your role cannot request leader input." });
    const q = await latest(db, req.params.id);
    if (!q) return reply.code(404).send({ error: "Client not found" });
    const created: string[] = [];
    for (const uid of req.body?.assignee_ids ?? []) {
      const u = DEMO_USERS.find((x) => x.id === uid && x.role === "account_leader");
      if (!u) continue;
      const dup = await db.query<any>("select 1 from leader_requests where client_id=$1 and assignee_id=$2 and status='pending'", [req.params.id, uid]);
      if (dup.rows.length) continue;
      const rid = id("lr");
      await db.query<any>(
        "insert into leader_requests (id,client_id,qualification_id,requested_by,assignee_id,assignee_name,assignee_role) values ($1,$2,$3,$4,$5,$6,$7)",
        [rid, req.params.id, q.id, actor.name, u.id, u.name, u.title],
      );
      await notify(db, u.id, "leader_request", { request_id: rid, client_id: req.params.id, link: `/requests/${rid}` });
      await audit(db, { actor: actor.name, action: "leader_request.created", entity: "leader_request", entity_id: rid, detail: { client_id: req.params.id, assignee: u.name, qualification_version: q.version } });
      created.push(rid);
    }
    return { created };
  });

  app.get<{ Params: { id: string } }>("/api/clients/:id/leader-requests", async (req) => {
    const r = await db.query<any>("select * from leader_requests where client_id=$1 order by created_at desc", [req.params.id]);
    return r.rows;
  });

  /** "My requests" inbox for the current user. */
  app.get("/api/leader-requests", async (req) => {
    const actor = actorOf(req);
    const r = await db.query<any>(
      `select lr.*, c.name as client_name, c.sector, q.version, q.overall_score, q.tier
       from leader_requests lr join clients c on c.id=lr.client_id join qualifications q on q.id=lr.qualification_id
       where lr.assignee_id=$1 order by (lr.status='pending') desc, lr.created_at desc`,
      [actor.id],
    );
    return r.rows;
  });

  app.get("/api/notifications", async (req) => {
    const r = await db.query<any>("select * from notifications where user_id=$1 order by created_at desc limit 50", [actorOf(req).id]);
    return r.rows;
  });

  app.get<{ Params: { id: string } }>("/api/leader-requests/:id", async (req, reply) => {
    const r = (await db.query<any>("select * from leader_requests where id=$1", [req.params.id])).rows[0];
    if (!r) return reply.code(404).send({ error: "Request not found" });
    const client = await getClient(db, r.client_id);
    const qrow = (await db.query<any>("select * from qualifications where id=$1", [r.qualification_id])).rows[0];
    const qual: Qualification = { ...qrow.data, id: qrow.id, client_id: qrow.client_id, version: qrow.version, created_at: new Date(qrow.created_at).toISOString() };
    const mine = latestPerAuthor(await loadInputs(db, r.client_id)).find((i) => i.author.id === r.assignee_id) ?? null;

    // Suggested answers where we already hold data (relationship notes, user-provided facts). Labelled "Suggested, please confirm".
    let suggested = null;
    if (!mine) {
      const notes = [client?.relationship_notes, ...qual.evidence.filter((e) => e.type === "User-provided").map((e) => e.snippet)].filter(Boolean).join("\n");
      if (notes.trim()) {
        try { suggested = await llm.mapLeaderText(notes, `${client?.name} (${client?.sector})`); } catch { suggested = null; }
      }
    }
    return { request: r, client, qualification: redactForRole(qual, actorOf(req).role), existing: mine, suggested };
  });

  /** Free text to the three lenses. A draft only: nothing is saved and the audit gate is never touched. */
  app.post<{ Params: { id: string }; Body: { text: string } }>("/api/leader-requests/:id/map", async (req, reply) => {
    const r = (await db.query<any>("select * from leader_requests where id=$1", [req.params.id])).rows[0];
    if (!r) return reply.code(404).send({ error: "Request not found" });
    if (!req.body?.text?.trim()) return reply.code(400).send({ error: "Please type or dictate something first." });
    const client = await getClient(db, r.client_id);
    return llm.mapLeaderText(req.body.text, `${client?.name} (${client?.sector})`);
  });

  app.post<{ Params: { id: string }; Body: unknown }>("/api/leader-requests/:id/submit", async (req, reply) => {
    const actor = actorOf(req);
    const r = (await db.query<any>("select * from leader_requests where id=$1", [req.params.id])).rows[0];
    if (!r) return reply.code(404).send({ error: "Request not found" });
    if (r.assignee_id !== actor.id) return reply.code(403).send({ error: "This request is assigned to someone else." });
    const parsed = Lens.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Please answer all three questions (audit status can be 'Unsure')." });
    const b = parsed.data;

    const input: LeaderInput = {
      id: id("li"), qualification_id: r.qualification_id, client_id: r.client_id,
      author: { id: actor.id, name: actor.name, role: actor.title },
      brand_permission: b.brand_permission, audit_status: b.audit_status, exec_relationship: b.exec_relationship,
      source: b.source, confirmed: true, created_at: new Date().toISOString(),
    };
    await db.query<any>(
      `insert into leader_inputs (id,qualification_id,client_id,author_id,author_name,author_role,brand_permission,audit_status,exec_relationship,source,confirmed,created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11)`,
      [input.id, input.qualification_id, input.client_id, actor.id, actor.name, actor.title, JSON.stringify(input.brand_permission), JSON.stringify(input.audit_status), JSON.stringify(input.exec_relationship), input.source, input.created_at],
    );
    await db.query<any>("update leader_requests set status='done', completed_at=now() where id=$1", [r.id]);
    await audit(db, { actor: actor.name, action: "leader_input.submitted", entity: "leader_input", entity_id: input.id, detail: { client_id: r.client_id, reacted_to_qualification: r.qualification_id, source: input.source, audit_status: b.audit_status.status } });

    const client = (await getClient(db, r.client_id))!;
    const prev = (await latest(db, r.client_id))!;
    const { id: _i, version: _v, created_at: _c, ...base } = prev;
    let next = applyLeaderInputs(base, await loadInputs(db, r.client_id), { rules: loadGateRules(), thresholds: loadMethodology().thresholds, mode: leaderAggregation(), now: new Date().toISOString() });
    next = { ...next, created_by: actor.name };

    const conflicts = (next.leader_summary as any)?.conflicts ?? [];
    if (conflicts.length) {
      const ctx = `Client: ${client.name} (${client.sector}).\nAI view: ${base.headline_why}\nConflicts: ${conflicts.map((c: any) => c.text).join(" ")}\nLeader comments: ${[b.brand_permission.comment, b.exec_relationship.comment].filter(Boolean).join(" | ")}\nEntry point so far: ${base.entry_point.buyer_persona} / ${base.entry_point.first_conversation_angle}`;
      (next.leader_summary as any).revised_approach = await llm.proposeApproach(ctx);
    }

    const saved = await save(db, client, next, `Leader input from ${actor.name}`);
    if (next.gate.status !== prev.gate.status) {
      await db.query<any>("insert into gates (id,client_id,status,set_by,reason,cleared_by) values ($1,$2,$3,$4,$5,$6)", [id("g"), r.client_id, next.gate.status, next.gate.set_by, next.gate.reason, next.gate.cleared_by]);
      await audit(db, { actor: actor.name, action: "gate.changed", entity: "gate", entity_id: r.client_id, detail: { from: prev.gate.status, to: next.gate.status, via: "leader input" }, reason: next.gate.reason ?? undefined });
    }
    if (b.audit_status.status === "unsure") {
      const contact = loadIndependence().notify_on_unsure;
      for (const u of DEMO_USERS.filter((x) => x.role === "risk_independence")) await notify(db, u.id, "audit_unsure", { client_id: r.client_id, client: client.name, link: `/?client=${r.client_id}` });
      console.log(`[email stub] To ${contact}: ${actor.name} is unsure about the audit relationship for ${client.name}. Please review via the firm's independence process.`);
      await audit(db, { actor: "system", action: "risk.notified", entity: "client", entity_id: r.client_id, detail: { contact, reason: "audit status unsure" } });
    }
    return { qualification: redactForRole(saved, actor.role) };
  });

  /** Every leader's current view, shown separately (never averaged). Comments hidden from the read-only leadership role. */
  app.get<{ Params: { id: string } }>("/api/clients/:id/leader-inputs", async (req) => {
    const role = actorOf(req).role;
    return latestPerAuthor(await loadInputs(db, req.params.id)).map((i) =>
      role === "leadership"
        ? { ...i, brand_permission: { ...i.brand_permission, comment: undefined }, audit_status: { ...i.audit_status, comment: undefined }, exec_relationship: { ...i.exec_relationship, comment: undefined } }
        : i,
    );
  });

  // ---- audit gate: Risk / Independence only --------------------------------
  app.get<{ Params: { id: string } }>("/api/clients/:id/gate-history", async (req) => {
    return (await db.query<any>("select * from gates where client_id=$1 order by updated_at desc", [req.params.id])).rows;
  });

  app.post<{ Params: { id: string }; Body: { status: Gate["status"]; reason: string } }>("/api/clients/:id/gate", async (req, reply) => {
    const actor = actorOf(req);
    if (actor.role !== "risk_independence") {
      await audit(db, { actor: actor.name, action: "gate.change_denied", entity: "gate", entity_id: req.params.id, detail: { role: actor.role } });
      return reply.code(403).send({ error: "Only the Risk / Independence role can change the audit gate. Please follow the firm's official independence process." });
    }
    const { status, reason } = req.body ?? ({} as any);
    if (!["none", "restricted", "unresolved", "cleared"].includes(status)) return reply.code(400).send({ error: "Invalid status." });
    if (!reason?.trim()) return reply.code(400).send({ error: "A reason is required and will be logged." });
    const prev = await latest(db, req.params.id);
    const client = await getClient(db, req.params.id);
    if (!prev || !client) return reply.code(404).send({ error: "Client not found" });

    const now = new Date().toISOString();
    const gate: Gate = { type: "audit_independence", status, set_by: `risk:${actor.name}`, reason: reason.trim(), cleared_by: status === "cleared" ? actor.name : null, updated_at: now };
    const { id: _i, version: _v, created_at: _c, ...base } = prev;
    const next: Q = { ...base, gate, tier: applyGate(base.override?.tier ?? base.ai_tier, gate, loadGateRules()), created_by: actor.name };
    next.pitch_readiness = pitchReadiness(next, !!(next.leader_summary as any)?.leaders?.length);
    const saved = await save(db, client, next, `Audit gate ${prev.gate.status} → ${status}: ${reason.trim()}`);
    await db.query<any>("insert into gates (id,client_id,status,set_by,reason,cleared_by) values ($1,$2,$3,$4,$5,$6)", [id("g"), req.params.id, status, gate.set_by, gate.reason, gate.cleared_by]);
    await audit(db, { actor: actor.name, action: "gate.changed", entity: "gate", entity_id: req.params.id, detail: { from: prev.gate.status, to: status, via: "risk role" }, reason: reason.trim() });
    return { qualification: saved };
  });
}
