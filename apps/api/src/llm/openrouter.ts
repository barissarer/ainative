import { toJSONSchema, z } from "zod";
import type { Attachment, SectorStore } from "./types";
import { addSources, type Source } from "./sources";
import { PipelineProvider, type Effort } from "./pipeline";

/** Error from the OpenRouter API, with the HTTP status. Never contains the API key. */
export class OpenRouterError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export interface OpenRouterOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  sectors: SectorStore;
  /** Only route to these hosts (e.g. ["fireworks", "together"]). Useful to keep data in an approved region. */
  onlyProviders?: string[];
  /** Default false: OpenRouter only uses hosts that do not store or train on prompts. */
  allowDataCollection?: boolean;
  fetchImpl?: typeof fetch;
  retryDelayMs?: number;
}

const QueriesSchema = z.object({ queries: z.array(z.string()) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Pull the JSON object out of a model reply: strips <think> blocks and code fences. */
export function extractJson(text: string): unknown {
  const t = text.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/```(?:json)?/gi, "").trim();
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("no JSON object in reply");
  return JSON.parse(t.slice(a, b + 1));
}

/**
 * Open-weight models (DeepSeek and others) through OpenRouter's OpenAI-compatible API.
 * - Structured output: JSON-schema mode when the host supports it, otherwise JSON mode with the schema in the prompt;
 *   either way the result is validated against the same schema, with one repair retry.
 * - Web research: OpenRouter's web plugin (search results come back as url_citation annotations). Only pages that
 *   appear in those annotations can back a "Fact".
 */
export class OpenRouterProvider extends PipelineProvider {
  name = "openrouter";
  private key: string;
  private model: string;
  private base: string;
  private only: string[];
  private allowCollect: boolean;
  private f: typeof fetch;
  private retryDelay: number;
  private schemaModeBroken = false;

  constructor(o: OpenRouterOptions) {
    super(o.sectors);
    this.key = o.apiKey ?? process.env.OPENROUTER_API_KEY ?? "";
    if (!this.key) throw new Error("OPENROUTER_API_KEY is not set.");
    this.model = o.model ?? process.env.OPENROUTER_MODEL ?? "deepseek/deepseek-chat";
    this.base = (o.baseUrl ?? process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");
    this.only = o.onlyProviders ?? (process.env.OPENROUTER_PROVIDERS ? process.env.OPENROUTER_PROVIDERS.split(",").map((x) => x.trim()).filter(Boolean) : []);
    this.allowCollect = o.allowDataCollection ?? process.env.OPENROUTER_ALLOW_DATA_COLLECTION === "true";
    this.f = o.fetchImpl ?? fetch;
    this.retryDelay = o.retryDelayMs ?? 1000;
  }

  // ----------------------------------------------------------------- HTTP

  private provider(requireParameters: boolean) {
    return { data_collection: this.allowCollect ? "allow" : "deny", ...(requireParameters ? { require_parameters: true } : {}), ...(this.only.length ? { only: this.only } : {}) };
  }

  private async chat(body: Record<string, unknown>): Promise<any> {
    let last: OpenRouterError | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await this.f(`${this.base}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json", "X-Title": "AI Native NewCo Campaign Hub" },
        body: JSON.stringify({ model: this.model, ...body }),
      });
      const json: any = await res.json().catch(() => ({}));
      const err = json?.error;
      if (res.ok && !err) return json;
      const status = Number(err?.code) || res.status;
      last = new OpenRouterError(String(err?.message ?? `OpenRouter returned HTTP ${res.status}`), status);
      if (status >= 500 || status === 429) {
        await sleep(this.retryDelay * (attempt + 1));
        continue;
      }
      throw last;
    }
    throw last!;
  }

  private contentOf(json: any): string {
    return String(json?.choices?.[0]?.message?.content ?? "");
  }

  // ------------------------------------------------------------ primitives

  protected async structured<T extends z.ZodType>(schema: T, system: string, user: string, effort: Effort = "medium"): Promise<z.infer<T>> {
    const jsonSchema: any = toJSONSchema(schema);
    delete jsonSchema.$schema;
    const hint = `${system}\n\nReply with a single JSON object only, no commentary, matching this JSON Schema:\n${JSON.stringify(jsonSchema)}`;
    const base = { temperature: effort === "high" ? 0.3 : 0.1, max_tokens: 8000 };
    let messages: any[] = [{ role: "system", content: hint }, { role: "user", content: user }];

    const attempt = async (strictMode: boolean) =>
      this.contentOf(
        await this.chat({
          ...base,
          messages,
          response_format: strictMode ? { type: "json_schema", json_schema: { name: "result", strict: true, schema: jsonSchema } } : { type: "json_object" },
          provider: this.provider(strictMode),
        }),
      );

    let content: string;
    if (!this.schemaModeBroken) {
      try {
        content = await attempt(true);
      } catch (e) {
        // No host for this model supports JSON-schema mode (or it rejected the schema): remember, and fall back to JSON mode.
        if (e instanceof OpenRouterError && [400, 404, 422].includes(e.status)) {
          this.schemaModeBroken = true;
          content = await attempt(false);
        } else throw e;
      }
    } else content = await attempt(false);

    for (let repair = 0; ; repair++) {
      let problem: string;
      try {
        const parsed = schema.safeParse(extractJson(content));
        if (parsed.success) return parsed.data;
        problem = parsed.error.issues.slice(0, 6).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
      } catch (e: any) {
        problem = `reply was not valid JSON (${e.message})`;
      }
      if (repair >= 1) throw new Error("The model returned an unreadable result. Please try again.");
      messages = [...messages, { role: "assistant", content }, { role: "user", content: `That did not match the schema: ${problem}. Reply again with only the corrected JSON object.` }];
      content = await attempt(!this.schemaModeBroken);
    }
  }

  protected async text(system: string, user: string): Promise<string | null> {
    const json = await this.chat({ messages: [{ role: "system", content: system }, { role: "user", content: user }], max_tokens: 800, temperature: 0.3, provider: this.provider(false) });
    return this.contentOf(json).replace(/<think>[\s\S]*?<\/think>/g, "").trim() || null;
  }

  /**
   * Research: the model writes a few short search queries, each runs through the web plugin in parallel, and the
   * annotated results are collected. Attached files are summarised separately (no URL, so never a sourced Fact).
   */
  protected async research(system: string, prompt: string, attachments: Attachment[], maxSearches: number): Promise<{ notes: string; sources: Source[] }> {
    const q = await this.structured(
      QueriesSchema,
      "You write web search queries. Give 3 short, specific queries (under 12 words each) that together cover the research brief. No quotes or operators.",
      prompt,
      "low",
    );
    const queries = q.queries.map((x) => x.trim()).filter(Boolean).slice(0, 3);
    if (queries.length === 0) throw new Error("Could not plan the research. Please try again.");

    const maxResults = Math.max(3, Math.min(8, maxSearches));
    const runs = await Promise.allSettled(
      queries.map(async (query) => {
        const json = await this.chat({
          messages: [
            { role: "system", content: system },
            { role: "user", content: `${query}\n\nSummarise what the search results say in 4-6 bullet points. State only what the results support, and say so if you found nothing relevant.` },
          ],
          plugins: [{ id: "web", max_results: maxResults }],
          max_tokens: 1500,
          temperature: 0.2,
          provider: this.provider(false),
        });
        return { query, json };
      }),
    );

    let sources: Source[] = [];
    const notes: string[] = [];
    let firstError: unknown;
    for (const r of runs) {
      if (r.status === "rejected") {
        firstError ??= r.reason;
        continue;
      }
      const msg = r.value.json?.choices?.[0]?.message;
      const ann = (msg?.annotations ?? []).filter((a: any) => a?.type === "url_citation").map((a: any) => a.url_citation ?? a);
      sources = addSources(sources, ann.map((c: any) => ({ url: c.url, title: c.title, snippet: c.content })));
      notes.push(`Search "${r.value.query}":\n${this.contentOf(r.value.json).replace(/<think>[\s\S]*?<\/think>/g, "").trim()}`);
    }
    // Every search failed (auth, credits, outage): surface that instead of scoring on nothing.
    if (notes.length === 0 && firstError) throw firstError;

    for (const a of attachments) notes.push(await this.readAttachment(a));
    return { notes: notes.join("\n\n"), sources };
  }

  private async readAttachment(a: Attachment): Promise<string> {
    if (a.media_type !== "application/pdf") return `User attachment "${a.name}" (user-provided, not a web source):\n${Buffer.from(a.data, "base64").toString("utf8").slice(0, 40000)}`;
    const json = await this.chat({
      messages: [{ role: "user", content: [{ type: "text", text: "Summarise the key facts in this document for a client qualification: strategy, leadership, financials, technology, relationships." }, { type: "file", file: { filename: a.name, file_data: `data:application/pdf;base64,${a.data}` } }] }],
      plugins: [{ id: "file-parser", pdf: { engine: "pdf-text" } }],
      max_tokens: 1500,
      provider: this.provider(false),
    });
    return `User attachment "${a.name}" (user-provided, not a web source):\n${this.contentOf(json)}`;
  }

  protected friendlyError(e: unknown): Error {
    if (e instanceof OpenRouterError) {
      if (e.status === 401 || e.status === 403) return new Error("OpenRouter rejected the server's credentials. Check OPENROUTER_API_KEY.");
      if (e.status === 402) return new Error("The OpenRouter account is out of credits.");
      if (e.status === 429) return new Error("The AI service is busy right now. Please try again in a minute.");
      if (e.status === 404) return new Error("No OpenRouter host is available for this model with the current data-handling settings. Check OPENROUTER_MODEL, OPENROUTER_PROVIDERS and OPENROUTER_ALLOW_DATA_COLLECTION.");
      return new Error(`The AI service returned an error: ${e.message}`);
    }
    return super.friendlyError(e);
  }
}
