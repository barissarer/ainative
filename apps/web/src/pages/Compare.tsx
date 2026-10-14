import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { DIMENSION_KEYS, DIMENSION_LABELS, type Client, type Qualification } from "@ainative/shared";
import { api, getClients, type ClientRowFull } from "../api";
import { TierBadge } from "../components/Bits";

type Item = { client: Client; q: Qualification };

export default function Compare() {
  const [params, setParams] = useSearchParams();
  const ids = (params.get("ids") ?? "").split(",").filter(Boolean).slice(0, 4);
  const [items, setItems] = useState<Item[]>([]);
  const [all, setAll] = useState<ClientRowFull[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => { getClients().then((r) => setAll(r as ClientRowFull[])).catch(() => {}); }, []);
  useEffect(() => {
    setErr("");
    Promise.all(ids.map((id) => api<{ client: Client; qualification: Qualification }>("GET", `/api/clients/${id}`).then((r) => ({ client: r.client, q: r.qualification }))))
      .then(setItems).catch((e) => setErr(e.message));
  }, [params.get("ids")]);

  const setIds = (next: string[]) => setParams(next.length ? { ids: next.join(",") } : {});
  const best = (vals: (number | null)[]) => { const nums = vals.filter((v): v is number => v != null); return nums.length > 1 && new Set(nums).size > 1 ? Math.max(...nums) : null; };

  if (ids.length < 2) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <h1 className="text-lg font-semibold">Compare clients</h1>
        <p className="mb-4 text-sm text-neutral-600">Pick 2 to 4 clients to see them side by side.</p>
        {all.length < 2 ? <p className="text-sm text-neutral-500">Qualify at least two clients first.</p> : (
          <ul className="card divide-y divide-neutral-100">
            {all.map((c) => (
              <li key={c.id}><label className="flex items-center gap-3 p-3 text-sm"><input type="checkbox" checked={ids.includes(c.id)} onChange={(e) => setIds(e.target.checked ? [...ids, c.id].slice(0, 4) : ids.filter((x) => x !== c.id))} /> <span className="flex-1 font-medium">{c.name}</span><span className="text-neutral-500">{c.sector}</span><TierBadge tier={c.tier} /><span className="w-8 text-right font-semibold">{c.score}</span></label></li>
            ))}
          </ul>
        )}
        {ids.length === 1 && <p className="mt-3 text-sm text-neutral-600">Add at least one more client.</p>}
      </div>
    );
  }
  if (err) return <div className="p-6 text-sm" role="alert">{err}</div>;
  if (items.length !== ids.length) return <div className="p-6 text-sm text-neutral-500">Loading…</div>;

  const cell = "border-b border-neutral-100 p-3 align-top";
  const lead = (q: Qualification) => (q as any).leader_summary as null | { leaders: any[]; disagreements: string[] };
  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-3 flex items-center justify-between"><h1 className="text-lg font-semibold">Compare</h1><div className="flex gap-2"><button className="btn" onClick={() => setIds([])}>Change selection</button></div></div>
      <div className="overflow-x-auto">
        <table className="card w-full min-w-[640px] text-sm">
          <thead>
            <tr><th className="w-48 p-3" />{items.map((i) => (
              <th key={i.client.id} className="p-3 text-left align-top"><Link to={`/?client=${i.client.id}`} className="text-base font-bold hover:underline">{i.client.name}</Link><div className="text-xs font-normal text-neutral-500">{i.client.sector}{i.client.region ? ` · ${i.client.region}` : ""}</div></th>
            ))}</tr>
          </thead>
          <tbody>
            <tr><td className={`${cell} font-medium`}>Tier</td>{items.map((i) => <td key={i.client.id} className={cell}><TierBadge tier={i.q.tier} />{i.q.override && <div className="mt-1 text-xs text-neutral-500">Overridden (AI: {i.q.ai_tier})</div>}</td>)}</tr>
            {(() => { const b = best(items.map((i) => i.q.overall_score)); return (
              <tr><td className={`${cell} font-medium`}>Overall score</td>{items.map((i) => <td key={i.client.id} className={`${cell} text-lg font-bold ${i.q.overall_score === b ? "bg-brand/20" : ""}`}>{i.q.overall_score}</td>)}</tr>
            ); })()}
            <tr><td className={`${cell} font-medium`}>Confidence</td>{items.map((i) => <td key={i.client.id} className={cell}>{i.q.confidence}</td>)}</tr>
            <tr><td className={`${cell} font-medium`}>Audit gate</td>{items.map((i) => <td key={i.client.id} className={cell}>{i.q.gate.status === "restricted" || i.q.gate.status === "unresolved" ? <b>{i.q.gate.status}</b> : i.q.gate.status}</td>)}</tr>
            {DIMENSION_KEYS.map((k) => {
              const b = best(items.map((i) => i.q.dimensions.find((d) => d.key === k)?.score ?? null));
              return (
                <tr key={k}><td className={`${cell} font-medium`}>{DIMENSION_LABELS[k]}</td>{items.map((i) => {
                  const d = i.q.dimensions.find((x) => x.key === k)!;
                  return <td key={i.client.id} className={`${cell} ${d.score === b ? "bg-brand/20" : ""}`}><b>{d.score}/5</b> <span className="text-xs text-neutral-500">{d.origin}, {d.confidence}</span></td>;
                })}</tr>
              );
            })}
            <tr><td className={`${cell} font-medium`}>Leader input</td>{items.map((i) => { const l = lead(i.q); return <td key={i.client.id} className={cell}>{l?.leaders?.length ? <>{l.leaders.length} leader{l.leaders.length > 1 ? "s" : ""}{l.disagreements.length > 0 && <ul className="mt-1 list-disc pl-4 text-xs">{l.disagreements.map((d) => <li key={d}>{d}</li>)}</ul>}</> : <span className="text-neutral-500">None yet</span>}</td>; })}</tr>
            <tr><td className={`${cell} font-medium`}>Pitch readiness</td>{items.map((i) => <td key={i.client.id} className={`${cell} text-xs`}>{i.q.pitch_readiness}</td>)}</tr>
            <tr><td className={`${cell} font-medium`}>Entry point</td>{items.map((i) => <td key={i.client.id} className={`${cell} text-xs`}><b>{i.q.entry_point.buyer_persona}</b><br />{i.q.entry_point.first_conversation_angle}</td>)}</tr>
            <tr><td className={`${cell} font-medium`}>Key risks</td>{items.map((i) => <td key={i.client.id} className={`${cell} text-xs`}><ul className="list-disc pl-4">{i.q.risks.map((r) => <li key={r}>{r}</li>)}</ul></td>)}</tr>
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-neutral-500">Green marks the highest value in a row when the clients differ. Scores are comparable because every client uses the same dimensions and weights.</p>
    </div>
  );
}
