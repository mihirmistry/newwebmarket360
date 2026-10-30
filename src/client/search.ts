// Header search (desktop pill + mobile menu field): suggests site pages as you type.
// Nothing shows until something is typed; then the matching pages, or "Nothing found".
import { searchPages, type SearchPage } from "../shared/site-search";

function initSearch(form: HTMLFormElement): void {
  const input = form.querySelector<HTMLInputElement>("input[type=search]");
  const list = form.querySelector<HTMLUListElement>("[data-search-list]");
  if (!input || !list) return;
  let results: SearchPage[] = [];
  let active = -1;

  function open(isOpen: boolean): void {
    list!.hidden = !isOpen;
    input!.setAttribute("aria-expanded", String(isOpen));
    form.classList.toggle("is-open", isOpen);
    if (!isOpen) setActive(-1);
  }

  function setActive(i: number): void {
    active = i;
    list!.querySelectorAll<HTMLElement>("[role=option]").forEach((opt, n) => opt.setAttribute("aria-selected", String(n === i)));
    if (i >= 0) input!.setAttribute("aria-activedescendant", `${list!.id}-${i}`);
    else input!.removeAttribute("aria-activedescendant");
  }

  function render(): void {
    const query = input!.value.trim();
    list!.replaceChildren();
    if (!query) {
      results = [];
      open(false);
      return;
    }
    results = searchPages(query);
    if (results.length === 0) {
      const empty = document.createElement("li");
      empty.className = "m3x-search-empty";
      empty.setAttribute("role", "presentation");
      empty.textContent = "Nothing found";
      list!.append(empty);
    }
    results.forEach((page, i) => {
      const li = document.createElement("li");
      li.id = `${list!.id}-${i}`;
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", "false");
      const link = document.createElement(page.soon ? "span" : "a");
      link.className = `m3x-search-item${page.soon ? " is-soon" : ""}`;
      if (link instanceof HTMLAnchorElement) {
        link.href = page.href;
        link.tabIndex = -1;
      } else li.setAttribute("aria-disabled", "true");
      const title = document.createElement("strong");
      title.textContent = page.title;
      if (page.soon) title.append(Object.assign(document.createElement("em"), { textContent: "Soon" }));
      const summary = document.createElement("small");
      summary.textContent = page.summary;
      link.append(title, summary);
      li.append(link);
      li.addEventListener("mousemove", () => setActive(i));
      if (!page.soon) link.addEventListener("click", closeMenu);
      list!.append(li);
    });
    setActive(results.length ? 0 : -1);
    open(true);
  }

  // A homepage section link ("/#pricing") on the homepage only scrolls, so close the mobile menu too.
  function closeMenu(): void {
    open(false);
    input!.blur();
    if (form.closest("#mobile-sidebar")) document.querySelector<HTMLElement>(".nav-hamburger-close")?.click();
  }

  function go(page: SearchPage | undefined): void {
    if (!page || page.soon) return;
    closeMenu();
    window.location.href = page.href;
  }

  input.addEventListener("input", render);
  input.addEventListener("focus", render);
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (list.hidden) render();
      if (!results.length) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((active + step + results.length) % results.length);
      list.querySelector(`#${CSS.escape(`${list.id}-${active}`)}`)?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Escape") {
      if (!list.hidden) {
        e.preventDefault();
        open(false);
      } else input.value = "";
    }
  });
  // Enter or the icon button opens the highlighted page; with nothing typed it just focuses the field.
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (input.value.trim() === "" && active < 0) {
      input.focus();
      return;
    }
    go(results[active >= 0 ? active : 0]);
  });
  document.addEventListener("pointerdown", (e) => {
    if (!form.contains(e.target as Node)) open(false);
  });
  form.addEventListener("focusout", (e) => {
    if (!form.contains(e.relatedTarget as Node | null)) open(false);
  });
}

document.querySelectorAll<HTMLFormElement>("[data-site-search]").forEach(initSearch);
