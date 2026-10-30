// Homepage cards built from a real Market360X Trading Terminal session (views/partials/terminal-*.ejs).
// Alert feed: replays the session's alerts, newest on top, each sliding in; loops after a pause.
// Chart: candles and alert dots animate in left to right once the card is on screen (CSS, via .is-in).
interface Alert {
  time: string;
  kind: "ENTRY" | "RE_ENTRY" | "REVERSAL" | "EXIT";
}

const VISIBLE = 4;
const STEP_MS = 1700;
const LOOP_PAUSE_MS = 4000;
const LABEL = { ENTRY: "New alert", RE_ENTRY: "Re-entry", REVERSAL: "Reversal", EXIT: "Exit" };
const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function onVisible(el: Element, cb: () => void): void {
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        cb();
      }
    },
    { threshold: 0.35 }
  );
  io.observe(el);
}

function row(a: Alert): HTMLLIElement {
  const li = document.createElement("li");
  li.className = `m3x-tlog-row is-${a.kind.toLowerCase().replace("_", "-")}`;
  for (const [cls, text] of [["m3x-tlog-kind", LABEL[a.kind]], ["m3x-tlog-text", "Nifty"], ["m3x-tlog-time", a.time]] as const) {
    const span = document.createElement("span");
    span.className = cls;
    span.textContent = text;
    li.append(span);
  }
  return li;
}

function initLog(root: HTMLElement): void {
  const list = root.querySelector<HTMLOListElement>("[data-tlog-list]");
  const data = root.querySelector<HTMLScriptElement>("[data-tlog-data]");
  if (!list || !data) return;
  const alerts = JSON.parse(data.textContent || "[]") as Alert[];
  if (!alerts.length || reduceMotion()) return; // the server already shows the latest alerts
  let i = 0;
  const next = () => {
    if (i >= alerts.length) {
      window.setTimeout(() => {
        list.replaceChildren();
        i = 0;
        next();
      }, LOOP_PAUSE_MS);
      return;
    }
    const li = row(alerts[i]!);
    li.classList.add("is-new");
    list.prepend(li);
    requestAnimationFrame(() => requestAnimationFrame(() => li.classList.remove("is-new")));
    while (list.children.length > VISIBLE) list.lastElementChild!.remove();
    i++;
    window.setTimeout(next, STEP_MS);
  };
  onVisible(root, () => {
    list.replaceChildren();
    next();
  });
}

document.querySelectorAll<HTMLElement>("[data-terminal-log]").forEach(initLog);
document.querySelectorAll<HTMLElement>("[data-terminal-chart]").forEach((chart) => {
  chart.classList.add("is-armed"); // hidden until on screen (without JS the chart is simply shown)
  onVisible(chart, () => chart.classList.add("is-in"));
});
