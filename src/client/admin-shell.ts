import { confirmDialog } from "./admin-dialog";

// Admin sidebar on small screens: the menu button slides it in; the backdrop, × or Escape close it.
const side = document.querySelector<HTMLElement>("[data-adm-side]");
const menuButton = document.querySelector<HTMLButtonElement>("[data-adm-menu]");
const backdrop = document.querySelector<HTMLElement>(".adm-backdrop");

function setOpen(open: boolean): void {
  if (!side || !menuButton || !backdrop) return;
  side.classList.toggle("is-open", open);
  backdrop.hidden = !open;
  menuButton.setAttribute("aria-expanded", String(open));
  document.body.classList.toggle("adm-menu-open", open);
  if (open) side.querySelector<HTMLElement>("a, button")?.focus();
  else menuButton.focus();
}

menuButton?.addEventListener("click", () => setOpen(true));
document.querySelectorAll<HTMLElement>("[data-adm-close]").forEach((el) => el.addEventListener("click", () => setOpen(false)));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && side?.classList.contains("is-open")) setOpen(false);
});

// Desktop: collapse the sidebar to icons. Remembered in a cookie the server reads, so pages render already collapsed.
const shell = document.querySelector<HTMLElement>("[data-adm-shell]");
const collapseButton = document.querySelector<HTMLButtonElement>("[data-adm-collapse]");
collapseButton?.addEventListener("click", () => {
  const collapsed = !shell?.classList.contains("is-collapsed");
  shell?.classList.toggle("is-collapsed", collapsed);
  collapseButton.setAttribute("aria-expanded", String(!collapsed));
  collapseButton.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
  document.cookie = collapsed ? "adm_side=collapsed; path=/admin; max-age=31536000; samesite=lax" : "adm_side=; path=/admin; max-age=0; samesite=lax";
});

// Forms marked data-confirm (e.g. Delete on Orders and Messages) ask in a centred modal before submitting.
document.addEventListener("submit", async (e) => {
  const form = e.target as HTMLFormElement;
  if (!form.matches("form[data-confirm]") || form.dataset.confirmed === "yes") return;
  e.preventDefault();
  const sure = await confirmDialog({
    title: form.dataset.confirmTitle ?? "Are you sure?",
    message: form.dataset.confirm ?? "",
    confirmLabel: form.dataset.confirmLabel ?? "Delete",
    danger: true,
  });
  if (!sure) return;
  form.dataset.confirmed = "yes";
  form.requestSubmit();
});
