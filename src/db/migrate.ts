import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type pg from "pg";

const MIGRATIONS_DIR = path.resolve(process.cwd(), "migrations");

/** Apply every migrations/*.sql file that has not run yet, each in its own transaction. */
export async function runMigrations(pool: pg.Pool, log: (msg: string) => void = console.log): Promise<string[]> {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name       TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const done = new Set((await pool.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
  const files = (await fs.readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];

  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      applied.push(file);
      log(`applied ${file}`);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
  if (applied.length === 0) log("database is up to date");
  return applied;
}

// CLI: `npm run migrate`
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { loadConfig } = await import("../config.js");
  const { createPool } = await import("./pool.js");
  const config = loadConfig();
  const pool = createPool(config.DATABASE_URL, config.DATABASE_SSL);
  try {
    await runMigrations(pool);
  } finally {
    await pool.end();
  }
}
