// Admin tabs (Settings page): [data-adm-tabs] holds role="tab" buttons, each controlling a role="tabpanel".
// Opens the tab the server marked (data-active), or the one a link points into (#set-angel), else the first.
// Arrow keys, Home and End move between tabs. Without JavaScript every panel simply shows.
document.querySelectorAll<HTMLElement>("[data-adm-tabs]").forEach((root) => {
  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const panelOf = (tab: HTMLButtonElement) => document.getElementById(tab.getAttribute("aria-controls") ?? "");

  function select(tab: HTMLButtonElement, focus = false, updateHash = false): void {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      const panel = panelOf(t);
      if (panel) panel.hidden = !on;
    }
    if (focus) tab.focus();
    if (updateHash) history.replaceState(null, "", `#${tab.dataset.hash ?? tab.getAttribute("aria-controls")}`);
  }

  const fromHash = () => {
    const target = location.hash ? document.getElementById(location.hash.slice(1)) : null;
    return target ? tabs.find((t) => t.dataset.hash === target.id || panelOf(t)?.contains(target)) : undefined;
  };
  select(tabs.find((t) => t.id === root.dataset.active) ?? fromHash() ?? tabs[0]!);

  for (const tab of tabs) {
    tab.addEventListener("click", () => select(tab, false, true));
    tab.addEventListener("keydown", (e) => {
      const i = tabs.indexOf(tab);
      const next =
        e.key === "ArrowRight" ? tabs[(i + 1) % tabs.length] : e.key === "ArrowLeft" ? tabs[(i - 1 + tabs.length) % tabs.length] : e.key === "Home" ? tabs[0] : e.key === "End" ? tabs[tabs.length - 1] : undefined;
      if (!next) return;
      e.preventDefault();
      select(next, true, true);
    });
  }
  window.addEventListener("hashchange", () => {
    const tab = fromHash();
    if (tab) select(tab);
  });
});
