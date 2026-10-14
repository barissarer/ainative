import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { Client, Qualification } from "@ainative/shared";
import { getClient, getConfig, streamChat } from "../api";
import Scorecard from "../components/Scorecard";

type Msg = { role: "user" | "assistant"; text: string; chips?: string[] };

const EXAMPLES = [
  "Qualify Acme Insurance, mid-size P&C insurer in the UK, we have a strong relationship with the CFO",
  "Qualify Northwind Bank, regional retail bank in Germany",
  "Qualify Contoso Energy, European utility mid-way through a cloud migration",
];

export default function Home() {
  const [params] = useSearchParams();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [client, setClient] = useState<Client | null>(null);
  const [q, setQ] = useState<Qualification | null>(null);
  const [cfg, setCfg] = useState<{ gate_banner: string; gate_note: string; llm: string } | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => { getConfig().then(setCfg).catch(() => {}); }, []);
  useEffect(() => {
    const id = params.get("client");
    if (id) getClient(id).then((r) => { setClient(r.client); setQ(r.qualification); setMsgs([{ role: "assistant", text: `Loaded ${r.client.name}. Tell me what to change.` }]); });
  }, [params]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, progress]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setInput("");
    setBusy(true);
    setMsgs((m) => [...m, { role: "user", text }]);
    await streamChat({ message: text, client_id: client?.id }, {
      onProgress: setProgress,
      onQuestion: (qu) => setMsgs((m) => [...m, { role: "assistant", text: qu.text, chips: qu.chips }]),
      onResult: (r) => { setClient(r.client); setQ(r.qualification); setMsgs((m) => [...m, { role: "assistant", text: r.reply }]); },
      onError: (e) => setMsgs((m) => [...m, { role: "assistant", text: e }]),
    });
    setProgress("");
    setBusy(false);
  }

  return (
    <div className="grid h-full grid-cols-1 md:grid-cols-[minmax(320px,2fr)_3fr]">
      <section className="flex min-h-0 flex-col border-r border-neutral-200">
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
          {msgs.length === 0 && (
            <div className="space-y-3">
              <h1 className="text-lg font-semibold">Which client do you want to qualify?</h1>
              <p className="text-sm text-neutral-600">Type a client name with any context, or paste notes. Try:</p>
              {EXAMPLES.map((e) => <button key={e} className="card block w-full p-3 text-left text-sm hover:bg-neutral-50" onClick={() => send(e)}>{e}</button>)}
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={m.role === "user" ? "ml-8 rounded-lg bg-neutral-100 p-3 text-sm" : "mr-8 text-sm"}>
              {m.text}
              {m.chips && <div className="mt-2 flex gap-2">{m.chips.map((c) => <button key={c} className="chip hover:bg-neutral-100" onClick={() => send(c)}>{c}</button>)}</div>}
            </div>
          ))}
          {busy && <div className="text-sm text-neutral-500">{progress || "Working…"}</div>}
          <div ref={end} />
        </div>
        <form className="flex gap-2 border-t border-neutral-200 p-3" onSubmit={(e) => { e.preventDefault(); send(input); }}>
          <input className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-brand focus:outline-none" placeholder={q ? "Refine, e.g. “Weight executive relationship higher”" : "Qualify Acme Insurance, UK P&C insurer…"} value={input} onChange={(e) => setInput(e.target.value)} />
          <button className="btn-primary" disabled={busy}>Send</button>
        </form>
        {cfg?.llm === "mock" && <div className="bg-neutral-50 px-3 py-1 text-center text-xs text-neutral-500">Demo mode: results are illustrative mock data.</div>}
      </section>
      <section className="min-h-0 overflow-y-auto bg-neutral-50/50">
        {client && q ? <Scorecard client={client} q={q} gateBanner={cfg?.gate_banner} gateNote={cfg?.gate_note} /> : (
          <div className="flex h-full items-center justify-center p-10 text-center text-sm text-neutral-500">Your scorecard will appear here.</div>
        )}
      </section>
    </div>
  );
}
