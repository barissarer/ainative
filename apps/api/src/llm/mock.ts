import {
  DIMENSION_KEYS,
  DIMENSION_LABELS,
  applyGate,
  baseTier,
  overallConfidence,
  overallScore,
  type DimensionKey,
  type DimensionScore,
  type Evidence,
  type Gate,
} from "@ainative/shared";
import type { LeaderDraft, LlmEvent, LlmProvider, QualifyRequest } from "./types";
import { loadGateRules, loadMethodology } from "../config";
import { EMPTY_FILTER, type SearchFilter } from "../search";

/** Simulated research time so the progress UI is visible in demos. Set MOCK_DELAY_MS=0 to skip (tests do). */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, Number(process.env.MOCK_DELAY_MS ?? ms)));

function hash(s: string) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

const SECTORS: [RegExp, string][] = [
  [/insur|p&c|assur/i, "Insurance"],
  [/bank|lender|credit/i, "Banking"],
  [/retail|grocer|consumer/i, "Retail"],
  [/pharma|health|life science/i, "Life Sciences & Health"],
  [/energy|utilit|oil|power/i, "Energy & Resources"],
  [/telecom|media/i, "TMT"],
  [/manufactur|industrial|auto/i, "Industrials"],
];

export function parseClientName(message: string): string {
  const m = message.match(/qualify\s+(.+?)(?:,|\.|$| - )/i) ?? message.match(/^(.+?)(?:,|\.|$)/);
  return (m?.[1] ?? "Unnamed client").trim().replace(/^["']|["']$/g, "");
}

export const MOCK_NOTICE = "Mock data: no real research was performed.";

/** Deterministic fixture provider. Lets the UI be built and tested without any API calls. */
export class MockProvider implements LlmProvider {
  name = "mock";

  async *qualify(req: QualifyRequest): AsyncGenerator<LlmEvent> {
    const method = loadMethodology();

    // Refinement of an existing scorecard
    if (req.previous && req.previousClient) {
      yield { type: "progress", message: "Applying your changes…" };
      await sleep(250);
      const weights = { ...req.previous.weights };
      const lower = req.message.toLowerCase();
      let reply = "I've re-run the scorecard with your instruction.";
      for (const k of DIMENSION_KEYS) {
        const words = DIMENSION_LABELS[k].toLowerCase().split(/\W+/).filter((w) => w.length > 4);
        if (words.some((w) => lower.includes(w)) || lower.includes(k.replace("_", " "))) {
          if (/higher|more|increase|up/.test(lower)) weights[k] = Math.round(weights[k] * 1.5);
          if (/lower|less|decrease|down/.test(lower)) weights[k] = Math.round(weights[k] * 0.6);
          reply = `Updated the weighting for ${DIMENSION_LABELS[k]}. Weights are shown on the scorecard.`;
        }
      }
      const prev = req.previous;
      const score = overallScore(prev.dimensions, weights);
      const tier = applyGate(baseTier(score, method.thresholds), prev.gate, loadGateRules());
      yield {
        type: "result",
        client: req.previousClient,
        reply,
        qualification: { ...prev, weights, overall_score: score, ai_tier: baseTier(score, method.thresholds), tier, created_by: req.user },
      };
      return;
    }

    const name = parseClientName(req.message);
    const sector = SECTORS.find(([re]) => re.test(req.message))?.[1] ?? "Cross-sector";
    const h = hash(name.toLowerCase());
    const now = new Date().toISOString();

    for (const m of [
      `Researching ${name}…`,
      `Reviewing ${sector} sector dynamics…`,
      "Checking competitor moves…",
      "Scoring against the framework…",
    ]) {
      yield { type: "progress", message: m };
      await sleep(350);
    }

    const evidence: Evidence[] = [];
    const dims: DimensionScore[] = DIMENSION_KEYS.map((key: DimensionKey, i) => {
      const score = 2 + ((h >>> (i * 3)) % 4); // 2..5 (unsigned shift: a signed one goes negative)
      const evId = `ev_${key}`;
      const isLeaderDim = key === "brand_permission" || key === "exec_relationship";
      evidence.push({
        id: evId,
        dimension: key,
        source: isLeaderDim ? "user" : "https://example.com/mock-source",
        snippet: isLeaderDim
          ? "No leader input yet. Estimated from available notes."
          : `Placeholder finding for ${DIMENSION_LABELS[key]}. ${MOCK_NOTICE}`,
        type: isLeaderDim ? "Inference" : "Fact",
        retrieved_at: now,
      });
      return {
        key,
        score,
        rationale: `${MOCK_NOTICE} Illustrative rationale for ${DIMENSION_LABELS[key].toLowerCase()} at ${name}.`,
        confidence: isLeaderDim ? "Low" : (["Med", "High", "Low"] as const)[(h >>> i) % 3],
        origin: "AI-estimated",
        evidence_ids: [evId],
      };
    });

    const weights = method.weights;
    const score = overallScore(dims, weights);
    const gate: Gate = { type: "audit_independence", status: "unresolved", set_by: "system", reason: "Audit relationship not yet confirmed by a leader.", cleared_by: null, updated_at: now };
    const ai_tier = baseTier(score, method.thresholds);
    const tier = applyGate(ai_tier, gate, loadGateRules());

    yield { type: "question", text: "Do you know whether the leadership team has an AI mandate?", chips: ["Yes", "No", "Not sure"] };

    yield {
      type: "result",
      reply: `Here's a first-pass view of ${name}. ${MOCK_NOTICE}`,
      client: { id: `c_${h.toString(36)}`, name, sector, region: /uk|united kingdom/i.test(req.message) ? "UK" : undefined, owner: req.user, relationship_notes: req.message },
      qualification: {
        client_id: `c_${h.toString(36)}`,
        dimensions: dims,
        evidence,
        weights,
        overall_score: score,
        ai_tier,
        tier,
        confidence: overallConfidence(dims),
        headline_why: `First-pass view of ${name} against the seven-dimension framework. ${MOCK_NOTICE}`,
        pitch_readiness: "Illustrative: confirm audit status and executive access with an account leader before pitching.",
        risks: ["Executive access unverified", "Audit relationship unresolved"],
        entry_point: {
          buyer_persona: "Chief Strategy Officer or CFO",
          hook: "A recent trigger event (to be confirmed by research)",
          first_conversation_angle: "Sector AI-impact insight before a transformation pitch",
        },
        open_questions: ["Is there an AI mandate at leadership level?", "Who owns the executive relationship?"],
        gate,
        override: null,
        created_by: req.user,
      },
    };
  }

  /** Keyword heuristic so the leader flow can be demoed without an API key. */
  async mapLeaderText(text: string): Promise<LeaderDraft> {
    const t = text.toLowerCase();
    const has = (re: RegExp) => re.test(t);
    const brand: LeaderDraft["brand_permission"] = has(/nothing strategic|only cost|tactical|weak permission|sensitiv|delivery issue/)
      ? { rating: "Weak", comment: text }
      : has(/strategic|trusted|strong (brand|permission|credib)|lots of .*work/) ? { rating: "Strong", comment: text }
      : has(/some work|moderate/) ? { rating: "Moderate", comment: text } : null;
    const audit: LeaderDraft["audit_status"] = has(/not (an? )?audit|no audit|we don.?t audit/)
      ? { status: "not_audit_client", audit_lead: null, comment: "" }
      : has(/related entity|affiliate/) && has(/audit/) ? { status: "related_entity_audit_client", audit_lead: null, comment: "" }
      : has(/we audit|audit client|our audit/) ? { status: "audit_client", audit_lead: null, comment: "" }
      : has(/not sure.*audit|unsure.*audit|audit.*(unsure|not sure)/) ? { status: "unsure", audit_lead: null, comment: "" } : null;
    const weak = has(/barely|doesn.?t know|don.?t know us|no relationship|weak relationship/);
    const exec: LeaderDraft["exec_relationship"] = weak
      ? { seniority: has(/ceo/) ? "Director" : "None", quality: "Weak", receptiveness: "Unknown", owner: null, comment: text }
      : has(/ceo|cfo|coo|cio|cto|c-suite|board/) && has(/strong|close|knows? us well|trust/)
        ? { seniority: has(/ceo/) ? "CEO" : "C-suite", quality: "Strong", receptiveness: has(/open|receptive|keen/) ? "Yes" : "Maybe", owner: null, comment: text }
        : null;
    return { brand_permission: brand, audit_status: audit, exec_relationship: exec, inferred_fields: [brand && "brand_permission", exec && "exec_relationship"].filter(Boolean) as string[] };
  }

  async proposeApproach(): Promise<string | null> {
    return `${MOCK_NOTICE} Suggested: open with a sector-insight conversation through the relationship owner, and test appetite with a different sponsor before pitching a full transformation.`;
  }

  /** Keyword parser so list search can be demoed without an API key. */
  async parseSearch(query: string): Promise<SearchFilter> {
    const q = query.toLowerCase();
    const f: SearchFilter = { ...EMPTY_FILTER, sectors: [], tiers: [], confidence: [], gate: [], statuses: [] };
    for (const [re, name] of SECTORS) if (re.test(q)) f.sectors.push(name);
    if (/pursue[ -]?now/.test(q)) f.tiers.push("Pursue now");
    if (/deprioriti[sz]e/.test(q)) f.tiers.push("Deprioritize");
    if (/\bnurture\b/.test(q)) f.tiers.push("Nurture");
    for (const c of [["low", "Low"], ["medium|med", "Med"], ["high", "High"]] as const) if (new RegExp(`${c[0]} confidence|confidence (is )?${c[0]}`).test(q)) f.confidence.push(c[1]);
    if (/(exec\w*|executive) access (is |are )?strong|strong exec\w* access/.test(q)) f.exec_access = "strong";
    if (/(exec\w*|executive) access (is |are )?weak|weak exec\w* access/.test(q)) f.exec_access = "weak";
    if (/no audit|not (an )?audit/.test(q)) f.audit_relationship = "none";
    else if (/audit (restriction|relationship|client)/.test(q)) f.audit_relationship = "present";
    if (/awaiting leader/.test(q)) f.statuses.push("Awaiting leader input");
    if (/leader[- ]informed/.test(q)) f.statuses.push("Leader-informed");
    if (/in (the )?campaign/.test(q)) f.statuses.push("In campaign");
    const above = q.match(/(?:above|over|more than|at least|>=?)\s*(\d{1,3})/);
    const below = q.match(/(?:below|under|less than|<=?)\s*(\d{1,3})/);
    if (above) f.min_score = Number(above[1]);
    if (below) f.max_score = Number(below[1]);
    const isEmpty = !f.sectors.length && !f.tiers.length && !f.confidence.length && !f.exec_access && !f.audit_relationship && !f.statuses.length && f.min_score == null && f.max_score == null;
    if (isEmpty) f.name_contains = query.trim();
    return f;
  }
}
