// Date/time formatting shared by server-rendered pages and browser updates (always India time).
const dateTime = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const timeOnly = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
});

/** "15 Oct 2026, 4:52 pm IST" */
export function formatIstDateTime(iso: string | Date): string {
  return `${dateTime.format(new Date(iso))} IST`;
}

/** "4:52:10 pm" */
export function formatIstTime(date: Date): string {
  return timeOnly.format(date);
}

export interface DonutSegment {
  key: "bullish" | "neutral" | "bearish";
  /** Arc length on a circle whose circumference is 100 */
  length: number;
  /** stroke-dashoffset that starts this arc where the previous one ended (12 o'clock origin) */
  offset: number;
}

/** Donut arcs for the bullish / neutral / bearish alert split (circle r = 15.9155, circumference 100). */
export function donutSegments(counts: { bullish: number; neutral: number; bearish: number }): DonutSegment[] {
  const total = counts.bullish + counts.neutral + counts.bearish;
  if (total === 0) return [];
  let start = 0;
  return (["bullish", "neutral", "bearish"] as const)
    .map((key) => {
      const length = (counts[key] / total) * 100;
      const seg = { key, length, offset: 25 - start };
      start += length;
      return seg;
    })
    .filter((s) => s.length > 0);
}

/**
 * Whole-number share of each alert type that always adds up to 100 (largest remainder; ties go to the
 * smaller group), e.g. 5 / 2 / 1 alerts -> 62 / 25 / 13. All zeros when there are no alerts.
 */
export function alertShares(counts: { bullish: number; bearish: number; neutral: number }): { bullish: number; bearish: number; neutral: number } {
  const keys = ["bullish", "bearish", "neutral"] as const;
  const total = counts.bullish + counts.bearish + counts.neutral;
  const shares = { bullish: 0, bearish: 0, neutral: 0 };
  if (total === 0) return shares;
  for (const k of keys) shares[k] = Math.floor((counts[k] / total) * 100);
  let left = 100 - shares.bullish - shares.bearish - shares.neutral;
  const order = [...keys].sort((a, b) => {
    const ra = (counts[a] / total) * 100 - shares[a];
    const rb = (counts[b] / total) * 100 - shares[b];
    return rb - ra || counts[a] - counts[b];
  });
  for (const k of order) {
    if (left <= 0) break;
    if (counts[k] > 0) {
      shares[k] += 1;
      left -= 1;
    }
  }
  return shares;
}

/** Axis limit for the "signal per alert" chart: at least ±2, otherwise the largest absolute value. */
export function chartScale(values: readonly number[]): number {
  const max = values.reduce((m, v) => (Number.isFinite(v) ? Math.max(m, Math.abs(v)) : m), 0);
  return Math.max(2, Math.ceil(max));
}

/** Bar length as % of the full track (each side of the zero line is 50%). */
export function chartBarWidth(value: number, scale: number): number {
  if (!Number.isFinite(value) || scale <= 0) return 0;
  return Math.round((Math.min(Math.abs(value), scale) / scale) * 50 * 100) / 100;
}

/** Position of a −100…+100 score on a 0…100% track. */
export function scaleOffset(percent: number): number {
  const clamped = Math.max(-100, Math.min(100, percent));
  return (clamped + 100) / 2;
}

export interface TrendDay {
  /** YYYY-MM-DD */
  day: string;
  percent: number;
  label: "Bullish" | "Bearish" | "Neutral";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** "2026-10-14" -> "14 Oct" */
export function shortDay(day: string): string {
  const [, m, d] = day.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1] ?? ""}`;
}

/**
 * Daily sentiment trend chart as HTML (shared by the server view and the browser refresh).
 * The line and area are an SVG drawn in a 1000 x 300 box stretched to the container; the points,
 * tooltips and axis labels are HTML positioned in % so they stay round and crisp at any size.
 */
export function trendChartHtml(history: TrendDay[]): string {
  const W = 1000;
  const H = 300;
  const PAD_X = 40;
  const y = (p: number) => 18 + (1 - (Math.max(-100, Math.min(100, p)) + 100) / 200) * (H - 36);
  const n = history.length;
  const pts = history.map((d, i) => ({ ...d, x: n === 1 ? W / 2 : PAD_X + (i * (W - 2 * PAD_X)) / (n - 1), y: y(d.percent) }));
  const tone = (l: string) => l.toLowerCase();
  const signed = (p: number) => (p > 0 ? `+${p}` : `${p}`);

  // smooth line through the points (Catmull-Rom converted to cubic Béziers)
  let line = "";
  if (n === 1) line = `M ${PAD_X} ${pts[0]!.y} L ${W - PAD_X} ${pts[0]!.y}`;
  else if (n > 1) {
    line = `M ${pts[0]!.x} ${pts[0]!.y}`;
    for (let i = 0; i < n - 1; i++) {
      const p0 = pts[i - 1] ?? pts[i]!;
      const p1 = pts[i]!;
      const p2 = pts[i + 1]!;
      const p3 = pts[i + 2] ?? p2;
      const c1x = p1.x + (p2.x - p0.x) / 6;
      const c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6;
      const c2y = p2.y - (p3.y - p1.y) / 6;
      line += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2.x} ${p2.y.toFixed(1)}`;
    }
  }
  const first = n === 1 ? PAD_X : pts[0]?.x ?? 0;
  const last = n === 1 ? W - PAD_X : pts[n - 1]?.x ?? 0;
  const area = n ? `${line} L ${last} ${H} L ${first} ${H} Z` : "";
  // the line and area take each day's colour, blending between days
  const stops = pts
    .map((p) => `<stop offset="${((p.x / W) * 100).toFixed(1)}%" class="is-${tone(p.label)}" />`)
    .join("");

  const yLabels = `<span class="m3x-trend-y is-bullish" style="top:${((y(100) / H) * 100).toFixed(1)}%">Bullish</span>
<span class="m3x-trend-y is-neutral" style="top:${((y(0) / H) * 100).toFixed(1)}%">Neutral</span>
<span class="m3x-trend-y is-bearish" style="top:${((y(-100) / H) * 100).toFixed(1)}%">Bearish</span>`;
  const points = pts
    .map((p, i) => {
      const left = ((p.x / W) * 100).toFixed(2);
      const top = ((p.y / H) * 100).toFixed(2);
      const latest = i === n - 1 ? " is-latest" : "";
      return `<span class="m3x-trend-pt is-${tone(p.label)}${latest}" style="left:${left}%;top:${top}%" role="img" tabindex="0" aria-label="${esc(shortDay(p.day))}: ${esc(p.label)}, score ${signed(p.percent)}%"><span class="m3x-trend-tip">${esc(p.label)}<small>Score: ${signed(p.percent)}%</small></span></span>`;
    })
    .join("");
  const xLabels = pts
    .map((p) => `<span class="m3x-trend-x" style="left:${((p.x / W) * 100).toFixed(2)}%">${esc(shortDay(p.day))}</span>`)
    .join("");

  return `<div class="m3x-trend-plot">${yLabels}
<svg class="m3x-trend-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true" focusable="false">
<defs><linearGradient id="m3x-trend-grad" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${W}" y2="0">${stops}</linearGradient></defs>
<line class="m3x-trend-grid" x1="0" x2="${W}" y1="${y(100)}" y2="${y(100)}" /><line class="m3x-trend-grid is-mid" x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" /><line class="m3x-trend-grid" x1="0" x2="${W}" y1="${y(-100)}" y2="${y(-100)}" />
${area ? `<path class="m3x-trend-area" d="${area}" />` : ""}${line ? `<path class="m3x-trend-line${n === 1 ? " is-flat" : ""}" d="${line}" />` : ""}
</svg>${points}</div><div class="m3x-trend-xaxis">${xLabels}</div>`;
}
