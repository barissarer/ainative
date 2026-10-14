import { buildApp, makeSectorStore } from "./app";
import { openDb } from "./db";
import { MockProvider } from "./llm/mock";
import { AnthropicProvider } from "./llm/anthropic";

const db = await openDb();
const hasKey = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const useReal = process.env.LLM_PROVIDER ? process.env.LLM_PROVIDER === "anthropic" : hasKey;
if (useReal && !hasKey) throw new Error("LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set.");

const llm = useReal ? new AnthropicProvider({ sectors: makeSectorStore(db) }) : new MockProvider();
const app = await buildApp(db, llm);
const port = Number(process.env.PORT ?? 8787);
await app.listen({ port, host: "0.0.0.0" });
console.log(`API listening on :${port} (llm: ${llm.name}${useReal ? `, model: ${process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5"}` : ""})`);
