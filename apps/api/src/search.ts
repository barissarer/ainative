import type { FastifyInstance } from "fastify";
import type { Db } from "./db";
import type { LlmProvider } from "./llm/types";
import { clientRows, type ClientRow } from "./clients";

export interface SearchFilter {
  sectors: string[];
  tiers: string[]; // Pursue now | Nurture | Nurture (advisory-only) | Deprioritize
  confidence: string[]; // High | Med | Low
  min_score: number | null;
  max_score: number | null;
  gate: string[]; // none | restricted | unresolved | cleared
  statuses: string[]; // chips, e.g. "Awaiting leader input"
  exec_access: "strong" | "weak" | null;
  brand_permission: "strong" | "weak" | null;
  audit_relationship: "none" | "present" | null;
  name_contains: string | null;
  sort: "score" | "updated" | "name" | null;
}

export const EMPTY_FILTER: SearchFilter = { sectors: [], tiers: [], confidence: [], min_score: null, max_score: null, gate: [], statuses: [], exec_access: null, brand_permission: null, audit_relationship: null, name_contains: null, sort: null };

const has = (list: string[], v: string) => list.some((x) => x.toLowerCase() === v.toLowerCase());

/** Pure and deterministic: the model only proposes a filter; this decides who matches. */
export function applyFilter(rows: ClientRow[], f: SearchFilter): ClientRow[] {
  const out = rows.filter((r) => {
    if (f.sectors.length && !f.sectors.some((s) => r.sector.toLowerCase().includes(s.toLowerCase()) || s.toLowerCase().includes(r.sector.toLowerCase()))) return false;
    if (f.tiers.length) {
      // "Nurture" also covers the advisory-only variant
      if (!f.tiers.some((t) => t.toLowerCase() === r.tier.toLowerCase() || (t.toLowerCase() === "nurture" && r.tier.startsWith("Nurture")))) return false;
    }
    if (f.confidence.length && !has(f.confidence, r.confidence)) return false;
    if (f.min_score != null && r.score < f.min_score) return false;
    if (f.max_score != null && r.score > f.max_score) return false;
    if (f.gate.length && !has(f.gate, r.gate_status)) return false;
    if (f.statuses.length && !f.statuses.every((s) => has(r.statuses, s))) return false;
    if (f.exec_access === "strong" && !(r.exec_score != null && r.exec_score >= 4)) return false;
    if (f.exec_access === "weak" && !(r.exec_score != null && r.exec_score <= 2)) return false;
    if (f.brand_permission === "strong" && !(r.brand_score != null && r.brand_score >= 4)) return false;
    if (f.brand_permission === "weak" && !(r.brand_score != null && r.brand_score <= 2)) return false;
    if (f.audit_relationship === "none" && r.gate_status !== "none") return false;
    if (f.audit_relationship === "present" && r.gate_status !== "restricted") return false;
    if (f.name_contains && !r.name.toLowerCase().includes(f.name_contains.toLowerCase())) return false;
    return true;
  });
  const by = f.sort ?? "score";
  return out.sort((a, b) => (by === "name" ? a.name.localeCompare(b.name) : by === "updated" ? b.updated_at.localeCompare(a.updated_at) : b.score - a.score));
}

/** Plain-English description of what was understood, shown to the user so they can correct it. */
export function describeFilter(f: SearchFilter): string[] {
  const out: string[] = [];
  if (f.sectors.length) out.push(`Sector: ${f.sectors.join(", ")}`);
  if (f.tiers.length) out.push(`Tier: ${f.tiers.join(", ")}`);
  if (f.confidence.length) out.push(`Confidence: ${f.confidence.join(", ")}`);
  if (f.min_score != null) out.push(`Score ≥ ${f.min_score}`);
  if (f.max_score != null) out.push(`Score ≤ ${f.max_score}`);
  if (f.gate.length) out.push(`Audit gate: ${f.gate.join(", ")}`);
  if (f.statuses.length) out.push(`Status: ${f.statuses.join(", ")}`);
  if (f.exec_access) out.push(`Executive access: ${f.exec_access}`);
  if (f.brand_permission) out.push(`Brand permission: ${f.brand_permission}`);
  if (f.audit_relationship) out.push(f.audit_relationship === "none" ? "No audit relationship" : "Audit relationship present");
  if (f.name_contains) out.push(`Name contains "${f.name_contains}"`);
  return out;
}

export function registerSearchRoutes(app: FastifyInstance, db: Db, llm: LlmProvider) {
  app.post<{ Body: { query: string } }>("/api/clients/search", async (req, reply) => {
    const query = req.body?.query?.trim();
    if (!query) return reply.code(400).send({ error: "Type what you are looking for." });
    let filter: SearchFilter;
    try {
      filter = await llm.parseSearch(query);
    } catch {
      filter = { ...EMPTY_FILTER, name_contains: query }; // never leave the user empty-handed: fall back to a name search
    }
    const rows = applyFilter(await clientRows(db), filter);
    return { filter, understood: describeFilter(filter), rows };
  });
}
