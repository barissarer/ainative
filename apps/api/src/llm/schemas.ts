import { z } from "zod";
import { DIMENSION_KEYS, SECTOR_OPTIONS } from "@ainative/shared";

/** Structured-output schemas. Kept free of numeric bounds (unsupported); clamped in code instead. */

export const IntakeSchema = z.object({
  client_name: z.string(),
  sector: z.enum(SECTOR_OPTIONS),
  sub_sector: z.string().nullable(),
  region: z.string().nullable(),
  size: z.string().nullable(),
  /** Facts the user stated themselves (relationships, assumptions, context). */
  user_facts: z.array(z.string()),
});
export type Intake = z.infer<typeof IntakeSchema>;

const EvidenceClaim = z.object({
  type: z.enum(["Fact", "Inference", "User-provided"]),
  /** Source id from the provided source list (e.g. "S3"). Required for Fact. */
  source_id: z.string().nullable(),
  snippet: z.string(),
});

export const ReasoningSchema = z.object({
  dimensions: z.array(
    z.object({
      key: z.enum(DIMENSION_KEYS),
      score: z.number(),
      rationale: z.string(),
      confidence: z.enum(["High", "Med", "Low"]),
      evidence: z.array(EvidenceClaim),
    }),
  ),
  headline_why: z.string(),
  pitch_readiness: z.string(),
  risks: z.array(z.string()),
  entry_point: z.object({
    buyer_persona: z.string(),
    hook: z.string(),
    first_conversation_angle: z.string(),
  }),
  open_questions: z.array(z.string()),
  follow_up_questions: z.array(z.object({ text: z.string(), chips: z.array(z.string()) })),
});
export type Reasoning = z.infer<typeof ReasoningSchema>;

export const RefineSchema = z.object({
  /** Only dimensions the user asked to reweight. Values are relative weights (0-100). */
  weight_changes: z.array(z.object({ key: z.enum(DIMENSION_KEYS), weight: z.number() })),
  /** Score changes caused by assumptions or facts the user supplied. */
  adjustments: z.array(
    z.object({
      key: z.enum(DIMENSION_KEYS),
      new_score: z.number(),
      rationale: z.string(),
      user_statement: z.string(),
    }),
  ),
  reply: z.string(),
});
export type Refine = z.infer<typeof RefineSchema>;

export const SectorSummarySchema = z.object({
  summary: z.string(),
  ai_impact_view: z.string(),
});

export const LeaderMapSchema = z.object({
  brand_permission: z.object({ rating: z.enum(["Strong", "Moderate", "Weak", "Unknown"]), comment: z.string() }).nullable(),
  audit_status: z
    .object({ status: z.enum(["not_audit_client", "audit_client", "related_entity_audit_client", "unsure"]), audit_lead: z.string().nullable(), comment: z.string() })
    .nullable(),
  exec_relationship: z
    .object({
      seniority: z.enum(["CEO", "C-suite", "VP", "Director", "None"]),
      quality: z.enum(["Strong", "Moderate", "Weak"]),
      receptiveness: z.enum(["Yes", "Maybe", "No", "Unknown"]),
      owner: z.string().nullable(),
      comment: z.string(),
    })
    .nullable(),
  inferred_fields: z.array(z.string()),
});

export const SearchFilterSchema = z.object({
  sectors: z.array(z.string()),
  tiers: z.array(z.enum(["Pursue now", "Nurture", "Nurture (advisory-only)", "Deprioritize"])),
  confidence: z.array(z.enum(["High", "Med", "Low"])),
  min_score: z.number().nullable(),
  max_score: z.number().nullable(),
  gate: z.array(z.enum(["none", "restricted", "unresolved", "cleared"])),
  statuses: z.array(z.enum(["Awaiting leader input", "Leader-informed", "Audit restriction", "Audit status unresolved", "In campaign"])),
  exec_access: z.enum(["strong", "weak"]).nullable(),
  brand_permission: z.enum(["strong", "weak"]).nullable(),
  audit_relationship: z.enum(["none", "present"]).nullable(),
  name_contains: z.string().nullable(),
  sort: z.enum(["score", "updated", "name"]).nullable(),
});
