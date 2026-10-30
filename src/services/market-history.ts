// Price history for the homepage index chart (Today / 1 week / 1 month / 1 year) of the six indices in the
// header strip. Source: Yahoo Finance chart API, like the header quotes. Each index + range is cached on the
// server, so visitors switching charts never hit Yahoo directly.
// Yahoo has no daily bars for BANKEX (BSE-BANK.BO), only intraday ones: when a daily series comes back almost
// empty, the hourly series is fetched instead and reduced to one close per trading day.
import { INDICES, type IndexDef } from "./market-quotes.js";

export type HistoryRange = "1d" | "1w" | "1m" | "1y";
export const HISTORY_RANGES: readonly HistoryRange[] = ["1d", "1w", "1m", "1y"];

const RANGE_QUERY: Record<HistoryRange, { range: string; interval: string; daily: boolean; cacheMs: number }> = {
  "1d": { range: "1d", interval: "5m", daily: false, cacheMs: 60_000 },
  "1w": { range: "5d", interval: "30m", daily: false, cacheMs: 5 * 60_000 },
  "1m": { range: "1mo", interval: "1d", daily: true, cacheMs: 30 * 60_000 },
  "1y": { range: "1y", interval: "1d", daily: true, cacheMs: 60 * 60_000 },
};

export interface IndexHistory {
  id: string;
  label: string;
  exchange: "NSE" | "BSE";
  range: HistoryRange;
  /** [unix seconds, close], oldest first */
  points: Array<[number, number]>;
  /** Latest price */
  price: number;
  /** What the change is measured from: the previous close for "1d", otherwise the first point of the range */
  baseline: number;
  change: number;
  changePercent: number;
  direction: "up" | "down" | "flat";
  marketOpen: boolean;
  fetchedAt: string;
}

export interface MarketHistory {
  /** Null when the data can't be loaded (and nothing is cached). */
  get(id: string, range: HistoryRange): Promise<IndexHistory | null>;
}

type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

interface ChartResponse {
  chart?: {
    result?: Array<{
      meta: {
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        currentTradingPeriod?: { regular?: { start: number; end: number } };
      };
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
  };
}

const IST_OFFSET_S = 5.5 * 60 * 60;
const istDay = (unixSeconds: number) => new Date((unixSeconds + IST_OFFSET_S) * 1000).toISOString().slice(0, 10);
const round2 = (n: number) => Math.round(n * 100) / 100;
const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Keeps the last point of each IST trading day (turns an hourly series into a daily one). Exported for tests. */
export function lastPerDay(points: Array<[number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const point of points) {
    const prev = out[out.length - 1];
    if (prev && istDay(prev[0]) === istDay(point[0])) out[out.length - 1] = point;
    else out.push(point);
  }
  return out;
}

/**
 * Turns one Yahoo chart response into a history. `previousClose` (from the header quotes, which work it out
 * from the daily bars) overrides Yahoo's own figure for the "1d" baseline. Exported for tests.
 */
export function parseHistory(
  def: IndexDef,
  range: HistoryRange,
  body: unknown,
  opts: { nowSeconds: number; previousClose?: number; daily?: boolean }
): IndexHistory | null {
  const result = (body as ChartResponse)?.chart?.result?.[0];
  if (!result?.meta) return null;
  const stamps = result.timestamp ?? [];
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  let points: Array<[number, number]> = [];
  stamps.forEach((t, i) => {
    const c = closes[i];
    if (isNum(t) && isNum(c)) points.push([t, round2(c)]);
  });
  if (opts.daily) points = lastPerDay(points);
  if (points.length < 2) return null;

  const price = isNum(result.meta.regularMarketPrice) ? round2(result.meta.regularMarketPrice) : points[points.length - 1]![1];
  const baseline =
    range === "1d"
      ? isNum(opts.previousClose) && opts.previousClose > 0
        ? opts.previousClose
        : isNum(result.meta.chartPreviousClose)
          ? result.meta.chartPreviousClose
          : points[0]![1]
      : points[0]![1];
  if (!(baseline > 0)) return null;
  const change = round2(price - baseline);
  const period = result.meta.currentTradingPeriod?.regular;
  return {
    id: def.id,
    label: def.label,
    exchange: def.exchange,
    range,
    points,
    price,
    baseline: round2(baseline),
    change,
    changePercent: round2((change / baseline) * 100),
    direction: change > 0 ? "up" : change < 0 ? "down" : "flat",
    marketOpen: Boolean(period && opts.nowSeconds >= period.start && opts.nowSeconds < period.end),
    fetchedAt: new Date(opts.nowSeconds * 1000).toISOString(),
  };
}

export function createYahooMarketHistory(
  options: { fetchImpl?: FetchLike; now?: () => number; previousClose?: (id: string) => Promise<number | undefined> } = {}
): MarketHistory {
  const fetchImpl: FetchLike = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const now = options.now ?? Date.now;
  const cache = new Map<string, { at: number; data: IndexHistory }>();
  const inFlight = new Map<string, Promise<IndexHistory | null>>();

  async function fetchChart(symbol: string, range: string, interval: string): Promise<unknown> {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
    const res = await fetchImpl(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Market360X/1.0)", Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`${symbol} ${range}: HTTP ${res.status}`);
    return res.json();
  }

  async function load(def: IndexDef, range: HistoryRange): Promise<IndexHistory | null> {
    const q = RANGE_QUERY[range];
    const previousClose = range === "1d" ? await options.previousClose?.(def.id).catch(() => undefined) : undefined;
    const opts = { nowSeconds: Math.floor(now() / 1000), previousClose };
    const parsed = parseHistory(def, range, await fetchChart(def.symbol, q.range, q.interval), opts);
    if (parsed || !q.daily) return parsed;
    // no daily bars (BANKEX): build the days from hourly bars
    return parseHistory(def, range, await fetchChart(def.symbol, q.range, "60m"), { ...opts, daily: true });
  }

  return {
    async get(id, range) {
      const def = INDICES.find((d) => d.id === id);
      if (!def || !RANGE_QUERY[range]) return null;
      const key = `${id}:${range}`;
      const hit = cache.get(key);
      if (hit && now() - hit.at < RANGE_QUERY[range].cacheMs) return hit.data;
      let pending = inFlight.get(key);
      if (!pending) {
        pending = load(def, range)
          .then((data) => {
            if (data) cache.set(key, { at: now(), data });
            return data ?? hit?.data ?? null;
          })
          .catch((err) => {
            console.error("market history failed:", (err as Error).message);
            return hit?.data ?? null; // keep showing the last good chart
          })
          .finally(() => inFlight.delete(key));
        inFlight.set(key, pending);
      }
      return pending;
    },
  };
}

/** Used in tests: never makes network calls. */
export const disabledMarketHistory: MarketHistory = { get: async () => null };
