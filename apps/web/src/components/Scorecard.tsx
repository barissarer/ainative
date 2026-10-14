import { useState } from "react";
import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer } from "recharts";
import { DIMENSION_LABELS, type Client, type Qualification } from "@ainative/shared";
import { TierBadge } from "./Bits";

const tag = (t: string) => (t === "Fact" ? "bg-brand/20" : t === "Leader-informed" ? "bg-black text-white" : "bg-neutral-100");

export default function Scorecard({ client, q, gateBanner, gateNote, onRefreshSector, busy }: { client: Client; q: Qualification; gateBanner?: string; gateNote?: string; onRefreshSector?: () => void; busy?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const radar = q.dimensions.map((d) => ({ dim: DIMENSION_LABELS[d.key].split(" ")[0], score: d.score }));
  const evById = new Map(q.evidence.map((e) => [e.id, e]));
  const gateActive = q.gate.status === "restricted" || q.gate.status === "unresolved";

  return (
    <div className="space-y-4 p-5">
      {gateActive && (
        <div className="rounded-lg border-2 border-black bg-white p-3 text-sm">
          <span className="font-semibold">{q.gate.status === "restricted" ? gateBanner : "Audit relationship not confirmed: “Pursue now” is blocked until resolved."}</span>{" "}
          <span className="text-neutral-600">{gateNote}</span>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        {/* Main column */}
        <div className="space-y-4">
          <div className="card grid gap-4 p-4 lg:grid-cols-[1fr_260px]">
            <div>
              <div className="text-xs text-neutral-500">{client.sector}{client.region ? ` · ${client.region}` : ""} · version {q.version}</div>
              <h2 className="text-2xl font-bold">{client.name}</h2>
              <div className="mt-3 flex items-end gap-4">
                <div className="text-5xl font-bold leading-none">{q.overall_score}<span className="text-lg text-neutral-400">/100</span></div>
                <div className="space-y-1"><TierBadge tier={q.tier} /><div className="text-xs text-neutral-500">Confidence: {q.confidence}</div></div>
              </div>
              <p className="mt-3 text-sm">{q.headline_why}</p>
              <p className="mt-2 rounded bg-neutral-50 p-2 text-sm"><b>Pitch readiness:</b> {q.pitch_readiness}</p>
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
                <button className="grid w-full grid-cols-[1fr_140px_70px_90px] items-center gap-3 px-3 py-2.5 text-left hover:bg-neutral-50" onClick={() => setOpen(open === d.key ? null : d.key)}>
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
                    {d.evidence_ids.map((id) => evById.get(id)).filter(Boolean).map((e) => (
                      <div key={e!.id} className="flex gap-2 text-xs">
                        <span className={`rounded px-1.5 py-0.5 font-medium ${tag(e!.type)}`}>{e!.type}</span>
                        <span>{e!.snippet}{" "}
                          {e!.source.startsWith("http") ? <a className="underline" href={e!.source} target="_blank" rel="noreferrer">source</a> : <i>({e!.source}-provided)</i>}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Right rail */}
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
          <div className="card p-3 text-sm">
            <h3 className="mb-1 font-semibold">Account leader input</h3>
            <p className="text-neutral-600">No leader input yet. Brand permission and executive relationship are AI estimates.</p>
            <button className="btn mt-2" disabled title="Coming in Phase 3">Ask account leader</button>
          </div>
          <div className="flex flex-wrap gap-2">
            {["Save to campaign", "Compare", "Export PDF", "Hand off to Narrative builder"].map((a) => (
              <button key={a} className="btn" disabled title="Coming in a later phase">{a}</button>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
