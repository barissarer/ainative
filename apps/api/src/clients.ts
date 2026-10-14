import type { Db } from "./db";

export interface ClientRow {
  id: string; name: string; sector: string; region: string | null; owner: string | null;
  score: number; tier: string; confidence: string; version: number; updated_at: string;
  gate_status: string; exec_score: number | null; brand_score: number | null; in_campaign: boolean;
  statuses: string[];
}

/** One row per client (latest qualification), with the derived status chips used by the list, search and compare. */
export async function clientRows(db: Db): Promise<ClientRow[]> {
  const r = await db.query<any>(
    `select c.*, q.version, q.overall_score, q.tier, q.confidence, q.created_at as updated_at, q.data,
            (select count(*) from leader_requests lr where lr.client_id=c.id and lr.status='pending') as pending
     from clients c join lateral (select * from qualifications where client_id=c.id order by version desc limit 1) q on true
     order by q.created_at desc`,
  );
  return r.rows.map((x: any) => {
    const gate = x.data?.gate?.status ?? "none";
    const dims: any[] = x.data?.dimensions ?? [];
    const dim = (k: string) => dims.find((d) => d.key === k);
    const informed = dims.some((d) => d.origin === "Leader-informed");
    return {
      id: x.id, name: x.name, sector: x.sector, region: x.region, owner: x.owner,
      score: Number(x.overall_score), tier: x.tier, confidence: x.confidence,
      version: Number(x.version), updated_at: new Date(x.updated_at).toISOString(), gate_status: gate,
      exec_score: dim("exec_relationship")?.score ?? null, brand_score: dim("brand_permission")?.score ?? null,
      in_campaign: !!x.in_campaign,
      statuses: [
        x.in_campaign ? "In campaign" : null,
        Number(x.pending) > 0 ? "Awaiting leader input" : null,
        informed ? "Leader-informed" : null,
        gate === "restricted" ? "Audit restriction" : null,
        gate === "unresolved" ? "Audit status unresolved" : null,
      ].filter(Boolean) as string[],
    };
  });
}
