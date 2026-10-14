import { useEffect, useState } from "react";
import { AUDIT_LABELS, type Client, type LeaderInput, type Qualification } from "@ainative/shared";
import { api, getUserId } from "../api";

type Person = { id: string; name: string; title: string };
type Req = { id: string; assignee_name: string; assignee_role: string; status: string };

const GATE_OPTIONS = [
  ["cleared", "Cleared"],
  ["none", "No restriction"],
  ["restricted", "Restricted"],
  ["unresolved", "Unresolved"],
] as const;

export default function LeaderPanel({ client, q, role, onUpdate, readOnly }: { client: Client; q: Qualification; role: string; onUpdate: (q: Qualification) => void; readOnly?: boolean }) {
  const [inputs, setInputs] = useState<LeaderInput[]>([]);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const [gateStatus, setGateStatus] = useState<string>("cleared");
  const [gateReason, setGateReason] = useState("");
  const [gateHistory, setGateHistory] = useState<any[]>([]);
  const summary = (q as any).leader_summary as null | { disagreements: string[]; conflicts: { text: string }[]; revised_approach: string | null };

  const load = () => {
    api<LeaderInput[]>("GET", `/api/clients/${client.id}/leader-inputs`).then(setInputs).catch(() => {});
    api<Req[]>("GET", `/api/clients/${client.id}/leader-requests`).then(setReqs).catch(() => {});
    api<any[]>("GET", `/api/clients/${client.id}/gate-history`).then(setGateHistory).catch(() => {});
  };
  useEffect(load, [client.id, q.version]);

  const pending = reqs.filter((r) => r.status === "pending");
  const canAsk = !readOnly && (role === "consultant" || role === "account_leader");

  async function openPicker() {
    setPicking(true);
    setPeople(await api("GET", `/api/clients/${client.id}/suggested-leaders`));
  }
  async function send() {
    try {
      const r = await api<{ created: string[] }>("POST", `/api/clients/${client.id}/leader-requests`, { assignee_ids: chosen });
      setMsg(r.created.length ? `Requested input from ${r.created.length} leader${r.created.length > 1 ? "s" : ""}.` : "Those leaders already have a pending request.");
      setPicking(false); setChosen([]); load();
    } catch (e: any) { setMsg(e.message); }
  }
  async function changeGate() {
    try {
      const r = await api<{ qualification: Qualification }>("POST", `/api/clients/${client.id}/gate`, { status: gateStatus, reason: gateReason });
      onUpdate(r.qualification); setGateReason(""); setMsg("Audit gate updated and logged.");
    } catch (e: any) { setMsg(e.message); }
  }

  return (
    <div className="space-y-4">
      <div className="card p-3 text-sm">
        <h3 className="mb-1 font-semibold">Account leader input</h3>
        {inputs.length === 0 && <p className="text-neutral-600">No leader input yet. Brand permission and executive relationship are AI estimates.</p>}

        {summary && summary.disagreements.length > 0 && (
          <div className="mb-2 rounded border-2 border-black bg-white p-2">
            <div className="text-xs font-semibold uppercase">Leaders disagree</div>
            <ul className="list-disc pl-5">{summary.disagreements.map((d) => <li key={d}>{d}</li>)}</ul>
          </div>
        )}
        {inputs.length > 1 && summary && summary.disagreements.length === 0 && <p className="mb-2 text-xs text-neutral-500">All leaders agree.</p>}

        <ul className="space-y-2">
          {inputs.map((i) => (
            <li key={i.id} className="rounded border border-neutral-200 p-2">
              <div className="flex justify-between text-xs text-neutral-500"><span><b className="text-black">{i.author.name}</b>, {i.author.role}</span><span>{new Date(i.created_at).toLocaleString()}</span></div>
              <div className="mt-1 text-xs">
                Brand permission: <b>{i.brand_permission.rating}</b> · Access: <b>{i.exec_relationship.seniority}, {i.exec_relationship.quality}</b>, bold pitch: <b>{i.exec_relationship.receptiveness}</b> · Audit: <b>{AUDIT_LABELS[i.audit_status.status]}</b>
              </div>
              {[i.brand_permission.comment, i.exec_relationship.comment, i.audit_status.comment].filter(Boolean).map((c) => <p key={c} className="mt-1 text-xs italic text-neutral-600">“{c}”</p>)}
              <div className="mt-1 text-[11px] text-neutral-400">{i.source === "conversational" ? "Typed, then confirmed" : "Tapped"}</div>
            </li>
          ))}
        </ul>

        {summary && summary.conflicts.length > 0 && (
          <div className="mt-2 rounded bg-neutral-50 p-2">
            <div className="text-xs font-semibold uppercase">Leader view differs from the AI</div>
            <ul className="list-disc pl-5">{summary.conflicts.map((c) => <li key={c.text}>{c.text}</li>)}</ul>
            {summary.revised_approach && <p className="mt-1"><b>Suggested approach:</b> {summary.revised_approach}</p>}
          </div>
        )}

        {pending.length > 0 && (
          <div className="mt-2 text-xs text-neutral-600">
            Awaiting: {pending.map((r) => (
              <span key={r.id} className="chip mr-1">{r.assignee_name}
                <button className="ml-1 underline" title="Copy a link to send by email" onClick={() => navigator.clipboard?.writeText(`${location.origin}/requests/${r.id}`).then(() => setMsg("Link copied."))}>copy link</button>
              </span>
            ))}
          </div>
        )}

        {canAsk && !picking && <button className="btn mt-2" onClick={openPicker}>Ask account leader</button>}
        {picking && (
          <div className="mt-2 rounded border border-neutral-200 p-2">
            <div className="mb-1 text-xs font-medium">Who should weigh in?</div>
            {people.map((p) => (
              <label key={p.id} className="flex items-center gap-2 py-0.5">
                <input type="checkbox" checked={chosen.includes(p.id)} onChange={(e) => setChosen((c) => (e.target.checked ? [...c, p.id] : c.filter((x) => x !== p.id)))} />
                {p.name} <span className="text-xs text-neutral-500">{p.title}</span>
              </label>
            ))}
            <div className="mt-2 flex gap-2"><button className="btn-primary" disabled={!chosen.length} onClick={send}>Send request</button><button className="btn" onClick={() => setPicking(false)}>Cancel</button></div>
          </div>
        )}
        {msg && <p className="mt-2 text-xs text-neutral-600" role="status">{msg}</p>}
      </div>

      <div className="card p-3 text-sm">
        <h3 className="mb-1 font-semibold">Audit relationship gate</h3>
        <p className="text-neutral-600">Status: <b className="text-black">{q.gate.status}</b>{q.gate.reason ? ` · ${q.gate.reason}` : ""}</p>
        <p className="mt-1 text-xs text-neutral-500">This app does not make independence determinations. Follow the firm's official independence process.</p>
        {role === "risk_independence" ? (
          <div className="mt-2 space-y-2 border-t border-neutral-100 pt-2">
            <div className="text-xs font-medium">Risk / Independence: change the gate</div>
            <select className="w-full rounded border border-neutral-300 px-2 py-1" value={gateStatus} onChange={(e) => setGateStatus(e.target.value)}>
              {GATE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <textarea className="w-full rounded border border-neutral-300 px-2 py-1" rows={2} placeholder="Reason (required, logged)" value={gateReason} onChange={(e) => setGateReason(e.target.value)} />
            <button className="btn-primary" disabled={!gateReason.trim()} onClick={changeGate}>Apply and log</button>
          </div>
        ) : (
          <p className="mt-1 text-xs text-neutral-500">Only the Risk / Independence role can clear or change this.</p>
        )}
        {gateHistory.length > 0 && (
          <details className="mt-2 text-xs"><summary className="cursor-pointer text-neutral-600">History ({gateHistory.length})</summary>
            <ul className="mt-1 space-y-1">{gateHistory.map((g) => <li key={g.id}>{new Date(g.updated_at).toLocaleString()}: <b>{g.status}</b> by {g.set_by}{g.reason ? ` — ${g.reason}` : ""}</li>)}</ul>
          </details>
        )}
      </div>
    </div>
  );
}
