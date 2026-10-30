// Show/hide password buttons and the 4-bar strength meter, shared by the auth popup and the profile page.
import { PASSWORD_RULES, STRENGTH_LABELS, passwordStrength } from "../shared/customer-rules";

/** Fill the strength bars and tick the password rules for one input. */
export function updateStrength(input: HTMLInputElement): void {
  const field = input.closest(".m3x-field");
  const meter = field?.querySelector<HTMLElement>(".m3x-strength");
  if (!field || !meter) return;
  const value = input.value;
  const score = passwordStrength(value);
  meter.dataset.strength = String(score);
  field.querySelector("[data-strength-label]")!.textContent = score ? `Password strength: ${STRENGTH_LABELS[score]}` : "Password strength";
  for (const rule of PASSWORD_RULES) {
    field.querySelector(`[data-rule="${rule.id}"]`)?.classList.toggle("is-met", rule.test(value));
  }
}

export function bindPasswordUi(root: ParentNode): void {
  root.querySelectorAll<HTMLButtonElement>("[data-pass-toggle]").forEach((toggle) => {
    toggle.addEventListener("click", () => {
      const input = toggle.parentElement?.querySelector("input");
      if (!input) return;
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      toggle.setAttribute("aria-pressed", String(show));
      toggle.setAttribute("aria-label", show ? "Hide password" : "Show password");
    });
  });
  root.querySelectorAll<HTMLInputElement>("[data-strength-input]").forEach((input) => {
    input.addEventListener("input", () => updateStrength(input));
    if (input.value) updateStrength(input);
  });
}
