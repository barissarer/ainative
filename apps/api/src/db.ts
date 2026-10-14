import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { readdirSync, readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "./config";

/** The small surface the app needs. Implemented by Postgres (pg) and by PGlite (dev/tests). */
export interface Db {
  kind: "postgres" | "pglite";
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

const isPgUrl = (s: string) => /^postgres(ql)?:\/\//i.test(s);

/**
 * Connection choice:
 *  - an explicit argument ("memory://", a directory, or a postgres:// URL), else
 *  - DATABASE_URL (hosted Postgres: Replit, Neon, Supabase, RDS…), else
 *  - PGlite on local disk (.data/pg): real Postgres in WASM for development. Not suitable for hosting
 *    where the filesystem is wiped between deploys.
 * The same SQL migrations in supabase/migrations run on all of them.
 */
export async function openDb(target?: string): Promise<Db> {
  const t = target ?? process.env.DATABASE_URL ?? process.env.DATA_DIR ?? path.join(repoRoot, ".data", "pg");
  return isPgUrl(t) ? openPostgres(t) : openPglite(t);
}

async function openPglite(dir: string): Promise<Db> {
  if (dir !== "memory://") mkdirSync(dir, { recursive: true });
  const lite = new PGlite(dir === "memory://" ? undefined : dir);
  await lite.waitReady;
  await runMigrations((sql) => lite.exec(sql).then(() => {}));
  return {
    kind: "pglite",
    query: async (sql, params) => ({ rows: (await lite.query<any>(sql, params)).rows }),
    exec: async (sql) => void (await lite.exec(sql)),
    close: () => lite.close(),
  };
}

async function openPostgres(url: string): Promise<Db> {
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const pool = new pg.Pool({
    connectionString: url,
    max: Number(process.env.PG_POOL_MAX ?? 10),
    // Hosted providers need TLS. A sslmode in the URL is respected; otherwise default to TLS for non-local hosts.
    ssl: /sslmode=/.test(url) || local || process.env.PGSSL === "false" ? undefined : { rejectUnauthorized: false },
  });
  pool.on("error", (e) => console.error("[db] idle client error:", e.message));
  // One dedicated connection for migrations so the advisory lock is held and released on the same session.
  // Fails fast with a clear message if the URL or credentials are wrong.
  const c = await pool.connect();
  try {
    await c.query("select pg_advisory_lock(7272740001)");
    await runMigrations((sql) => c.query(sql).then(() => {}));
  } finally {
    await c.query("select pg_advisory_unlock(7272740001)").catch(() => {});
    c.release();
  }
  return {
    kind: "postgres",
    query: async (sql, params) => ({ rows: (await pool.query(sql, params)).rows }),
    exec: async (sql) => void (await pool.query(sql)),
    close: () => pool.end(),
  };
}

/** Apply all migrations in order. Each is idempotent (create ... if not exists), so this is safe on every start. */
async function runMigrations(exec: (sql: string) => Promise<void>) {
  const dir = path.join(repoRoot, "supabase", "migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) await exec(readFileSync(path.join(dir, f), "utf8"));
}

export async function audit(
  db: Db,
  a: { actor: string; action: string; entity: string; entity_id: string; detail?: unknown; reason?: string },
) {
  await db.query(
    "insert into audit_log (actor, action, entity, entity_id, detail, reason) values ($1,$2,$3,$4,$5,$6)",
    [a.actor, a.action, a.entity, a.entity_id, JSON.stringify(a.detail ?? {}), a.reason ?? null],
  );
}
