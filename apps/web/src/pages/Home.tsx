import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { DIMENSION_LABELS, type Client, type Qualification } from "@ainative/shared";
import { getClient, getConfig, streamChat, type Attachment } from "../api";
import Scorecard from "../components/Scorecard";
import { TierBadge } from "../components/Bits";

type Msg = { role: "user" | "assistant"; text: string; chips?: string[]; steps?: string[] };

const EXAMPLES = [
  "Qualify Acme Insurance, mid-size P&C insurer in the UK, we have a strong relationship with the CFO",
  "Qualify Northwind Bank, regional retail bank in Germany",
  "Qualify Contoso Energy, European utility mid-way through a cloud migration",
];
const REFINEMENTS = ["Weight executive relationship higher", "Assume they're already mid-way through a cloud migration", "Weight client circumstances lower"];

function summarise(q: Qualification) {
  const sorted = [...q.dimensions].sort((a, b) => b.score - a.score);
  const top = sorted.slice(0, 2).map((d) => DIMENSION_LABELS[d.key]);
  const low = sorted.slice(-2).map((d) => DIMENSION_LABELS[d.key]);
  return { top, low };
}

export default function Home() {
  const [params] = useSearchParams();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [client, setClient] = useState<Client | null>(null);
  const [q, setQ] = useState<Qualification | null>(null);
  const [cfg, setCfg] = useState<{ gate_banner: string; gate_note: string; llm: string } | null>(null);
  const [files, setFiles] = useState<Attachment[]>([]);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => { getConfig().then(setCfg).catch(() => {}); }, []);
  useEffect(() => {
    const id = params.get("client");
    if (id) getClient(id).then((r) => { setClient(r.client); setQ(r.qualification); setMsgs([{ role: "assistant", text: `Loaded ${r.client.name}. Tell me what to change.` }]); });
  }, [params]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, steps]);

  async function attach(list: FileList | null) {
    if (!list) return;
    const read = (f: File) => new Promise<Attachment>((res) => {
      const r = new FileReader();
      r.onload = () => res({ name: f.name, media_type: f.type || "text/plain", data: String(r.result).split(",")[1] ?? "" });
      r.readAsDataURL(f);
    });
    const added = await Promise.all([...list].map(read));
    setFiles((cur) => [...cur, ...added]);
  }

  async function send(text: string, opts: { refreshSector?: boolean } = {}) {
    if (!text.trim() || busy) return;
    const attachments = files;
    setInput("");
    setFiles([]);
    setBusy(true);
    setSteps([]);
    setMsgs((m) => [...m, { role: "user", text: attachments.length ? `${text}\n📎 ${attachments.map((a) => a.name).join(", ")}` : text }]);
    const log: string[] = [];
    await streamChat({ message: text, client_id: client?.id, attachments: attachments.length ? attachments : undefined, refresh_sector: opts.refreshSector }, {
      onProgress: (p) => { log.push(p); setSteps([...log]); },
      onQuestion: (qu) => setMsgs((m) => [...m, { role: "assistant", text: qu.text, chips: qu.chips }]),
      onResult: (r) => {
        setClient(r.client); setQ(r.qualification);
        setMsgs((m) => [...m, { role: "assistant", text: r.reply, steps: [...log] }]);
      },
      onError: (e) => setMsgs((m) => [...m, { role: "assistant", text: e }]),
    });
    setSteps([]);
    setBusy(false);
  }

  const sum = q ? summarise(q) : null;

  return (
    <div className="grid h-full grid-cols-1 md:grid-cols-[400px_minmax(0,1fr)]">
      <section className="flex min-h-0 flex-col border-r border-neutral-200">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {msgs.length === 0 && (
            <div className="space-y-3">
              <h1 className="text-lg font-semibold">Which client do you want to qualify?</h1>
              <p className="text-sm text-neutral-600">Type a client name with any context, or paste notes, a URL or an account plan. Try:</p>
              {EXAMPLES.map((e) => <button key={e} className="card block w-full p-3 text-left text-sm hover:bg-neutral-50" onClick={() => send(e)}>{e}</button>)}
            </div>
          )}

          {client && q && (
            <div className="card p-3 text-sm">
              <div className="mb-1 flex items-center justify-between"><span className="font-semibold">{client.name}</span><TierBadge tier={q.tier} /></div>
              <dl className="grid grid-cols-[90px_1fr] gap-y-0.5 text-xs text-neutral-600">
                <dt>Sector</dt><dd>{client.sector}</dd>
                {client.region && (<><dt>Region</dt><dd>{client.region}</dd></>)}
                {client.owner && (<><dt>Owner</dt><dd>{client.owner}</dd></>)}
                <dt>Version</dt><dd>{q.version} · {new Date(q.created_at).toLocaleTimeString()}</dd>
                <dt>Evidence</dt><dd>{q.evidence.filter((e) => e.type === "Fact").length} sourced facts, {q.evidence.filter((e) => e.type !== "Fact").length} inferred or user-provided</dd>
              </dl>
            </div>
          )}

          {msgs.map((m, i) => (
            <div key={i} className={m.role === "user" ? "ml-8 rounded-lg bg-neutral-100 p-3 text-sm" : "mr-4 text-sm"}>
              {m.steps && m.steps.length > 0 && (
                <ul className="mb-2 space-y-0.5 text-xs text-neutral-500">{m.steps.map((s) => <li key={s}><span className="text-brand-dark">✓</span> {s}</li>)}</ul>
              )}
              {m.text}
              {m.chips && <div className="mt-2 flex gap-2">{m.chips.map((c) => <button key={c} className="chip hover:bg-neutral-100" onClick={() => send(c)}>{c}</button>)}</div>}
              {m.steps && sum && i === msgs.length - 1 && (
                <div className="mt-2 rounded-lg border border-neutral-200 p-3">
                  <p><b>Strongest:</b> {sum.top.join(", ")}</p>
                  <p><b>Weakest:</b> {sum.low.join(", ")}</p>
                  <p className="mt-1 text-neutral-600">Next: confirm audit status and executive access with an account leader.</p>
                </div>
              )}
            </div>
          ))}
          {busy && (
            <ul className="space-y-0.5 text-xs text-neutral-500">
              {steps.map((s, i) => <li key={s}>{i < steps.length - 1 ? <span className="text-brand-dark">✓</span> : "…"} {s}</li>)}
              {steps.length === 0 && <li>Working…</li>}
            </ul>
          )}
          <div ref={end} />
        </div>

        {q && !busy && (
          <div className="border-t border-neutral-100 px-5 py-3">
            <div className="mb-1.5 text-xs font-medium uppercase text-neutral-500">Try refining</div>
            <div className="flex flex-wrap gap-2">{REFINEMENTS.map((r) => <button key={r} className="chip hover:bg-neutral-100" onClick={() => send(r)}>{r}</button>)}</div>
          </div>
        )}
        {files.length > 0 && <div className="flex flex-wrap gap-2 border-t border-neutral-100 px-5 pt-2">{files.map((f) => <span key={f.name} className="chip">📎 {f.name} <button className="ml-1" onClick={() => setFiles((c) => c.filter((x) => x !== f))}>×</button></span>)}</div>}
        <form className="flex gap-2 border-t border-neutral-200 p-3" onSubmit={(e) => { e.preventDefault(); send(input); }}>
          <input className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-brand focus:outline-none" placeholder={q ? "Refine, e.g. “Weight executive relationship higher”" : "Qualify Acme Insurance, UK P&C insurer…"} value={input} onChange={(e) => setInput(e.target.value)} />
          <label className="btn cursor-pointer" title="Attach a PDF or text file (account plan, notes)">Attach<input type="file" hidden multiple accept=".pdf,.txt,.md" onChange={(e) => { attach(e.target.files); e.target.value = ""; }} /></label>
          <button className="btn-primary" disabled={busy}>Send</button>
        </form>
        {cfg?.llm === "mock" && <div className="bg-neutral-50 px-3 py-1 text-center text-xs text-neutral-500">Demo mode: results are illustrative mock data.</div>}
      </section>

      <section className="min-h-0 overflow-y-auto bg-neutral-50/50">
        {client && q ? <Scorecard client={client} q={q} gateBanner={cfg?.gate_banner} gateNote={cfg?.gate_note} busy={busy} onRefreshSector={() => send("Re-run with refreshed sector research", { refreshSector: true })} /> : (
          <div className="flex h-full items-center justify-center p-10 text-center text-sm text-neutral-500">Your scorecard will appear here.</div>
        )}
      </section>
    </div>
  );
}
