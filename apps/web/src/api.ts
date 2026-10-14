import type { Client, Qualification } from "@ainative/shared";

export interface ClientRow {
  id: string; name: string; sector: string; region?: string; owner?: string;
  score: number; tier: string; confidence: string; version: number;
  updated_at: string; gate_status: string; statuses: string[];
}

export async function getClients(): Promise<ClientRow[]> {
  return (await fetch("/api/clients")).json();
}
export async function getClient(id: string): Promise<{ client: Client; qualification: Qualification }> {
  return (await fetch(`/api/clients/${id}`)).json();
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
  const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
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
