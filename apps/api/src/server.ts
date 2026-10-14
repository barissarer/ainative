import { buildApp, makeSectorStore } from "./app";
import { openDb } from "./db";
import { makeProvider } from "./llm/factory";

const prod = process.env.NODE_ENV === "production";
const db = await openDb();
if (prod) {
  console.warn("[warn] There is no login. Anyone who can open this URL can read and change client data, and the 'Viewing as' switcher is not security. Restrict who can reach the deployment (e.g. a private deployment option on your host) before using real client data.");
  if (db.kind === "pglite") console.warn("[warn] Using the local PGlite database. Hosts that wipe the filesystem between deploys will lose data. Set DATABASE_URL to a hosted Postgres.");
}
const { llm, label } = makeProvider(makeSectorStore(db));
const app = await buildApp(db, llm);
const port = Number(process.env.PORT ?? 8787);
await app.listen({ port, host: "0.0.0.0" });
console.log(`API listening on :${port} (llm: ${label}; db: ${db.kind})`);
