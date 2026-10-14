import {
  AUDIT_LABELS,
  applyGate,
  baseTier,
  brandScoreFromRating,
  execScoreFromRelationship,
  overallConfidence,
  overallScore,
  type AuditStatus,
  type Evidence,
  type Gate,
  type GateRules,
  type LeaderInput,
  type Qualification,
  type TierThresholds,
} from "@ainative/shared";

type Q = Omit<Qualification, "id" | "version" | "created_at">;

export interface LeaderSummary {
  leaders: { id: string; name: string; role: string; created_at: string; source: string }[];
  disagreements: string[];
  conflicts: { dimension: string; ai_score: number; leader_score: number; text: string }[];
  revised_approach: string | null;
}

const CONFLICT_GAP = 2;

/** Latest input per author: a leader editing their own view replaces it. */
export function latestPerAuthor(inputs: LeaderInput[]): LeaderInput[] {
  const m = new Map<string, LeaderInput>();
  for (const i of [...inputs].sort((a, b) => a.created_at.localeCompare(b.created_at))) m.set(i.author.id, i);
  return [...m.values()].filter((i) => i.confirmed);
}

export function aggregate(scores: number[], mode: "conservative" | "median"): number | null {
  if (scores.length === 0) return null;
  const s = [...scores].sort((a, b) => a - b);
  return mode === "conservative" ? s[0] : s[Math.floor((s.length - 1) / 2)];
}

/** "2 of 3 rate executive access as Strong; 1 rates it Weak". Empty when everyone agrees. */
function split(lens: string, labels: string[]): string | null {
  if (labels.length < 2) return null;
  const counts = new Map<string, number>();
  for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1);
  if (counts.size < 2) return null;
  const parts = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [top, ...rest] = parts;
  return `${top[1]} of ${labels.length} rate ${lens} as ${top[0]}; ${rest.map(([l, n]) => `${n} ${n === 1 ? "rates" : "rate"} it ${l}`).join("; ")}`;
}

/** Audit gate follows the leaders' answers, but only ever tightens once Risk has set it. */
export function deriveGate(current: Gate, allInputs: LeaderInput[], now: string): Gate {
  const riskSet0 = !!current.set_by?.startsWith("risk:");
  // Once Risk has decided, only answers given after that decision can tighten the gate again.
  const inputs = riskSet0 ? allInputs.filter((i) => i.created_at > current.updated_at) : allInputs;
  const statuses = inputs.map((i) => i.audit_status.status);
  const worst: Gate["status"] | null = statuses.some((s) => s === "audit_client" || s === "related_entity_audit_client")
    ? "restricted"
    : statuses.some((s) => s === "unsure")
      ? "unresolved"
      : statuses.length > 0
        ? "none"
        : null;
  if (!worst) return current;
  const riskSet = riskSet0;
  const by = `leader input (${inputs.map((i) => i.author.name).join(", ")})`;
  if (riskSet) {
    // Only Risk can loosen or clear. A new restriction reported by a leader still tightens the gate.
    if (worst === "restricted" && current.status !== "restricted") {
      return { ...current, status: "restricted", set_by: by, reason: "A leader reports an audit relationship after Risk / Independence set this gate. Risk review required.", cleared_by: null, updated_at: now };
    }
    return current;
  }
  const reason =
    worst === "restricted"
      ? "Leader reports an audit or related-entity audit relationship."
      : worst === "unresolved"
        ? "A leader is unsure about the audit relationship."
        : "Leaders report no audit relationship.";
  return current.status === worst ? current : { ...current, status: worst, set_by: by, reason, cleared_by: null, updated_at: now };
}

export function pitchReadiness(q: Q, hasLeaders: boolean): string {
  const dim = (k: string) => q.dimensions.find((d) => d.key === k)!;
  const exec = dim("exec_relationship");
  const brand = dim("brand_permission");
  const fit = q.overall_score >= 70 ? "Strong fit on paper" : q.overall_score >= 45 ? "Moderate fit" : "Weak fit";
  const level = (s: number) => (s >= 4 ? "strong" : s <= 2 ? "weak" : "moderate");
  const src = (d: typeof exec) => (d.origin === "AI-estimated" ? " (AI estimate, awaiting leader input)" : "");
  const gap = exec.score <= 3 || brand.score <= 3;
  const joiner = q.overall_score >= 45 && gap ? "but" : "and";
  const facts = `executive access is ${level(exec.score)}${src(exec)} and permission to pitch is ${level(brand.score)}${src(brand)}`;
  let next: string;
  if (q.gate.status === "restricted") next = "audit independence restrictions apply: advisory-only, and Risk / Independence review is needed before any pitch";
  else if (q.gate.status === "unresolved") next = "confirm the audit relationship before any pitch";
  else if (exec.score <= 2 || brand.score <= 2) next = "recommend a sector-insight conversation before a bold pitch";
  else if (exec.score >= 4 && brand.score >= 4 && q.overall_score >= 70) next = "well placed for a bold transformation conversation";
  else next = hasLeaders ? "build executive access before leading with a bold pitch" : "ask the account leader to confirm access and permission";
  return `${fit}, ${joiner} ${facts}: ${next}.`;
}

/**
 * Apply leaders' input to a qualification, deterministically (no AI):
 *  - brand permission and executive relationship scores come from the leaders (labelled Leader-informed),
 *    combined by the configured rule; the AI estimate is kept as ai_score;
 *  - the audit gate follows the leaders' audit answers;
 *  - score, tier, disagreement and conflict flags are recomputed.
 */
export function applyLeaderInputs(
  q: Q,
  all: LeaderInput[],
  o: { rules: GateRules; thresholds: TierThresholds; mode: "conservative" | "median"; now: string },
): Q {
  const inputs = latestPerAuthor(all);
  const dims = q.dimensions.map((d) => ({ ...d }));
  const evidence: Evidence[] = q.evidence.filter((e) => e.type !== "Leader-informed");
  const disagreements: string[] = [];
  const conflicts: LeaderSummary["conflicts"] = [];

  const brandScores = inputs.map((i) => brandScoreFromRating(i.brand_permission.rating)).filter((x): x is number => x != null);
  const execScores = inputs.map((i) => execScoreFromRelationship(i.exec_relationship));

  const set = (key: "brand_permission" | "exec_relationship", score: number | null, label: string, lines: { by: string; text: string }[]) => {
    const d = dims.find((x) => x.key === key)!;
    if (d.origin === "Human override") return; // a person's explicit override wins over leader input
    d.evidence_ids = d.evidence_ids.filter((id) => !id.startsWith(`ev_${key}_L`));
    if (score == null) {
      if (d.origin === "Leader-informed") { d.origin = "AI-estimated"; d.score = d.ai_score ?? d.score; }
      return;
    }
    if (d.origin !== "Leader-informed") d.ai_score = d.score;
    d.score = score;
    d.origin = "Leader-informed";
    d.confidence = "High";
    d.rationale = `${label}: ${lines.map((l) => l.text).join("; ")}.`;
    lines.forEach((l, n) => {
      const id = `ev_${key}_L${n}`;
      evidence.push({ id, dimension: key, source: l.by, snippet: l.text, type: "Leader-informed", retrieved_at: o.now });
      d.evidence_ids.push(id);
    });
    if (d.ai_score != null && Math.abs(d.ai_score - score) >= CONFLICT_GAP) {
      conflicts.push({
        dimension: key,
        ai_score: d.ai_score,
        leader_score: score,
        text: `AI estimated ${key === "brand_permission" ? "brand permission" : "executive relationship"} at ${d.ai_score}/5; leader input puts it at ${score}/5.`,
      });
    }
  };

  set("brand_permission", aggregate(brandScores, o.mode), "Leader view of brand permission", inputs.filter((i) => brandScoreFromRating(i.brand_permission.rating) != null).map((i) => ({ by: `${i.author.name} (${i.author.role})`, text: `${i.brand_permission.rating}${i.brand_permission.comment ? ` — ${i.brand_permission.comment}` : ""}` })));
  set("exec_relationship", aggregate(execScores, o.mode), "Leader view of executive relationship", inputs.map((i) => ({ by: `${i.author.name} (${i.author.role})`, text: `${i.exec_relationship.seniority} level, ${i.exec_relationship.quality} relationship, ${i.exec_relationship.receptiveness} on a bold conversation${i.exec_relationship.comment ? ` — ${i.exec_relationship.comment}` : ""}` })));

  const d1 = split("brand permission", inputs.map((i) => i.brand_permission.rating).filter((r) => r !== "Unknown"));
  const d2 = split("executive access", inputs.map((i) => i.exec_relationship.quality));
  const d3 = split("the audit relationship", inputs.map((i) => AUDIT_LABELS[i.audit_status.status as AuditStatus]));
  for (const x of [d1, d2, d3]) if (x) disagreements.push(x);

  const gate = deriveGate(q.gate, inputs, o.now);
  const score = overallScore(dims, q.weights);
  const ai_tier = baseTier(score, o.thresholds);
  const out: Q = {
    ...q,
    dimensions: dims,
    evidence,
    gate,
    overall_score: score,
    ai_tier,
    tier: applyGate(q.override?.tier ?? ai_tier, gate, o.rules), // a human tier override can never lift the audit cap
    confidence: overallConfidence(dims),
    leader_summary: {
      leaders: inputs.map((i) => ({ id: i.author.id, name: i.author.name, role: i.author.role, created_at: i.created_at, source: i.source })),
      disagreements,
      conflicts,
      revised_approach: null,
    } satisfies LeaderSummary,
  };
  out.pitch_readiness = pitchReadiness(out, inputs.length > 0);
  return out;
}


// ---------------------------------------------------------------- human overrides

export type TierName = "Pursue now" | "Nurture" | "Deprioritize";

/** Recompute score, tier and confidence from the current dimensions. The audit gate always caps, including over an override. */
export function recompute(q: Q, o: { rules: GateRules; thresholds: TierThresholds }): Q {
  const score = overallScore(q.dimensions, q.weights);
  const ai_tier = baseTier(score, o.thresholds);
  const next: Q = { ...q, overall_score: score, ai_tier, tier: applyGate(q.override?.tier ?? ai_tier, q.gate, o.rules), confidence: overallConfidence(q.dimensions) };
  next.pitch_readiness = pitchReadiness(next, !!(next.leader_summary as any)?.leaders?.length);
  return next;
}

/** Override one dimension's score. Keeps the AI/leader view in the record and attaches the reason as visible evidence. */
export function overrideDimension(q: Q, key: string, score: number, reason: string, by: string, now: string): Q {
  const dims = q.dimensions.map((d) => ({ ...d }));
  const d = dims.find((x) => x.key === key);
  if (!d) throw new Error("Unknown dimension");
  const s = Math.max(1, Math.min(5, Math.round(score)));
  const before = { score: d.score, origin: d.origin };
  if (d.origin !== "Human override" && d.ai_score == null) d.ai_score = d.score;
  const evId = `ev_${key}_H${q.evidence.length}`;
  d.score = s;
  d.origin = "Human override";
  d.rationale = `Overridden by ${by} (was ${before.score}/5, ${before.origin}): ${reason}`;
  d.evidence_ids = [...d.evidence_ids.filter((id) => !id.startsWith(`ev_${key}_H`)), evId];
  const evidence = [...q.evidence.filter((e) => !(e.dimension === key && e.id.startsWith(`ev_${key}_H`))), { id: evId, dimension: key, source: "user", snippet: `${by}: ${reason}`, type: "User-provided" as const, retrieved_at: now }];
  return { ...q, dimensions: dims, evidence };
}

export function overrideTier(q: Q, tier: TierName, reason: string, by: string, now: string): Q {
  return { ...q, override: { tier, reason, by, at: now } };
}

/** Undo an override. A dimension goes back to the AI estimate (leader input is re-applied afterwards by the caller). */
export function clearOverride(q: Q, target: { kind: "dimension"; key: string } | { kind: "tier" }): Q {
  if (target.kind === "tier") return { ...q, override: null };
  const dims = q.dimensions.map((d) => ({ ...d }));
  const d = dims.find((x) => x.key === target.key);
  if (!d || d.origin !== "Human override") return q;
  d.score = d.ai_score ?? d.score;
  d.origin = "AI-estimated";
  d.rationale = "Override removed; back to the AI estimate.";
  d.evidence_ids = d.evidence_ids.filter((id) => !id.startsWith(`ev_${target.key}_H`));
  return { ...q, dimensions: dims, evidence: q.evidence.filter((e) => !e.id.startsWith(`ev_${target.key}_H`)) };
}

/** After an AI re-run: put the person's overrides back on top of the fresh result. */
export function carryOverrides(prev: Pick<Q, "dimensions" | "evidence" | "override">, next: Q): Q {
  const dims = next.dimensions.map((d) => ({ ...d }));
  let evidence = [...next.evidence];
  for (const pd of prev.dimensions.filter((d) => d.origin === "Human override")) {
    const d = dims.find((x) => x.key === pd.key);
    if (!d) continue;
    if (d.ai_score == null) d.ai_score = d.score;
    d.score = pd.score;
    d.origin = "Human override";
    d.rationale = pd.rationale;
    const ev = prev.evidence.filter((e) => e.dimension === pd.key && e.id.startsWith(`ev_${pd.key}_H`));
    evidence = [...evidence.filter((e) => !ev.some((x) => x.id === e.id)), ...ev];
    d.evidence_ids = [...d.evidence_ids.filter((id) => !id.startsWith(`ev_${pd.key}_H`)), ...ev.map((e) => e.id)];
  }
  return { ...next, dimensions: dims, evidence, override: prev.override ?? next.override };
}
