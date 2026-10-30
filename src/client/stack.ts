// Homepage "We don't guess" cards: they stick and stack while scrolling (CSS position: sticky). As each
// new card slides over, the ones underneath dim a little (they keep their size) so their top strips read as a deck.
function initStack(list: HTMLElement): void {
  const items = Array.from(list.querySelectorAll<HTMLElement>(".m3x-stack-item"));
  if (items.length < 2) return;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0;

  function update(): void {
    frame = 0;
    // arrival[j]: 0 while card j is a full card height below its resting place, 1 once it has stacked
    const arrival = items.map((item, j) => {
      if (j === 0) return 0;
      const rest = parseFloat(getComputedStyle(item).top) || 0;
      const height = items[j - 1]!.offsetHeight || 1;
      return Math.min(1, Math.max(0, 1 - (item.getBoundingClientRect().top - rest) / height));
    });
    items.forEach((item, i) => {
      const depth = reduceMotion.matches ? 0 : arrival.slice(i + 1).reduce((sum, a) => sum + a, 0);
      item.style.setProperty("--depth", depth.toFixed(3));
    });
  }

  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  reduceMotion.addEventListener?.("change", schedule);
  update();
}

document.querySelectorAll<HTMLElement>("[data-stack-cards]").forEach(initStack);
