import type { z } from "zod";
import {
  DIMENSION_KEYS,
  DIMENSION_LABELS,
  SECTOR_OPTIONS,
  applyGate,
  baseTier,
  normalizeWeights,
  overallConfidence,
  overallScore,
  type Client,
  type Qualification,
  type SectorResearch,
} from "@ainative/shared";
import type { Attachment, LeaderDraft, LlmEvent, LlmProvider, ProgressEvent, QualifyRequest, SectorStore } from "./types";
import { IntakeSchema, LeaderMapSchema, ReasoningSchema, RefineSchema, SectorSummarySchema, type Intake } from "./schemas";
import { formatSources, type Source } from "./sources";
import { assemble } from "./assemble";
import { loadGateRules, loadMethodology } from "../config";

const SECTOR_TTL_MS = 30 * 24 * 3600 * 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Yields a progress message every few seconds until the promise settles. */
async function* ticks(p: Promise<unknown>, msgs: string[], ms = 7000): AsyncGenerator<ProgressEvent> {
  let done = false;
  p.then(() => (done = true), () => (done = true));
  let i = 0;
  while (!done) {
    await Promise.race([p.catch(() => {}), sleep(ms)]);
    if (!done && i < msgs.length) yield { type: "progress", message: msgs[i++] };
  }
}

export type Effort = "low" | "medium" | "high";

/**
 * Shared qualification pipeline: read request -> research (client + sector in parallel) -> score -> code checks.
 * A concrete provider only supplies three primitives: schema-constrained output, web research, and a plain-text call.
 */
export abstract class PipelineProvider implements LlmProvider {
  abstract name: string;
  constructor(protected sectors: SectorStore) {}

  /** Schema-constrained call. Must throw a readable Error on refusal or unparsable output. */
  protected abstract structured<T extends z.ZodType>(schema: T, system: string, user: string, effort?: Effort): Promise<z.infer<T>>;
  /** Web research. Returns notes plus the sources actually retrieved (only these may back a "Fact"). */
  protected abstract research(system: string, prompt: string, attachments: Attachment[], maxSearches: number): Promise<{ notes: string; sources: Source[] }>;
  /** Short plain-text completion. */
  protected abstract text(system: string, user: string): Promise<string | null>;
  /** Turn provider errors into messages a consultant can act on. */
  protected friendlyError(e: unknown): Error {
    return e instanceof Error ? e : new Error("Something went wrong.");
  }

  protected async sectorResearch(sector: string, force: boolean, m = loadMethodology()): Promise<{ r: SectorResearch; fresh: boolean; sources: Source[] }> {
    const cached = await this.sectors.get(sector);
    if (cached && !force && Date.now() - Date.parse(cached.refreshed_at) < SECTOR_TTL_MS) {
      return { r: cached, fresh: false, sources: cached.sources.map((url, i) => ({ id: `SC${i + 1}`, url, title: url, snippets: [] })) };
    }
    const { notes, sources } = await this.research(
      m.prompts.research,
      `Research the ${sector} sector for an AI-transformation sales campaign. Cover: market structure, margin pressure, regulation and compliance constraints, talent and cost structure, customer expectation shifts, and AI impact across the value chain. Keep evidenced deployments separate from hype and forecasts. Cite sources.`,
      [],
      5,
    );
    const s = await this.structured(
      SectorSummarySchema,
      "Summarise sector research for busy consultants. Use only the research notes provided. Plain consulting language, no invented data.",
      `Sector: ${sector}\n\nResearch notes:\n${notes}\n\nWrite (1) a sector summary of 4-6 sentences and (2) an AI impact view that separates real deployments from expectations.`,
      "low",
    );
    const r: SectorResearch = { sector, summary: s.summary, ai_impact_view: s.ai_impact_view, sources: sources.map((x) => x.url), refreshed_at: new Date().toISOString() };
    await this.sectors.save(r);
    return { r, fresh: true, sources };
  }

  // ------------------------------------------------------------------ main

  async *qualify(req: QualifyRequest): AsyncGenerator<LlmEvent> {
    try {
      if (req.previous && req.previousClient && !req.forceSectorRefresh) yield* this.refine(req);
      else yield* this.fresh(req);
    } catch (e) {
      throw this.friendlyError(e);
    }
  }

  private async *fresh(req: QualifyRequest): AsyncGenerator<LlmEvent> {
    const m = loadMethodology();
    const now = new Date().toISOString();

    let intake: Intake;
    let client: Client;
    if (req.forceSectorRefresh && req.previousClient) {
      client = req.previousClient;
      intake = { client_name: client.name, sector: client.sector as any, sub_sector: client.sub_sector ?? null, region: client.region ?? null, size: client.size ?? null, user_facts: [] };
    } else {
      yield { type: "progress", message: "Reading your request…" };
      intake = await this.structured(
        IntakeSchema,
        `Extract client details from the user's request. Sector must be one of: ${SECTOR_OPTIONS.join(", ")}. user_facts are things the user states about the client or our relationship (e.g. "strong relationship with the CFO"); do not add anything the user did not say.`,
        req.message,
        "low",
      );
      client = { id: `c_${slug(intake.client_name)}`, name: intake.client_name, sector: intake.sector, sub_sector: intake.sub_sector ?? undefined, region: intake.region ?? undefined, size: intake.size ?? undefined, owner: req.user, relationship_notes: req.message };
    }
    const userFacts = req.forceSectorRefresh && req.previous ? req.previous.evidence.filter((e) => e.type === "User-provided").map((e) => e.snippet) : intake.user_facts;

    yield { type: "progress", message: `Researching ${client.name} and the ${client.sector} sector…` };
    const clientP = this.research(
      m.prompts.research,
      `Research the company "${client.name}" (${[client.sector, client.region].filter(Boolean).join(", ")}). Cover: strategic posture and appetite for transformation, leadership and sponsorship, financial health and investment capacity, data and technology maturity, trigger events (new CEO, M&A, restructuring, margin pressure, regulatory action), and how peers and AI-native challengers are moving on AI. Cite sources. If you cannot find something, say so.\n\nUser context:\n${req.message}`,
      req.attachments ?? [],
      6,
    );
    const sectorP = this.sectorResearch(client.sector, !!req.forceSectorRefresh, m);
    const both = Promise.all([clientP, sectorP]);
    yield* ticks(both, ["Reviewing sector dynamics…", "Checking competitor moves…", "Looking for trigger events…"]);
    const [cr, sr] = await both;
    if (!sr.fresh) yield { type: "progress", message: `Reused ${client.sector} sector research from ${new Date(sr.r.refreshed_at).toLocaleDateString()}` };

    yield { type: "progress", message: "Scoring against the framework…" };
    const sources = [...cr.sources, ...sr.sources.filter((s) => !cr.sources.some((c) => c.url === s.url))].map((s, i) => ({ ...s, id: `S${i + 1}` }));
    const rubric = DIMENSION_KEYS.map((k) => `- ${k} (${DIMENSION_LABELS[k]}): ${m.rubric[k]}`).join("\n");
    const reasoning = await this.structured(
      ReasoningSchema,
      `${m.prompts.reasoning}\n\nRubric:\n${rubric}\n\nRules:\n- Score all seven dimensions 1-5.\n- Every dimension needs at least one evidence item. Type "Fact" ONLY with a source_id from the source list; otherwise use "Inference". Use "User-provided" only for things the user stated.\n- Brand permission and executive relationship: rely only on what the user stated; otherwise estimate cautiously with Low confidence.\n- Do not state the numeric score or the tier. Do not make independence or audit determinations.\n- Ask at most 3 follow-up questions, only for things you could not find. Give 2-3 short quick-reply chips for each.\n- Keep AI impact evidence separate: real deployments are Facts, forecasts are Inference.`,
      `Client: ${client.name} | ${client.sector}${client.region ? " | " + client.region : ""}\n\nUser-stated facts:\n${userFacts.map((f) => `- ${f}`).join("\n") || "(none)"}\n\nClient research notes:\n${cr.notes}\n\nSector summary:\n${sr.r.summary}\n\nSector AI impact view:\n${sr.r.ai_impact_view}\n\nSources:\n${formatSources(sources)}`,
      "high",
    );

    const q = assemble({
      reasoning: { ...reasoning, dimensions: reasoning.dimensions },
      sources,
      weights: m.weights,
      thresholds: m.thresholds,
      clientId: client.id,
      user: req.user,
      now,
      sector: { sector: client.sector, refreshed_at: sr.r.refreshed_at },
    });
    // User-stated facts become evidence on the relationship dimensions so they are visible and labelled.
    for (const f of userFacts) {
      const target = /relationship|cfo|ceo|exec|sponsor|know/i.test(f) ? "exec_relationship" : null;
      if (!target) continue;
      const id = `ev_user_${q.evidence.length}`;
      q.evidence.push({ id, dimension: target, source: "user", snippet: f, type: "User-provided", retrieved_at: now });
      q.dimensions.find((d) => d.key === target)!.evidence_ids.push(id);
    }

    for (const fq of reasoning.follow_up_questions.slice(0, 3)) yield { type: "question", text: fq.text, chips: fq.chips.slice(0, 3) };
    yield { type: "result", client, qualification: q, reply: `Here's a first-pass view of ${client.name}. Sources are linked on each dimension.` };
  }

  private async *refine(req: QualifyRequest): AsyncGenerator<LlmEvent> {
    const m = loadMethodology();
    const prev = req.previous!;
    const client = req.previousClient!;
    yield { type: "progress", message: "Applying your changes…" };
    const summary = prev.dimensions.map((d) => `${d.key}: score ${d.score}, weight ${prev.weights[d.key]}, ${d.origin}, "${d.rationale}"`).join("\n");
    const r = await this.structured(
      RefineSchema,
      `${m.prompts.refine}\nOnly change weights if the user asks about importance. Only adjust a dimension's score if the user states a fact or assumption that bears on it, and quote it in user_statement. Never adjust anything labelled Leader-informed or Human override. Never touch the audit gate. If the instruction needs new research, say so in reply and make no changes.`,
      `Instruction: ${req.message}\n\nCurrent scorecard for ${client.name}:\n${summary}`,
      "low",
    );

    const weights = { ...prev.weights };
    for (const c of r.weight_changes) if (c.weight >= 0) weights[c.key] = Math.min(100, Math.round(c.weight));
    const dims = prev.dimensions.map((d) => ({ ...d }));
    const evidence = [...prev.evidence];
    const now = new Date().toISOString();
    for (const a of r.adjustments) {
      const d = dims.find((x) => x.key === a.key);
      if (!d || d.origin !== "AI-estimated") continue;
      d.score = Math.max(1, Math.min(5, Math.round(a.new_score)));
      d.rationale = a.rationale;
      const id = `ev_${a.key}_u${evidence.length}`;
      evidence.push({ id, dimension: a.key, source: "user", snippet: a.user_statement, type: "User-provided", retrieved_at: now });
      d.evidence_ids = [...d.evidence_ids, id];
      if (d.confidence === "Low") d.confidence = "Med";
    }
    const score = overallScore(dims, normalizeWeights(weights));
    const ai_tier = baseTier(score, m.thresholds);
    yield {
      type: "result",
      client,
      reply: r.reply,
      qualification: { ...prev, dimensions: dims, evidence, weights, overall_score: score, ai_tier, tier: prev.override?.tier ?? applyGate(ai_tier, prev.gate, loadGateRules()), confidence: overallConfidence(dims), created_by: req.user },
    };
  }

  async mapLeaderText(text: string, context: string): Promise<LeaderDraft> {
    const m = loadMethodology();
    return this.structured(
      LeaderMapSchema,
      `${m.prompts.leader_mapping}\nRules: set a lens to null if the text does not mention it - never guess an audit status. Quote or closely paraphrase the leader in each comment. List in inferred_fields any lens value you inferred rather than read directly. You have no ability to change or clear the audit gate; you only draft values for the leader to confirm.`,
      `Leader's words:\n${text}\n\nContext about the client (for interpretation only):\n${context}`,
      "low",
    );
  }

  async proposeApproach(context: string): Promise<string | null> {
    try {
      return await this.text(
        "You advise consultants on how to approach a client. When leader input conflicts with the AI's first-pass view, propose a revised approach in 2-3 plain sentences: a softer entry point or a different sponsor. Do not make independence or audit determinations.",
        context,
      );
    } catch {
      return null; // optional; never block saving leader input
    }
  }
}
