import type { FastifyInstance } from "fastify";
import PDFDocument from "pdfkit";
import { AUDIT_LABELS, DIMENSION_LABELS, type Qualification } from "@ainative/shared";
import { audit, type Db } from "./db";
import { latest } from "./app";
import { actorOf, redactForRole } from "./routes";
import { loadIndependence } from "./config";

const ascii = (s: unknown) =>
  String(s ?? "")
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/→/g, "->").replace(/≥/g, ">=").replace(/…/g, "...")
    .replace(/[^\x20-\x7E\n]/g, "");

/** One-page summary PDF. Leader commentary is never included: ratings and agreement only. */
export function buildOnePager(client: { name: string; sector: string; region?: string | null }, q: Qualification, opts: { compress?: boolean } = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 42, compress: opts.compress ?? true, info: { Title: `${client.name} - qualification one-pager` } });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const GREEN = "#43B02A", INK = "#0B0B0B", MUTED = "#666666";
    const W = doc.page.width - 84;
    // Always write at the left margin: positioned text elsewhere must not leak its x into the next paragraph.
    const h = (t: string) => { doc.y += 8; doc.fillColor(INK).font("Helvetica-Bold").fontSize(11).text(ascii(t), 42, doc.y, { width: W }); doc.y += 2; };
    const p = (t: string, o: { color?: string; size?: number; bold?: boolean } = {}) => doc.fillColor(o.color ?? INK).font(o.bold ? "Helvetica-Bold" : "Helvetica").fontSize(o.size ?? 9.5).text(ascii(t), 42, doc.y, { width: W });
    const bullets = (items: string[]) => items.forEach((i) => p(`- ${i}`));

    doc.rect(0, 0, doc.page.width, 8).fill(GREEN);
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(20).text(ascii(client.name), 42, 28);
    p(`${client.sector}${client.region ? " | " + client.region : ""}   |   Version ${q.version}   |   ${new Date(q.created_at).toLocaleDateString("en-GB")}`, { color: MUTED, size: 9 });

    const y = doc.y + 10;
    doc.roundedRect(42, y, 120, 44, 4).fill(INK);
    doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(22).text(`${q.overall_score}/100`, 42, y + 10, { width: 120, align: "center" });
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(13).text(ascii(q.tier), 176, y + 6);
    doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(`Confidence: ${q.confidence}${q.override ? `   |   Tier overridden by ${ascii(q.override.by)}` : ""}`, 176, y + 26);
    doc.y = y + 56;

    if (q.gate.status === "restricted" || q.gate.status === "unresolved") {
      const ind = loadIndependence();
      const bh = 40;
      const top = doc.y;
      doc.rect(42, top, W, bh).lineWidth(1.5).stroke(INK);
      doc.fillColor(INK).font("Helvetica-Bold").fontSize(9).text(ascii(q.gate.status === "restricted" ? ind.banner : "Audit relationship not confirmed: 'Pursue now' is blocked until resolved."), 50, top + 6, { width: W - 16 });
      doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(ascii(ind.constraint_note), 50, top + 19, { width: W - 16 });
      doc.y = top + bh;
    }

    h("Why");
    p(q.headline_why);
    p(`Pitch readiness: ${q.pitch_readiness}`, { bold: true });

    h("Dimensions");
    for (const d of q.dimensions) {
      const yy = doc.y;
      doc.fillColor(INK).font("Helvetica-Bold").fontSize(9).text(ascii(DIMENSION_LABELS[d.key]), 42, yy, { width: 170 });
      doc.font("Helvetica").text(`${d.score}/5`, 215, yy, { width: 30 });
      doc.fillColor(MUTED).fontSize(8.5).text(`${d.origin}, ${d.confidence}`, 250, yy, { width: 130, lineBreak: false });
      // Leader-informed rationales quote the leader's own words: never print those in a shareable one-pager.
      const why = d.origin === "Leader-informed" ? "Based on account leader input." : d.rationale;
      doc.fillColor(MUTED).fontSize(8).text(ascii(why).replace(/\s+/g, " ").slice(0, 120), 385, yy, { width: W - 343, height: 22 });
      doc.y = yy + 22;
    }

    const ls: any = q.leader_summary;
    if (ls?.leaders?.length) {
      h("Account leader input");
      p(`${ls.leaders.length} leader${ls.leaders.length > 1 ? "s" : ""}: ${ls.leaders.map((l: any) => `${l.name} (${l.role})`).join(", ")}`);
      if (ls.disagreements?.length) bullets(ls.disagreements); else if (ls.leaders.length > 1) p("Leaders agree.");
      if (ls.conflicts?.length) bullets(ls.conflicts.map((c: any) => c.text));
    }
    if (q.gate.status !== "none") p(`Audit gate: ${q.gate.status}${q.gate.reason ? " - " + q.gate.reason : ""}`, { color: MUTED, size: 8.5 });

    h("Suggested entry point");
    p(`Buyer: ${q.entry_point.buyer_persona}`); p(`Hook: ${q.entry_point.hook}`); p(`First conversation: ${q.entry_point.first_conversation_angle}`);
    h("Key risks"); bullets(q.risks);
    h("Open questions"); bullets(q.open_questions);

    doc.page.margins.bottom = 0; // let the footer sit inside the bottom margin without forcing a second page
    doc.fontSize(7.5).fillColor(MUTED).text(ascii("Internal use. Handle client data per firm policy. This summary does not make independence determinations; follow the firm's official independence process. Leader commentary is not included."), 42, doc.page.height - 56, { width: W, lineBreak: true });
    doc.end();
  });
}

export function registerCampaignRoutes(app: FastifyInstance, db: Db) {
  const CAN = ["consultant", "account_leader", "admin"];

  app.get<{ Params: { id: string } }>("/api/clients/:id/onepager.pdf", async (req, reply) => {
    const actor = actorOf(req);
    const q = await latest(db, req.params.id);
    const c = (await db.query<any>("select * from clients where id=$1", [req.params.id])).rows[0];
    if (!q || !c) return reply.code(404).send({ error: "Client not found" });
    const pdf = await buildOnePager(c, redactForRole(q, actor.role));
    await audit(db, { actor: actor.name, action: "export.onepager", entity: "client", entity_id: c.id, detail: { version: q.version } });
    return reply.header("Content-Type", "application/pdf").header("Content-Disposition", `attachment; filename="${c.name.replace(/[^\w.-]+/g, "_")}_qualification.pdf"`).send(pdf);
  });

  app.post<{ Params: { id: string }; Body: { in_campaign?: boolean } }>("/api/clients/:id/campaign", async (req, reply) => {
    const actor = actorOf(req);
    if (!CAN.includes(actor.role)) return reply.code(403).send({ error: "Your role cannot change campaign membership." });
    const on = req.body?.in_campaign !== false;
    const r = await db.query<any>("update clients set in_campaign=$2, campaign_saved_by=$3, campaign_saved_at=now() where id=$1 returning id", [req.params.id, on, actor.name]);
    if (!r.rows[0]) return reply.code(404).send({ error: "Client not found" });
    await audit(db, { actor: actor.name, action: on ? "campaign.saved" : "campaign.removed", entity: "client", entity_id: req.params.id });
    return { in_campaign: on };
  });

  /** Stable package for later modules (Narrative builder, tracking). Contains no leader commentary. */
  app.get<{ Params: { id: string } }>("/api/clients/:id/handoff", async (req, reply) => {
    const actor = actorOf(req);
    const q = await latest(db, req.params.id);
    const c = (await db.query<any>("select * from clients where id=$1", [req.params.id])).rows[0];
    if (!q || !c) return reply.code(404).send({ error: "Client not found" });
    const sector = (await db.query<any>("select * from sector_research where sector=$1", [c.sector])).rows[0] ?? null;
    const safe = redactForRole(q, "leadership"); // strips leader commentary regardless of who exports
    const ls: any = q.leader_summary;
    const pkg = {
      schema: "ainative.qualification-handoff", schema_version: 1, exported_at: new Date().toISOString(), exported_by: actor.name,
      client: { id: c.id, name: c.name, sector: c.sector, sub_sector: c.sub_sector, region: c.region, size: c.size, in_campaign: !!c.in_campaign },
      qualification: { version: q.version, overall_score: q.overall_score, tier: q.tier, ai_tier: q.ai_tier, confidence: q.confidence, headline_why: q.headline_why, pitch_readiness: q.pitch_readiness, risks: q.risks, entry_point: q.entry_point, open_questions: q.open_questions, override: q.override, weights: q.weights, dimensions: safe.dimensions, evidence: safe.evidence },
      gate: { status: q.gate.status, restricted: q.gate.status === "restricted", note: q.gate.status === "restricted" ? "Implementation or delivery work may be restricted. Risk / Independence review required before any pitch." : null },
      leader_summary: ls ? { leaders: ls.leaders, disagreements: ls.disagreements, conflicts: ls.conflicts, revised_approach: ls.revised_approach } : null,
      sector_research: sector ? { sector: sector.sector, summary: sector.summary, ai_impact_view: sector.ai_impact_view, sources: sector.sources, refreshed_at: sector.refreshed_at } : null,
      audit_labels: AUDIT_LABELS,
    };
    await audit(db, { actor: actor.name, action: "handoff.exported", entity: "client", entity_id: c.id, detail: { version: q.version } });
    return reply.header("Content-Disposition", `attachment; filename="${c.name.replace(/[^\w.-]+/g, "_")}_handoff.json"`).send(pkg);
  });
}
