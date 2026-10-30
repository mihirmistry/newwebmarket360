// Updates the header "Market ±N%" badge. Used by dashboard.ts (homepage) and indicator.ts (other pages).
import { formatPercent, type SentimentLabel } from "../shared/sentiment";

export interface IndicatorSentiment {
  percent: number;
  label: SentimentLabel;
}

export function updateMarketIndicator(s: IndicatorSentiment): void {
  document.querySelectorAll<HTMLElement>("[data-market-indicator]").forEach((badge) => {
    const text = formatPercent(s.percent);
    badge.classList.remove("is-bullish", "is-bearish", "is-neutral");
    badge.classList.add(`is-${s.label.toLowerCase()}`);
    const value = badge.querySelector("[data-mkt-value]");
    if (value) value.textContent = text;
    const state = badge.querySelector("[data-mkt-state]");
    if (state) state.textContent = s.label; // Bullish / Bearish / Neutral
    badge.setAttribute("aria-label", `Market ${text} ${s.label} (Nifty 50 sentiment)`);
    badge.hidden = false;
  });
}
