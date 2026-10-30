// Automatic indicators: fetches Nifty 50 / India VIX daily candles, the Nifty put-call ratio and the advance / decline
// count of the Nifty 50 stocks from Angel One,
// works out each automatic indicator's previous-close and current value, scores the change (+1 / 0 / -1, see
// src/shared/indicators.ts) and writes the score to the indicator's signal value. Runs every 15 minutes during
// market hours, once more after the close, and on demand from the admin panel.
import type pg from "pg";
import { indicatorById, indicatorSeries, scoreChange, type Candles, type IndicatorSource } from "../shared/indicators.js";
import { getPublicSentiment } from "./alerts.js";
import { AngelOneError, INDIA_VIX_TOKEN, NIFTY_TOKEN, createAngelOneClient, istDay, type AngelCredentials, type AngelOneClient, type DailyClose, type Quote } from "./angelone.js";
import { readAngelCredentials } from "./settings.js";

export interface RefreshResult {
  ok: boolean;
  /** Indicators that got fresh values */
  updated: number;
  /** One line for the admin panel */
  message: string;
  at: string;
}

export interface IndicatorService {
  /** Fetch and score every automatic indicator now. */
  refresh(): Promise<RefreshResult>;
  /** Log in and read the Nifty 50 price, to check the saved details. */
  test(): Promise<string>;
  /** The last refresh (since the server started), if any. */
  lastResult(): RefreshResult | null;
  /** Start the market-hours schedule (the server does this; tests don't). */
  start(): void;
  stop(): void;
}

/** Calendar days of daily candles to load: enough trading days for MACD (26 + 9) and RSI to settle. */
const HISTORY_DAYS = 400;
const EVERY_MS = 15 * 60_000;

interface AutoRow {
  id: string;
  indicator: string;
  threshold: string;
  higher_is_bullish: boolean;
  signal_value: number | string;
}

/** Daily candles with today's live price as the latest close (added, or replacing today's partial candle). Today's
 * high and low are widened to include the live price. */
export function withLive(closes: DailyClose[], live: { ltp: number; day: string | null; high?: number; low?: number } | undefined): DailyClose[] {
  const out = closes.map((c) => ({ ...c }));
  if (!live?.day) return out;
  const last = out[out.length - 1];
  const high = Math.max(live.ltp, live.high ?? live.ltp, last?.day === live.day ? (last.high ?? live.ltp) : live.ltp);
  const low = Math.min(live.ltp, live.low ?? live.ltp, last?.day === live.day ? (last.low ?? live.ltp) : live.ltp);
  if (last && last.day === live.day) Object.assign(last, { close: live.ltp, high, low });
  else if (!last || live.day > last.day) out.push({ day: live.day, close: live.ltp, high, low });
  return out;
}

/** The last two finite values of a series with their days: [previous close, current]. */
export function lastTwo(days: string[], values: number[]): { prev: number; prevDay: string; current: number; currentDay: string } | null {
  const idx: number[] = [];
  for (let i = values.length - 1; i >= 0 && idx.length < 2; i--) if (Number.isFinite(values[i]!)) idx.push(i);
  if (idx.length < 2) return null;
  const [c, p] = idx as [number, number];
  return { prev: values[p]!, prevDay: days[p]!, current: values[c]!, currentDay: days[c]! };
}

const round4 = (v: number) => Math.round(v * 10_000) / 10_000;

/** Advancing minus declining stocks: each stock's price against its previous close. */
export function netAdvances(pairs: ReadonlyArray<readonly [prev: number, current: number]>): number {
  let net = 0;
  for (const [prev, current] of pairs) net += Math.sign(Math.round((current - prev) * 100));
  return net;
}

export interface RefreshOptions {
  /** Gap between the per-stock candle requests when filling in a missed day (Angel One allows about 3 a second). */
  pacingMs?: number;
}

const storeSeries = (pool: pg.Pool, series: string, day: string, value: number) =>
  pool.query(
    `INSERT INTO market_series_daily (series, day, value) VALUES ($1, $2, $3)
     ON CONFLICT (series, day) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [series, day, round4(value)]
  );

const lastTwoStored = async (pool: pg.Pool, series: string, day: string) => {
  const { rows } = await pool.query<{ day: string; value: string }>(
    "SELECT to_char(day, 'YYYY-MM-DD') AS day, value FROM market_series_daily WHERE series = $1 AND day <= $2 ORDER BY day DESC LIMIT 2",
    [series, day]
  );
  const h = rows.reverse();
  return { days: h.map((r) => r.day), closes: h.map((r) => Number(r.value)) };
};

/** Today's advance / decline of the Nifty 50 (stored per day), and the previous trading day's, which is worked out
 * once from the stocks' daily candles when it isn't stored yet. */
async function loadBreadth(pool: pg.Pool, client: AngelOneClient, now: Date, tradingDays: string[], pacingMs: number) {
  const stocks = (await client.nifty50()).slice(0, 50);
  const quotes = (await client.quotes(stocks.map((s) => s.token))).filter((q): q is Quote & { prevClose: number } => Boolean(q.prevClose));
  if (quotes.length < 40) throw new AngelOneError(`Angel One returned prices for only ${quotes.length} of the Nifty 50 stocks.`);
  const dayCount = new Map<string, number>();
  for (const q of quotes) if (q.day) dayCount.set(q.day, (dayCount.get(q.day) ?? 0) + 1);
  const day = [...dayCount].sort((a, b) => b[1] - a[1])[0]?.[0] ?? istDay(now);
  await storeSeries(pool, "advdec", day, netAdvances(quotes.map((q) => [q.prevClose, q.ltp] as const)));

  const prevDay = [...tradingDays].reverse().find((d) => d < day);
  if (prevDay) {
    const have = await pool.query("SELECT 1 FROM market_series_daily WHERE series = 'advdec' AND day = $1", [prevDay]);
    if (!have.rowCount) {
      const pairs: Array<readonly [number, number]> = [];
      for (const [i, stock] of stocks.entries()) {
        if (i > 0 && pacingMs > 0) await new Promise((r) => setTimeout(r, pacingMs));
        try {
          const candles: DailyClose[] = (await client.dailyCloses(stock.token, 15)).filter((c) => c.day <= prevDay);
          const [before, last] = candles.slice(-2);
          if (before && last?.day === prevDay) pairs.push([before.close, last.close]);
        } catch {
          /* skip this stock */
        }
      }
      if (pairs.length >= 40) await storeSeries(pool, "advdec", prevDay, netAdvances(pairs));
    }
  }
  return lastTwoStored(pool, "advdec", day);
}

export async function refreshAutoIndicators(pool: pg.Pool, client: AngelOneClient, now = new Date(), options: RefreshOptions = {}): Promise<RefreshResult> {
  const at = now.toISOString();
  const { rows } = await pool.query<AutoRow>(
    "SELECT id, indicator, threshold, higher_is_bullish, signal_value FROM nifty_alerts WHERE indicator IS NOT NULL ORDER BY display_order, id"
  );
  if (!rows.length) return { ok: true, updated: 0, message: "No indicators are set to automatic.", at };

  const sources = new Set(rows.map((r) => indicatorById(r.indicator)?.source).filter((s): s is IndicatorSource => Boolean(s)));
  const data: Partial<Record<IndicatorSource, ({ days: string[] } & Candles & { closes: number[] }) | Error>> = {};

  // live prices (one call for both indices)
  let live: Map<string, Quote> = new Map();
  if (sources.size > 0) {
    try {
      live = new Map((await client.quotes([NIFTY_TOKEN, INDIA_VIX_TOKEN])).map((q) => [q.token, q]));
    } catch {
      /* fall back to daily candles only */
    }
  }
  for (const [source, token] of [
    ["nifty", NIFTY_TOKEN],
    ["vix", INDIA_VIX_TOKEN],
  ] as const) {
    // advance / decline uses the Nifty 50 trading days to find the previous session
    if (!sources.has(source) && !(source === "nifty" && sources.has("breadth"))) continue;
    try {
      const series = withLive(await client.dailyCloses(token, HISTORY_DAYS), live.get(token));
      data[source] = {
        days: series.map((c) => c.day),
        closes: series.map((c) => c.close),
        highs: series.map((c) => c.high ?? c.close),
        lows: series.map((c) => c.low ?? c.close),
      };
    } catch (err) {
      data[source] = err as Error;
    }
  }
  if (sources.has("pcr")) {
    try {
      const pcr = await client.niftyPcr();
      // the PCR is only "now": keep one value per trading day so today can be compared with the day before
      const day = live.get(NIFTY_TOKEN)?.day ?? istDay(now);
      await storeSeries(pool, "pcr", day, pcr);
      data.pcr = await lastTwoStored(pool, "pcr", day);
    } catch (err) {
      data.pcr = err as Error;
    }
  }
  if (sources.has("breadth")) {
    try {
      const nifty = data.nifty;
      data.breadth = await loadBreadth(pool, client, now, nifty && !(nifty instanceof Error) ? nifty.days : [], options.pacingMs ?? 350);
    } catch (err) {
      data.breadth = err as Error;
    }
  }

  let updated = 0;
  let changed = false;
  const problems: string[] = [];
  for (const r of rows) {
    const def = indicatorById(r.indicator);
    let error: string | null = null;
    let pair: ReturnType<typeof lastTwo> = null;
    if (!def) error = `Unknown indicator "${r.indicator}"`;
    else if (def.available === false) error = "Coming soon: this indicator isn't connected yet";
    else {
      const src = data[def.source];
      if (!src) error = "No data";
      else if (src instanceof Error) error = src.message;
      else {
        const stored = def.source === "pcr" || def.source === "breadth";
        const series = stored ? src.closes : indicatorSeries(def.id, src);
        pair = lastTwo(src.days, series);
        if (!pair)
          error =
            def.source === "pcr"
              ? "Waiting for a second trading day of put-call ratio data"
              : def.source === "breadth"
                ? "Waiting for the previous trading day's advance / decline"
                : "Not enough price history yet";
      }
    }
    if (error || !pair) {
      problems.push(`${def?.label ?? r.indicator}: ${error}`);
      await pool.query("UPDATE nifty_alerts SET auto_error = $2 WHERE id = $1", [r.id, (error ?? "No data").slice(0, 300)]);
      continue;
    }
    const score = scoreChange(round4(pair.prev), round4(pair.current), Number(r.threshold), r.higher_is_bullish);
    if (Number(r.signal_value) !== score) changed = true;
    await pool.query(
      `UPDATE nifty_alerts SET prev_value = $2, prev_day = $3, current_value = $4, current_day = $5, signal_value = $6,
         auto_updated_at = $7, auto_error = NULL
       WHERE id = $1`,
      [r.id, round4(pair.prev), pair.prevDay, round4(pair.current), pair.currentDay, score, now]
    );
    updated += 1;
  }
  if (updated > 0) {
    await pool.query("UPDATE app_state SET updated_at = now() WHERE key = 'nifty_alerts'");
    // keep today's point on the sentiment trend chart current even when nobody is visiting
    await getPublicSentiment(pool).catch(() => undefined);
  }
  const ok = problems.length === 0;
  const message = ok
    ? `Updated ${updated} indicator${updated === 1 ? "" : "s"}${changed ? "" : " (no score changed)"}.`
    : `Updated ${updated} of ${rows.length}. ${problems.slice(0, 3).join(" · ")}`;
  return { ok, updated, message: message.slice(0, 500), at };
}

/** Minutes since midnight and weekday (0 = Sunday) in IST. */
function istClock(d: Date): { minutes: number; weekday: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false })
      .formatToParts(d)
      .map((x) => [x.type, x.value])
  );
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday ?? "");
  return { minutes: (Number(p.hour) % 24) * 60 + Number(p.minute), weekday };
}

export function createIndicatorService(
  pool: pg.Pool,
  secret: string,
  makeClient: (creds: AngelCredentials) => AngelOneClient = (creds) => createAngelOneClient(creds)
): IndicatorService {
  let cached: { key: string; client: AngelOneClient } | null = null;
  let last: RefreshResult | null = null;
  let running: Promise<RefreshResult> | null = null;
  let timer: NodeJS.Timeout | null = null;
  let lastRunAt = 0;
  let finalDoneDay = "";

  const clientFor = (creds: AngelCredentials) => {
    const key = [creds.apiKey, creds.clientCode, creds.pin, creds.totpSecret].join("|");
    if (cached?.key !== key) cached = { key, client: makeClient(creds) };
    return cached.client;
  };

  const run = async (): Promise<RefreshResult> => {
    const creds = await readAngelCredentials(pool, secret);
    if (!creds.ok) return { ok: false, updated: 0, message: creds.reason, at: new Date().toISOString() };
    try {
      return await refreshAutoIndicators(pool, clientFor(creds.creds));
    } catch (err) {
      const message = err instanceof AngelOneError ? `Angel One: ${err.message}${err.code ? ` (${err.code})` : ""}` : (err as Error).message;
      return { ok: false, updated: 0, message: message.slice(0, 500), at: new Date().toISOString() };
    }
  };

  const service: IndicatorService = {
    refresh() {
      // one refresh at a time; a second request gets the same result
      running ??= run()
        .then((r) => (last = r))
        .finally(() => {
          running = null;
          lastRunAt = Date.now();
        });
      return running;
    },
    async test() {
      const creds = await readAngelCredentials(pool, secret);
      if (!creds.ok) throw new Error(creds.reason);
      const quotes = await clientFor(creds.creds).quotes([NIFTY_TOKEN]);
      const nifty = quotes.find((q) => q.token === NIFTY_TOKEN);
      if (!nifty) throw new Error("Logged in, but Angel One returned no Nifty 50 price.");
      return `Connected to Angel One. Nifty 50 is at ${nifty.ltp.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`;
    },
    lastResult: () => last,
    start() {
      if (timer) return;
      const tick = async () => {
        try {
          const creds = await readAngelCredentials(pool, secret);
          if (!creds.ok || !creds.enabled) return;
          const now = new Date();
          const { minutes, weekday } = istClock(now);
          const tradingDay = weekday >= 1 && weekday <= 5;
          const inSession = tradingDay && minutes >= 9 * 60 + 15 && minutes <= 15 * 60 + 35;
          const afterClose = tradingDay && minutes >= 15 * 60 + 40;
          const today = istDay(now);
          if (lastRunAt === 0 || (inSession && Date.now() - lastRunAt >= EVERY_MS) || (afterClose && finalDoneDay !== today)) {
            if (afterClose) finalDoneDay = today;
            const r = await service.refresh();
            if (!r.ok) console.error("automatic indicators:", r.message);
          }
        } catch (err) {
          console.error("automatic indicators:", (err as Error).message);
        }
      };
      setTimeout(() => void tick(), 5_000).unref();
      timer = setInterval(() => void tick(), 60_000);
      timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
  return service;
}
