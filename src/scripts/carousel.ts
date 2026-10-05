export {};

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

for (const root of document.querySelectorAll<HTMLElement>('[data-carousel]')) {
  const track = root.querySelector<HTMLElement>('[data-carousel-track]');
  const prev = root.querySelector<HTMLButtonElement>('[data-carousel-prev]');
  const next = root.querySelector<HTMLButtonElement>('[data-carousel-next]');
  if (!track || !prev || !next) continue;

  const step = () => {
    const [first, second] = track.querySelectorAll<HTMLElement>('[data-carousel-item]');
    if (!first) return track.clientWidth;
    return second ? second.offsetLeft - first.offsetLeft : first.offsetWidth;
  };

  const scrollByStep = (direction: 1 | -1) => {
    track.scrollBy({ left: direction * step(), behavior: reduceMotion.matches ? 'auto' : 'smooth' });
  };

  let frame = 0;
  const update = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const max = track.scrollWidth - track.clientWidth;
      prev.disabled = track.scrollLeft <= 4;
      next.disabled = track.scrollLeft >= max - 4;
    });
  };

  prev.addEventListener('click', () => scrollByStep(-1));
  next.addEventListener('click', () => scrollByStep(1));
  track.addEventListener('scroll', update, { passive: true });
  new ResizeObserver(update).observe(track);
  update();
}
