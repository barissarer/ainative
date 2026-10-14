import type { Client, Qualification, LeaderInput } from "@ainative/shared";

export interface ClientRow {
  id: string; name: string; sector: string; region?: string; owner?: string;
  score: number; tier: string; confidence: string; version: number;
  updated_at: string; gate_status: string; statuses: string[];
}

export const getUserId = () => { try { return localStorage.getItem("user") ?? "casey"; } catch { return "casey"; } };
export const setUserId = (id: string) => { try { localStorage.setItem("user", id); } catch { /* ignore */ } };
const H = () => ({ "Content-Type": "application/json", "X-User": getUserId() });
export const api = async <T = any>(method: string, path: string, body?: unknown): Promise<T> => {
  const res = await fetch(path, { method, headers: H(), body: body ? JSON.stringify(body) : undefined });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error ?? "Something went wrong");
  return j;
};
export type DemoUser = { id: string; name: string; role: string; title: string };
export type Draft = {
  brand_permission: { rating: string; comment: string } | null;
  audit_status: { status: string; audit_lead: string | null; comment: string } | null;
  exec_relationship: { seniority: string; quality: string; receptiveness: string; owner: string | null; comment: string } | null;
  inferred_fields: string[];
};
export type { LeaderInput };

export async function getClients(): Promise<ClientRow[]> {
  return api("GET", "/api/clients");
}
export async function getClient(id: string): Promise<{ client: Client; qualification: Qualification }> {
  return api("GET", `/api/clients/${id}`);
}
export async function getConfig(): Promise<{ weights: Record<string, number>; gate_banner: string; gate_note: string; llm: string }> {
  return (await fetch("/api/config")).json();
}

export interface ChatHandlers {
  onProgress: (m: string) => void;
  onQuestion: (q: { text: string; chips?: string[] }) => void;
  onResult: (r: { client: Client; qualification: Qualification; reply: string }) => void;
  onError: (m: string) => void;
}

/** POST + SSE stream (EventSource can't POST, so parse the stream manually). */
export interface Attachment { name: string; media_type: string; data: string }

export async function streamChat(body: { message: string; client_id?: string; attachments?: Attachment[]; refresh_sector?: boolean }, h: ChatHandlers) {
  const res = await fetch("/api/chat", { method: "POST", headers: H(), body: JSON.stringify(body) });
  if (!res.ok || !res.body) return h.onError("The request failed. Please try again.");
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const ev = /event: (.*)/.exec(block)?.[1];
      const data = /data: (.*)/.exec(block)?.[1];
      if (!ev || !data) continue;
      const d = JSON.parse(data);
      if (ev === "progress") h.onProgress(d.message);
      else if (ev === "question") h.onQuestion(d);
      else if (ev === "result") h.onResult(d);
      else if (ev === "error") h.onError(d.message);
    }
  }
}
