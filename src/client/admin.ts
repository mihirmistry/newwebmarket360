// Admin editor for Nifty sentiment alerts: inline editing, live preview, save/reset/delete.
// A row is either entered by hand (its signal value is typed in) or automatic: a built-in indicator calculated from
// Angel One data, scored +1 / 0 / -1 by comparing today's value with the previous close (src/shared/indicators.ts).
import { confirmDialog } from "./admin-dialog";
import { DESCRIPTION_MAX_LENGTH, NAME_MAX_LENGTH, SIGNAL_MAX, SIGNAL_MIN, hasAtMostTwoDecimals } from "../shared/alert-limits";
import { scaleOffset } from "../shared/format";
import { scoreChange, type IndicatorDef } from "../shared/indicators";
import { calculateSentiment, directionOf, formatPercent, formatSignal } from "../shared/sentiment";

interface ServerAlert {
  id: number;
  name: string;
  description: string;
  signalValue: number;
  enabled: boolean;
  indicator: string | null;
  higherIsBullish: boolean;
  threshold: number;
  prevValue: number | null;
  prevDay: string | null;
  currentValue: number | null;
  currentDay: string | null;
  autoUpdatedAt: string | null;
  autoError: string | null;
}

interface Row {
  key: string;
  id?: number;
  name: string;
  description: string;
  signalText: string;
  enabled: boolean;
  /** null = entered by hand */
  indicator: string | null;
  higherIsBullish: boolean;
  thresholdText: string;
  /** Calculated values from the server (automatic rows) */
  auto: Pick<ServerAlert, "signalValue" | "prevValue" | "prevDay" | "currentValue" | "currentDay" | "autoUpdatedAt" | "autoError"> & { indicator: string | null };
}

type Field = "name" | "description" | "signalValue" | "threshold";
type RowErrors = Partial<Record<Field, string>>;

const API = "/api/admin/nifty-alerts";
const csrfToken = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? "";

const tbody = document.querySelector<HTMLTableSectionElement>("[data-rows]")!;
const addBtn = document.querySelector<HTMLButtonElement>("[data-add]")!;
const saveBtn = document.querySelector<HTMLButtonElement>("[data-save]")!;
const resetBtn = document.querySelector<HTMLButtonElement>("[data-reset]")!;
const refreshBtn = document.querySelector<HTMLButtonElement>("[data-refresh]");
const statusEl = document.querySelector<HTMLElement>("[data-status]")!;
const dirtyBadge = document.querySelector<HTMLElement>("[data-dirty-badge]")!;

let INDICATORS: IndicatorDef[] = [];
try {
  INDICATORS = JSON.parse(document.getElementById("adm-indicators")?.textContent ?? "[]") as IndicatorDef[];
} catch {
  /* automatic indicators unavailable on this page */
}
const defOf = (id: string | null) => INDICATORS.find((d) => d.id === id);

let keySeq = 0;
const newKey = () => `r${++keySeq}`;

const toRow = (a: ServerAlert): Row => ({
  key: newKey(),
  id: a.id,
  name: a.name,
  description: a.description,
  signalText: formatEditable(a.signalValue),
  enabled: a.enabled,
  indicator: a.indicator,
  higherIsBullish: a.higherIsBullish,
  thresholdText: String(a.threshold),
  auto: { ...a },
});

let saved: Row[] = [];
let rows: Row[] = [];
let busy = false;

// ---------- parsing & validation ----------
function formatEditable(v: number): string {
  if (v > 0) return `+${v}`;
  return String(v);
}

/** Accepts "+2", "-1", "−1" (typographic minus), "1.5". Returns null when empty, NaN when invalid. */
function parseSignal(text: string): number | null {
  const t = text.trim().replace(/−/g, "-");
  if (t === "") return null;
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(t)) return Number.NaN;
  return Number(t);
}

function parseThreshold(text: string): number {
  const t = text.trim();
  return /^(\d+(\.\d*)?|\.\d+)$/.test(t) ? Number(t) : Number.NaN;
}

function validateRow(r: Row): RowErrors {
  const errors: RowErrors = {};
  const name = r.name.trim();
  if (!name) errors.name = "Enter an alert name";
  else if (name.length > NAME_MAX_LENGTH) errors.name = `Use ${NAME_MAX_LENGTH} characters or fewer`;
  if (r.description.trim().length > DESCRIPTION_MAX_LENGTH) errors.description = `Use ${DESCRIPTION_MAX_LENGTH} characters or fewer`;
  if (r.indicator) {
    const t = parseThreshold(r.thresholdText);
    if (Number.isNaN(t)) errors.threshold = "Use a number of 0 or more";
    else if (t > 100_000) errors.threshold = "Use a smaller number";
    return errors;
  }
  const v = parseSignal(r.signalText);
  if (v === null) errors.signalValue = "Enter a value, e.g. +1 or -2";
  else if (Number.isNaN(v)) errors.signalValue = "Use a number such as +2, 0 or -1";
  else if (v < SIGNAL_MIN || v > SIGNAL_MAX) errors.signalValue = `Use a value between ${SIGNAL_MIN} and +${SIGNAL_MAX}`;
  else if (!hasAtMostTwoDecimals(v)) errors.signalValue = "Use at most 2 decimal places";
  return errors;
}

/** The score of an automatic row with the direction and threshold currently on screen (0 until it has values). */
function autoScore(r: Row): number {
  const { prevValue, currentValue } = r.auto;
  if (r.indicator !== r.auto.indicator || prevValue === null || currentValue === null) return 0;
  const t = parseThreshold(r.thresholdText);
  return scoreChange(prevValue, currentValue, Number.isNaN(t) ? 0 : t, r.higherIsBullish);
}

const validValue = (r: Row): number | undefined => {
  if (r.indicator) return autoScore(r);
  const v = parseSignal(r.signalText);
  return v !== null && !Number.isNaN(v) && v >= SIGNAL_MIN && v <= SIGNAL_MAX && hasAtMostTwoDecimals(v) ? v : undefined;
};

const normalize = (list: Row[]) =>
  JSON.stringify(
    list.map((r) => [
      r.id ?? null,
      r.name.trim(),
      r.description.trim(),
      r.indicator ? null : parseSignal(r.signalText),
      r.enabled,
      r.indicator,
      r.indicator ? r.higherIsBullish : null,
      r.indicator ? parseThreshold(r.thresholdText) : null,
    ])
  );
const isDirty = () => normalize(rows) !== normalize(saved);

// ---------- rendering ----------
function setStatus(message: string, tone: "info" | "success" | "error" = "info", html?: Node): void {
  statusEl.className = `adm-status is-${tone}`;
  statusEl.replaceChildren(message);
  if (html) statusEl.append(" ", html);
}

const trashIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>`;

function directionChip(r: Row): HTMLSpanElement {
  const span = document.createElement("span");
  const v = validValue(r);
  if (v === undefined) {
    span.className = "adm-dir is-invalid";
    span.textContent = "—";
  } else {
    const d = directionOf(v);
    span.className = `adm-dir is-${d.toLowerCase()}`;
    span.textContent = d;
  }
  return span;
}

const num = (v: number) => (Math.abs(v) >= 1000 ? v.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : String(Math.round(v * 100) / 100));
const shortDay = (day: string | null) =>
  day ? new Date(`${day}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "";

/** The calculated signal of an automatic row, with previous close → current and when it was updated. */
function autoReadout(r: Row): HTMLDivElement {
  const box = document.createElement("div");
  box.className = "adm-auto";
  const score = document.createElement("strong");
  const value = autoScore(r);
  score.className = `adm-auto-score is-${directionOf(value).toLowerCase()}`;
  score.textContent = formatSignal(value);
  box.appendChild(score);
  const detail = document.createElement("small");
  const a = r.auto;
  if (r.indicator !== a.indicator) detail.textContent = "Calculated after you save";
  else if (a.prevValue !== null && a.currentValue !== null) {
    const change = a.currentValue - a.prevValue;
    detail.textContent = `${num(a.prevValue)} (${shortDay(a.prevDay)}) → ${num(a.currentValue)} (${shortDay(a.currentDay)}), change ${change > 0 ? "+" : change < 0 ? "−" : ""}${num(Math.abs(change))}`;
  } else detail.textContent = "Waiting for the first update";
  box.appendChild(detail);
  if (r.indicator === a.indicator && (a.autoError || a.autoUpdatedAt)) {
    const meta = document.createElement("small");
    meta.className = a.autoError ? "adm-auto-error" : "adm-auto-time";
    meta.textContent = a.autoError
      ? a.autoError
      : `Updated ${new Date(a.autoUpdatedAt!).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}`;
    box.appendChild(meta);
  }
  return box;
}

function renderRows(): void {
  if (rows.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 7;
    td.className = "adm-empty";
    td.textContent = "No alerts yet. Use “+ Add Alert” to create one.";
    tr.appendChild(td);
    tbody.replaceChildren(tr);
    return;
  }
  tbody.replaceChildren(...rows.map((r, i) => buildRow(r, i)));
}

function errorLine(r: Row, f: Field): HTMLParagraphElement {
  const err = document.createElement("p");
  err.className = "adm-row-error";
  err.dataset.err = f;
  err.id = `err-${r.key}-${f}`;
  return err;
}

function buildRow(r: Row, index: number): HTMLTableRowElement {
  const n = index + 1;
  const tr = document.createElement("tr");
  tr.dataset.key = r.key;
  tr.classList.toggle("is-disabled", !r.enabled);
  tr.classList.toggle("is-auto", Boolean(r.indicator));

  const numTd = document.createElement("td");
  numTd.className = "adm-col-num";
  numTd.textContent = String(n);

  const field = (f: Field, value: string, label: string, attrs: Record<string, string>) => {
    const td = document.createElement("td");
    const input = document.createElement("input");
    input.type = "text";
    input.className = "adm-input";
    input.value = value;
    input.dataset.field = f;
    input.setAttribute("aria-label", `${label}, row ${n}`);
    for (const [k, v] of Object.entries(attrs)) input.setAttribute(k, v);
    const err = errorLine(r, f);
    input.setAttribute("aria-describedby", err.id);
    td.append(input, err);
    return td;
  };

  // (descriptions are kept and saved as they are; the table no longer shows them)
  const nameTd = field("name", r.name, "Alert name", { maxlength: String(NAME_MAX_LENGTH), placeholder: "e.g. RSI Signal" });

  // source: entered by hand, or a built-in indicator (with its direction and threshold)
  const srcTd = document.createElement("td");
  srcTd.className = "adm-col-source";
  const select = document.createElement("select");
  select.className = "adm-input adm-source";
  select.dataset.field = "indicator";
  select.setAttribute("aria-label", `Source, row ${n}`);
  const manual = new Option("Entered by hand", "");
  select.appendChild(manual);
  const group = document.createElement("optgroup");
  group.label = "Automatic (Angel One)";
  for (const d of INDICATORS) {
    const opt = new Option(d.available === false ? `${d.label} (coming soon)` : d.label, d.id);
    opt.disabled = d.available === false;
    group.appendChild(opt);
  }
  select.appendChild(group);
  select.value = r.indicator ?? "";
  srcTd.appendChild(select);
  if (r.indicator) {
    const opts = document.createElement("div");
    opts.className = "adm-auto-opts";
    const dir = document.createElement("select");
    dir.className = "adm-input";
    dir.dataset.field = "higherIsBullish";
    dir.setAttribute("aria-label", `Direction, row ${n}`);
    dir.append(new Option("Rise = bullish", "1"), new Option("Rise = bearish", "0"));
    dir.value = r.higherIsBullish ? "1" : "0";
    const th = document.createElement("label");
    th.className = "adm-auto-th";
    const thText = document.createElement("span");
    thText.textContent = "Threshold";
    th.title = "Changes up to this size score 0";
    const thInput = document.createElement("input");
    thInput.type = "text";
    thInput.inputMode = "decimal";
    thInput.className = "adm-input adm-threshold";
    thInput.value = r.thresholdText;
    thInput.dataset.field = "threshold";
    const unit = document.createElement("em");
    unit.textContent = defOf(r.indicator)?.unit ?? "";
    const thErr = errorLine(r, "threshold");
    thInput.setAttribute("aria-describedby", thErr.id);
    th.append(thText, thInput, unit);
    opts.append(dir, th, thErr);
    srcTd.appendChild(opts);
  }

  let sigTd: HTMLTableCellElement;
  if (r.indicator) {
    sigTd = document.createElement("td");
    sigTd.dataset.cell = "auto";
    sigTd.appendChild(autoReadout(r));
  } else {
    sigTd = field("signalValue", r.signalText, "Signal value", { inputmode: "decimal", placeholder: "+1", autocomplete: "off" });
    sigTd.querySelector("input")!.classList.add("adm-signal");
  }

  const dirTd = document.createElement("td");
  dirTd.dataset.cell = "direction";
  dirTd.appendChild(directionChip(r));

  const enTd = document.createElement("td");
  const sw = document.createElement("label");
  sw.className = "adm-switch";
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = r.enabled;
  cb.setAttribute("role", "switch");
  cb.setAttribute("aria-label", `Enabled, row ${n}`);
  cb.dataset.field = "enabled";
  const knob = document.createElement("span");
  knob.setAttribute("aria-hidden", "true");
  const swText = document.createElement("em");
  swText.textContent = r.enabled ? "On" : "Off";
  sw.append(cb, knob, swText);
  enTd.appendChild(sw);

  const delTd = document.createElement("td");
  const del = document.createElement("button");
  del.type = "button";
  del.className = "adm-icon-btn";
  del.dataset.action = "delete";
  del.setAttribute("aria-label", `Delete ${r.name.trim() || `row ${n}`}`);
  del.innerHTML = trashIcon;
  delTd.appendChild(del);

  tr.append(numTd, nameTd, srcTd, sigTd, dirTd, enTd, delTd);
  return tr;
}

function showRowErrors(tr: HTMLTableRowElement, errors: RowErrors, onlyField?: Field): void {
  for (const f of ["name", "description", "signalValue", "threshold"] as Field[]) {
    if (onlyField && f !== onlyField) continue;
    const msg = errors[f] ?? "";
    const p = tr.querySelector<HTMLElement>(`[data-err="${f}"]`);
    const input = tr.querySelector<HTMLInputElement>(`[data-field="${f}"]`);
    if (p) p.textContent = msg;
    input?.toggleAttribute("aria-invalid", Boolean(msg));
  }
}

function updatePreview(): void {
  const enabledValid = rows.filter((r) => r.enabled).map(validValue);
  const values = enabledValid.filter((v): v is number => v !== undefined);
  const s = calculateSentiment(values);
  const set = (k: string, text: string) => {
    const node = document.querySelector(`[data-pv="${k}"]`);
    if (node) node.textContent = text;
  };
  set("bullish", String(s.bullishStrength));
  set("bearish", String(s.bearishStrength));
  set("net", (s.netStrength > 0 ? "+" : s.netStrength < 0 ? "−" : "") + Math.abs(s.netStrength));
  set("percent", formatPercent(s.percent));
  set("label", s.label);
  const result = document.querySelector<HTMLElement>("[data-pv-result]");
  result?.classList.remove("is-bullish", "is-bearish", "is-neutral");
  result?.classList.add(`is-${s.label.toLowerCase()}`);
  const marker = document.querySelector<HTMLElement>("[data-pv-marker]");
  if (marker) marker.style.left = `${scaleOffset(s.percent)}%`;

  const dirty = isDirty();
  dirtyBadge.hidden = !dirty;
  saveBtn.disabled = busy || !dirty;
  resetBtn.disabled = busy || !dirty;
  addBtn.disabled = busy;
  if (refreshBtn) refreshBtn.disabled = busy;
}

const rerenderRow = (tr: HTMLTableRowElement, row: Row) => {
  const fresh = buildRow(row, rows.indexOf(row));
  tr.replaceWith(fresh);
  return fresh;
};

// ---------- events ----------
tbody.addEventListener("input", (e) => {
  const input = e.target as HTMLInputElement;
  const tr = input.closest("tr");
  const row = rows.find((r) => r.key === tr?.dataset.key);
  if (!tr || !row) return;
  const f = input.dataset.field;
  if (f === "name") row.name = input.value;
  else if (f === "description") row.description = input.value;
  else if (f === "signalValue") row.signalText = input.value;
  else if (f === "threshold") row.thresholdText = input.value;
  else if (f === "enabled") {
    row.enabled = input.checked;
    tr.classList.toggle("is-disabled", !row.enabled);
    const label = input.parentElement?.querySelector("em");
    if (label) label.textContent = row.enabled ? "On" : "Off";
  }
  if (f === "signalValue" || f === "threshold") {
    tr.querySelector('[data-cell="direction"]')?.replaceChildren(directionChip(row));
    tr.querySelector('[data-cell="auto"]')?.replaceChildren(autoReadout(row));
  }
  if (f === "name" || f === "description" || f === "signalValue" || f === "threshold") {
    // clear an error as soon as the field becomes valid; full messages appear on blur/save
    const errs = validateRow(row);
    if (!errs[f as Field]) showRowErrors(tr, errs, f as Field);
  }
  updatePreview();
});

tbody.addEventListener("change", (e) => {
  const input = e.target as HTMLSelectElement;
  const tr = input.closest("tr");
  const row = rows.find((r) => r.key === tr?.dataset.key);
  if (!tr || !row) return;
  if (input.dataset.field === "indicator") {
    row.indicator = input.value || null;
    const def = defOf(row.indicator);
    // a newly chosen indicator starts with its usual direction and threshold
    if (def && row.indicator !== row.auto.indicator) {
      row.higherIsBullish = def.higherIsBullish;
      row.thresholdText = String(def.threshold);
    }
    rerenderRow(tr, row).querySelector<HTMLSelectElement>('[data-field="indicator"]')?.focus();
  } else if (input.dataset.field === "higherIsBullish") {
    row.higherIsBullish = input.value === "1";
    tr.querySelector('[data-cell="direction"]')?.replaceChildren(directionChip(row));
    tr.querySelector('[data-cell="auto"]')?.replaceChildren(autoReadout(row));
  } else return;
  updatePreview();
});

tbody.addEventListener("focusout", (e) => {
  const input = e.target as HTMLInputElement;
  const f = input.dataset.field as Field | undefined;
  const tr = input.closest("tr");
  const row = rows.find((r) => r.key === tr?.dataset.key);
  if (!tr || !row || !f || !["name", "description", "signalValue", "threshold"].includes(f)) return;
  showRowErrors(tr, validateRow(row), f);
});

tbody.addEventListener("click", async (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-action=delete]");
  if (!btn || busy) return;
  const tr = btn.closest("tr");
  const row = rows.find((r) => r.key === tr?.dataset.key);
  if (!row) return;
  const label = row.name.trim() || "this alert";
  const sure = await confirmDialog({
    title: row.name.trim() ? `Delete “${row.name.trim()}”?` : "Delete this alert?",
    message: row.id ? "This removes it from the public dashboard. It can't be undone." : "This row hasn't been saved yet.",
    confirmLabel: "Delete alert",
    danger: true,
  });
  if (!sure) return;

  if (row.id === undefined) {
    rows = rows.filter((r) => r !== row);
    renderRows();
    updatePreview();
    setStatus(`Removed “${label}”.`);
    return;
  }
  busy = true;
  updatePreview();
  try {
    const res = await fetch(`${API}/${row.id}`, { method: "DELETE", headers: { "X-CSRF-Token": csrfToken, Accept: "application/json" } });
    if (res.status !== 204 && res.status !== 404) throw await apiError(res);
    rows = rows.filter((r) => r.id !== row.id);
    saved = saved.filter((r) => r.id !== row.id);
    renderRows();
    setStatus(`Deleted “${label}”.`, "success");
  } catch (err) {
    reportError(err);
  } finally {
    busy = false;
    updatePreview();
  }
});

const emptyAuto = (): Row["auto"] => ({ indicator: null, signalValue: 0, prevValue: null, prevDay: null, currentValue: null, currentDay: null, autoUpdatedAt: null, autoError: null });

addBtn.addEventListener("click", () => {
  rows.push({ key: newKey(), name: "", description: "", signalText: "0", enabled: true, indicator: null, higherIsBullish: true, thresholdText: "0", auto: emptyAuto() });
  renderRows();
  updatePreview();
  tbody.querySelector<HTMLInputElement>(`tr[data-key="${rows[rows.length - 1]!.key}"] [data-field="name"]`)?.focus();
});

resetBtn.addEventListener("click", async () => {
  if (!isDirty()) return;
  const sure = await confirmDialog({ title: "Discard unsaved changes?", message: "Your edits on this page will be lost.", confirmLabel: "Discard changes" });
  if (!sure) return;
  rows = saved.map((r) => ({ ...r }));
  renderRows();
  updatePreview();
  setStatus("Unsaved changes discarded.");
});

const loadSaved = (alerts: ServerAlert[]) => {
  saved = alerts.map(toRow);
  rows = saved.map((r) => ({ ...r }));
  renderRows();
};

saveBtn.addEventListener("click", async () => {
  if (busy) return;
  // client-side validation first
  let firstInvalid: HTMLInputElement | null = null;
  let invalidCount = 0;
  rows.forEach((r) => {
    const tr = tbody.querySelector<HTMLTableRowElement>(`tr[data-key="${r.key}"]`);
    const errs = validateRow(r);
    if (tr) showRowErrors(tr, errs);
    if (Object.keys(errs).length) {
      invalidCount += 1;
      firstInvalid ??= tr?.querySelector<HTMLInputElement>("[aria-invalid]") ?? null;
    }
  });
  if (invalidCount > 0) {
    setStatus(`Fix ${invalidCount} highlighted ${invalidCount === 1 ? "row" : "rows"} before saving.`, "error");
    (firstInvalid as HTMLInputElement | null)?.focus();
    return;
  }

  const payload = {
    alerts: rows.map((r) => ({
      ...(r.id !== undefined ? { id: r.id } : {}),
      name: r.name.trim(),
      description: r.description.trim(),
      signalValue: r.indicator ? autoScore(r) : (parseSignal(r.signalText) as number),
      enabled: r.enabled,
      indicator: r.indicator,
      higherIsBullish: r.higherIsBullish,
      threshold: r.indicator ? parseThreshold(r.thresholdText) : 0,
    })),
    deletedIds: [] as number[],
  };

  busy = true;
  updatePreview();
  setStatus("Saving…");
  try {
    const res = await fetch(API, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Accept: "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw await apiError(res);
    const data = (await res.json()) as { alerts: ServerAlert[] };
    loadSaved(data.alerts);
    const pending = data.alerts.some((a) => a.indicator && a.prevValue === null);
    setStatus(
      `Saved at ${new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })}. The public dashboard now shows these alerts.${pending ? " Use “Refresh now” to calculate new automatic indicators." : ""}`,
      "success"
    );
  } catch (err) {
    reportError(err);
  } finally {
    busy = false;
    updatePreview();
  }
});

refreshBtn?.addEventListener("click", async () => {
  if (busy) return;
  if (isDirty()) {
    setStatus("Save or reset your changes first, then refresh.", "error");
    return;
  }
  busy = true;
  updatePreview();
  setStatus("Fetching market data from Angel One…");
  try {
    const res = await fetch(`${API}/refresh`, { method: "POST", headers: { Accept: "application/json", "X-CSRF-Token": csrfToken } });
    const data = (await res.json().catch(() => ({}))) as { result?: { ok: boolean; message: string }; alerts?: ServerAlert[]; error?: string };
    if (res.status === 401 || res.status === 403) throw new ApiError(data.error ?? "Your session has ended.", res.status);
    if (data.alerts) loadSaved(data.alerts);
    setStatus(data.result?.message ?? data.error ?? `Request failed (${res.status})`, data.result?.ok ? "success" : "error");
  } catch (err) {
    reportError(err);
  } finally {
    busy = false;
    updatePreview();
  }
});

window.addEventListener("beforeunload", (e) => {
  if (isDirty()) {
    e.preventDefault();
    e.returnValue = "";
  }
});

// ---------- errors ----------
class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public issues: { path: (string | number)[]; message: string }[] = []
  ) {
    super(message);
  }
}

async function apiError(res: Response): Promise<ApiError> {
  let body: { error?: string; issues?: { path: (string | number)[]; message: string }[] } = {};
  try {
    body = await res.json();
  } catch {
    /* non-JSON error page */
  }
  return new ApiError(body.error ?? `Request failed (${res.status})`, res.status, body.issues);
}

function reportError(err: unknown): void {
  if (err instanceof ApiError) {
    if (err.status === 401) {
      const a = document.createElement("a");
      a.href = `/admin/login?next=${encodeURIComponent(location.pathname)}`;
      a.textContent = "Sign in again";
      setStatus("Your session has ended. Your edits are still on this page.", "error", a);
      return;
    }
    // map server validation issues back onto rows: path = ["alerts", index, field]
    for (const issue of err.issues) {
      const [scope, index, f] = issue.path;
      if (scope !== "alerts" || typeof index !== "number") continue;
      const row = rows[index];
      const tr = row && tbody.querySelector<HTMLTableRowElement>(`tr[data-key="${row.key}"]`);
      if (tr && (f === "name" || f === "description" || f === "signalValue" || f === "threshold")) showRowErrors(tr, { [f]: issue.message }, f);
    }
    setStatus(err.message, "error");
    return;
  }
  setStatus("Couldn't reach the server. Check your connection and try again; your edits are still here.", "error");
}

// ---------- boot ----------
try {
  loadSaved(JSON.parse(document.getElementById("adm-initial")?.textContent ?? "[]") as ServerAlert[]);
} catch {
  setStatus("Couldn't read the saved alerts. Reload the page.", "error");
  renderRows();
}
updatePreview();
