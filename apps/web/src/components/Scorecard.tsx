import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer } from "recharts";
import { DIMENSION_LABELS, type Client, type Qualification } from "@ainative/shared";
import { Choice, TierBadge } from "./Bits";
import LeaderPanel from "./LeaderPanel";
import { api, download } from "../api";

const tag = (t: string) => (t === "Fact" ? "bg-brand/20" : t === "Leader-informed" ? "bg-black text-white" : "bg-neutral-100");
const TIERS = ["Pursue now", "Nurture", "Deprioritize"] as const;

interface Props {
  client: Client & { in_campaign?: boolean };
  q: Qualification;
  gateBanner?: string;
  gateNote?: string;
  onRefreshSector?: () => void;
  busy?: boolean;
  role?: string;
  onUpdate?: (q: Qualification) => void;
}

export default function Scorecard({ client, q, gateBanner, gateNote, onRefreshSector, busy, role = "consultant", onUpdate }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [inCampaign, setInCampaign] = useState(!!client.in_campaign);
  const [msg, setMsg] = useState("");
  const [versions, setVersions] = useState<any[]>([]);
  // override editors
  const [ovScore, setOvScore] = useState<string>("");
  const [ovReason, setOvReason] = useState("");
  const [tierOpen, setTierOpen] = useState(false);
  const [ovTier, setOvTier] = useState<string>("");

  const canOverride = ["consultant", "account_leader", "admin"].includes(role);
  const radar = q.dimensions.map((d) => ({ dim: DIMENSION_LABELS[d.key].split(" ")[0], score: d.score }));
  const evById = new Map(q.evidence.map((e) => [e.id, e]));
  const gateActive = q.gate.status === "restricted" || q.gate.status === "unresolved";

  useEffect(() => { setInCampaign(!!client.in_campaign); }, [client.id, client.in_campaign]);
  useEffect(() => { api<any[]>("GET", `/api/clients/${client.id}/versions`).then(setVersions).catch(() => {}); }, [client.id, q.version]);
  useEffect(() => { setOpen(null); setTierOpen(false); setOvReason(""); setOvScore(""); }, [client.id]);

  const run = async (fn: () => Promise<void>) => { setMsg(""); try { await fn(); } catch (e: any) { setMsg(e.message); } };
  const override = (body: object) => run(async () => {
    const r = await api<{ qualification: Qualification; capped_by_gate?: boolean }>("POST", `/api/clients/${client.id}/override`, body);
    onUpdate?.(r.qualification);
    setOvReason(""); setOvScore(""); setTierOpen(false);
    setMsg(r.capped_by_gate ? "Saved. The audit gate still caps the tier, so the displayed tier is lower than your override." : "Override saved and logged.");
  });
  const clearOv = (body: object) => run(async () => {
    const r = await api<{ qualification: Qualification }>("POST", `/api/clients/${client.id}/override/clear`, { ...body, reason: ovReason || "Override removed" });
    onUpdate?.(r.qualification); setOvReason(""); setMsg("Override removed.");
  });

  return (
    <div className="space-y-4 p-5">
      {gateActive && (
        <div className="rounded-lg border-2 border-black bg-white p-3 text-sm" role="alert">
          <span className="font-semibold">{q.gate.status === "restricted" ? gateBanner : "Audit relationship not confirmed: “Pursue now” is blocked until resolved."}</span>{" "}
          <span className="text-neutral-600">{gateNote}</span>
          {q.gate.reason && <div className="mt-1 text-xs text-neutral-500">{q.gate.reason}</div>}
        </div>
      )}
      {q.gate.status === "cleared" && (
        <div className="rounded-lg border border-neutral-300 bg-white p-3 text-xs text-neutral-600">Audit gate cleared by {q.gate.cleared_by} on {new Date(q.gate.updated_at).toLocaleDateString()}: {q.gate.reason}</div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <div className="card grid gap-4 p-4 lg:grid-cols-[1fr_260px]">
            <div>
              <div className="text-xs text-neutral-500">{client.sector}{client.region ? ` · ${client.region}` : ""} · version {q.version}{inCampaign && <span className="chip ml-2">In campaign</span>}</div>
              <h2 className="text-2xl font-bold">{client.name}</h2>
              <div className="mt-3 flex items-end gap-4">
                <div className="text-5xl font-bold leading-none">{q.overall_score}<span className="text-lg text-neutral-400">/100</span></div>
                <div className="space-y-1"><TierBadge tier={q.tier} /><div className="text-xs text-neutral-500">Confidence: {q.confidence}</div></div>
              </div>
              {q.override && (
                <p className="mt-2 rounded border border-neutral-300 bg-neutral-50 p-2 text-xs">
                  <b>Tier overridden</b> to {q.override.tier} by {q.override.by}: “{q.override.reason}”. AI view: {q.ai_tier}.{" "}
                  {canOverride && <button className="underline" onClick={() => clearOv({ kind: "tier" })}>Remove</button>}
                </p>
              )}
              <p className="mt-3 text-sm">{q.headline_why}</p>
              <p className="mt-2 rounded bg-neutral-50 p-2 text-sm"><b>Pitch readiness:</b> {q.pitch_readiness}</p>
              {canOverride && !tierOpen && <button className="btn mt-3" onClick={() => { setTierOpen(true); setOvTier(q.override?.tier ?? q.ai_tier); }}>Override tier</button>}
              {tierOpen && (
                <div className="mt-3 space-y-2 rounded border border-neutral-200 p-2 text-sm">
                  <div className="text-xs text-neutral-500">The audit gate cannot be overridden and still caps the tier.</div>
                  <Choice value={ovTier as any} options={TIERS} onChange={setOvTier} />
                  <input className="w-full rounded border border-neutral-300 px-2 py-1" placeholder="Reason (required, logged)" value={ovReason} onChange={(e) => setOvReason(e.target.value)} />
                  <div className="flex gap-2"><button className="btn-primary" disabled={!ovReason.trim() || !ovTier} onClick={() => override({ kind: "tier", tier: ovTier, reason: ovReason })}>Apply and log</button><button className="btn" onClick={() => setTierOpen(false)}>Cancel</button></div>
                </div>
              )}
            </div>
            <div className="h-56">
              <ResponsiveContainer>
                <RadarChart data={radar} outerRadius="70%">
                  <PolarGrid />
                  <PolarAngleAxis dataKey="dim" tick={{ fontSize: 11 }} />
                  <PolarRadiusAxis domain={[0, 5]} tick={false} axisLine={false} />
                  <Radar dataKey="score" stroke="#43B02A" fill="#86BC25" fillOpacity={0.5} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card divide-y divide-neutral-100">
            <div className="grid grid-cols-[1fr_140px_70px_90px] gap-3 px-3 py-2 text-xs font-medium uppercase text-neutral-500">
              <span>Dimension</span><span>Score</span><span>Weight</span><span>Confidence</span>
            </div>
            {q.dimensions.map((d) => (
              <div key={d.key}>
                <button className="grid w-full grid-cols-[1fr_140px_70px_90px] items-center gap-3 px-3 py-2.5 text-left hover:bg-neutral-50" onClick={() => { setOpen(open === d.key ? null : d.key); setOvScore(""); setOvReason(""); }}>
                  <span className="text-sm font-medium">{DIMENSION_LABELS[d.key]} <span className="chip ml-1">{d.origin}</span></span>
                  <span className="flex items-center gap-2">
                    <span className="h-2 flex-1 rounded bg-neutral-100"><span className="block h-2 rounded bg-brand" style={{ width: `${d.score * 20}%` }} /></span>
                    <span className="w-6 text-sm font-semibold">{d.score}/5</span>
                  </span>
                  <span className="text-sm text-neutral-600">{q.weights[d.key]}</span>
                  <span className="text-sm text-neutral-600">{d.confidence}</span>
                </button>
                {open === d.key && (
                  <div className="space-y-2 bg-neutral-50 px-3 py-3 text-sm">
                    <p>{d.rationale}</p>
                    {d.ai_score != null && d.ai_score !== d.score && <p className="text-xs text-neutral-500">AI estimate was {d.ai_score}/5.</p>}
                    {d.evidence_ids.map((id) => evById.get(id)).filter(Boolean).map((e) => (
                      <div key={e!.id} className="flex gap-2 text-xs">
                        <span className={`rounded px-1.5 py-0.5 font-medium ${tag(e!.type)}`}>{e!.type}</span>
                        <span>{e!.snippet}{" "}
                          {e!.source.startsWith("http") ? <a className="underline" href={e!.source} target="_blank" rel="noreferrer">source</a> : <i>({e!.source}-provided)</i>}
                        </span>
                      </div>
                    ))}
                    {canOverride && (
                      <div className="mt-2 space-y-2 border-t border-neutral-200 pt-2">
                        <div className="text-xs font-medium">Override this score</div>
                        <Choice value={ovScore as any} options={["1", "2", "3", "4", "5"] as const} onChange={setOvScore} />
                        <input className="w-full rounded border border-neutral-300 px-2 py-1" placeholder="Reason (required, logged)" value={ovReason} onChange={(e) => setOvReason(e.target.value)} />
                        <div className="flex gap-2">
                          <button className="btn-primary" disabled={!ovScore || !ovReason.trim()} onClick={() => override({ kind: "dimension", key: d.key, score: Number(ovScore), reason: ovReason })}>Apply and log</button>
                          {d.origin === "Human override" && <button className="btn" onClick={() => clearOv({ kind: "dimension", key: d.key })}>Remove override</button>}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          {msg && <p className="text-sm" role="status">{msg}</p>}
        </div>

        <aside className="space-y-4">
          <div className="card p-3 text-sm"><h3 className="mb-1 font-semibold">Suggested entry point</h3>
            <p><b>Buyer:</b> {q.entry_point.buyer_persona}</p>
            <p><b>Hook:</b> {q.entry_point.hook}</p>
            <p><b>First conversation:</b> {q.entry_point.first_conversation_angle}</p>
          </div>
          <div className="card p-3 text-sm"><h3 className="mb-1 font-semibold">Key risks</h3><ul className="list-disc pl-5">{q.risks.map((r) => <li key={r}>{r}</li>)}</ul></div>
          <div className="card p-3 text-sm"><h3 className="mb-1 font-semibold">Open questions</h3><ul className="list-disc pl-5">{q.open_questions.map((r) => <li key={r}>{r}</li>)}</ul></div>
          {q.sector_research && (
            <div className="card p-3 text-sm">
              <h3 className="mb-1 font-semibold">Sector research</h3>
              <p className="text-neutral-600">{q.sector_research.sector} research last refreshed on {new Date(q.sector_research.refreshed_at).toLocaleDateString()}.</p>
              <button className="btn mt-2" disabled={busy || !onRefreshSector} onClick={onRefreshSector}>Refresh sector research</button>
            </div>
          )}
          <LeaderPanel client={client} q={q} role={role} onUpdate={onUpdate ?? (() => {})} />

          <div className="flex flex-wrap gap-2">
            {canOverride && (
              <button className="btn" onClick={() => run(async () => { const r = await api<{ in_campaign: boolean }>("POST", `/api/clients/${client.id}/campaign`, { in_campaign: !inCampaign }); setInCampaign(r.in_campaign); setMsg(r.in_campaign ? "Saved to campaign." : "Removed from campaign."); })}>{inCampaign ? "Remove from campaign" : "Save to campaign"}</button>
            )}
            <Link className="btn" to={`/compare?ids=${client.id}`}>Compare with other clients</Link>
            <button className="btn" onClick={() => run(() => download(`/api/clients/${client.id}/onepager.pdf`, `${client.name}.pdf`))}>Export one-pager (PDF)</button>
            <button className="btn" title="Downloads a data package for the Narrative builder module" onClick={() => run(async () => { await download(`/api/clients/${client.id}/handoff`, `${client.name}_handoff.json`); setMsg("Hand-off package downloaded. The Narrative builder module will pick this up."); })}>Hand off to Narrative builder</button>
          </div>

          {versions.length > 0 && (
            <details className="card p-3 text-sm">
              <summary className="cursor-pointer font-semibold">Version history ({versions.length})</summary>
              <ul className="mt-2 space-y-2">
                {versions.map((v) => (
                  <li key={v.id} className="border-l-2 border-neutral-200 pl-2 text-xs">
                    <div><b>v{v.version}</b> · {v.overall_score} · {v.tier} · {v.created_by}</div>
                    <div className="text-neutral-500">{new Date(v.created_at).toLocaleString()}{v.reason ? ` · ${v.reason}` : ""}</div>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </aside>
      </div>
    </div>
  );
}
