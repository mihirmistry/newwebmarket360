// Plan buttons -> log in / sign up popup -> checkout. The header "Log in" link opens the same popup -> dashboard.
import { bindPasswordUi } from "./password-ui";
import {
  normalizePhone,
  validateEmail,
  validateExperience,
  validateName,
  validateNewPassword,
  validatePhone,
} from "../shared/customer-rules";

type Mode = "login" | "signup";
interface PlanInfo {
  id: string;
  name: string;
  price: number;
  period: string;
}
interface SessionInfo {
  authenticated: boolean;
  csrfToken: string;
}

const modal = document.querySelector<HTMLDialogElement>("[data-auth-modal]");
const plans: PlanInfo[] = JSON.parse(document.getElementById("m3x-plans")?.textContent ?? "[]");

let selectedPlan: string | null = null;
let nextUrl: string | null = null;
let session: Promise<SessionInfo> | null = null;

function loadSession(force = false): Promise<SessionInfo> {
  if (!session || force) {
    session = fetch("/api/account/session", { headers: { Accept: "application/json" }, cache: "no-store", credentials: "same-origin" })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<SessionInfo>;
      })
      .catch((err) => {
        session = null;
        throw err;
      });
  }
  return session;
}

const checkoutUrl = (plan: string) => `/checkout?plan=${encodeURIComponent(plan)}`;
/** Only our own account pages are allowed as a post-login destination. */
const safeNext = (v: string | null | undefined) => (v && /^\/account(\/(profile|plan))?$/.test(v) ? v : null);
/** Where to go after logging in or signing up. */
const destination = () => (selectedPlan ? checkoutUrl(selectedPlan) : (nextUrl ?? location.pathname + location.search));

// ---------- popup UI ----------
function setMode(mode: Mode, focus = true): void {
  if (!modal) return;
  modal.querySelectorAll<HTMLButtonElement>("[data-auth-tab]").forEach((tab) => {
    const active = tab.dataset.authTab === mode;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  modal.querySelectorAll<HTMLFormElement>("[data-auth-form]").forEach((form) => {
    form.hidden = form.dataset.authForm !== mode;
  });
  modal.querySelector("[data-auth-title]")!.textContent = mode === "login" ? "Log in to continue" : "Create your account";
  const loginSub = selectedPlan ? "Log in to review your plan and checkout." : "Log in to your Market360X account.";
  modal.querySelector("[data-auth-sub]")!.textContent = mode === "login" ? loginSub : "Sign up in a minute to get your alerts.";
  if (focus) modal.querySelector<HTMLInputElement>(`[data-auth-form="${mode}"] input`)?.focus();
}

function openModal(planId: string | null, mode: Mode = "login", next: string | null = null): void {
  selectedPlan = planId;
  nextUrl = next;
  if (!modal) {
    location.href = destination();
    return;
  }
  modal.querySelectorAll<HTMLFormElement>("[data-auth-form]").forEach(clearErrors);
  if (!modal.open) {
    document.documentElement.classList.add("m3x-auth-lock"); // the popup's overlay scrolls, not the page behind it
    modal.showModal();
    modal.scrollTop = 0;
  }
  setMode(mode);
}

function closeModal(): void {
  modal?.close();
}

function clearErrors(form: HTMLFormElement): void {
  form.querySelectorAll<HTMLElement>("[data-error-for]").forEach((n) => (n.textContent = ""));
  form.querySelectorAll("input").forEach((i) => i.removeAttribute("aria-invalid"));
  const general = form.querySelector<HTMLElement>(".m3x-auth-error");
  if (general) {
    general.hidden = true;
    general.querySelector("[data-auth-error]")!.textContent = "";
  }
}

function showFieldError(form: HTMLFormElement, field: string, message: string): void {
  const slot = form.querySelector<HTMLElement>(`[data-error-for="${field}"]`);
  const input = form.querySelector<HTMLInputElement>(`[name="${field}"]`);
  if (slot) slot.textContent = message;
  input?.setAttribute("aria-invalid", "true");
}

function showGeneralError(form: HTMLFormElement, message: string): void {
  const general = form.querySelector<HTMLElement>(".m3x-auth-error");
  if (general) {
    general.querySelector("[data-auth-error]")!.textContent = message;
    general.hidden = false;
  }
}

function validate(mode: Mode, data: Record<string, string>): Record<string, string> {
  const errors: Record<string, string> = {};
  const add = (field: string, msg: string | undefined) => {
    if (msg) errors[field] = msg;
  };
  if (mode === "signup") {
    add("name", validateName(data.name ?? ""));
    add("email", validateEmail(data.email ?? ""));
    add("phone", validatePhone(data.phone ?? ""));
    add("experienceYears", validateExperience(data.experienceYears ?? ""));
    add("password", validateNewPassword(data.password ?? ""));
  } else {
    add("email", validateEmail(data.email ?? ""));
    if (!data.password) errors.password = "Enter your password";
  }
  return errors;
}

async function submit(form: HTMLFormElement): Promise<void> {
  const mode = form.dataset.authForm as Mode;
  clearErrors(form);
  const data = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
  const errors = validate(mode, data);
  const fields = Object.keys(errors);
  if (fields.length) {
    fields.forEach((f) => showFieldError(form, f, errors[f]!));
    form.querySelector<HTMLInputElement>(`[name="${fields[0]}"]`)?.focus();
    return;
  }

  const button = form.querySelector<HTMLButtonElement>(".m3x-auth-submit")!;
  const labelNode = button.querySelector("[data-submit-label]")!;
  const label = labelNode.textContent;
  button.disabled = true;
  labelNode.textContent = mode === "login" ? "Logging in…" : "Creating account…";
  try {
    const { csrfToken } = await loadSession();
    const body =
      mode === "signup"
        ? { name: data.name, email: data.email, phone: normalizePhone(data.phone ?? ""), experienceYears: data.experienceYears, password: data.password }
        : { email: data.email, password: data.password };
    const res = await fetch(`/api/account/${mode}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      location.href = destination();
      return;
    }
    const payload = (await res.json().catch(() => ({}))) as { error?: string; fields?: Record<string, string> };
    if (res.status === 403) {
      // session/CSRF expired: get a fresh token and ask the user to try again
      await loadSession(true).catch(() => undefined);
      showGeneralError(form, "Your session expired. Please try again.");
    } else if (payload.fields && Object.keys(payload.fields).length) {
      for (const [f, msg] of Object.entries(payload.fields)) showFieldError(form, f, msg);
      if (res.status === 409) showGeneralError(form, payload.error ?? "");
    } else {
      showGeneralError(form, payload.error ?? "Something went wrong. Please try again.");
    }
  } catch {
    showGeneralError(form, "We couldn't reach the server. Check your connection and try again.");
  } finally {
    button.disabled = false;
    labelNode.textContent = label;
  }
}

// ---------- wiring ----------
document.addEventListener("click", async (e) => {
  const link = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[data-plan], a[data-auth-open]");
  if (!link || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  const plan = link.dataset.plan ?? null;
  const next = plan ? null : "/account";
  try {
    const s = await loadSession();
    if (s.authenticated) {
      location.href = plan ? checkoutUrl(plan) : "/account";
      return;
    }
  } catch {
    /* if the session check fails, show the popup anyway */
  }
  openModal(plan, "login", next);
});

if (modal) {
  modal.addEventListener("close", () => document.documentElement.classList.remove("m3x-auth-lock"));

  modal.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target === modal || target.closest("[data-auth-close]")) closeModal(); // backdrop or ×
    const tab = target.closest<HTMLButtonElement>("[data-auth-tab], [data-auth-switch]");
    if (tab) setMode((tab.dataset.authTab ?? tab.dataset.authSwitch) as Mode);
  });

  bindPasswordUi(modal);

  // arrow keys move between the two tabs
  modal.querySelector('[role="tablist"]')?.addEventListener("keydown", (e) => {
    const key = (e as KeyboardEvent).key;
    if (key !== "ArrowLeft" && key !== "ArrowRight") return;
    const current = modal.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]');
    setMode(current?.dataset.authTab === "login" ? "signup" : "login", false);
    modal.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus();
  });

  modal.querySelectorAll<HTMLFormElement>("[data-auth-form]").forEach((form) => {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      void submit(form);
    });
  });

  // Arriving from /checkout or an /account page without being signed in: open the popup, then return there.
  const params = new URLSearchParams(location.search);
  const auth = params.get("auth");
  if (auth === "login" || auth === "signup") {
    const plan = params.get("plan");
    const next = safeNext(params.get("next"));
    params.delete("auth");
    params.delete("plan");
    params.delete("next");
    const qs = params.toString();
    history.replaceState(null, "", location.pathname + (qs ? `?${qs}` : "") + location.hash);
    openModal(plans.some((p) => p.id === plan) ? plan : null, auth, next);
  }
}
