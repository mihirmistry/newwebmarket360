// Checkout on phones: split the one form into two steps (1. your details, 2. pay & confirm).
// Desktop keeps the side-by-side layout. Without JavaScript the page stays a single form.
import { validateEmail, validateExperience, validateName, validatePaymentRef, validatePhone } from "../shared/customer-rules.js";

const form = document.querySelector<HTMLFormElement>("[data-co-form]");
if (form) initCheckout(form);

function initCheckout(form: HTMLFormElement) {
  const phone = window.matchMedia("(max-width: 767.98px)");
  const detailRules: Record<string, (v: string) => string | undefined> = {
    name: validateName,
    email: validateEmail,
    phone: validatePhone,
    experienceYears: validateExperience,
  };
  let step = form.dataset.coStart === "2" ? 2 : 1;

  const input = (name: string) => form.querySelector<HTMLInputElement>(`[name="${name}"]`);
  const errorEl = (name: string) => form.querySelector<HTMLElement>(`[data-error-for="${name}"]`);

  function setError(name: string, message: string | undefined) {
    const el = input(name);
    const box = errorEl(name);
    if (el) {
      if (message) el.setAttribute("aria-invalid", "true");
      else el.removeAttribute("aria-invalid");
    }
    if (box) box.textContent = message ?? "";
    if (name === "paid") form.querySelector(".m3x-check")?.classList.toggle("is-invalid", Boolean(message));
  }

  /** Checks the step 1 fields; shows each message and returns the first invalid input. */
  function checkDetails(): HTMLInputElement | null {
    let first: HTMLInputElement | null = null;
    for (const [name, rule] of Object.entries(detailRules)) {
      const el = input(name);
      const message = rule(el?.value ?? "");
      setError(name, message);
      if (message && !first) first = el;
    }
    return first;
  }

  function show(next: number, opts: { focus?: boolean; push?: boolean } = {}) {
    step = next;
    form.dataset.step = String(step);
    form.querySelectorAll<HTMLElement>("[data-co-progress]").forEach((li) => {
      const n = Number(li.dataset.coProgress);
      li.classList.toggle("is-done", n < step);
      if (n === step) li.setAttribute("aria-current", "step");
      else li.removeAttribute("aria-current");
    });
    if (step === 2) {
      const name = form.querySelector<HTMLElement>("[data-co-recap-name]");
      const email = form.querySelector<HTMLElement>("[data-co-recap-email]");
      if (name) name.textContent = input("name")?.value.trim() ?? "";
      if (email) email.textContent = input("email")?.value.trim() ?? "";
    }
    if (opts.push && history.pushState) history.pushState({ coStep: step }, "");
    if (opts.focus) {
      const top = form.getBoundingClientRect().top + window.scrollY - 130;
      window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
      const heading = form.querySelector<HTMLElement>(step === 1 ? "#m3x-co-form-title" : "#m3x-co-pay-title");
      heading?.focus({ preventScroll: true });
    }
  }

  function goToPayment() {
    const bad = checkDetails();
    if (bad) {
      bad.focus();
      return;
    }
    show(2, { focus: true, push: true });
  }

  function layout() {
    form.classList.toggle("is-stepped", phone.matches);
    if (phone.matches) show(step);
  }

  form.querySelector("[data-co-next]")?.addEventListener("click", goToPayment);
  form.querySelector("[data-co-back]")?.addEventListener("click", () => {
    if (history.state?.coStep === 2) history.back();
    else show(1, { focus: true });
  });
  window.addEventListener("popstate", (e) => {
    if (form.classList.contains("is-stepped")) show(e.state?.coStep === 2 ? 2 : 1, { focus: true });
  });

  // Enter in a step 1 field moves on instead of submitting half the form.
  form.addEventListener("submit", (e) => {
    const stepped = form.classList.contains("is-stepped");
    if (stepped && step === 1) {
      e.preventDefault();
      goToPayment();
      return;
    }
    // Desktop shows every field at once, so check the details too; on phones step 1 already did.
    let first = stepped ? null : checkDetails();
    const ref = input("paymentRef");
    const refError = validatePaymentRef(ref?.value ?? "");
    setError("paymentRef", refError);
    if (refError && !first) first = ref;
    const paid = input("paid");
    const paidError = paid && !paid.checked ? "Please pay using the QR code, then tick this box" : undefined;
    setError("paid", paidError);
    if (paidError && !first) first = paid;
    if (first) {
      e.preventDefault();
      first.focus();
    }
  });

  // Clear a message as soon as the field is fixed.
  form.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement;
    if (el.getAttribute("aria-invalid") !== "true") return;
    const rule = el.name === "paymentRef" ? validatePaymentRef : detailRules[el.name];
    if (rule) setError(el.name, rule(el.value));
  });
  input("paid")?.addEventListener("change", (e) => {
    if ((e.target as HTMLInputElement).checked) setError("paid", undefined);
  });

  if (phone.addEventListener) phone.addEventListener("change", layout);
  else phone.addListener(layout);
  layout();
}
