import type { Qualification, Client } from "@ainative/shared";

export type ProgressEvent = { type: "progress"; message: string };
export type QuestionEvent = { type: "question"; text: string; chips?: string[] };
export type ResultEvent = {
  type: "result";
  client: Client;
  qualification: Omit<Qualification, "id" | "version" | "created_at">;
  reply: string;
};
export type LlmEvent = ProgressEvent | QuestionEvent | ResultEvent;

export interface QualifyRequest {
  message: string;
  /** Existing qualification when the user is refining. */
  previous?: Qualification;
  previousClient?: Client;
  user: string;
}

/** Provider-agnostic interface. Real implementations (Anthropic) arrive in Phase 2. */
export interface LlmProvider {
  name: string;
  qualify(req: QualifyRequest): AsyncGenerator<LlmEvent>;
}
