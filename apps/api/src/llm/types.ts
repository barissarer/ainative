import type { Qualification, Client, SectorResearch } from "@ainative/shared";

export type ProgressEvent = { type: "progress"; message: string };
export type QuestionEvent = { type: "question"; text: string; chips?: string[] };
export type ResultEvent = {
  type: "result";
  client: Client;
  qualification: Omit<Qualification, "id" | "version" | "created_at">;
  reply: string;
};
export type LlmEvent = ProgressEvent | QuestionEvent | ResultEvent;

export interface Attachment {
  name: string;
  media_type: string; // application/pdf, text/plain, text/markdown
  data: string; // base64
}

export interface QualifyRequest {
  message: string;
  /** Existing qualification when the user is refining. */
  previous?: Qualification;
  previousClient?: Client;
  user: string;
  attachments?: Attachment[];
  /** Re-run sector research even if a cached copy exists. */
  forceSectorRefresh?: boolean;
}

/** Sector playbook memory, backed by the sector_research table. */
export interface SectorStore {
  get(sector: string): Promise<SectorResearch | undefined>;
  save(r: SectorResearch): Promise<void>;
}

/** Provider-agnostic interface. */
export interface LlmProvider {
  name: string;
  qualify(req: QualifyRequest): AsyncGenerator<LlmEvent>;
}
