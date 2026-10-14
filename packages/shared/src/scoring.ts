import { DIMENSION_KEYS, type Confidence, type DimensionKey, type DimensionScore, type Gate, type Tier } from "./types";

/**
 * Proposed defaults. Relationship strength and client circumstances (which include
 * trigger events) carry the most weight; weights are editable in config/methodology.yaml
 * or in plain English via the chat.
 */
export const DEFAULT_WEIGHTS: Record<DimensionKey, number> = {
  client_circumstances: 20,
  competitive_landscape: 10,
  sector_dynamics: 10,
  ai_impact: 10,
  offering_fit: 15,
  brand_permission: 15,
  exec_relationship: 20,
};

export interface TierThresholds {
  pursue_now: number;
  nurture: number;
}
export const DEFAULT_THRESHOLDS: TierThresholds = { pursue_now: 70, nurture: 45 };

export function normalizeWeights(w: Partial<Record<string, number>>): Record<DimensionKey, number> {
  const out = { ...DEFAULT_WEIGHTS };
  for (const k of DIMENSION_KEYS) {
    const v = w[k];
    if (typeof v === "number" && v >= 0) out[k] = v;
  }
  return out;
}

/** Weighted mean of 1-5 scores mapped onto 0-100. */
export function overallScore(dims: Pick<DimensionScore, "key" | "score">[], weights: Record<string, number>): number {
  let num = 0;
  let den = 0;
  for (const d of dims) {
    const w = weights[d.key] ?? 0;
    num += w * ((d.score - 1) / 4);
    den += w;
  }
  return den === 0 ? 0 : Math.round((num / den) * 100);
}

export function baseTier(score: number, t: TierThresholds = DEFAULT_THRESHOLDS): Tier {
  if (score >= t.pursue_now) return "Pursue now";
  if (score >= t.nurture) return "Nurture";
  return "Deprioritize";
}

export interface GateRules {
  /** Tier cap applied when the audit status is restricted. */
  restricted_cap: Tier;
  /** Tier cap applied while the audit status is unresolved ("Unsure"). */
  unresolved_cap: Tier;
}
export const DEFAULT_GATE_RULES: GateRules = {
  restricted_cap: "Nurture (advisory-only)",
  unresolved_cap: "Nurture",
};

const TIER_RANK: Record<Tier, number> = {
  Deprioritize: 0,
  "Nurture (advisory-only)": 1,
  Nurture: 1,
  "Pursue now": 2,
};

/** Apply the audit gate. The gate can only lower a tier, never raise it. Deterministic, no LLM involvement. */
export function applyGate(tier: Tier, gate: Pick<Gate, "status">, rules: GateRules = DEFAULT_GATE_RULES): Tier {
  let cap: Tier | null = null;
  if (gate.status === "restricted") cap = rules.restricted_cap;
  else if (gate.status === "unresolved") cap = rules.unresolved_cap;
  if (!cap) return tier;
  // At or above the cap becomes the cap, so a plain "Nurture" is relabelled "Nurture (advisory-only)" when restricted.
  return tier !== "Deprioritize" && TIER_RANK[tier] >= TIER_RANK[cap] ? cap : tier;
}

/** Overall confidence: the weakest link, softened if most dimensions are High. */
export function overallConfidence(dims: Pick<DimensionScore, "confidence">[]): Confidence {
  if (dims.length === 0) return "Low";
  const pts = dims.reduce((s, d) => s + (d.confidence === "High" ? 2 : d.confidence === "Med" ? 1 : 0), 0);
  const avg = pts / dims.length;
  return avg >= 1.5 ? "High" : avg >= 0.8 ? "Med" : "Low";
}

/** Map leader lens inputs to 1-5 scores. */
export function brandScoreFromRating(r: "Strong" | "Moderate" | "Weak" | "Unknown"): number | null {
  return r === "Strong" ? 5 : r === "Moderate" ? 3 : r === "Weak" ? 1 : null;
}
const SENIORITY: Record<string, number> = { CEO: 2, "C-suite": 1.5, VP: 1, Director: 0.5, None: -1 };
const QUALITY: Record<string, number> = { Strong: 2, Moderate: 1, Weak: 0 };
const RECEPT: Record<string, number> = { Yes: 1, Maybe: 0.5, No: -0.5, Unknown: 0 };
export function execScoreFromRelationship(r: {
  seniority: string;
  quality: string;
  receptiveness: string;
}): number {
  const raw = 1 + (SENIORITY[r.seniority] ?? 0) + (QUALITY[r.quality] ?? 0) + (RECEPT[r.receptiveness] ?? 0);
  return Math.max(1, Math.min(5, Math.round(raw)));
}
