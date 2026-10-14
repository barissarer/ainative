import { z } from "zod";

export const DIMENSION_KEYS = [
  "client_circumstances",
  "competitive_landscape",
  "sector_dynamics",
  "ai_impact",
  "offering_fit",
  "brand_permission",
  "exec_relationship",
] as const;
export type DimensionKey = (typeof DIMENSION_KEYS)[number];

export const DIMENSION_LABELS: Record<DimensionKey, string> = {
  client_circumstances: "Client circumstances",
  competitive_landscape: "Competitive landscape",
  sector_dynamics: "Sector dynamics",
  ai_impact: "AI impact",
  offering_fit: "Offering fit & deal potential",
  brand_permission: "Brand permission to pitch",
  exec_relationship: "Executive relationship",
};

export const Confidence = z.enum(["High", "Med", "Low"]);
export type Confidence = z.infer<typeof Confidence>;

export const EvidenceType = z.enum(["Fact", "Inference", "User-provided", "Leader-informed"]);
export type EvidenceType = z.infer<typeof EvidenceType>;

export const Tier = z.enum(["Pursue now", "Nurture", "Nurture (advisory-only)", "Deprioritize"]);
export type Tier = z.infer<typeof Tier>;

export const Evidence = z.object({
  id: z.string(),
  dimension: z.string().nullable().optional(),
  source: z.string(), // URL or "user"
  snippet: z.string(),
  type: EvidenceType,
  retrieved_at: z.string(),
});
export type Evidence = z.infer<typeof Evidence>;

export const DimensionScore = z.object({
  key: z.enum(DIMENSION_KEYS),
  score: z.number().int().min(1).max(5),
  rationale: z.string(),
  confidence: Confidence,
  origin: z.enum(["AI-estimated", "Leader-informed", "Human override"]),
  evidence_ids: z.array(z.string()),
});
export type DimensionScore = z.infer<typeof DimensionScore>;

export const AuditStatus = z.enum([
  "not_audit_client",
  "audit_client",
  "related_entity_audit_client",
  "unsure",
]);
export type AuditStatus = z.infer<typeof AuditStatus>;

export const Gate = z.object({
  type: z.literal("audit_independence"),
  status: z.enum(["none", "restricted", "unresolved", "cleared"]),
  set_by: z.string().nullable(),
  reason: z.string().nullable(),
  cleared_by: z.string().nullable(),
  updated_at: z.string(),
});
export type Gate = z.infer<typeof Gate>;

export const LeaderInput = z.object({
  id: z.string(),
  qualification_id: z.string(),
  client_id: z.string(),
  author: z.object({ id: z.string(), name: z.string(), role: z.string() }),
  brand_permission: z.object({
    rating: z.enum(["Strong", "Moderate", "Weak", "Unknown"]),
    comment: z.string().optional(),
  }),
  audit_status: z.object({
    status: AuditStatus,
    audit_lead: z.string().optional(),
    comment: z.string().optional(),
  }),
  exec_relationship: z.object({
    seniority: z.enum(["CEO", "C-suite", "VP", "Director", "None"]),
    quality: z.enum(["Strong", "Moderate", "Weak"]),
    receptiveness: z.enum(["Yes", "Maybe", "No", "Unknown"]),
    owner: z.string().optional(),
    comment: z.string().optional(),
  }),
  source: z.enum(["structured", "conversational"]),
  confirmed: z.boolean(),
  created_at: z.string(),
});
export type LeaderInput = z.infer<typeof LeaderInput>;

export const Client = z.object({
  id: z.string(),
  name: z.string(),
  sector: z.string(),
  sub_sector: z.string().optional(),
  region: z.string().optional(),
  size: z.string().optional(),
  owner: z.string().optional(),
  relationship_notes: z.string().optional(),
});
export type Client = z.infer<typeof Client>;

export const EntryPoint = z.object({
  buyer_persona: z.string(),
  hook: z.string(),
  first_conversation_angle: z.string(),
});

export const Qualification = z.object({
  id: z.string(),
  client_id: z.string(),
  version: z.number().int(),
  dimensions: z.array(DimensionScore),
  evidence: z.array(Evidence),
  weights: z.record(z.string(), z.number()),
  overall_score: z.number(),
  ai_tier: Tier, // tier before human override
  tier: Tier, // effective tier after override and gate
  confidence: Confidence,
  headline_why: z.string(),
  pitch_readiness: z.string(),
  risks: z.array(z.string()),
  entry_point: EntryPoint,
  open_questions: z.array(z.string()),
  gate: Gate,
  override: z
    .object({ tier: Tier.optional(), reason: z.string(), by: z.string(), at: z.string() })
    .nullable(),
  created_by: z.string(),
  created_at: z.string(),
});
export type Qualification = z.infer<typeof Qualification>;

export const SectorResearch = z.object({
  sector: z.string(),
  summary: z.string(),
  ai_impact_view: z.string(),
  sources: z.array(z.string()),
  refreshed_at: z.string(),
});
export type SectorResearch = z.infer<typeof SectorResearch>;

export type Role = "consultant" | "account_leader" | "risk_independence" | "leadership" | "admin";
