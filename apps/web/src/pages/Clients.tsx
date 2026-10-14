import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, getClients, type ClientRowFull } from "../api";
import { TierBadge } from "../components/Bits";

type SortKey = "name" | "sector" | "tier" | "score" | "confidence" | "owner" | "updated_at";
const EXAMPLES = ["banking clients rated Pursue now with low confidence", "Pursue-now clients where executive access is strong and there's no audit relationship", "clients awaiting leader input"];

export default function Clients() {
  const nav = useNavigate();
  const [all, setAll] = useState<ClientRowFull[] | null>(null);
  const [rows, setRows] = useState<ClientRowFull[] | null>(null);
  const [query, setQuery] = useState("");
  const [understood, setUnderstood] = useState<string[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "updated_at", dir: -1 });
  const [sel, setSel] = useState<string[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => { getClients().then((r) => { setAll(r as ClientRowFull[]); setRows(r as ClientRowFull[]); }); }, []);

  async function search(q: string) {
    setQuery(q); setErr("");
    if (!q.trim()) { setRows(all); setUnderstood(null); return; }
    setSearching(true);
    try {
      const r = await api<{ understood: string[]; rows: ClientRowFull[] }>("POST", "/api/clients/search", { query: q });
      setRows(r.rows); setUnderstood(r.understood);
    } catch (e: any) { setErr(e.message); }
    setSearching(false);
  }

  const sorted = useMemo(() => {
    const r = [...(rows ?? [])];
    const { key, dir } = sort;
    return r.sort((a: any, b: any) => (typeof a[key] === "number" ? a[key] - b[key] : String(a[key] ?? "").localeCompare(String(b[key] ?? ""))) * dir);
  }, [rows, sort]);

  const th = (key: SortKey, label: string) => (
    <th className="cursor-pointer select-none p-3 hover:text-black" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === "score" || key === "updated_at" ? -1 : 1 }))} aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      {label}{sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
    </th>
  );
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < 4 ? [...s, id] : s));

  if (!all) return <div className="p-6 text-sm text-neutral-500">Loading…</div>;
  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Clients</h1>
        <div className="flex gap-2">
          <Link to="/bulk" className="btn">Bulk qualify</Link>
          <button className="btn-primary" disabled={sel.length < 2} onClick={() => nav(`/compare?ids=${sel.join(",")}`)} title="Tick 2 to 4 clients">Compare {sel.length > 0 ? `(${sel.length})` : ""}</button>
        </div>
      </div>

      <form className="mb-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); search(query); }}>
        <input className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-brand focus:outline-none" placeholder="Ask in plain English, e.g. “banking clients rated Pursue now with low confidence”" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search clients" />
        <button className="btn-primary" disabled={searching}>{searching ? "Searching…" : "Search"}</button>
        {understood && <button type="button" className="btn" onClick={() => search("")}>Clear</button>}
      </form>
      {all.length > 0 && !understood && <div className="mb-3 flex flex-wrap gap-2">{EXAMPLES.map((e) => <button key={e} className="chip hover:bg-neutral-100" onClick={() => search(e)}>{e}</button>)}</div>}
      {understood && (
        <div className="mb-3 text-sm">
          <span className="text-neutral-500">Showing {sorted.length} of {all.length}. Understood as: </span>
          {understood.length === 0 ? <span className="chip">everyone</span> : understood.map((u) => <span key={u} className="chip mr-1">{u}</span>)}
        </div>
      )}
      {err && <p className="mb-2 text-sm" role="alert">{err}</p>}

      {all.length === 0 ? (
        <div className="card p-10 text-center text-sm text-neutral-600">No qualified clients yet. Start on the Home page, or <Link className="underline" to="/bulk">qualify a list</Link>.</div>
      ) : sorted.length === 0 ? (
        <div className="card p-10 text-center text-sm text-neutral-600">No clients match. Try fewer conditions, or clear the search.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="card w-full text-sm">
            <thead className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-500">
              <tr><th className="w-8 p-3" /> {th("name", "Client")}{th("sector", "Sector")}{th("tier", "Tier")}{th("score", "Score")}{th("confidence", "Confidence")}<th className="p-3">Status</th>{th("owner", "Owner")}{th("updated_at", "Updated")}</tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                  <td className="p-3"><input type="checkbox" aria-label={`Select ${r.name} to compare`} checked={sel.includes(r.id)} onChange={() => toggle(r.id)} disabled={!sel.includes(r.id) && sel.length >= 4} /></td>
                  <td className="p-3 font-medium"><Link to={`/?client=${r.id}`} className="hover:underline">{r.name}</Link></td>
                  <td>{r.sector}</td>
                  <td><TierBadge tier={r.tier} /></td>
                  <td className="font-semibold">{r.score}</td>
                  <td>{r.confidence}</td>
                  <td className="space-x-1">{r.statuses.map((s) => <span key={s} className="chip">{s}</span>)}</td>
                  <td className="text-neutral-600">{r.owner ?? ""}</td>
                  <td className="text-neutral-500">{new Date(r.updated_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
