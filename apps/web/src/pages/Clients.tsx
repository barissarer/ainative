import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getClients, type ClientRow } from "../api";
import { TierBadge } from "../components/Bits";

export default function Clients() {
  const [rows, setRows] = useState<ClientRow[] | null>(null);
  const [sort, setSort] = useState<"score" | "name" | "updated_at">("updated_at");
  useEffect(() => { getClients().then(setRows); }, []);
  if (!rows) return <div className="p-6 text-sm text-neutral-500">Loading…</div>;
  if (rows.length === 0) return <div className="p-10 text-center text-sm text-neutral-600">No qualified clients yet. Start on the Home page.</div>;
  const sorted = [...rows].sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "score" ? b.score - a.score : b.updated_at.localeCompare(a.updated_at));
  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Clients</h1>
        <label className="text-xs text-neutral-500">Sort by{" "}
          <select className="ml-1 rounded border border-neutral-300 px-1 py-0.5" value={sort} onChange={(e) => setSort(e.target.value as any)}>
            <option value="updated_at">Last updated</option><option value="score">Score</option><option value="name">Name</option>
          </select>
        </label>
      </div>
      <table className="card w-full text-sm">
        <thead className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-500">
          <tr><th className="p-3">Client</th><th>Sector</th><th>Tier</th><th>Score</th><th>Status</th><th>Updated</th></tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
              <td className="p-3 font-medium"><Link to={`/?client=${r.id}`} className="hover:underline">{r.name}</Link></td>
              <td>{r.sector}</td>
              <td><TierBadge tier={r.tier} /></td>
              <td>{r.score}</td>
              <td className="space-x-1">{r.statuses.map((s) => <span key={s} className="chip">{s}</span>)}</td>
              <td className="text-neutral-500">{new Date(r.updated_at).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
