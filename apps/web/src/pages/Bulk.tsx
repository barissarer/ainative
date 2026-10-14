import { useState } from "react";
import { Link } from "react-router-dom";
import { streamPost, type ClientRowFull } from "../api";
import { TierBadge } from "../components/Bits";

type Item = { name: string; status: "queued" | "working" | "done" | "existing" | "failed"; error?: string };

export default function Bulk() {
  const [text, setText] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [ranked, setRanked] = useState<ClientRowFull[] | null>(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState("");

  async function readFile(f: File | undefined) {
    if (f) setText(((text ? text + "\n" : "") + (await f.text())).trim());
  }
  async function start() {
    setErr(""); setRanked(null); setRunning(true); setItems([]);
    try {
      await streamPost("/api/bulk", { text }, (ev, d) => {
        if (ev === "start") setItems(d.names.map((n: string) => ({ name: n, status: "queued" })));
        else if (ev === "progress") setItems((c) => c.map((i) => (i.name === d.name && i.status === "queued" ? { ...i, status: "working" } : i)));
        else if (ev === "item") setItems((c) => c.map((i) => (i.name === d.name ? { ...i, status: d.status, error: d.error } : i)));
        else if (ev === "done") setRanked(d.ranked);
      });
    } catch (e: any) { setErr(e.message); }
    setRunning(false);
  }
  const doneN = items.filter((i) => ["done", "existing", "failed"].includes(i.status)).length;

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="text-lg font-semibold">Bulk qualify</h1>
      <p className="mb-3 text-sm text-neutral-600">Paste a list of client names (one per line) or upload a .txt/.csv. You get a ranked first pass for all of them; open any to see the evidence. Up to 25 at a time. Clients you have already qualified are ranked from their saved result, not researched again.</p>
      <textarea className="h-36 w-full rounded-md border border-neutral-300 p-3 text-sm focus:border-brand focus:outline-none" placeholder={"Acme Insurance\nNorthwind Bank\nContoso Energy"} value={text} onChange={(e) => setText(e.target.value)} disabled={running} aria-label="Client names" />
      <div className="mt-2 flex items-center gap-3">
        <button className="btn-primary" disabled={running || !text.trim()} onClick={start}>{running ? "Working…" : "Qualify all"}</button>
        <label className="btn cursor-pointer">Upload list<input type="file" hidden accept=".txt,.csv" onChange={(e) => { readFile(e.target.files?.[0]); e.target.value = ""; }} /></label>
        {running && <span className="text-sm text-neutral-500">{doneN} of {items.length} done</span>}
      </div>
      {err && <p className="mt-2 text-sm" role="alert">{err}</p>}

      {items.length > 0 && !ranked && (
        <ul className="card mt-4 divide-y divide-neutral-100 text-sm">
          {items.map((i) => <li key={i.name} className="flex justify-between p-2.5"><span>{i.name}</span><span className="text-neutral-500">{i.status === "queued" ? "Waiting" : i.status === "working" ? "Researching…" : i.status === "existing" ? "Already qualified" : i.status === "failed" ? `Failed: ${i.error}` : "Done"}</span></li>)}
        </ul>
      )}

      {ranked && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-semibold">Ranked first pass</h2>
          <table className="card w-full text-sm">
            <thead className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-500"><tr><th className="p-3 w-10">#</th><th>Client</th><th>Sector</th><th>Tier</th><th>Score</th><th>Confidence</th></tr></thead>
            <tbody>
              {ranked.map((r, n) => (
                <tr key={r.id} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                  <td className="p-3 text-neutral-500">{n + 1}</td>
                  <td className="font-medium"><Link className="hover:underline" to={`/?client=${r.id}`}>{r.name}</Link></td>
                  <td>{r.sector}</td><td><TierBadge tier={r.tier} /></td><td className="font-semibold">{r.score}</td><td>{r.confidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {items.some((i) => i.status === "failed") && <p className="mt-2 text-sm">Some names failed: {items.filter((i) => i.status === "failed").map((i) => `${i.name} (${i.error})`).join("; ")}. Run them again on their own.</p>}
          <p className="mt-2 text-xs text-neutral-500">First-pass results carry low confidence on the relationship dimensions until account leaders weigh in. <Link className="underline" to="/clients">See all clients</Link></p>
        </div>
      )}
    </div>
  );
}
