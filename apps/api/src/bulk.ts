import type { FastifyInstance } from "fastify";
import type { Db } from "./db";
import type { LlmProvider } from "./llm/types";
import { persistResult } from "./app";
import { clientRows } from "./clients";
import { actorOf } from "./routes";

export const BULK_LIMIT = 25;
const CONCURRENCY = 2;

/**
 * Entries from pasted text or a .txt/.csv upload. With several lines, each line is one client and may carry context
 * ("Acme Insurance, UK P&C insurer"). A single line is treated as a comma/semicolon separated list of names.
 * Deduplicated by the name part, capped by the caller.
 */
export function parseNames(input: string | string[]): string[] {
  const text = Array.isArray(input) ? input.join("\n") : input;
  const lines = text.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
  const raw = lines.length > 1 || Array.isArray(input) ? lines : (lines[0] ?? "").split(/[;,]/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (let n of raw) {
    n = n.trim().replace(/^["']|["']$/g, "").trim();
    if (!n || /^(client|company|name)s?$/i.test(n)) continue; // header row
    const key = nameOf(n).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

/** The client name part of an entry ("Acme Insurance, UK insurer" -> "Acme Insurance"). */
export const nameOf = (entry: string) => entry.split(/[,;]/)[0].trim();

/**
 * Bulk first pass: qualify a list of names and return them ranked. Each is a full qualification (same research, same
 * evidence rules). Clients already qualified are not re-researched; they are ranked from their saved version.
 */
export function registerBulkRoutes(app: FastifyInstance, db: Db, llm: LlmProvider) {
  app.post<{ Body: { names?: string[]; text?: string } }>("/api/bulk", async (req, reply) => {
    const actor = actorOf(req);
    if (!["consultant", "account_leader", "admin"].includes(actor.role)) return reply.code(403).send({ error: "Your role cannot start a bulk run." });
    const names = parseNames(req.body?.names ?? req.body?.text ?? "");
    if (names.length === 0) return reply.code(400).send({ error: "Paste at least one client name." });
    if (names.length > BULK_LIMIT) return reply.code(400).send({ error: `Please keep a bulk run to ${BULK_LIMIT} clients or fewer (you sent ${names.length}).` });

    reply.raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    const send = (ev: string, data: unknown) => reply.raw.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
    send("start", { total: names.length, names });

    const existing = await clientRows(db);
    const results: { name: string; status: "done" | "existing" | "failed"; id?: string; error?: string }[] = [];
    let next = 0;
    const worker = async () => {
      while (next < names.length) {
        const name = names[next++];
        send("progress", { name, message: "Researching…" });
        const have = existing.find((c) => c.name.toLowerCase() === nameOf(name).toLowerCase());
        if (have) {
          results.push({ name, status: "existing", id: have.id });
          send("item", { name, status: "existing", id: have.id });
          continue;
        }
        try {
          let id: string | undefined;
          for await (const ev of llm.qualify({ message: `Qualify ${name}`, user: actor.name })) {
            if (ev.type === "result") id = (await persistResult(db, ev, `Bulk first pass: ${name}`)).client_id;
          }
          results.push({ name, status: "done", id });
          send("item", { name, status: "done", id });
        } catch (e: any) {
          results.push({ name, status: "failed", error: e?.message ?? "Failed" });
          send("item", { name, status: "failed", error: e?.message ?? "Failed" });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, names.length) }, worker));

    const ids = new Set(results.map((r) => r.id).filter(Boolean));
    const ranked = (await clientRows(db)).filter((r) => ids.has(r.id)).sort((a, b) => b.score - a.score);
    send("done", { ranked, failed: results.filter((r) => r.status === "failed") });
    reply.raw.end();
    return reply;
  });
}
