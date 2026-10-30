import type pg from "pg";
import { z } from "zod";
import { withTransaction } from "../db/pool.js";
import {
  DESCRIPTION_MAX_LENGTH,
  MAX_ALERTS,
  NAME_MAX_LENGTH,
  SIGNAL_MAX,
  SIGNAL_MIN,
  hasAtMostTwoDecimals,
} from "../shared/alert-limits.js";
import { INDICATOR_IDS } from "../shared/indicators.js";
import { calculateSentiment, countAlerts, directionOf, type AlertCounts, type SentimentResult, type SignalDirection } from "../shared/sentiment.js";

export interface AdminAlert {
  id: number;
  name: string;
  description: string;
  signalValue: number;
  enabled: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
  /** Built-in indicator calculated from Angel One data (src/shared/indicators.ts); null = value entered by hand */
  indicator: string | null;
  higherIsBullish: boolean;
  /** Changes this small or smaller score 0 */
  threshold: number;
  prevValue: number | null;
  prevDay: string | null;
  currentValue: number | null;
  currentDay: string | null;
  autoUpdatedAt: string | null;
  autoError: string | null;
}

export interface PublicAlert {
  name: string;
  description: string;
  signalValue: number;
  direction: SignalDirection;
  status: "Active";
}

export interface PublicSentiment {
  sentiment: Omit<SentimentResult, "percentExact">;
  counts: AlertCounts;
  alerts: PublicAlert[];
  /** When the alert configuration last changed (ISO 8601) */
  updatedAt: string;
  /** Overall sentiment per IST day, oldest first (up to HISTORY_DAYS, today included) */
  history: SentimentDay[];
}

export interface SentimentDay {
  /** YYYY-MM-DD (IST) */
  day: string;
  percent: number;
  label: "Bullish" | "Bearish" | "Neutral";
}

export const HISTORY_DAYS = 8;

/**
 * Records today's (IST) sentiment, writing only when it changed, and returns the recent daily history.
 * Never fails the page: without the history table it just returns today's point.
 */
async function recordAndLoadHistory(db: Queryable, s: Omit<SentimentResult, "percentExact">, c: AlertCounts): Promise<SentimentDay[]> {
  const today: SentimentDay = { day: istDay(new Date()), percent: s.percent, label: s.label };
  try {
    await db.query(
      `INSERT INTO nifty_sentiment_daily (day, percent, label, bullish, bearish, neutral)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (day) DO UPDATE SET percent = EXCLUDED.percent, label = EXCLUDED.label, bullish = EXCLUDED.bullish,
         bearish = EXCLUDED.bearish, neutral = EXCLUDED.neutral, updated_at = now()
       WHERE (nifty_sentiment_daily.percent, nifty_sentiment_daily.label, nifty_sentiment_daily.bullish,
              nifty_sentiment_daily.bearish, nifty_sentiment_daily.neutral)
         IS DISTINCT FROM (EXCLUDED.percent, EXCLUDED.label, EXCLUDED.bullish, EXCLUDED.bearish, EXCLUDED.neutral)`,
      [today.day, s.percent, s.label, c.bullish, c.bearish, c.neutral]
    );
    const { rows } = await db.query<{ day: string; percent: string; label: SentimentDay["label"] }>(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, percent, label FROM nifty_sentiment_daily ORDER BY day DESC LIMIT $1`,
      [HISTORY_DAYS]
    );
    return rows.reverse().map((r) => ({ day: r.day, percent: Number(r.percent), label: r.label }));
  } catch {
    return [today];
  }
}

/** YYYY-MM-DD in India Standard Time. */
function istDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

// ---------- validation ----------
const signalValue = z
  .number({ invalid_type_error: "Signal value must be a number" })
  .finite("Signal value must be a number")
  .min(SIGNAL_MIN, `Signal value must be between ${SIGNAL_MIN} and ${SIGNAL_MAX}`)
  .max(SIGNAL_MAX, `Signal value must be between ${SIGNAL_MIN} and ${SIGNAL_MAX}`)
  .refine(hasAtMostTwoDecimals, "Signal value can have at most 2 decimal places");

export const alertInputSchema = z.object({
  name: z.string().trim().min(1, "Alert name is required").max(NAME_MAX_LENGTH, `Alert name must be ${NAME_MAX_LENGTH} characters or fewer`),
  description: z
    .string()
    .trim()
    .max(DESCRIPTION_MAX_LENGTH, `Description must be ${DESCRIPTION_MAX_LENGTH} characters or fewer`)
    .optional()
    .default(""),
  signalValue,
  enabled: z.boolean().optional().default(true),
  // automatic indicators: the signal value is calculated, so the one sent is ignored for them
  indicator: z.enum(INDICATOR_IDS, { errorMap: () => ({ message: "Choose an indicator from the list" }) }).nullable().optional().default(null),
  higherIsBullish: z.boolean().optional().default(true),
  threshold: z
    .number({ invalid_type_error: "Threshold must be a number" })
    .finite("Threshold must be a number")
    .min(0, "Threshold can't be negative")
    .max(100_000, "Threshold is too large")
    .optional()
    .default(0),
});
export type AlertInput = z.infer<typeof alertInputSchema>;

export const alertPatchSchema = alertInputSchema.partial().refine((v) => Object.keys(v).length > 0, "Nothing to update");

const id = z.number().int().positive();

export const bulkSaveSchema = z
  .object({
    alerts: z.array(alertInputSchema.extend({ id: id.optional() })).max(MAX_ALERTS, `You can save up to ${MAX_ALERTS} alerts`),
    deletedIds: z.array(id).max(MAX_ALERTS).optional().default([]),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<number>();
    value.alerts.forEach((a, i) => {
      if (a.id === undefined) return;
      if (seen.has(a.id)) ctx.addIssue({ code: "custom", path: ["alerts", i, "id"], message: "Duplicate alert id" });
      if (value.deletedIds.includes(a.id)) ctx.addIssue({ code: "custom", path: ["alerts", i, "id"], message: "Alert is both saved and deleted" });
      seen.add(a.id);
    });
  });
export type BulkSaveInput = z.infer<typeof bulkSaveSchema>;

export class NotFoundError extends Error {
  constructor(message = "Alert not found") {
    super(message);
  }
}

// ---------- queries ----------
interface AlertRow {
  id: string;
  name: string;
  description: string;
  signal_value: number;
  enabled: boolean;
  display_order: number;
  created_at: Date;
  updated_at: Date;
  indicator: string | null;
  higher_is_bullish: boolean;
  threshold: number;
  prev_value: number | null;
  prev_day: Date | null;
  current_value: number | null;
  current_day: Date | null;
  auto_updated_at: Date | null;
  auto_error: string | null;
}

/** pg returns DATE as local midnight; turn it back into YYYY-MM-DD. */
const dateOnly = (d: Date | null): string | null =>
  d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : null;

const toAdminAlert = (r: AlertRow): AdminAlert => ({
  id: Number(r.id),
  name: r.name,
  description: r.description,
  signalValue: r.signal_value,
  enabled: r.enabled,
  displayOrder: r.display_order,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
  indicator: r.indicator,
  higherIsBullish: r.higher_is_bullish,
  threshold: r.threshold,
  prevValue: r.prev_value,
  prevDay: dateOnly(r.prev_day),
  currentValue: r.current_value,
  currentDay: dateOnly(r.current_day),
  autoUpdatedAt: r.auto_updated_at ? r.auto_updated_at.toISOString() : null,
  autoError: r.auto_error,
});

/**
 * Re-score automatic indicators from their stored values (after the direction or threshold changed), with the
 * same rule as src/shared/indicators.ts scoreChange. Rows without values yet are left as they are.
 */
const rescoreAuto = (db: Queryable) =>
  db.query(
    `UPDATE nifty_alerts SET signal_value = CASE
       WHEN abs(round(current_value - prev_value, 4)) <= threshold THEN 0
       WHEN (current_value > prev_value) = higher_is_bullish THEN 1 ELSE -1 END
     WHERE indicator IS NOT NULL AND prev_value IS NOT NULL AND current_value IS NOT NULL`
  );

/** When a row's indicator changes, its old calculated values no longer apply. */
const indicatorChangedSql = "indicator IS DISTINCT FROM $7::varchar";

type Queryable = pg.Pool | pg.PoolClient;

const touchState = (db: Queryable) => db.query("UPDATE app_state SET updated_at = now() WHERE key = 'nifty_alerts'");

export async function listAllAlerts(db: Queryable): Promise<AdminAlert[]> {
  const { rows } = await db.query<AlertRow>("SELECT * FROM nifty_alerts ORDER BY display_order, id");
  return rows.map(toAdminAlert);
}

export async function getPublicSentiment(db: Queryable): Promise<PublicSentiment> {
  const [alertsRes, stateRes] = await Promise.all([
    db.query<Pick<AlertRow, "name" | "description" | "signal_value">>(
      "SELECT name, description, signal_value FROM nifty_alerts WHERE enabled ORDER BY display_order, id"
    ),
    db.query<{ updated_at: Date }>("SELECT updated_at FROM app_state WHERE key = 'nifty_alerts'"),
  ]);
  const values = alertsRes.rows.map((r) => r.signal_value);
  const { percentExact: _ignored, ...sentiment } = calculateSentiment(values);
  const counts = countAlerts(values);
  const history = await recordAndLoadHistory(db, sentiment, counts);
  return {
    sentiment,
    counts,
    history,
    alerts: alertsRes.rows.map((r) => ({
      name: r.name,
      description: r.description,
      signalValue: r.signal_value,
      direction: directionOf(r.signal_value),
      status: "Active" as const,
    })),
    updatedAt: (stateRes.rows[0]?.updated_at ?? new Date()).toISOString(),
  };
}

export async function createAlert(pool: pg.Pool, input: AlertInput): Promise<AdminAlert> {
  return withTransaction(pool, async (client) => {
    const count = await client.query<{ n: string }>("SELECT count(*) AS n FROM nifty_alerts");
    if (Number(count.rows[0]?.n ?? 0) >= MAX_ALERTS) throw new z.ZodError([{ code: "custom", path: [], message: `You can have up to ${MAX_ALERTS} alerts` }]);
    const { rows } = await client.query<AlertRow>(
      `INSERT INTO nifty_alerts (name, description, signal_value, enabled, display_order, indicator, higher_is_bullish, threshold)
       VALUES ($1, $2, $3, $4, COALESCE((SELECT max(display_order) FROM nifty_alerts), 0) + 1, $5, $6, $7)
       RETURNING *`,
      [input.name, input.description, input.indicator ? 0 : input.signalValue, input.enabled, input.indicator, input.higherIsBullish, input.threshold]
    );
    await touchState(client);
    return toAdminAlert(rows[0]!);
  });
}

export async function updateAlert(pool: pg.Pool, alertId: number, patch: Partial<AlertInput>): Promise<AdminAlert> {
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query<AlertRow>(
      `UPDATE nifty_alerts SET
         name         = COALESCE($2, name),
         description  = COALESCE($3, description),
         signal_value = CASE WHEN indicator IS NULL THEN COALESCE($4, signal_value) ELSE signal_value END,
         enabled      = COALESCE($5, enabled),
         higher_is_bullish = COALESCE($6, higher_is_bullish),
         threshold    = COALESCE($7, threshold),
         updated_at   = now()
       WHERE id = $1
       RETURNING *`,
      [alertId, patch.name ?? null, patch.description ?? null, patch.signalValue ?? null, patch.enabled ?? null, patch.higherIsBullish ?? null, patch.threshold ?? null]
    );
    if (!rows[0]) throw new NotFoundError();
    await rescoreAuto(client);
    await touchState(client);
    const fresh = await client.query<AlertRow>("SELECT * FROM nifty_alerts WHERE id = $1", [alertId]);
    return toAdminAlert(fresh.rows[0]!);
  });
}

export async function deleteAlert(pool: pg.Pool, alertId: number): Promise<void> {
  await withTransaction(pool, async (client) => {
    const res = await client.query("DELETE FROM nifty_alerts WHERE id = $1", [alertId]);
    if (res.rowCount === 0) throw new NotFoundError();
    await touchState(client);
  });
}

/**
 * Save the whole admin table in one transaction: delete removed rows, update existing rows,
 * insert new rows, and store the on-screen order. Any failure rolls everything back.
 */
export async function saveAllAlerts(pool: pg.Pool, input: BulkSaveInput): Promise<AdminAlert[]> {
  return withTransaction(pool, async (client) => {
    if (input.deletedIds.length > 0) {
      await client.query("DELETE FROM nifty_alerts WHERE id = ANY($1::bigint[])", [input.deletedIds]);
    }
    for (const [index, alert] of input.alerts.entries()) {
      const order = index + 1;
      if (alert.id !== undefined) {
        // automatic rows keep their calculated signal value; switching indicator clears the old values
        const res = await client.query(
          `UPDATE nifty_alerts
             SET name = $2::varchar, description = $3::varchar,
                 signal_value = CASE WHEN $7::varchar IS NULL THEN $4::numeric
                                     WHEN ${indicatorChangedSql} THEN 0 ELSE signal_value END,
                 enabled = $5::boolean, display_order = $6::int,
                 prev_value = CASE WHEN ${indicatorChangedSql} THEN NULL ELSE prev_value END,
                 prev_day = CASE WHEN ${indicatorChangedSql} THEN NULL ELSE prev_day END,
                 current_value = CASE WHEN ${indicatorChangedSql} THEN NULL ELSE current_value END,
                 current_day = CASE WHEN ${indicatorChangedSql} THEN NULL ELSE current_day END,
                 auto_updated_at = CASE WHEN ${indicatorChangedSql} THEN NULL ELSE auto_updated_at END,
                 auto_error = CASE WHEN ${indicatorChangedSql} THEN NULL ELSE auto_error END,
                 indicator = $7::varchar, higher_is_bullish = $8::boolean, threshold = $9::numeric,
                 updated_at = CASE
                   WHEN (name, description, enabled, display_order, indicator, higher_is_bullish, threshold)
                        IS DISTINCT FROM ($2::varchar, $3::varchar, $5::boolean, $6::int, $7::varchar, $8::boolean, $9::numeric)
                     OR ($7::varchar IS NULL AND signal_value IS DISTINCT FROM $4::numeric)
                   THEN now() ELSE updated_at END
           WHERE id = $1::bigint`,
          [alert.id, alert.name, alert.description, alert.signalValue, alert.enabled, order, alert.indicator, alert.higherIsBullish, alert.threshold]
        );
        if (res.rowCount === 0) throw new NotFoundError(`Alert ${alert.id} no longer exists. Reload the page and try again.`);
      } else {
        await client.query(
          `INSERT INTO nifty_alerts (name, description, signal_value, enabled, display_order, indicator, higher_is_bullish, threshold)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [alert.name, alert.description, alert.indicator ? 0 : alert.signalValue, alert.enabled, order, alert.indicator, alert.higherIsBullish, alert.threshold]
        );
      }
    }
    const total = await client.query<{ n: string }>("SELECT count(*) AS n FROM nifty_alerts");
    if (Number(total.rows[0]?.n ?? 0) > MAX_ALERTS) {
      throw new z.ZodError([{ code: "custom", path: [], message: `You can have up to ${MAX_ALERTS} alerts` }]);
    }
    await rescoreAuto(client);
    await touchState(client);
    return listAllAlerts(client);
  });
}
