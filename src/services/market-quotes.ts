// Indian index quotes for the header ticker strip.
// Source: Yahoo Finance chart API (no key needed). The change is computed from the previous day's daily close,
// because the "previousClose" Yahoo reports for some indices (NIFTY, SENSEX, BANKNIFTY) can be a day old.
// Checked against NSE's official figures for NIFTY, BANKNIFTY, FINNIFTY and MIDCPNIFTY on 2026-10-16.

export interface IndexDef {
  id: string;
  label: string;
  symbol: string;
  exchange: "NSE" | "BSE";
}

export const INDICES: readonly IndexDef[] = [
  { id: "nifty", label: "NIFTY", symbol: "^NSEI", exchange: "NSE" },
  { id: "sensex", label: "SENSEX", symbol: "^BSESN", exchange: "BSE" },
  { id: "banknifty", label: "BANKNIFTY", symbol: "^NSEBANK", exchange: "NSE" },
  { id: "finnifty", label: "FINNIFTY", symbol: "NIFTY_FIN_SERVICE.NS", exchange: "NSE" },
  { id: "bankex", label: "BANKEX", symbol: "BSE-BANK.BO", exchange: "BSE" },
  { id: "midcpnifty", label: "MIDCPNIFTY", symbol: "NIFTY_MID_SELECT.NS", exchange: "NSE" },
];

export interface IndexQuote {
  id: string;
  label: string;
  exchange: "NSE" | "BSE";
  price: number;
  change: number;
  changePercent: number;
  direction: "up" | "down" | "flat";
  /** ISO time of the last trade */
  time: string;
}

export interface IndexQuotes {
  indices: IndexQuote[];
  marketOpen: boolean;
  /** When these numbers were fetched (ISO) */
  fetchedAt: string;
  /** True when the latest refresh failed and older numbers are being shown */
  stale: boolean;
  source: string;
}

export interface MarketQuotes {
  /** Fresh-enough quotes (refreshes when older than the cache time). Null if nothing could be loaded yet. */
  get(): Promise<IndexQuotes | null>;
  /** Whatever is cached right now, without waiting; starts a background refresh when it's old. */
  peek(): IndexQuotes | null;
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
        regularMarketTime?: number;
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

/** Turns one Yahoo chart response into a quote. Exported for tests. */
export function parseChart(def: IndexDef, body: unknown, nowSeconds: number): { quote: IndexQuote; open: boolean } | null {
  const result = (body as ChartResponse)?.chart?.result?.[0];
  const meta = result?.meta;
  const price = meta?.regularMarketPrice;
  const time = meta?.regularMarketTime;
  if (!meta || typeof price !== "number" || !Number.isFinite(price) || typeof time !== "number") return null;

  // Previous close = close of the latest daily bar dated before the last trade's day (IST).
  const today = istDay(time);
  const stamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  let prev: number | undefined;
  for (let i = stamps.length - 1; i >= 0; i--) {
    const close = closes[i];
    if (istDay(stamps[i]!) < today && typeof close === "number" && Number.isFinite(close)) {
      prev = close;
      break;
    }
  }
  prev ??= meta.chartPreviousClose;
  if (typeof prev !== "number" || !Number.isFinite(prev) || prev <= 0) return null;

  const change = round2(price - prev);
  const changePercent = round2((change / prev) * 100);
  const period = meta.currentTradingPeriod?.regular;
  return {
    quote: {
      id: def.id,
      label: def.label,
      exchange: def.exchange,
      price: round2(price),
      change,
      changePercent,
      direction: change > 0 ? "up" : change < 0 ? "down" : "flat",
      time: new Date(time * 1000).toISOString(),
    },
    open: Boolean(period && nowSeconds >= period.start && nowSeconds < period.end),
  };
}

export function createYahooMarketQuotes(options: { fetchImpl?: FetchLike; cacheMs?: number; now?: () => number } = {}): MarketQuotes {
  const fetchImpl: FetchLike = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const cacheMs = options.cacheMs ?? 60_000;
  const now = options.now ?? Date.now;

  let cache: IndexQuotes | null = null;
  let cachedAt = 0;
  let inFlight: Promise<IndexQuotes | null> | null = null;
  let retryAt = 0; // after a failed refresh, wait a little before trying again

  async function fetchOne(def: IndexDef) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(def.symbol)}?range=5d&interval=1d`;
    const res = await fetchImpl(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Market360X/1.0)", Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`${def.symbol}: HTTP ${res.status}`);
    return parseChart(def, await res.json(), Math.floor(now() / 1000));
  }

  async function refresh(): Promise<IndexQuotes | null> {
    const results = await Promise.allSettled(INDICES.map(fetchOne));
    const previous = new Map((cache?.indices ?? []).map((q) => [q.id, q]));
    const indices: IndexQuote[] = [];
    let open = false;
    let failures = 0;
    results.forEach((r, i) => {
      const parsed = r.status === "fulfilled" ? r.value : null;
      if (parsed) {
        indices.push(parsed.quote);
        open ||= parsed.open;
      } else {
        failures++;
        if (r.status === "rejected") console.error("market quote failed:", (r.reason as Error).message);
        const old = previous.get(INDICES[i]!.id); // keep the last good number for this index
        if (old) indices.push(old);
      }
    });
    if (!indices.length) {
      retryAt = now() + 15_000;
      if (cache) cache = { ...cache, stale: true };
      return cache;
    }
    cache = { indices, marketOpen: open, fetchedAt: new Date(now()).toISOString(), stale: failures > 0, source: "Yahoo Finance" };
    cachedAt = now();
    return cache;
  }

  function start(): Promise<IndexQuotes | null> {
    if (!inFlight && now() < retryAt) return Promise.resolve(cache);
    inFlight ??= refresh()
      .catch((err) => {
        console.error("market quotes refresh failed:", (err as Error).message);
        retryAt = now() + 15_000;
        return cache;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  const isFresh = () => cache !== null && now() - cachedAt < cacheMs;

  return {
    get: () => (isFresh() ? Promise.resolve(cache) : start()),
    peek() {
      if (!isFresh()) void start();
      return cache;
    },
  };
}

/** Used in tests and when market data is switched off: never makes network calls. */
export const disabledMarketQuotes: MarketQuotes = { get: async () => null, peek: () => null };
