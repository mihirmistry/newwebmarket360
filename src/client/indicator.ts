// Keeps the header "Market ±N%" badge fresh on pages without the full dashboard.
import { updateMarketIndicator, type IndicatorSentiment } from "./market-indicator-ui";

const ENDPOINT = "/api/nifty-sentiment";
const POLL_MS = 30_000;
const TIMEOUT_MS = 10_000;

async function refresh(): Promise<void> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, { headers: { Accept: "application/json" }, cache: "no-store", signal: controller.signal });
    if (!res.ok) return; // keep showing the last known value
    const data = (await res.json()) as { sentiment: IndicatorSentiment };
    updateMarketIndicator(data.sentiment);
  } catch {
    /* network error: keep the last known value and try again next tick */
  } finally {
    window.clearTimeout(timer);
  }
}

if (document.querySelector("[data-market-indicator]")) {
  // If the server couldn't render a value, fetch one straight away.
  if (document.querySelector("[data-market-indicator][hidden]")) void refresh();
  window.setInterval(() => {
    if (document.visibilityState === "visible") void refresh();
  }, POLL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refresh();
  });
}
