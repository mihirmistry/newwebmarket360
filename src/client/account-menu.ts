// Header profile menu: open/close on click, close on outside click or Escape, arrow keys move between items.
const root = document.querySelector<HTMLElement>("[data-account-menu]");
const toggle = root?.querySelector<HTMLButtonElement>("[data-account-toggle]");
const panel = root?.querySelector<HTMLElement>("[data-account-panel]");

if (root && toggle && panel) {
  const items = () => Array.from(panel.querySelectorAll<HTMLElement>("a, button"));

  const setOpen = (open: boolean, focusFirst = false) => {
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    root.classList.toggle("is-open", open);
    if (open && focusFirst) items()[0]?.focus();
  };

  toggle.addEventListener("click", () => setOpen(panel.hidden));
  toggle.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true, true);
    }
  });

  panel.addEventListener("keydown", (e) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = e.key === "ArrowDown" ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
      list[next]?.focus();
    }
  });

  document.addEventListener("click", (e) => {
    if (!panel.hidden && !root.contains(e.target as Node)) setOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !panel.hidden) {
      setOpen(false);
      toggle.focus();
    }
  });
  root.addEventListener("focusout", (e) => {
    if (!root.contains(e.relatedTarget as Node | null) && e.relatedTarget) setOpen(false);
  });
}
