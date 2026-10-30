// Homepage "Markets" chart: price history of the selected index for Today / 1W / 1M / 1Y (/api/market/history),
// with an index picker. The line and area are an SVG stretched to the plot; axis labels, the crosshair dot and the
// tooltip are HTML positioned in %, so they stay crisp at any size. Hover, touch or the arrow keys move the crosshair.
import { directionArrow, formatIndexChange, formatIndexPrice } from "../shared/ticker-format";

type Range = "1d" | "1w" | "1m" | "1y";
interface History {
  id: string;
  label: string;
  range: Range;
  points: Array<[number, number]>;
  price: number;
  baseline: number;
  change: number;
  changePercent: number;
  direction: "up" | "down" | "flat";
  marketOpen: boolean;
}

const W = 1000;
const H = 360;
const PAD_TOP = 16;
const PAD_BOTTOM = 16;
const REFRESH_MS = 60_000;
const PERIOD: Record<Range, string> = { "1d": "Today", "1w": "Past week", "1m": "Past month", "1y": "Past year" };
const RANGE_WORDS: Record<Range, string> = { "1d": "today", "1w": "over the past week", "1m": "over the past month", "1y": "over the past year" };

const ist = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", ...opts });
const fmtTime = ist({ hour: "numeric", minute: "2-digit", hour12: true });
const fmtDay = ist({ day: "numeric", month: "short" });
const fmtDayTime = ist({ day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
const fmtDate = ist({ day: "numeric", month: "short", year: "numeric" });
const fmtMonth = ist({ month: "short", year: "numeric" });

/** x-axis label and tooltip time for a point, by range */
function axisLabel(t: number, range: Range): string {
  const d = new Date(t * 1000);
  return range === "1d" ? fmtTime.format(d) : range === "1y" ? fmtMonth.format(d) : fmtDay.format(d);
}
function tipLabel(t: number, range: Range): string {
  const d = new Date(t * 1000);
  return range === "1d" ? fmtDayTime.format(d) : range === "1w" ? fmtDayTime.format(d) : fmtDate.format(d);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function initChart(root: HTMLElement): void {
  const q = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;
  const plot = q<HTMLElement>("[data-ic-plot]");
  const canvas = q<HTMLElement>("[data-ic-canvas]");
  const msg = q<HTMLElement>("[data-ic-msg]");
  const picks = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-ic-index]"));
  const rangeButtons = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-ic-range]"));
  const cache = new Map<string, { at: number; data: History }>();
  let index = picks.find((b) => b.getAttribute("aria-pressed") === "true")?.dataset.icIndex ?? "nifty";
  let range: Range = "1d";
  let current: History | null = null;
  let hover = -1;
  let request = 0;

  const pick = () => picks.find((b) => b.dataset.icIndex === index)!;

  function setHeader(data: History | null): void {
    const p = pick();
    q<HTMLElement>("[data-ic-name]").textContent = p.dataset.icFull ?? p.textContent ?? "";
    q<HTMLElement>("[data-ic-exchange]").textContent = p.dataset.icExchange ?? "";
    q<HTMLElement>("[data-ic-period]").textContent = PERIOD[range];
    if (!data) return;
    q<HTMLElement>("[data-ic-price]").textContent = formatIndexPrice(data.price);
    const chg = q<HTMLElement>("[data-ic-change]");
    chg.className = `m3x-ic-chg is-${data.direction}`;
    chg.textContent = `${directionArrow(data.direction)} ${formatIndexChange(data.change, data.changePercent)}`;
    q<HTMLElement>("[data-ic-status]").textContent = data.marketOpen ? "Market open" : "Market closed";
    // keep the picker's "today" figures in step with the 1-day chart
    if (data.range === "1d") {
      p.querySelector("[data-ic-pick-price]")!.textContent = formatIndexPrice(data.price);
      const pc = p.querySelector<HTMLElement>("[data-ic-pick-change]")!;
      pc.className = `m3x-ic-pick-chg is-${data.direction}`;
      const sign = data.changePercent > 0 ? "+" : data.changePercent < 0 ? "−" : "";
      pc.textContent = `${directionArrow(data.direction)} ${sign}${Math.abs(data.changePercent).toFixed(2)}%`;
    }
  }

  function draw(data: History): void {
    const pts = data.points;
    const n = pts.length;
    const values = pts.map((p) => p[1]);
    if (data.range === "1d") values.push(data.baseline);
    let min = Math.min(...values);
    let max = Math.max(...values);
    const pad = (max - min || max * 0.01) * 0.08;
    min -= pad;
    max += pad;
    const x = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
    const y = (v: number) => PAD_TOP + (1 - (v - min) / (max - min)) * (H - PAD_TOP - PAD_BOTTOM);
    const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p[1]).toFixed(1)}`).join(" ");
    const area = `${line} L${W} ${H} L0 ${H} Z`;
    const tone = data.direction === "down" ? "is-down" : "is-up";

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("class", `m3x-ic-svg ${tone}`);
    svg.setAttribute("aria-hidden", "true");
    const gradId = `m3x-ic-grad-${Math.random().toString(36).slice(2, 8)}`;
    svg.innerHTML =
      `<defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" class="m3x-ic-stop-a"/><stop offset="100%" class="m3x-ic-stop-b"/></linearGradient></defs>` +
      [0.25, 0.5, 0.75].map((f) => `<line class="m3x-ic-grid" x1="0" x2="${W}" y1="${(PAD_TOP + f * (H - PAD_TOP - PAD_BOTTOM)).toFixed(1)}" y2="${(PAD_TOP + f * (H - PAD_TOP - PAD_BOTTOM)).toFixed(1)}"/>`).join("") +
      (data.range === "1d" ? `<line class="m3x-ic-base" x1="0" x2="${W}" y1="${y(data.baseline).toFixed(1)}" y2="${y(data.baseline).toFixed(1)}"/>` : "") +
      `<path class="m3x-ic-area" d="${area}" fill="url(#${gradId})"/><path class="m3x-ic-line" d="${line}"/>`;

    // y labels (right edge) for the three grid lines, x labels for five evenly spaced points
    const yLabels = [0.25, 0.5, 0.75].map((f) => {
      const at = PAD_TOP + f * (H - PAD_TOP - PAD_BOTTOM);
      const label = el("span", "m3x-ic-y", formatIndexPrice(max - f * (max - min)));
      label.style.top = `${((at / H) * 100).toFixed(2)}%`;
      return label;
    });
    const xAxis = el("div", "m3x-ic-xaxis");
    const ticks = Math.min(canvas.clientWidth < 520 ? 3 : 5, n); // fewer labels on phones so they never touch
    for (let k = 0; k < ticks; k++) {
      const i = Math.round((k / Math.max(1, ticks - 1)) * (n - 1));
      const label = el("span", "m3x-ic-x", axisLabel(pts[i]![0], data.range));
      label.style.left = `${((x(i) / W) * 100).toFixed(2)}%`;
      xAxis.append(label);
    }
    const cross = el("div", "m3x-ic-cross");
    const dot = el("span", `m3x-ic-dot ${tone}`);
    const tip = el("div", "m3x-ic-tip");
    let base: HTMLElement | null = null;
    if (data.range === "1d") {
      base = el("span", "m3x-ic-baselabel", `Prev. close ${formatIndexPrice(data.baseline)}`);
      base.style.top = `${((y(data.baseline) / H) * 100).toFixed(2)}%`;
    }
    const surface = el("div", "m3x-ic-surface");
    surface.append(svg, ...yLabels, ...(base ? [base] : []), cross, dot, tip);
    canvas.replaceChildren(surface, xAxis);

    const show = (i: number) => {
      hover = i;
      if (i < 0) {
        surface.classList.remove("is-hover");
        return;
      }
      const [t, v] = pts[i]!;
      const left = (x(i) / W) * 100;
      const top = (y(v) / H) * 100;
      cross.style.left = dot.style.left = `${left}%`;
      dot.style.top = `${top}%`;
      tip.replaceChildren(el("strong", "", formatIndexPrice(v)), el("span", "", tipLabel(t, data.range)));
      tip.style.left = `${left}%`;
      tip.style.top = `${top}%`;
      tip.classList.toggle("is-below", top < 30);
      tip.classList.toggle("is-right", left > 70);
      tip.classList.toggle("is-left", left < 30);
      surface.classList.add("is-hover");
    };
    const fromPointer = (e: PointerEvent) => {
      const r = surface.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      show(Math.round(f * (n - 1)));
    };
    surface.addEventListener("pointermove", fromPointer);
    surface.addEventListener("pointerdown", fromPointer);
    surface.addEventListener("pointerleave", () => show(-1));
    plot.onkeydown = (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
      e.preventDefault();
      const start = hover < 0 ? n - 1 : hover;
      show(e.key === "Home" ? 0 : e.key === "End" ? n - 1 : Math.min(n - 1, Math.max(0, start + (e.key === "ArrowRight" ? 1 : -1))));
    };
    plot.onblur = () => show(-1);
    const full = pick().dataset.icFull ?? data.label;
    const sign = data.changePercent > 0 ? "up" : data.changePercent < 0 ? "down" : "unchanged";
    plot.setAttribute(
      "aria-label",
      `${full} price chart ${RANGE_WORDS[data.range]}: ${sign} ${Math.abs(data.changePercent).toFixed(2)}%, now ${formatIndexPrice(data.price)}. Use the arrow keys to read the prices.`
    );
  }

  async function load(force = false): Promise<void> {
    const key = `${index}:${range}`;
    const id = ++request;
    setHeader(cache.get(key)?.data ?? null);
    const hit = cache.get(key);
    if (hit && !force && (range !== "1d" || Date.now() - hit.at < REFRESH_MS)) {
      show(hit.data);
      return;
    }
    if (!hit) {
      plot.classList.add("is-loading");
      plot.classList.remove("is-error");
      msg.textContent = "Loading chart…";
    }
    try {
      const res = await fetch(`/api/market/history?index=${encodeURIComponent(index)}&range=${range}`, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as History;
      cache.set(key, { at: Date.now(), data });
      if (id === request) show(data);
    } catch {
      if (id !== request || hit) return;
      plot.classList.remove("is-loading");
      plot.classList.add("is-error");
      canvas.replaceChildren();
      msg.textContent = "The chart couldn't load right now. Please try again in a moment.";
    }
  }

  function show(data: History): void {
    current = data;
    plot.classList.remove("is-loading", "is-error");
    setHeader(data);
    draw(data);
  }

  picks.forEach((button) =>
    button.addEventListener("click", () => {
      index = button.dataset.icIndex ?? index;
      picks.forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
      void load();
    })
  );
  rangeButtons.forEach((button) =>
    button.addEventListener("click", () => {
      range = (button.dataset.icRange as Range) ?? range;
      rangeButtons.forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
      void load();
    })
  );

  // "Today" keeps updating while the tab is visible
  window.setInterval(() => {
    if (document.visibilityState === "visible" && range === "1d" && current) void load(true);
  }, REFRESH_MS);

  // load when the section is near the screen
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        void load();
      }
    },
    { rootMargin: "400px 0px" }
  );
  io.observe(root);
}

document.querySelectorAll<HTMLElement>("[data-index-chart]").forEach(initChart);
