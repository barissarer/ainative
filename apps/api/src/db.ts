import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "./config";

/**
 * Dev database: PGlite (real Postgres compiled to WASM), persisted under .data/.
 * The same SQL migrations in supabase/migrations run on a hosted Postgres / Supabase.
 */
export async function openDb(dir = process.env.DATA_DIR ?? path.join(repoRoot, ".data", "pg")) {
  if (dir !== "memory://") mkdirSync(dir, { recursive: true });
  const db = new PGlite(dir === "memory://" ? undefined : dir);
  await db.waitReady;
  const migDir = path.join(repoRoot, "supabase", "migrations");
  for (const f of readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(path.join(migDir, f), "utf8"));
  }
  return db;
}
export type Db = Awaited<ReturnType<typeof openDb>>;

export async function audit(
  db: Db,
  a: { actor: string; action: string; entity: string; entity_id: string; detail?: unknown; reason?: string },
) {
  await db.query(
    "insert into audit_log (actor, action, entity, entity_id, detail, reason) values ($1,$2,$3,$4,$5,$6)",
    [a.actor, a.action, a.entity, a.entity_id, JSON.stringify(a.detail ?? {}), a.reason ?? null],
  );
}
