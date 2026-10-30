// Homepage "One alert service" showcase: the section is pinned (CSS position: sticky) while the page scrolls through
// its track, which is split into one equal step per screenshot. Each step shows one screenshot on the right and its
// name on the left (only one name is visible at a time).
function initShowcase(root: HTMLElement): void {
  const track = root.querySelector<HTMLElement>("[data-showcase-track]");
  const titles = Array.from(root.querySelectorAll<HTMLElement>("[data-showcase-title]"));
  const slides = Array.from(root.querySelectorAll<HTMLElement>("[data-showcase-slide]"));
  if (!track || titles.length < 2 || slides.length === 0) return;
  const sticky = track.firstElementChild as HTMLElement;
  let step = -1;
  let frame = 0;

  function update(): void {
    frame = 0;
    // phones don't pin: the screenshots are simply listed
    if (getComputedStyle(sticky).position !== "sticky") return;
    const top = parseFloat(getComputedStyle(sticky).top) || 0;
    const range = track!.offsetHeight - sticky.offsetHeight;
    const scrolled = Math.min(range, Math.max(0, top - track!.getBoundingClientRect().top));
    const next = range > 0 ? Math.min(titles.length - 1, Math.floor((scrolled / range) * titles.length)) : 0;
    if (next === step) return;
    step = next;
    titles.forEach((title, i) => {
      title.classList.toggle("is-active", i === step);
      title.classList.toggle("is-past", i < step);
    });
    // (if there are more titles than screenshots, the first title goes with the first screenshot)
    const shot = Math.max(0, step - (titles.length - slides.length));
    slides.forEach((slide, i) => {
      slide.classList.toggle("is-active", i === shot);
      slide.classList.toggle("is-past", i < shot);
    });
  }

  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  update();
}

document.querySelectorAll<HTMLElement>("[data-showcase]").forEach(initShowcase);
