// Light / dark mode. Loaded in <head> (not deferred) so the saved theme is applied before the page paints.
// The choice is remembered in localStorage; the default is the light theme.
const KEY = "m3x-theme";
type Theme = "light" | "dark";

function saved(): Theme {
  try {
    return localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light"; // storage blocked (private mode etc.)
  }
}

function apply(theme: Theme): void {
  // only write when it changes: every html[data-theme] rule is re-checked on a write, across the whole page
  if (document.documentElement.dataset.theme !== theme) document.documentElement.dataset.theme = theme;
  document.querySelectorAll<HTMLButtonElement>("[data-theme-toggle]").forEach((button) => {
    button.setAttribute("aria-pressed", String(theme === "dark"));
    button.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
    button.title = theme === "dark" ? "Light mode" : "Dark mode";
  });
}

apply(saved());
// scripts are running: CSS can start widgets (e.g. the FAQ answers) in their scripted state before main.js sets them up
document.documentElement.classList.add("m3x-js");

document.addEventListener("DOMContentLoaded", () => {
  apply(saved());
  document.querySelectorAll<HTMLButtonElement>("[data-theme-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const next: Theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(KEY, next);
      } catch {
        /* still switch for this page view */
      }
      apply(next);
    });
  });
});
