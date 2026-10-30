// Public Nifty sentiment dashboard: keeps the server-rendered dashboard in sync with saved alerts.
import { alertShares, formatIstDateTime, formatIstTime, trendChartHtml, type TrendDay } from "../shared/format";
import { formatPercent, formatSignal, type AlertCounts, type SentimentLabel, type SignalDirection } from "../shared/sentiment";
import { updateMarketIndicator } from "./market-indicator-ui";

interface ApiResponse {
  sentiment: {
    bullishStrength: number;
    bearishStrength: number;
    netStrength: number;
    totalStrength: number;
    percent: number;
    label: SentimentLabel;
  };
  counts: AlertCounts;
  alerts: { name: string; description: string; signalValue: number; direction: SignalDirection; status: string }[];
  updatedAt: string;
  history?: TrendDay[];
}

const REQUEST_TIMEOUT_MS = 10_000;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function initDashboard(root: HTMLElement): void {
  const q = <T extends Element>(sel: string) => root.querySelector<T>(sel);
  const endpoint = root.dataset.endpoint ?? "/api/nifty-sentiment";
  const pollMs = Math.max(15_000, Number(root.dataset.pollMs) || 20_000);
  const statusEl = q<HTMLElement>("[data-status]");
  const errorEl = q<HTMLElement>("[data-error]");
  let lastSuccess: Date | null = root.dataset.state === "ready" && root.dataset.renderedAt ? new Date(root.dataset.renderedAt) : null;
  let timer: number | undefined;
  let inFlight = false;

  function setStatus(text: string, live = true): void {
    if (!statusEl) return;
    statusEl.replaceChildren(el("span", live ? "m3x-live" : "m3x-sent-stale", text));
  }

  function render(data: ApiResponse): void {
    const { sentiment: s, counts: c } = data;
    const tone = s.label.toLowerCase();

    const card = q<HTMLElement>("[data-score-card]");
    card?.classList.remove("is-bullish", "is-bearish", "is-neutral");
    card?.classList.add(`is-${tone}`);
    const setText = (sel: string, text: string) => {
      const node = q(sel);
      if (node) node.textContent = text;
    };
    setText("[data-percent]", formatPercent(s.percent));
    setText("[data-label]", s.label);

    for (const key of ["bullish", "bearish", "neutral", "active"] as const) setText(`[data-count=${key}]`, String(c[key]));
    const shares = alertShares(c);
    for (const key of ["bullish", "bearish", "neutral"] as const) setText(`[data-share=${key}]`, `${shares[key]}%`);

    // Redraw the trend only when the daily history actually changed (keeps hover/focus stable).
    const trend = q<HTMLElement>("[data-trend]");
    const key = JSON.stringify(data.history ?? []);
    if (trend && data.history && trend.dataset.key !== key) {
      trend.dataset.key = key;
      trend.innerHTML = trendChartHtml(data.history);
      const days = Math.max(data.history.length, 1);
      setText("[data-trend-range]", `Last ${days} day${days === 1 ? "" : "s"}`);
    }
    setText("[data-updated]", `Last updated ${formatIstDateTime(data.updatedAt)}`);
    renderIndicators(data.alerts);
    updateMarketIndicator(s);
  }

  // "i" button on the trend card: the active indicators and their values (rebuilt only when they change)
  function renderIndicators(alerts: ApiResponse["alerts"]): void {
    const list = q<HTMLUListElement>("[data-ind-list]");
    const key = JSON.stringify(alerts.map((a) => [a.name, a.signalValue]));
    if (!list || list.dataset.key === key) return;
    list.dataset.key = key;
    if (!alerts.length) {
      list.replaceChildren(el("li", "is-empty", "No active indicators"));
      return;
    }
    list.replaceChildren(
      ...alerts.map((a) => {
        const li = el("li", `is-${a.direction.toLowerCase()}`);
        li.append(el("strong", undefined, a.name), el("b", undefined, formatSignal(a.signalValue)));
        return li;
      })
    );
  }

  // hover and keyboard focus show it (CSS); a tap or click pins it open until a click elsewhere or Escape
  const ind = q<HTMLElement>("[data-ind]");
  const indBtn = q<HTMLButtonElement>("[data-ind-btn]");
  const setIndOpen = (open: boolean) => {
    ind?.classList.toggle("is-open", open);
    indBtn?.setAttribute("aria-expanded", String(open));
  };
  indBtn?.addEventListener("click", () => setIndOpen(!ind?.classList.contains("is-open")));
  document.addEventListener("click", (e) => {
    if (ind && !ind.contains(e.target as Node)) setIndOpen(false);
  });
  ind?.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && ind.classList.contains("is-open")) {
      setIndOpen(false);
      indBtn?.focus();
    }
  });

  async function refresh(): Promise<void> {
    if (inFlight) return;
    inFlight = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(endpoint, { headers: { Accept: "application/json" }, cache: "no-store", signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ApiResponse;
      render(data);
      lastSuccess = new Date();
      root.dataset.state = "ready";
      if (errorEl) {
        errorEl.hidden = true;
        errorEl.textContent = "";
      }
      setStatus(`Refreshed ${formatIstTime(lastSuccess)}`);
    } catch {
      root.dataset.state = "error";
      if (errorEl) {
        errorEl.hidden = false;
        errorEl.textContent = lastSuccess
          ? `We couldn't refresh the alerts. Showing data from ${formatIstTime(lastSuccess)}. Retrying automatically…`
          : "We couldn't load the latest alerts. Retrying automatically…";
      }
      setStatus("Refresh failed", false);
    } finally {
      window.clearTimeout(timeout);
      inFlight = false;
    }
  }

  function schedule(): void {
    window.clearInterval(timer);
    timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, pollMs);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refresh();
  });

  if (lastSuccess) setStatus(`Refreshed ${formatIstTime(lastSuccess)}`);
  // If the server could not render data, try straight away.
  if (root.dataset.state !== "ready") void refresh();
  schedule();
}

document.querySelectorAll<HTMLElement>("[data-sentiment-dashboard]").forEach(initDashboard);
