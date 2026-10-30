import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { runMigrations } from "./db/migrate.js";
import { createPool } from "./db/pool.js";
import type { IndicatorService } from "./services/auto-indicators.js";

async function start(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.DATABASE_URL, config.DATABASE_SSL);

  // Automatically apply pending database migrations on startup.
  try {
    await runMigrations(pool);
  } catch (err) {
    console.error(`Database migration failed: ${(err as Error).message}\nIs DATABASE_URL correct?`);
    process.exit(1);
  }

  // Automatically configure initial admin user if ADMIN_EMAIL and ADMIN_PASSWORD are provided.
  if (config.ADMIN_EMAIL && config.ADMIN_PASSWORD) {
    try {
      const { upsertAdmin } = await import("./services/admins.js");
      await upsertAdmin(pool, config.ADMIN_EMAIL, config.ADMIN_PASSWORD);
      console.log(`Admin account verified/ensured for ${config.ADMIN_EMAIL}`);
    } catch (err) {
      console.warn(`Admin auto-setup warning: ${(err as Error).message}`);
    }
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
}

void start().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
