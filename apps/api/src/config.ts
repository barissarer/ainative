import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import YAML from "yaml";
import { normalizeWeights, type TierThresholds, DEFAULT_THRESHOLDS } from "@ainative/shared";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const repoRoot = root;

function load(name: string): any {
  return YAML.parse(readFileSync(path.join(root, "config", name), "utf8"));
}

export function loadMethodology() {
  const m = load("methodology.yaml");
  return {
    weights: normalizeWeights(m.weights ?? {}),
    thresholds: { ...DEFAULT_THRESHOLDS, ...(m.tier_thresholds ?? {}) } as TierThresholds,
    rubric: m.rubric as Record<string, string>,
    prompts: m.prompts as Record<string, string>,
  };
}

export function loadIndependence() {
  return load("independence.yaml");
}
