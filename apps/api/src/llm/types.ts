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

/** A leader's free text mapped onto the three lenses. A null lens means the text did not mention it. */
export interface LeaderDraft {
  brand_permission: { rating: "Strong" | "Moderate" | "Weak" | "Unknown"; comment: string } | null;
  audit_status: { status: "not_audit_client" | "audit_client" | "related_entity_audit_client" | "unsure"; audit_lead: string | null; comment: string } | null;
  exec_relationship: {
    seniority: "CEO" | "C-suite" | "VP" | "Director" | "None";
    quality: "Strong" | "Moderate" | "Weak";
    receptiveness: "Yes" | "Maybe" | "No" | "Unknown";
    owner: string | null;
    comment: string;
  } | null;
  /** Fields the model inferred rather than read directly; shown to the leader for confirmation. */
  inferred_fields: string[];
}

/** Provider-agnostic interface. Neither leader method can touch the audit gate. */
export interface LlmProvider {
  name: string;
  qualify(req: QualifyRequest): AsyncGenerator<LlmEvent>;
  /** Map free text (typed or dictated) onto the three leader lenses. Output is a draft for the leader to confirm. */
  mapLeaderText(text: string, context: string): Promise<LeaderDraft>;
  /** Suggest a softer entry point or different sponsor when leader input conflicts with the AI view. */
  proposeApproach(context: string): Promise<string | null>;
}
