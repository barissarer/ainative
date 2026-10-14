import { useState } from "react";
import { PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer } from "recharts";
import { DIMENSION_LABELS, type Client, type Qualification } from "@ainative/shared";
import { TierBadge } from "./Bits";

const tag = (t: string) =>
  t === "Fact" ? "bg-brand/20" : t === "Leader-informed" ? "bg-black text-white" : "bg-neutral-100";

export default function Scorecard({ client, q, gateBanner, gateNote }: { client: Client; q: Qualification; gateBanner?: string; gateNote?: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const radar = q.dimensions.map((d) => ({ dim: DIMENSION_LABELS[d.key].split(" ")[0], score: d.score }));
  const evById = new Map(q.evidence.map((e) => [e.id, e]));
  const gateActive = q.gate.status === "restricted" || q.gate.status === "unresolved";

  return (
    <div className="space-y-4 p-5">
      {gateActive && (
        <div className="rounded-lg border-2 border-black bg-neutral-50 p-3 text-sm">
          <div className="font-semibold">{q.gate.status === "restricted" ? gateBanner : "Audit relationship not confirmed: \"Pursue now\" is blocked until resolved."}</div>
          <div className="mt-1 text-neutral-600">{gateNote}</div>
        </div>
      )}

      <div className="card p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs text-neutral-500">{client.sector}{client.region ? ` · ${client.region}` : ""} · version {q.version}</div>
            <h2 className="text-xl font-bold">{client.name}</h2>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold">{q.overall_score}<span className="text-base text-neutral-400">/100</span></div>
            <TierBadge tier={q.tier} />
            <div className="mt-1 text-xs text-neutral-500">Confidence: {q.confidence}</div>
          </div>
        </div>
        <p className="mt-3 text-sm">{q.headline_why}</p>
        <p className="mt-2 rounded bg-neutral-50 p-2 text-sm"><b>Pitch readiness:</b> {q.pitch_readiness}</p>
      </div>

      <div className="card p-3">
        <div className="h-56">
          <ResponsiveContainer>
            <RadarChart data={radar}>
              <PolarGrid />
              <PolarAngleAxis dataKey="dim" tick={{ fontSize: 11 }} />
              <Radar dataKey="score" stroke="#43B02A" fill="#86BC25" fillOpacity={0.5} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="space-y-2">
        {q.dimensions.map((d) => (
          <div key={d.key} className="card">
            <button className="flex w-full items-center justify-between p-3 text-left" onClick={() => setOpen(open === d.key ? null : d.key)}>
              <span className="text-sm font-medium">{DIMENSION_LABELS[d.key]} <span className="chip ml-1">{d.origin}</span></span>
              <span className="text-sm">{d.score}/5 · {d.confidence} · weight {q.weights[d.key]}</span>
            </button>
            {open === d.key && (
              <div className="space-y-2 border-t border-neutral-100 p-3 text-sm">
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

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="card p-3 text-sm"><h3 className="mb-1 font-semibold">Key risks</h3><ul className="list-disc pl-5">{q.risks.map((r) => <li key={r}>{r}</li>)}</ul></div>
        <div className="card p-3 text-sm"><h3 className="mb-1 font-semibold">Open questions</h3><ul className="list-disc pl-5">{q.open_questions.map((r) => <li key={r}>{r}</li>)}</ul></div>
      </div>
      <div className="card p-3 text-sm">
        <h3 className="mb-1 font-semibold">Suggested entry point</h3>
        <p><b>Buyer:</b> {q.entry_point.buyer_persona}</p>
        <p><b>Hook:</b> {q.entry_point.hook}</p>
        <p><b>First conversation:</b> {q.entry_point.first_conversation_angle}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {["Save to campaign", "Ask account leader", "Compare with other clients", "Export one-pager (PDF)", "Hand off to Narrative builder"].map((a) => (
          <button key={a} className="btn" disabled title="Coming in a later phase">{a}</button>
        ))}
      </div>
    </div>
  );
}
