export {};

const items = document.querySelectorAll<HTMLElement>('[data-reveal]');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

if (reduceMotion || !('IntersectionObserver' in window)) {
  items.forEach((el) => el.classList.add('is-revealed'));
} else {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-revealed');
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
  );
  items.forEach((el) => observer.observe(el));
}

document.documentElement.classList.add('reveal-ready');
