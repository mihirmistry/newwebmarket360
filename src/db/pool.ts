import pg from "pg";

// NUMERIC comes back as a string by default; signal values are small, so parse them as numbers.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value: string) => Number.parseFloat(value));

export function createPool(connectionString: string, ssl: boolean): pg.Pool {
  let cleanUrl = connectionString;
  try {
    const u = new URL(connectionString);
    if (ssl && u.searchParams.has("sslmode")) {
      u.searchParams.delete("sslmode");
      cleanUrl = u.toString();
    }
  } catch {
    // keep raw connection string if URL parsing fails
  }

  return new pg.Pool({
    connectionString: cleanUrl,
    ssl: ssl ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
}

/** Run `fn` inside a transaction, rolling back on any error. */
export async function withTransaction<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
