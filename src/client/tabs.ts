// Simple accessible tabs ([data-tabs]: role="tablist" buttons controlling role="tabpanel" panels).
// Click or Arrow Left/Right/Home/End to switch; only the selected tab is in the Tab order.
function initTabs(root: HTMLElement): void {
  const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  if (tabs.length === 0) return;

  function select(index: number, focus: boolean): void {
    tabs.forEach((tab, i) => {
      const selected = i === index;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      const panel = document.getElementById(tab.getAttribute("aria-controls") ?? "");
      // panels share one grid cell, so the inactive one is hidden with visibility (keeps the height steady)
      if (panel) {
        panel.classList.toggle("is-inactive", !selected);
        panel.tabIndex = selected ? 0 : -1;
      }
    });
    if (focus) tabs[index]!.focus();
  }

  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => select(i, false));
    tab.addEventListener("keydown", (e) => {
      const last = tabs.length - 1;
      const next = { ArrowRight: i === last ? 0 : i + 1, ArrowLeft: i === 0 ? last : i - 1, Home: 0, End: last }[e.key];
      if (next === undefined) return;
      e.preventDefault();
      select(next, true);
    });
  });
}

document.querySelectorAll<HTMLElement>("[data-tabs]").forEach(initTabs);
