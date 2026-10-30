// Market sentiment calculation shared by the server, the public dashboard and the admin preview.
// It measures the balance of configured bullish vs bearish alert values. It is NOT a probability
// that Nifty will rise or fall.

export type SentimentLabel = "Bullish" | "Bearish" | "Neutral";
export type SignalDirection = SentimentLabel;

export interface SentimentResult {
  /** B: sum of positive signal values */
  bullishStrength: number;
  /** D: sum of absolute values of negative signal values */
  bearishStrength: number;
  /** N = B - D */
  netStrength: number;
  /** T = B + D */
  totalStrength: number;
  /** (N / T) * 100, unrounded; 0 when T = 0 */
  percentExact: number;
  /** percentExact rounded to the nearest whole number (never -0) */
  percent: number;
  /** Classified from the rounded percent so the label always matches the displayed number */
  label: SentimentLabel;
}

export interface AlertCounts {
  bullish: number;
  bearish: number;
  neutral: number;
  active: number;
}

// Signal values are stored with 2 decimal places; summing in hundredths avoids float drift.
const toHundredths = (value: number): number => Math.round(value * 100);
const fromHundredths = (value: number): number => value / 100;

export function directionOf(value: number): SignalDirection {
  const v = toHundredths(value);
  if (v > 0) return "Bullish";
  if (v < 0) return "Bearish";
  return "Neutral";
}

export function calculateSentiment(signalValues: readonly number[]): SentimentResult {
  let bullish = 0;
  let bearish = 0;
  for (const raw of signalValues) {
    if (!Number.isFinite(raw)) continue;
    const v = toHundredths(raw);
    if (v > 0) bullish += v;
    else if (v < 0) bearish += -v;
  }
  const net = bullish - bearish;
  const total = bullish + bearish;
  const percentExact = total > 0 ? (net / total) * 100 : 0;
  const rounded = Math.round(percentExact);
  const percent = rounded === 0 ? 0 : rounded; // normalise -0

  return {
    bullishStrength: fromHundredths(bullish),
    bearishStrength: fromHundredths(bearish),
    netStrength: fromHundredths(net),
    totalStrength: fromHundredths(total),
    percentExact,
    percent,
    label: percent > 0 ? "Bullish" : percent < 0 ? "Bearish" : "Neutral",
  };
}

export function countAlerts(signalValues: readonly number[]): AlertCounts {
  const counts: AlertCounts = { bullish: 0, bearish: 0, neutral: 0, active: 0 };
  for (const v of signalValues) {
    counts.active += 1;
    const d = directionOf(v);
    if (d === "Bullish") counts.bullish += 1;
    else if (d === "Bearish") counts.bearish += 1;
    else counts.neutral += 1;
  }
  return counts;
}

const MINUS = "−";

/** "+65%", "−40%", "0%" */
export function formatPercent(percent: number): string {
  if (percent > 0) return `+${percent}%`;
  if (percent < 0) return `${MINUS}${Math.abs(percent)}%`;
  return "0%";
}

/** "+2", "−1.5", "0" */
export function formatSignal(value: number): string {
  const v = fromHundredths(toHundredths(value));
  const body = Number.isInteger(v) ? String(Math.abs(v)) : Math.abs(v).toFixed(2).replace(/0$/, "");
  if (v > 0) return `+${body}`;
  if (v < 0) return `${MINUS}${body}`;
  return "0";
}

/** "+65% — Bullish" */
export function formatSentiment(result: Pick<SentimentResult, "percent" | "label">): string {
  return `${formatPercent(result.percent)} — ${result.label}`;
}
