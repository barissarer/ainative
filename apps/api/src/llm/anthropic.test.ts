import { describe, expect, it } from "vitest";
import { DIMENSION_KEYS, type SectorResearch } from "@ainative/shared";
import { AnthropicProvider } from "./anthropic";
import type { LlmEvent, SectorStore } from "./types";

/** Fake SDK client: no network. Counts research calls so sector reuse can be asserted. */
function fakeClient(opts: { pauseOnce?: boolean; refuse?: boolean } = {}) {
  const calls = { stream: 0, parse: 0 };
  let paused = false;
  const client: any = {
    messages: {
      stream: (_p: any) => ({
        finalMessage: async () => {
          calls.stream++;
          if (opts.pauseOnce && !paused) {
            paused = true;
            return { stop_reason: "pause_turn", content: [{ type: "text", text: "partial " }] };
          }
          return {
            stop_reason: "end_turn",
            content: [
              { type: "web_search_tool_result", content: [{ type: "web_search_result", url: `https://src.example/${calls.stream}`, title: "Src" }] },
              { type: "text", text: "notes", citations: [{ type: "web_search_result_location", url: `https://src.example/${calls.stream}`, title: "Src", cited_text: "quote" }] },
            ],
          };
        },
      }),
      parse: async (p: any) => {
        calls.parse++;
        if (opts.refuse) return { stop_reason: "refusal", parsed_output: null };
        const sys: string = p.system;
        let out: any;
        if (sys.includes("Extract client details")) out = { client_name: "Acme Insurance", sector: "Insurance", sub_sector: null, region: "UK", size: null, user_facts: ["strong relationship with the CFO"] };
        else if (sys.includes("Summarise sector")) out = { summary: "sector summary", ai_impact_view: "impact view" };
        else if (sys.includes("Instruction") || p.messages[0].content.startsWith("Instruction")) out = { weight_changes: [{ key: "exec_relationship", weight: 40 }], adjustments: [{ key: "ai_impact", new_score: 4, rationale: "User says they are mid-migration", user_statement: "mid-way through a cloud migration" }], reply: "Updated." };
        else
          out = {
            dimensions: DIMENSION_KEYS.map((key) => ({ key, score: 4, rationale: "why", confidence: "Med", evidence: [{ type: "Fact", source_id: "S1", snippet: "found" }] })),
            headline_why: "Good fit.", pitch_readiness: "Confirm audit status.", risks: ["r"], entry_point: { buyer_persona: "CFO", hook: "h", first_conversation_angle: "f" },
            open_questions: ["q"], follow_up_questions: [{ text: "AI mandate?", chips: ["Yes", "No"] }],
          };
        return { stop_reason: "end_turn", parsed_output: out };
      },
    },
  };
  return { client, calls };
}

function memStore() {
  const m = new Map<string, SectorResearch>();
  const store: SectorStore = { get: async (s) => m.get(s), save: async (r) => void m.set(r.sector, r) };
  return store;
}
async function collect(g: AsyncGenerator<LlmEvent>) {
  const out: LlmEvent[] = [];
  for await (const e of g) out.push(e);
  return out;
}

describe("AnthropicProvider (fake client)", () => {
  it("researches, scores, and emits progress, a follow-up question and a result", async () => {
    const { client } = fakeClient({ pauseOnce: true });
    const p = new AnthropicProvider({ client, model: "m", sectors: memStore() });
    const ev = await collect(p.qualify({ message: "Qualify Acme Insurance, UK P&C insurer, strong relationship with the CFO", user: "u" }));
    expect(ev.some((e) => e.type === "progress")).toBe(true);
    expect(ev.find((e) => e.type === "question")).toMatchObject({ chips: ["Yes", "No"] });
    const res: any = ev.find((e) => e.type === "result");
    expect(res.qualification.dimensions).toHaveLength(7);
    expect(res.qualification.evidence.some((e: any) => e.type === "Fact" && e.source.startsWith("https://"))).toBe(true);
    expect(res.qualification.evidence.some((e: any) => e.type === "User-provided" && e.dimension === "exec_relationship")).toBe(true);
    expect(res.qualification.gate.status).toBe("unresolved");
    expect(res.qualification.tier).not.toBe("Pursue now");
    expect(res.qualification.sector_research.sector).toBe("Insurance");
  });

  it("reuses cached sector research for a second client in the same sector", async () => {
    const { client, calls } = fakeClient();
    const store = memStore();
    const p = new AnthropicProvider({ client, model: "m", sectors: store });
    await collect(p.qualify({ message: "Qualify Acme Insurance", user: "u" }));
    const after1 = calls.stream;
    const ev = await collect(p.qualify({ message: "Qualify Acme Insurance again", user: "u" }));
    expect(calls.stream - after1).toBe(1); // client research only; sector reused
    expect(ev.some((e) => e.type === "progress" && e.message.startsWith("Reused"))).toBe(true);
  });

  it("refreshes sector research when forced", async () => {
    const { client, calls } = fakeClient();
    const p = new AnthropicProvider({ client, model: "m", sectors: memStore() });
    const first: any = (await collect(p.qualify({ message: "Qualify Acme Insurance", user: "u" }))).find((e) => e.type === "result");
    const before = calls.stream;
    await collect(p.qualify({ message: "refresh", user: "u", previous: { ...first.qualification, id: "q", version: 1, created_at: "t" }, previousClient: first.client, forceSectorRefresh: true }));
    expect(calls.stream - before).toBe(2);
  });

  it("refines weights and assumptions without changing leader-informed or gate state", async () => {
    const { client } = fakeClient();
    const p = new AnthropicProvider({ client, model: "m", sectors: memStore() });
    const first: any = (await collect(p.qualify({ message: "Qualify Acme Insurance", user: "u" }))).find((e) => e.type === "result");
    const prev = { ...first.qualification, id: "q", version: 1, created_at: "t" };
    const ev = await collect(p.qualify({ message: "Weight exec relationship higher and assume they are mid-way through a cloud migration", user: "u", previous: prev, previousClient: first.client }));
    const res: any = ev.find((e) => e.type === "result");
    expect(res.qualification.weights.exec_relationship).toBe(40);
    expect(res.qualification.dimensions.find((d: any) => d.key === "ai_impact").score).toBe(4);
    expect(res.qualification.evidence.some((e: any) => e.type === "User-provided" && e.snippet.includes("cloud migration"))).toBe(true);
    expect(res.qualification.gate.status).toBe("unresolved");
  });

  it("surfaces a refusal as an error instead of inventing a result", async () => {
    const { client } = fakeClient({ refuse: true });
    const p = new AnthropicProvider({ client, model: "m", sectors: memStore() });
    await expect(collect(p.qualify({ message: "Qualify X", user: "u" }))).rejects.toThrow(/declined/);
  });
});
