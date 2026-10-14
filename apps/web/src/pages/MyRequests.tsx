import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { TierBadge } from "../components/Bits";

export default function MyRequests({ meName }: { meName: string }) {
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { api<any[]>("GET", "/api/leader-requests").then(setRows).catch(() => setRows([])); }, [meName]);
  if (!rows) return <div className="p-6 text-sm text-neutral-500">Loading…</div>;
  const pending = rows.filter((r) => r.status === "pending");
  const done = rows.filter((r) => r.status === "done");
  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-lg font-semibold">My requests</h1>
      <p className="mb-4 text-sm text-neutral-600">Clients waiting for your view. It takes under two minutes: tap, or just type a sentence.</p>
      {rows.length === 0 && <div className="card p-6 text-center text-sm text-neutral-600">Nothing waiting for {meName}. Requests appear here when a consultant asks for your input.<br />Switch to an account leader (top right) to try it.</div>}
      {pending.length > 0 && <h2 className="mb-2 text-xs font-medium uppercase text-neutral-500">Awaiting your input</h2>}
      <ul className="space-y-2">
        {pending.map((r) => (
          <li key={r.id}>
            <Link to={`/requests/${r.id}`} className="card flex items-center justify-between p-3 hover:bg-neutral-50">
              <div><div className="font-medium">{r.client_name}</div><div className="text-xs text-neutral-500">{r.sector} · requested by {r.requested_by} · {new Date(r.created_at).toLocaleDateString()}</div></div>
              <div className="flex items-center gap-3"><TierBadge tier={r.tier} /><span className="btn-primary">Give your view</span></div>
            </Link>
          </li>
        ))}
      </ul>
      {done.length > 0 && <h2 className="mb-2 mt-6 text-xs font-medium uppercase text-neutral-500">Completed</h2>}
      <ul className="space-y-2">
        {done.map((r) => (
          <li key={r.id}><Link to={`/requests/${r.id}`} className="card flex items-center justify-between p-3 text-sm hover:bg-neutral-50"><span>{r.client_name}</span><span className="text-xs text-neutral-500">Done {r.completed_at ? new Date(r.completed_at).toLocaleDateString() : ""} · edit</span></Link></li>
        ))}
      </ul>
    </div>
  );
}
