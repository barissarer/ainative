/**
 * Live check against the real API (costs a small amount). Usage:
 *   OPENROUTER_API_KEY=... (or ANTHROPIC_API_KEY=...) npm run smoke -w @ainative/api -- "Qualify Acme Insurance, UK P&C insurer"
 */
import { openDb } from "./db";
import { makeSectorStore } from "./app";
import { makeProvider } from "./llm/factory";

const db = await openDb("memory://");
const { llm, label } = makeProvider(makeSectorStore(db));
console.log(`Provider: ${label}`);
const message = process.argv.slice(2).join(" ") || "Qualify Acme Insurance, mid-size P&C insurer in the UK";
const t0 = Date.now();
for await (const ev of llm.qualify({ message, user: "smoke" })) {
  if (ev.type === "progress") console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${ev.message}`);
  else if (ev.type === "question") console.log("Q:", ev.text, ev.chips);
  else {
    const q = ev.qualification;
    console.log(`\n${ev.client.name} (${ev.client.sector}) score ${q.overall_score} tier ${q.tier} confidence ${q.confidence}`);
    for (const d of q.dimensions) {
      const ev2 = q.evidence.filter((e) => d.evidence_ids.includes(e.id));
      console.log(` - ${d.key}: ${d.score}/5 ${d.confidence} [${ev2.map((e) => e.type).join(",")}]`);
    }
    const facts = q.evidence.filter((e) => e.type === "Fact");
    console.log(`\n${facts.length} sourced facts; ${facts.filter((f) => !f.source.startsWith("http")).length} facts missing a URL (should be 0)`);
    console.log(`Total ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
}
