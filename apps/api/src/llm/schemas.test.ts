import { describe, expect, it } from "vitest";
import { toJSONSchema } from "zod";
import { IntakeSchema, LeaderMapSchema, ReasoningSchema, RefineSchema, SectorSummarySchema } from "./schemas";

/** Strict JSON-schema mode (OpenRouter / OpenAI-style) needs closed objects with every property required. */
function problems(n: any, path: string, out: string[] = []): string[] {
  if (n && typeof n === "object") {
    if (n.type === "object" && n.properties) {
      if (n.additionalProperties !== false) out.push(`${path}: additionalProperties is not false`);
      const req = new Set<string>(n.required ?? []);
      for (const k of Object.keys(n.properties)) if (!req.has(k)) out.push(`${path}.${k}: not required`);
    }
    for (const [k, v] of Object.entries(n)) problems(v, `${path}.${k}`, out);
  }
  return out;
}

describe("structured-output schemas", () => {
  for (const [name, schema] of Object.entries({ IntakeSchema, ReasoningSchema, RefineSchema, LeaderMapSchema, SectorSummarySchema })) {
    it(`${name} is strict-compatible`, () => {
      expect(problems(toJSONSchema(schema as any), name)).toEqual([]);
    });
  }
});
