import { describe, expect, it } from "vitest";
import { MockProvider } from "./mock";

describe("mock provider", () => {
  it("always produces in-range scores and a confidence for every dimension, whatever the name", async () => {
    const p = new MockProvider();
    for (let i = 0; i < 150; i++) {
      for await (const ev of p.qualify({ message: `Qualify Client ${i} ${Math.random().toString(36)}`, user: "u" })) {
        if (ev.type !== "result") continue;
        const q = ev.qualification;
        expect(q.dimensions.every((d) => d.score >= 1 && d.score <= 5 && ["High", "Med", "Low"].includes(d.confidence))).toBe(true);
        expect(q.overall_score).toBeGreaterThanOrEqual(0);
        expect(q.overall_score).toBeLessThanOrEqual(100);
      }
    }
  }, 120000);
});
