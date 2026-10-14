import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DIMENSION_KEYS, type SectorResearch } from "@ainative/shared";
import { OpenRouterProvider, extractJson } from "./openrouter";
import { chooseProvider } from "./factory";
import type { LlmEvent, SectorStore } from "./types";

const memStore = (): SectorStore => {
  const m = new Map<string, SectorResearch>();
  return { get: async (s) => m.get(s), save: async (r) => void m.set(r.sector, r) };
};
const reply = (content: string, extra: object = {}) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content, ...extra } }] }) }) as any;
const fail = (status: number, message: string) => ({ ok: false, status, json: async () => ({ error: { code: status, message } }) }) as any;
const mk = (fetchImpl: any, o: object = {}) => new OpenRouterProvider({ apiKey: "sk-or-secret", model: "deepseek/test", sectors: memStore(), fetchImpl, retryDelayMs: 1, ...o });
const callStructured = (p: any, schema: z.ZodType, user = "u") => p.structured(schema, "sys", user, "low");

const S = z.object({ name: z.string(), n: z.number() });

describe("extractJson", () => {
  it("strips think blocks and code fences", () => {
    expect(extractJson('<think>hmm {"x":1}</think>\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it("throws when there is no object", () => expect(() => extractJson("nope")).toThrow());
});

describe("OpenRouterProvider structured output", () => {
  it("uses JSON-schema mode with data protection and never leaks the key into the body", async () => {
    const calls: any[] = [];
    const p = mk(async (_u: string, init: any) => { calls.push({ init, body: JSON.parse(init.body) }); return reply('{"name":"a","n":1}'); });
    expect(await callStructured(p, S)).toEqual({ name: "a", n: 1 });
    const { init, body } = calls[0];
    expect(init.headers.Authorization).toBe("Bearer sk-or-secret");
    expect(body.model).toBe("deepseek/test");
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.provider).toMatchObject({ data_collection: "deny", require_parameters: true });
    expect(init.body).not.toContain("sk-or-secret");
  });

  it("falls back to JSON mode when no host supports JSON-schema, and remembers", async () => {
    const modes: string[] = [];
    const p = mk(async (_u: string, init: any) => {
      const b = JSON.parse(init.body);
      modes.push(b.response_format.type);
      return b.response_format.type === "json_schema" ? fail(404, "No endpoints found that support response_format") : reply('{"name":"b","n":2}');
    });
    expect(await callStructured(p, S)).toEqual({ name: "b", n: 2 });
    await callStructured(p, S);
    expect(modes).toEqual(["json_schema", "json_object", "json_object"]);
  });

  it("repairs once when the reply does not match the schema, then gives up readably", async () => {
    let n = 0;
    const p = mk(async () => (++n === 1 ? reply('{"name":"c"}') : reply('{"name":"c","n":3}')));
    expect(await callStructured(p, S)).toEqual({ name: "c", n: 3 });
    const bad = mk(async () => reply("not json"));
    await expect(callStructured(bad, S)).rejects.toThrow(/unreadable/);
  });

  it("retries transient errors and maps credential, credit and busy errors", async () => {
    let n = 0;
    expect(await callStructured(mk(async () => (++n < 3 ? fail(503, "overloaded") : reply('{"name":"d","n":4}'))), S)).toEqual({ name: "d", n: 4 });
    const run = async (status: number) => { try { await callStructured(mk(async () => fail(status, "x")), S); } catch (e) { return (mk(async () => reply("")) as any).friendlyError(e).message as string; } };
    expect(await run(401)).toMatch(/credentials/);
    expect(await run(402)).toMatch(/credits/);
    expect(await run(429)).toMatch(/busy/);
  });

  it("can pin hosts and allow data collection explicitly", async () => {
    let body: any;
    const p = mk(async (_u: string, init: any) => { body = JSON.parse(init.body); return reply('{"name":"e","n":5}'); }, { onlyProviders: ["fireworks"], allowDataCollection: true });
    await callStructured(p, S);
    expect(body.provider).toMatchObject({ only: ["fireworks"], data_collection: "allow" });
  });
});

describe("OpenRouterProvider pipeline (fake network)", () => {
  /** Routes by what the request looks like, like a tiny fake OpenRouter. */
  const router = (opts: { annotations?: boolean } = { annotations: true }) => {
    const seen = { web: 0, plugins: [] as any[] };
    const f = async (_u: string, init: any) => {
      const b = JSON.parse(init.body);
      const sys: string = b.messages[0].content;
      if (b.plugins?.some((x: any) => x.id === "web")) {
        seen.web++;
        seen.plugins.push(b.plugins);
        return reply("- finding", opts.annotations ? { annotations: [{ type: "url_citation", url_citation: { url: `https://web.example/${seen.web}`, title: "Page", content: "quote" } }] } : {});
      }
      if (sys.includes("You write web search queries")) return reply('{"queries":["acme strategy","acme leadership change","insurer ai adoption"]}');
      if (sys.includes("Extract client details")) return reply('{"client_name":"Acme Insurance","sector":"Insurance","sub_sector":null,"region":"UK","size":null,"user_facts":["strong relationship with the CFO"]}');
      if (sys.includes("Summarise sector")) return reply('{"summary":"sector","ai_impact_view":"impact"}');
      return reply(JSON.stringify({
        dimensions: DIMENSION_KEYS.map((key) => ({ key, score: 4, rationale: "why", confidence: "Med", evidence: [{ type: "Fact", source_id: "S1", snippet: "found" }] })),
        headline_why: "Good fit.", pitch_readiness: "x", risks: ["r"], entry_point: { buyer_persona: "CFO", hook: "h", first_conversation_angle: "f" }, open_questions: ["q"], follow_up_questions: [{ text: "AI mandate?", chips: ["Yes", "No"] }],
      }));
    };
    return { f, seen };
  };
  const run = async (p: any) => { const out: LlmEvent[] = []; for await (const e of p.qualify({ message: "Qualify Acme Insurance, UK insurer", user: "u" })) out.push(e); return out; };

  it("produces a sourced scorecard from search annotations and reuses sector research", async () => {
    const { f, seen } = router();
    const p = mk(f);
    const ev = await run(p);
    const res: any = ev.find((e) => e.type === "result");
    expect(res.qualification.dimensions).toHaveLength(7);
    expect(res.qualification.evidence.some((e: any) => e.type === "Fact" && e.source.startsWith("https://web.example/"))).toBe(true);
    expect(res.qualification.gate.status).toBe("unresolved");
    expect(res.qualification.tier).not.toBe("Pursue now");
    expect(seen.web).toBe(6); // 3 client + 3 sector queries
    expect(seen.plugins[0][0]).toMatchObject({ id: "web" });
    const before = seen.web;
    await run(p);
    expect(seen.web - before).toBe(3); // sector reused from memory
  });

  it("downgrades Facts to Inference when the search returns no citations", async () => {
    const ev = await run(mk(router({ annotations: false }).f));
    const res: any = ev.find((e) => e.type === "result");
    expect(res.qualification.evidence.some((e: any) => e.type === "Fact")).toBe(false);
    expect(res.qualification.dimensions.every((d: any) => d.confidence !== "High")).toBe(true);
  });

  it("fails with a clear message instead of scoring on nothing when every search fails", async () => {
    const p = mk(async (_u: string, init: any) => {
      const b = JSON.parse(init.body);
      if (b.messages[0].content.includes("You write web search queries")) return reply('{"queries":["a","b","c"]}');
      if (b.messages[0].content.includes("Extract client details")) return reply('{"client_name":"X","sector":"Banking","sub_sector":null,"region":null,"size":null,"user_facts":[]}');
      return fail(402, "insufficient credits");
    });
    await expect(run(p)).rejects.toThrow(/out of credits/);
  });
});

describe("provider selection", () => {
  it("prefers an explicit choice, then Anthropic, then OpenRouter, else mock", () => {
    expect(chooseProvider({ LLM_PROVIDER: "mock", OPENROUTER_API_KEY: "k" } as any)).toBe("mock");
    expect(chooseProvider({ ANTHROPIC_API_KEY: "a", OPENROUTER_API_KEY: "k" } as any)).toBe("anthropic");
    expect(chooseProvider({ OPENROUTER_API_KEY: "k" } as any)).toBe("openrouter");
    expect(chooseProvider({} as any)).toBe("mock");
    expect(() => chooseProvider({ LLM_PROVIDER: "x" } as any)).toThrow();
  });
});
