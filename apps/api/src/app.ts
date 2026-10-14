import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "./config";
import type { Qualification, Client } from "@ainative/shared";
import { audit, type Db } from "./db";
import type { LlmProvider, Attachment, SectorStore, LlmEvent } from "./llm/types";
import { loadGateRules, loadIndependence, loadMethodology, leaderAggregation } from "./config";
import { carryOverrides, recompute } from "./leaders";
import { registerBulkRoutes } from "./bulk";
import { registerCampaignRoutes } from "./campaign";
import { clientRows } from "./clients";
import { registerSearchRoutes } from "./search";
import { registerOverrideRoutes } from "./overrides";
import { registerLeaderRoutes, applyAllLeaderInputs, redactForRole, actorOf } from "./routes";

export const id = (p: string) => `${p}_${Math.random().toString(36).slice(2, 10)}`;

function rowToQual(r: any): Qualification {
  return { ...r.data, id: r.id, client_id: r.client_id, version: r.version, created_at: new Date(r.created_at).toISOString() };
}

export async function latest(db: Db, clientId: string): Promise<Qualification | undefined> {
  const r = await db.query("select * from qualifications where client_id=$1 order by version desc limit 1", [clientId]);
  return r.rows[0] ? rowToQual(r.rows[0]) : undefined;
}

export async function save(db: Db, client: Client, q: Omit<Qualification, "id" | "version" | "created_at">, reason: string) {
  await db.query(
    `insert into clients (id,name,sector,sub_sector,region,size,owner,relationship_notes) values ($1,$2,$3,$4,$5,$6,$7,$8)
     on conflict (id) do update set name=excluded.name, sector=excluded.sector, region=coalesce(excluded.region, clients.region)`,
    [client.id, client.name, client.sector, client.sub_sector ?? null, client.region ?? null, client.size ?? null, client.owner ?? null, client.relationship_notes ?? null],
  );
  const prev = await latest(db, client.id);
  const version = (prev?.version ?? 0) + 1;
  const qid = id("q");
  const { client_id, created_by, overall_score, tier, confidence, ...rest } = q as any;
  await db.query(
    "insert into qualifications (id,client_id,version,data,overall_score,tier,confidence,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8)",
    [qid, client.id, version, JSON.stringify({ ...rest, overall_score, tier, confidence, created_by, change_reason: reason }), overall_score, tier, confidence, created_by],
  );
  for (const e of q.evidence) {
    await db.query("insert into evidence (id,qualification_id,source,snippet,type) values ($1,$2,$3,$4,$5) on conflict do nothing", [`${qid}_${e.id}`, qid, e.source, e.snippet, e.type]);
  }
  await audit(db, { actor: created_by, action: version === 1 ? "qualification.created" : "qualification.revised", entity: "qualification", entity_id: qid, detail: { version, score: overall_score, tier }, reason });
  return (await latest(db, client.id))!;
}

/**
 * Save an AI result as a new version. Shared by chat and bulk so both behave the same:
 * the AI never writes the audit gate, and a re-run keeps the previous gate, people's overrides and leaders' input.
 * If the client already exists (even when the user did not select it), it is treated as a re-run of that client.
 */
export async function persistResult(db: Db, ev: Extract<LlmEvent, { type: "result" }>, message: string, previousIn?: Qualification) {
  const previous = previousIn ?? (await latest(db, ev.client.id));
  let qual = ev.qualification;
  if (previous) qual = carryOverrides(previous, { ...qual, gate: previous.gate });
  qual = await applyAllLeaderInputs(db, ev.client.id, qual);
  if (previous) qual = recompute(qual, { rules: loadGateRules(), thresholds: loadMethodology().thresholds });
  return save(db, ev.client, qual, previous ? `Refined: ${message}` : message.startsWith("Bulk first pass") ? message : "Initial qualification");
}

export function makeSectorStore(db: Db): SectorStore {
  return {
    async get(sector) {
      const r = await db.query("select * from sector_research where sector=$1", [sector]);
      const x: any = r.rows[0];
      return x ? { sector: x.sector, summary: x.summary, ai_impact_view: x.ai_impact_view, sources: x.sources, refreshed_at: new Date(x.refreshed_at).toISOString() } : undefined;
    },
    async save(r) {
      await db.query(
        `insert into sector_research (sector,summary,ai_impact_view,sources,refreshed_at) values ($1,$2,$3,$4,$5)
         on conflict (sector) do update set summary=excluded.summary, ai_impact_view=excluded.ai_impact_view, sources=excluded.sources, refreshed_at=excluded.refreshed_at`,
        [r.sector, r.summary, r.ai_impact_view, JSON.stringify(r.sources), r.refreshed_at],
      );
    },
  };
}

export async function buildApp(db: Db, llm: LlmProvider) {
  const app = Fastify({ logger: false, bodyLimit: 20 * 1024 * 1024 });
  // Dev: the Vite dev server proxies /api. Production: the API serves the built web app, same origin, no CORS needed.
  if (process.env.NODE_ENV !== "production") await app.register(cors, { origin: true });

  app.get("/api/health", async () => ({ ok: true, llm: llm.name }));
  app.get("/api/config", async () => {
    const m = loadMethodology();
    const ind = loadIndependence();
    return { weights: m.weights, thresholds: m.thresholds, gate_banner: ind.banner, gate_note: ind.constraint_note, llm: llm.name };
  });

  app.get("/api/clients", async () => clientRows(db));

  app.get<{ Params: { id: string } }>("/api/clients/:id", async (req, reply) => {
    const c = await db.query("select * from clients where id=$1", [req.params.id]);
    if (!c.rows[0]) return reply.code(404).send({ error: "not found" });
    const q = await latest(db, req.params.id);
    return { client: c.rows[0], qualification: q && redactForRole(q, actorOf(req).role) };
  });

  app.get<{ Params: { id: string } }>("/api/clients/:id/versions", async (req) => {
    const r = await db.query("select id,version,overall_score,tier,confidence,created_by,created_at,data->>'change_reason' as reason from qualifications where client_id=$1 order by version desc", [req.params.id]);
    return r.rows;
  });

  app.get<{ Params: { sector: string } }>("/api/sectors/:sector", async (req, reply) => {
    const r = await makeSectorStore(db).get(req.params.sector);
    return r ?? reply.code(404).send({ error: "no research yet" });
  });

  app.get("/api/audit-log", async () => (await db.query("select * from audit_log order by id desc limit 200")).rows);

  /** Chat endpoint: streams progress events over SSE, then the saved result. */
  app.post<{ Body: { message: string; client_id?: string; attachments?: Attachment[]; refresh_sector?: boolean } }>("/api/chat", async (req, reply) => {
    const { message, client_id, attachments, refresh_sector } = req.body ?? ({} as any);
    const actor = actorOf(req);
    if (!message?.trim()) return reply.code(400).send({ error: "message required" });

    reply.raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    const send = (ev: string, data: unknown) => reply.raw.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);

    try {
      let previous: Qualification | undefined;
      let previousClient: Client | undefined;
      if (client_id) {
        previous = await latest(db, client_id);
        const c = await db.query("select * from clients where id=$1", [client_id]);
        previousClient = c.rows[0] as Client | undefined;
      }
      for await (const ev of llm.qualify({ message, previous, previousClient, user: actor.name, attachments, forceSectorRefresh: refresh_sector })) {
        if (ev.type === "result") {
          const saved = await persistResult(db, ev, message, previous);
          send("result", { client: ev.client, qualification: redactForRole(saved, actor.role), reply: ev.reply });
        } else send(ev.type, ev);
      }
    } catch (e: any) {
      send("error", { message: e?.message ?? "Something went wrong" });
    }
    send("done", {});
    reply.raw.end();
    return reply;
  });

  registerLeaderRoutes(app, db, llm);
  registerOverrideRoutes(app, db);
  registerSearchRoutes(app, db, llm);
  registerBulkRoutes(app, db, llm);
  registerCampaignRoutes(app, db);

  const dist = path.join(repoRoot, "apps", "web", "dist");
  if (existsSync(path.join(dist, "index.html"))) {
    await app.register(fastifyStatic, { root: dist, wildcard: false });
    // Single-page app: any non-API GET returns index.html so deep links (e.g. /requests/abc) work after a refresh.
    app.setNotFoundHandler((req, reply) => (req.method === "GET" && !req.url.startsWith("/api/") && !/\.\w+$/.test(req.url.split("?")[0]) ? reply.sendFile("index.html") : reply.code(404).send({ error: "Not found" })));
  }
  return app;
}
