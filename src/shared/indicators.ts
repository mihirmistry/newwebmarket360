// Automatic indicators: the built-in list (shared by the admin editor and the server), the maths that turns daily
// closes into indicator values, and the one rule that scores every indicator.
//
// Rule: change = today's value - previous close. If |change| <= threshold the score is 0; otherwise +1 when the
// indicator moved in its bullish direction and -1 when it moved the other way. "Higher is bullish" is true for most
// indicators (RSI, MACD, price...) and false for fear gauges such as India VIX.

/** Where an indicator's numbers come from: Nifty 50 daily candles, India VIX daily candles, the put-call ratio, or
 * market breadth (advancing minus declining Nifty 50 stocks). */
export type IndicatorSource = "nifty" | "vix" | "pcr" | "breadth";

export interface IndicatorDef {
  id: string;
  label: string;
  source: IndicatorSource;
  /** Defaults for a new row; the admin can change both */
  higherIsBullish: boolean;
  threshold: number;
  /** What the threshold is measured in, for the admin hint */
  unit: string;
  /** false = listed in the admin as "coming soon" but can't be chosen yet */
  available?: boolean;
}

export const INDICATORS: readonly IndicatorDef[] = [
  { id: "rsi14", label: "RSI (14)", source: "nifty", higherIsBullish: true, threshold: 1, unit: "RSI points" },
  { id: "macd", label: "MACD histogram (12, 26, 9)", source: "nifty", higherIsBullish: true, threshold: 1, unit: "points" },
  { id: "ema20", label: "Trend: 20-day EMA", source: "nifty", higherIsBullish: true, threshold: 1, unit: "points" },
  { id: "roc10", label: "Momentum: 10-day rate of change", source: "nifty", higherIsBullish: true, threshold: 0.1, unit: "%" },
  { id: "close", label: "Nifty 50 close", source: "nifty", higherIsBullish: true, threshold: 10, unit: "points" },
  { id: "vix", label: "India VIX", source: "vix", higherIsBullish: false, threshold: 0.1, unit: "points" },
  { id: "pcr", label: "Put-call ratio (Nifty)", source: "pcr", higherIsBullish: true, threshold: 0.02, unit: "ratio" },
  // Supertrend's line jumps to the other side of the price when the trend flips, so the value compared is the
  // Nifty close minus the line: above 0 in an uptrend, below 0 in a downtrend, and a flip is a big change.
  { id: "supertrend", label: "Supertrend (10, 3)", source: "nifty", higherIsBullish: true, threshold: 10, unit: "points" },
  // advancing minus declining Nifty 50 stocks (-50 to +50), each stock's price against its previous close
  { id: "advdec", label: "Advance / decline (Nifty 50)", source: "breadth", higherIsBullish: true, threshold: 4, unit: "stocks" },
];

/** Indicators that can be chosen now (the admin form and the API accept only these). */
export const INDICATOR_IDS = INDICATORS.filter((d) => d.available !== false).map((d) => d.id) as [string, ...string[]];

export function indicatorById(id: string | null | undefined): IndicatorDef | undefined {
  return INDICATORS.find((d) => d.id === id);
}

/** The scoring rule. Values are compared at 4 decimal places so float noise never decides the sign. */
export function scoreChange(prev: number, current: number, threshold: number, higherIsBullish: boolean): -1 | 0 | 1 {
  const change = Math.round((current - prev) * 10_000) / 10_000;
  if (Math.abs(change) <= threshold || change === 0) return 0;
  const up = change > 0;
  return up === higherIsBullish ? 1 : -1;
}

// ---------- maths (all series are aligned with the input; NaN until there is enough history) ----------

/** Exponential moving average, seeded with the simple average of the first `period` values. */
export function ema(values: readonly number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(Number.NaN);
  const k = 2 / (period + 1);
  const start = values.findIndex((v) => Number.isFinite(v));
  if (start < 0 || values.length - start < period) return out;
  let sum = 0;
  for (let i = start; i < start + period; i++) sum += values[i]!;
  let prev = sum / period;
  out[start + period - 1] = prev;
  for (let i = start + period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Relative Strength Index with Wilder's smoothing. */
export function rsi(closes: readonly number[], period = 14): number[] {
  const out = new Array<number>(closes.length).fill(Number.NaN);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i]! - closes[i - 1]!;
    if (d > 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  const value = () => (avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : 100 - 100 / (1 + avgGain / avgLoss));
  out[period] = value();
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i]! - closes[i - 1]!;
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = value();
  }
  return out;
}

/** MACD histogram: (EMA12 - EMA26) minus its own 9-period EMA. */
export function macdHistogram(closes: readonly number[], fast = 12, slow = 26, signal = 9): number[] {
  const f = ema(closes, fast);
  const s = ema(closes, slow);
  const macd = closes.map((_, i) => f[i]! - s[i]!);
  const sig = ema(macd, signal);
  return macd.map((m, i) => m - sig[i]!);
}

/** Rate of change in percent over `period` days. */
export function rateOfChange(closes: readonly number[], period = 10): number[] {
  return closes.map((c, i) => (i >= period && closes[i - period]! !== 0 ? (c / closes[i - period]! - 1) * 100 : Number.NaN));
}

/** Average true range with Wilder's smoothing (seeded with the simple average of the first `period` ranges). */
export function atr(highs: readonly number[], lows: readonly number[], closes: readonly number[], period = 10): number[] {
  const out = new Array<number>(closes.length).fill(Number.NaN);
  if (closes.length < period) return out;
  const tr = closes.map((_, i) =>
    i === 0 ? highs[0]! - lows[0]! : Math.max(highs[i]! - lows[i]!, Math.abs(highs[i]! - closes[i - 1]!), Math.abs(lows[i]! - closes[i - 1]!))
  );
  let prev = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < closes.length; i++) {
    prev = (prev * (period - 1) + tr[i]!) / period;
    out[i] = prev;
  }
  return out;
}

/** Supertrend line and direction (+1 up / -1 down). Bands are the candle midpoint +/- multiplier x ATR; the lower
 * band only rises while the trend is up, the upper band only falls while it is down, and a close through the band
 * flips the trend. */
export function supertrend(
  highs: readonly number[],
  lows: readonly number[],
  closes: readonly number[],
  period = 10,
  multiplier = 3
): { line: number[]; direction: number[] } {
  const a = atr(highs, lows, closes, period);
  const line = new Array<number>(closes.length).fill(Number.NaN);
  const direction = new Array<number>(closes.length).fill(Number.NaN);
  let upper = Number.NaN;
  let lower = Number.NaN;
  let dir = 1;
  for (let i = 0; i < closes.length; i++) {
    if (!Number.isFinite(a[i]!)) continue;
    const mid = (highs[i]! + lows[i]!) / 2;
    const basicUpper = mid + multiplier * a[i]!;
    const basicLower = mid - multiplier * a[i]!;
    if (Number.isNaN(upper)) {
      upper = basicUpper;
      lower = basicLower;
      dir = closes[i]! >= mid ? 1 : -1;
    } else {
      const prevClose = closes[i - 1]!;
      upper = basicUpper < upper || prevClose > upper ? basicUpper : upper;
      lower = basicLower > lower || prevClose < lower ? basicLower : lower;
      if (dir === 1 && closes[i]! < lower) dir = -1;
      else if (dir === -1 && closes[i]! > upper) dir = 1;
    }
    line[i] = dir === 1 ? lower : upper;
    direction[i] = dir;
  }
  return { line, direction };
}

/** Daily candles for an index; high and low fall back to the close when the data has none. */
export interface Candles {
  closes: readonly number[];
  highs?: readonly number[];
  lows?: readonly number[];
}

/** The indicator's daily series from daily candles (Nifty 50 or India VIX). */
export function indicatorSeries(id: string, candles: Candles | readonly number[]): number[] {
  const { closes, highs = closes, lows = closes } = Array.isArray(candles) ? { closes: candles as readonly number[] } : (candles as Candles);
  switch (id) {
    case "rsi14":
      return rsi(closes, 14);
    case "macd":
      return macdHistogram(closes);
    case "ema20":
      return ema(closes, 20);
    case "roc10":
      return rateOfChange(closes, 10);
    case "supertrend": {
      const { line } = supertrend(highs, lows, closes, 10, 3);
      return closes.map((c, i) => c - line[i]!);
    }
    case "close":
    case "vix":
      return [...closes];
    default:
      throw new Error(`Unknown indicator "${id}"`);
  }
}
