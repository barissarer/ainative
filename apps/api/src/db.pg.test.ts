import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "./config";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { buildApp } from "./app";
import { openDb, type Db } from "./db";
import { MockProvider } from "./llm/mock";

/**
 * Runs the real `pg` adapter (the one used with DATABASE_URL on Replit, Neon, Supabase…) against a Postgres-protocol
 * server backed by PGlite, so the production code path is exercised without installing Postgres.
 */
describe("Postgres adapter (pg over the wire protocol)", () => {
  let lite: PGlite, server: PGLiteSocketServer, db: Db, port: number;
  beforeAll(async () => {
    lite = new PGlite();
    await lite.waitReady;
    port = 54000 + Math.floor(Math.random() * 1000);
    server = new PGLiteSocketServer({ db: lite, port, host: "127.0.0.1" });
    await server.start();
    process.env.PG_POOL_MAX = "1"; // PGlite is single-connection
    db = await openDb(`postgres://postgres:postgres@127.0.0.1:${port}/postgres?sslmode=disable`);
  }, 60000);
  afterAll(async () => {
    await db?.close().catch(() => {});
    await server?.stop().catch(() => {});
    await lite?.close().catch(() => {});
  });

  it("runs migrations and reports its kind", async () => {
    expect(db.kind).toBe("postgres");
    const r = await db.query("select column_name from information_schema.columns where table_name='clients' and column_name='in_campaign'");
    expect(r.rows).toHaveLength(1);
    // Migrations must be safe to re-run on every start (several instances may start together).
    const dir = path.join(repoRoot, "supabase", "migrations");
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) await db.exec(readFileSync(path.join(dir, f), "utf8"));
  });

  it("runs the app end to end: qualify, list, leader request, audit log", async () => {
    const app = await buildApp(db, new MockProvider());
    await app.listen({ port: 0 });
    const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
    const res = await fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json", "x-user": "casey" }, body: JSON.stringify({ message: "Qualify Acme Insurance, UK insurer" }) });
    const first = JSON.parse((await res.text()).match(/event: result\ndata: (.*)\n/)![1]);
    expect(first.qualification.version).toBe(1);
    const list = await (await fetch(`${base}/api/clients`)).json();
    expect(list).toHaveLength(1);
    expect(typeof list[0].score).toBe("number");
    const r = await fetch(`${base}/api/clients/${first.client.id}/leader-requests`, { method: "POST", headers: { "content-type": "application/json", "x-user": "casey" }, body: JSON.stringify({ assignee_ids: ["priya"] }) });
    expect((await r.json()).created).toHaveLength(1);
    const log = await (await fetch(`${base}/api/audit-log`)).json();
    expect(log.length).toBeGreaterThanOrEqual(2);
    await app.close();
  }, 60000);
});
