// Loads the page's scripts (animation libraries, main.js, then the page's own scripts) once the first paint is on
// screen, so on a slow connection they don't compete with the stylesheet and fonts for the first view. Order is kept
// (async = false). The list comes from data-scripts on this script tag (views/partials/footer.ejs).
const list = (document.currentScript as HTMLScriptElement | null)?.dataset.scripts;
const scripts: string[] = list ? JSON.parse(list) : [];
let loaded = false;

function load(): void {
  if (loaded) return;
  loaded = true;
  for (const src of scripts) {
    const script = document.createElement("script");
    script.src = src;
    script.async = false;
    // into <head>: adding children to <body> makes the browser re-check structural selectors across the page
    document.head.append(script);
  }
}

// start after the browser reports the first contentful paint; a tab opened in the background never paints,
// so load anyway after a short wait
try {
  const observer = new PerformanceObserver((entries) => {
    if (entries.getEntriesByName("first-contentful-paint").length) {
      observer.disconnect();
      setTimeout(load, 0);
    }
  });
  observer.observe({ type: "paint", buffered: true });
} catch {
  requestAnimationFrame(() => setTimeout(load, 0));
}
setTimeout(load, 2500);
