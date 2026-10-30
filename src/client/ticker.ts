// Header index strip: refresh the numbers every minute while the tab is visible.
import { directionArrow, formatIndexChange, formatIndexPrice } from "../shared/ticker-format";

interface Quote {
  id: string;
  label: string;
  price: number;
  change: number;
  changePercent: number;
  direction: "up" | "down" | "flat";
}
interface Quotes {
  indices: Quote[];
  marketOpen: boolean;
}

const REFRESH_MS = 60_000;
const root = document.querySelector<HTMLElement>("[data-ticker]");

function item(q: Quote): HTMLLIElement {
  const li = document.createElement("li");
  li.className = `m3x-tick is-${q.direction}`;
  li.dataset.tick = q.id;
  const parts: Array<[string, string]> = [
    ["m3x-tick-name", q.label],
    ["m3x-tick-price", formatIndexPrice(q.price)],
    ["m3x-tick-chg", `${directionArrow(q.direction)} ${formatIndexChange(q.change, q.changePercent)}`],
  ];
  for (const [cls, text] of parts) {
    const span = document.createElement("span");
    span.className = cls;
    span.textContent = text;
    li.append(span);
  }
  return li;
}

function render(data: Quotes): void {
  if (!root || !data.indices.length) return;
  root.querySelectorAll<HTMLUListElement>("[data-ticker-list]").forEach((list) => list.replaceChildren(...data.indices.map(item)));
  const status = root.querySelector<HTMLElement>("[data-ticker-status]");
  status?.classList.toggle("is-open", data.marketOpen);
  status?.classList.toggle("is-closed", !data.marketOpen);
  const text = root.querySelector("[data-ticker-status-text]");
  if (text) text.textContent = data.marketOpen ? "Live" : "Closed";
}

async function refresh(): Promise<void> {
  try {
    const res = await fetch("/api/market/indices", { headers: { Accept: "application/json" } });
    if (res.ok) render((await res.json()) as Quotes);
  } catch {
    /* keep showing the last numbers; try again next time */
  }
}

if (root) {
  void refresh();
  let timer = window.setInterval(refresh, REFRESH_MS);
  document.addEventListener("visibilitychange", () => {
    window.clearInterval(timer);
    if (document.visibilityState === "visible") {
      void refresh();
      timer = window.setInterval(refresh, REFRESH_MS);
    }
  });
}
