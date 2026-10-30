import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPool } from "./db/pool.js";
import type { IndicatorService } from "./services/auto-indicators.js";

const config = loadConfig();
const pool = createPool(config.DATABASE_URL, config.DATABASE_SSL);

// Fail fast with a clear message if the database is unreachable or not migrated.
try {
  await pool.query("SELECT 1 FROM nifty_alerts LIMIT 1");
} catch (err) {
  console.error(`Database check failed: ${(err as Error).message}\nIs DATABASE_URL correct, and have you run "npm run migrate"?`);
  process.exit(1);
}

const app = createApp(config, pool);
// automatic indicators: every 15 minutes in market hours once Angel One is set up in Admin > Settings
(app.locals.indicators as IndicatorService).start();
const server = app.listen(config.PORT, () => {
  console.log(`Market360X running on http://localhost:${config.PORT} (${config.NODE_ENV})`);
});

function shutdown(signal: string): void {
  console.log(`${signal} received, shutting down`);
  (app.locals.indicators as IndicatorService).stop();
  server.close(() => {
    void pool.end().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
