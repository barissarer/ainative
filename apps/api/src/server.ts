import { buildApp } from "./app";
import { openDb } from "./db";
import { MockProvider } from "./llm/mock";

const db = await openDb();
const app = await buildApp(db, new MockProvider());
const port = Number(process.env.PORT ?? 8787);
await app.listen({ port, host: "0.0.0.0" });
console.log(`API listening on :${port} (llm: mock)`);
