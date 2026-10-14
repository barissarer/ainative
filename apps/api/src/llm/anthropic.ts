import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import type { Attachment, SectorStore } from "./types";
import { extractSources, textOf, type Source } from "./sources";
import { PipelineProvider, type Effort } from "./pipeline";

export interface AnthropicProviderOptions {
  client?: Anthropic;
  model?: string;
  sectors: SectorStore;
}

/** Claude via the Anthropic API: native web search/fetch tools and schema-constrained output. */
export class AnthropicProvider extends PipelineProvider {
  name = "anthropic";
  private client: Anthropic;
  private model: string;

  constructor(opts: AnthropicProviderOptions) {
    super(opts.sectors);
    this.client = opts.client ?? new Anthropic(); // reads ANTHROPIC_API_KEY from the environment (server only)
    this.model = opts.model ?? process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5";
  }

  protected async structured<T extends z.ZodType>(schema: T, system: string, user: string, effort: Effort = "medium"): Promise<z.infer<T>> {
    const res = await this.client.messages.parse({
      model: this.model,
      max_tokens: 16000,
      system,
      messages: [{ role: "user", content: user }],
      output_config: { format: zodOutputFormat(schema), effort },
    });
    if (res.stop_reason === "refusal") throw new Error("The model declined this request. Try rephrasing, or contact support if this looks wrong.");
    if (!res.parsed_output) throw new Error("The model returned an unreadable result. Please try again.");
    return res.parsed_output;
  }

  protected async text(system: string, user: string): Promise<string | null> {
    const res = await this.client.messages.create({ model: this.model, max_tokens: 1000, system, messages: [{ role: "user", content: user }], output_config: { effort: "low" } });
    return res.stop_reason === "refusal" ? null : textOf(res.content) || null;
  }

  /** Web research with the server-side search tool. Resumes paused turns. */
  protected async research(system: string, prompt: string, attachments: Attachment[], maxSearches: number): Promise<{ notes: string; sources: Source[] }> {
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: [...this.attachmentBlocks(attachments), { type: "text", text: prompt }] }];
    const tools: Anthropic.Messages.ToolUnion[] = [
      { type: "web_search_20260209", name: "web_search", max_uses: maxSearches },
      { type: "web_fetch_20260209", name: "web_fetch", max_uses: 3 },
    ];
    let sources: Source[] = [];
    let notes = "";
    for (let turn = 0; turn < 4; turn++) {
      const msg = await this.client.messages.stream({ model: this.model, max_tokens: 16000, system, tools, messages, output_config: { effort: "medium" } }).finalMessage();
      if (msg.stop_reason === "refusal") throw new Error("The model declined this research request.");
      sources = extractSources(msg.content, sources);
      notes += (notes ? "\n" : "") + textOf(msg.content);
      if (msg.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: msg.content });
    }
    return { notes, sources };
  }

  private attachmentBlocks(atts: Attachment[]): Anthropic.ContentBlockParam[] {
    return atts.map((a): Anthropic.ContentBlockParam =>
      a.media_type === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: a.data }, title: a.name }
        : { type: "text", text: `Attached file "${a.name}":\n${Buffer.from(a.data, "base64").toString("utf8").slice(0, 60000)}` },
    );
  }

  protected friendlyError(e: unknown): Error {
    if (e instanceof Anthropic.AuthenticationError) return new Error("The AI service rejected the server's credentials. Check ANTHROPIC_API_KEY.");
    if (e instanceof Anthropic.RateLimitError) return new Error("The AI service is busy right now. Please try again in a minute.");
    return super.friendlyError(e);
  }
}
