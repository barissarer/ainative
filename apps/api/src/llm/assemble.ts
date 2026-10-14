import {
  DIMENSION_KEYS,
  DIMENSION_LABELS,
  applyGate,
  baseTier,
  overallConfidence,
  overallScore,
  type Confidence,
  type DimensionScore,
  type Evidence,
  type Gate,
  type Qualification,
  type TierThresholds,
} from "@ainative/shared";
import type { Reasoning } from "./schemas";
import type { Source } from "./sources";

const clampScore = (n: number) => Math.max(1, Math.min(5, Math.round(Number.isFinite(n) ? n : 3)));
const rank: Record<Confidence, number> = { Low: 0, Med: 1, High: 2 };
const cap = (c: Confidence, max: Confidence): Confidence => (rank[c] > rank[max] ? max : c);

export interface AssembleInput {
  reasoning: Reasoning;
  sources: Source[];
  weights: Record<string, number>;
  thresholds: TierThresholds;
  clientId: string;
  user: string;
  now: string;
  sector?: { sector: string; refreshed_at: string } | null;
}

/**
 * Turn model output into a Qualification and enforce the evidence rules in code,
 * so the UI never shows an unsourced claim as a Fact:
 *  - Fact needs a source id that was actually retrieved, otherwise it becomes an Inference.
 *  - A dimension with no sourced Fact cannot be High confidence; with no evidence at all it is Low.
 *  - Brand permission and executive relationship stay Low unless the user supplied something.
 *  - Tier, score and the audit gate are computed here, never by the model.
 */
export function assemble(i: AssembleInput): Omit<Qualification, "id" | "version" | "created_at"> {
  const byId = new Map(i.sources.map((s) => [s.id, s]));
  const evidence: Evidence[] = [];
  const dims: DimensionScore[] = DIMENSION_KEYS.map((key) => {
    const raw = i.reasoning.dimensions.find((d) => d.key === key);
    const ids: string[] = [];
    let hasFact = false;
    let hasUser = false;

    for (const [n, e] of (raw?.evidence ?? []).entries()) {
      const src = e.source_id ? byId.get(e.source_id) : undefined;
      let type = e.type;
      let source = src?.url ?? "inference";
      let snippet = e.snippet;
      if (type === "Fact" && !src) {
        type = "Inference"; // no verifiable source: do not present as fact
        snippet = `${snippet} (no verifiable source)`;
      }
      if (type === "User-provided") {
        source = "user";
        hasUser = true;
      }
      if (type === "Fact") hasFact = true;
      const id = `ev_${key}_${n}`;
      evidence.push({ id, dimension: key, source, snippet, type, retrieved_at: i.now });
      ids.push(id);
    }

    let confidence: Confidence = raw?.confidence ?? "Low";
    if (!raw || ids.length === 0) {
      const id = `ev_${key}_gap`;
      evidence.push({ id, dimension: key, source: "inference", snippet: "No evidence found for this dimension. Score is a low-confidence estimate.", type: "Inference", retrieved_at: i.now });
      ids.push(id);
      confidence = "Low";
    } else if (!hasFact && !hasUser) {
      confidence = cap(confidence, "Med");
    }
    if ((key === "brand_permission" || key === "exec_relationship") && !hasUser) confidence = "Low";

    return {
      key,
      score: clampScore(raw?.score ?? 3),
      rationale: raw?.rationale || `${DIMENSION_LABELS[key]} could not be assessed from available evidence.`,
      confidence,
      origin: "AI-estimated" as const,
      evidence_ids: ids,
    };
  });

  const score = overallScore(dims, i.weights);
  const gate: Gate = {
    type: "audit_independence",
    status: "unresolved",
    set_by: "system",
    reason: "Audit relationship not yet confirmed by a leader.",
    cleared_by: null,
    updated_at: i.now,
  };
  const ai_tier = baseTier(score, i.thresholds);
  return {
    client_id: i.clientId,
    dimensions: dims,
    evidence,
    weights: i.weights,
    overall_score: score,
    ai_tier,
    tier: applyGate(ai_tier, gate),
    confidence: overallConfidence(dims),
    headline_why: i.reasoning.headline_why,
    pitch_readiness: i.reasoning.pitch_readiness,
    risks: i.reasoning.risks,
    entry_point: i.reasoning.entry_point,
    open_questions: i.reasoning.open_questions,
    gate,
    sector_research: i.sector ?? null,
    override: null,
    created_by: i.user,
  };
}
