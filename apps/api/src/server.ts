import { buildApp, makeSectorStore } from "./app";
import { openDb } from "./db";
import { makeProvider } from "./llm/factory";

const db = await openDb();
const { llm, label } = makeProvider(makeSectorStore(db));
const app = await buildApp(db, llm);
const port = Number(process.env.PORT ?? 8787);
await app.listen({ port, host: "0.0.0.0" });
console.log(`API listening on :${port} (llm: ${label})`);
