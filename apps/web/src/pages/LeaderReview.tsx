import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AUDIT_LABELS, DIMENSION_LABELS } from "@ainative/shared";
import { api, type Draft } from "../api";
import { Choice, TierBadge } from "../components/Bits";

type Form = {
  brand: { rating: string; comment: string };
  audit: { status: string; audit_lead: string; comment: string };
  exec: { seniority: string; quality: string; receptiveness: string; owner: string; comment: string };
};
const EMPTY: Form = { brand: { rating: "", comment: "" }, audit: { status: "", audit_lead: "", comment: "" }, exec: { seniority: "", quality: "", receptiveness: "", owner: "", comment: "" } };
type Lens = "brand" | "audit" | "exec";

function fromDraft(d: Draft, cur: Form): { form: Form; suggested: Lens[] } {
  const f: Form = JSON.parse(JSON.stringify(cur));
  const s: Lens[] = [];
  if (d.brand_permission) { f.brand = { rating: d.brand_permission.rating, comment: d.brand_permission.comment ?? "" }; s.push("brand"); }
  if (d.audit_status) { f.audit = { status: d.audit_status.status, audit_lead: d.audit_status.audit_lead ?? "", comment: d.audit_status.comment ?? "" }; s.push("audit"); }
  if (d.exec_relationship) { const e = d.exec_relationship; f.exec = { seniority: e.seniority, quality: e.quality, receptiveness: e.receptiveness, owner: e.owner ?? "", comment: e.comment ?? "" }; s.push("exec"); }
  return { form: f, suggested: s };
}

export default function LeaderReview() {
  const { id } = useParams();
  const [data, setData] = useState<any>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [suggested, setSuggested] = useState<Lens[]>([]);
  const [source, setSource] = useState<"structured" | "conversational">("structured");
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<any>(null);
  const [listening, setListening] = useState(false);
  const rec = useRef<any>(null);
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

  useEffect(() => {
    api("GET", `/api/leader-requests/${id}`).then((d) => {
      setData(d);
      if (d.existing) {
        const e = d.existing;
        setForm({ brand: { rating: e.brand_permission.rating, comment: e.brand_permission.comment ?? "" }, audit: { status: e.audit_status.status, audit_lead: e.audit_status.audit_lead ?? "", comment: e.audit_status.comment ?? "" }, exec: { seniority: e.exec_relationship.seniority, quality: e.exec_relationship.quality, receptiveness: e.exec_relationship.receptiveness, owner: e.exec_relationship.owner ?? "", comment: e.exec_relationship.comment ?? "" } });
      } else if (d.suggested) {
        const r = fromDraft(d.suggested, EMPTY);
        setForm(r.form); setSuggested(r.suggested);
      }
    }).catch((e) => setErr(e.message));
  }, [id]);

  const confirm = (l: Lens) => setSuggested((s) => s.filter((x) => x !== l));
  const complete = form.brand.rating && form.audit.status && form.exec.seniority && form.exec.quality && form.exec.receptiveness;

  async function interpret() {
    setErr(""); setBusy(true);
    try {
      const d = await api<Draft>("POST", `/api/leader-requests/${id}/map`, { text });
      const r = fromDraft(d, form);
      setForm(r.form); setSuggested((s) => [...new Set([...s, ...r.suggested])]); setSource("conversational");
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  }
  function dictate() {
    if (!SR) return;
    if (listening) { rec.current?.stop(); return; }
    const r = new SR(); r.lang = "en-GB"; r.interimResults = false;
    r.onresult = (e: any) => setText((t) => `${t} ${e.results[0][0].transcript}`.trim());
    r.onend = () => setListening(false);
    rec.current = r; setListening(true); r.start();
  }
  async function submit() {
    setErr(""); setBusy(true);
    try {
      const r = await api("POST", `/api/leader-requests/${id}/submit`, {
        brand_permission: { rating: form.brand.rating, comment: form.brand.comment || undefined },
        audit_status: { status: form.audit.status, audit_lead: form.audit.audit_lead || undefined, comment: form.audit.comment || undefined },
        exec_relationship: { seniority: form.exec.seniority, quality: form.exec.quality, receptiveness: form.exec.receptiveness, owner: form.exec.owner || undefined, comment: form.exec.comment || undefined },
        source,
      });
      setDone(r.qualification);
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  }

  if (err && !data) return <div className="p-6 text-sm">{err}</div>;
  if (!data) return <div className="p-6 text-sm text-neutral-500">Loading…</div>;
  const q = data.qualification;
  const Tag = ({ l }: { l: Lens }) => (suggested.includes(l) ? <span className="chip ml-2 border-brand-dark bg-brand/20">Suggested, please confirm</span> : null);
  const set = <K extends Lens>(l: K, patch: Partial<Form[K]>) => { setForm((f) => ({ ...f, [l]: { ...f[l], ...patch } })); confirm(l); };

  if (done) {
    return (
      <div className="mx-auto max-w-xl p-10 text-center">
        <h1 className="text-lg font-semibold">Thank you. Your view is recorded.</h1>
        <p className="mt-2 text-sm text-neutral-600">{data.client.name} is now <TierBadge tier={done.tier} />. {done.pitch_readiness}</p>
        <Link className="btn-primary mt-4 inline-block" to="/requests">Back to my requests</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-5 p-5 lg:grid-cols-[2fr_3fr]">
      <section className="space-y-3">
        <div className="text-xs font-medium uppercase text-neutral-500">The AI's first-pass view</div>
        <div className="card p-4">
          <div className="flex items-start justify-between"><div><div className="text-xs text-neutral-500">{data.client.sector}{data.client.region ? ` · ${data.client.region}` : ""}</div><h1 className="text-xl font-bold">{data.client.name}</h1></div>
            <div className="text-right"><div className="text-3xl font-bold">{q.overall_score}<span className="text-sm text-neutral-400">/100</span></div><TierBadge tier={q.tier} /></div></div>
          <p className="mt-2 text-sm">{q.headline_why}</p>
          <ul className="mt-3 space-y-1 text-xs">
            {q.dimensions.map((d: any) => (<li key={d.key} className="flex justify-between"><span>{DIMENSION_LABELS[d.key as keyof typeof DIMENSION_LABELS]}</span><span className="text-neutral-600">{d.score}/5 · {d.origin}</span></li>))}
          </ul>
        </div>
        {q.leader_summary?.leaders?.length > 0 && <p className="text-xs text-neutral-500">Already weighed in: {q.leader_summary.leaders.map((l: any) => l.name).join(", ")}</p>}
      </section>

      <section className="space-y-4">
        <div className="card p-3">
          <label className="text-sm font-medium" htmlFor="say">Or just tell us in a sentence</label>
          <textarea id="say" className="mt-1 w-full rounded border border-neutral-300 p-2 text-sm" rows={2} placeholder="e.g. We've done lots of cost work there but nothing strategic, and the CEO barely knows us" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="mt-2 flex gap-2">
            <button className="btn-primary" disabled={!text.trim() || busy} onClick={interpret}>Fill in the answers for me</button>
            {SR && <button className="btn" onClick={dictate}>{listening ? "Stop" : "🎤 Dictate"}</button>}
          </div>
          <p className="mt-1 text-xs text-neutral-500">You'll see the result below and confirm or edit it before anything is saved.</p>
        </div>

        <div className="card p-4"><h2 className="mb-2 text-sm font-semibold">1. Brand permission to pitch <Tag l="brand" /></h2>
          <p className="mb-2 text-xs text-neutral-600">Do we have credibility and permission to pitch AI-native transformation here? Think past work, strategic vs tactical perception, sensitivities.</p>
          <Choice value={form.brand.rating as any} options={["Strong", "Moderate", "Weak", "Unknown"] as const} onChange={(v) => set("brand", { rating: v })} />
          <input className="mt-2 w-full rounded border border-neutral-300 px-2 py-1 text-sm" placeholder="Comment (optional)" value={form.brand.comment} onChange={(e) => set("brand", { comment: e.target.value })} />
        </div>

        <div className="card p-4"><h2 className="mb-2 text-sm font-semibold">2. Audit relationship <Tag l="audit" /></h2>
          <p className="mb-2 text-xs text-neutral-600">Are we the auditor, or an audit affiliate, of this client or a related entity? This is a constraint, not a preference. If unsure, say so: Risk will be notified.</p>
          <Choice value={form.audit.status as any} options={["not_audit_client", "audit_client", "related_entity_audit_client", "unsure"] as const} labels={AUDIT_LABELS} onChange={(v) => set("audit", { status: v })} />
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <input className="rounded border border-neutral-300 px-2 py-1 text-sm" placeholder="Audit engagement lead (optional)" value={form.audit.audit_lead} onChange={(e) => set("audit", { audit_lead: e.target.value })} />
            <input className="rounded border border-neutral-300 px-2 py-1 text-sm" placeholder="Comment (optional)" value={form.audit.comment} onChange={(e) => set("audit", { comment: e.target.value })} />
          </div>
          <p className="mt-2 text-xs text-neutral-500">This app does not make independence determinations. Follow the firm's official independence process.</p>
        </div>

        <div className="card p-4"><h2 className="mb-2 text-sm font-semibold">3. Executive relationship <Tag l="exec" /></h2>
          <p className="mb-1 text-xs text-neutral-600">Most senior relationship we have</p>
          <Choice value={form.exec.seniority as any} options={["CEO", "C-suite", "VP", "Director", "None"] as const} onChange={(v) => set("exec", { seniority: v })} />
          <p className="mb-1 mt-3 text-xs text-neutral-600">Quality of the relationship</p>
          <Choice value={form.exec.quality as any} options={["Strong", "Moderate", "Weak"] as const} onChange={(v) => set("exec", { quality: v })} />
          <p className="mb-1 mt-3 text-xs text-neutral-600">Would they be receptive to a bold “reinvent the company” conversation?</p>
          <Choice value={form.exec.receptiveness as any} options={["Yes", "Maybe", "No", "Unknown"] as const} onChange={(v) => set("exec", { receptiveness: v })} />
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <input className="rounded border border-neutral-300 px-2 py-1 text-sm" placeholder="Relationship owner (optional)" value={form.exec.owner} onChange={(e) => set("exec", { owner: e.target.value })} />
            <input className="rounded border border-neutral-300 px-2 py-1 text-sm" placeholder="Comment (optional)" value={form.exec.comment} onChange={(e) => set("exec", { comment: e.target.value })} />
          </div>
        </div>

        {err && <p className="text-sm font-medium" role="alert">{err}</p>}
        <div className="flex items-center gap-3">
          <button className="btn-primary" disabled={!complete || busy || suggested.length > 0} onClick={submit}>Confirm and submit</button>
          {suggested.length > 0 ? <span className="text-xs text-neutral-500">Tap or edit each “Suggested” answer to confirm it.</span> : !complete && <span className="text-xs text-neutral-500">Answer all three to submit.</span>}
        </div>
      </section>
    </div>
  );
}
