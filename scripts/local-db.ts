// Local PostgreSQL for development, without installing Postgres (uses the embedded-postgres package).
// Usage: npm run db:local   (keep it running; press Ctrl+C to stop). Data is kept in ./.local-pg
import fs from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

const PORT = Number(process.env.LOCAL_PG_PORT ?? 54329);
const DATA_DIR = path.resolve(process.cwd(), ".local-pg");
const DB_NAME = "market360x";

const db = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: "postgres",
  password: "postgres",
  port: PORT,
  persistent: true,
});

if (!fs.existsSync(path.join(DATA_DIR, "PG_VERSION"))) await db.initialise();
await db.start();

const client = new pg.Client({ host: "localhost", port: PORT, user: "postgres", password: "postgres", database: "postgres" });
await client.connect();
const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [DB_NAME]);
if (exists.rowCount === 0) await client.query(`CREATE DATABASE ${DB_NAME}`);
await client.end();

console.log(`\nLocal PostgreSQL is running.\nDATABASE_URL=postgres://postgres:postgres@localhost:${PORT}/${DB_NAME}\nPress Ctrl+C to stop.\n`);

async function stop(): Promise<void> {
  await db.stop();
  process.exit(0);
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
