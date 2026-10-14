import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS, DIMENSION_KEYS } from "@ainative/shared";
import { assemble } from "./assemble";
import { extractSources } from "./sources";
import type { Reasoning } from "./schemas";

const base = (over: Partial<Reasoning> = {}): Reasoning => ({
  dimensions: DIMENSION_KEYS.map((key) => ({ key, score: 5, rationale: "r", confidence: "High", evidence: [{ type: "Fact", source_id: "S1", snippet: "x" }] })),
  headline_why: "w", pitch_readiness: "p", risks: [], entry_point: { buyer_persona: "b", hook: "h", first_conversation_angle: "f" }, open_questions: [], follow_up_questions: [],
  ...over,
});
const run = (r: Reasoning) =>
  assemble({ reasoning: r, sources: [{ id: "S1", url: "https://example.com/a", title: "A", snippets: [] }], weights: DEFAULT_WEIGHTS, thresholds: DEFAULT_THRESHOLDS, clientId: "c", user: "u", now: "t" });

describe("assemble", () => {
  it("keeps sourced Facts and links the URL", () => {
    const q = run(base());
    const ev = q.evidence.find((e) => e.dimension === "sector_dynamics")!;
    expect(ev.type).toBe("Fact");
    expect(ev.source).toBe("https://example.com/a");
  });

  it("downgrades a Fact with an unknown source id to Inference", () => {
    const r = base();
    r.dimensions[2].evidence = [{ type: "Fact", source_id: "S99", snippet: "made up" }];
    const q = run(r);
    const ev = q.evidence.find((e) => e.dimension === r.dimensions[2].key)!;
    expect(ev.type).toBe("Inference");
    expect(ev.snippet).toContain("no verifiable source");
    expect(q.dimensions[2].confidence).not.toBe("High");
  });

  it("gives every dimension evidence and Low confidence when none was supplied", () => {
    const r = base();
    r.dimensions[0].evidence = [];
    const q = run(r);
    expect(q.dimensions[0].evidence_ids.length).toBeGreaterThan(0);
    expect(q.dimensions[0].confidence).toBe("Low");
  });

  it("fills missing dimensions and clamps scores", () => {
    const r = base();
    r.dimensions = r.dimensions.slice(0, 3);
    r.dimensions[0].score = 99;
    const q = run(r);
    expect(q.dimensions).toHaveLength(7);
    expect(q.dimensions[0].score).toBe(5);
  });

  it("keeps relationship dimensions Low without user input", () => {
    const q = run(base());
    expect(q.dimensions.find((d) => d.key === "exec_relationship")!.confidence).toBe("Low");
  });

  it("computes the tier in code and applies the audit gate", () => {
    const q = run(base()); // all 5s -> 100 -> Pursue now before gate
    expect(q.ai_tier).toBe("Pursue now");
    expect(q.gate.status).toBe("unresolved");
    expect(q.tier).toBe("Nurture");
  });
});

describe("extractSources", () => {
  it("collects search results and citations without duplicates", () => {
    const blocks: any[] = [
      { type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://a.com", title: "A" }, { type: "web_search_result", url: "https://b.com", title: "B" }] },
      { type: "text", text: "t", citations: [{ type: "web_search_result_location", url: "https://a.com", title: "A", cited_text: "quote" }] },
      { type: "web_search_tool_result", content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" } },
    ];
    const s = extractSources(blocks);
    expect(s.map((x) => x.url)).toEqual(["https://a.com", "https://b.com"]);
    expect(s[0].snippets).toEqual(["quote"]);
  });
});
