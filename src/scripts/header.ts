export {};

const header = document.querySelector<HTMLElement>('[data-header]');
const sentinel = document.querySelector<HTMLElement>('[data-header-sentinel]');

if (header && sentinel) {
  new IntersectionObserver(([entry]) => {
    header.classList.toggle('is-scrolled', !entry.isIntersecting);
  }).observe(sentinel);
}

const menu = document.querySelector<HTMLDialogElement>('[data-menu]');
const openButton = document.querySelector<HTMLButtonElement>('[data-menu-open]');

if (menu && openButton) {
  const close = () => menu.open && menu.close();

  openButton.addEventListener('click', () => {
    menu.showModal();
    openButton.setAttribute('aria-expanded', 'true');
  });

  menu.addEventListener('close', () => openButton.setAttribute('aria-expanded', 'false'));
  menu.querySelector('[data-menu-close]')?.addEventListener('click', close);
  menu.querySelectorAll('a').forEach((link) => link.addEventListener('click', close));

  matchMedia('(min-width: 56rem)').addEventListener('change', (event) => {
    if (event.matches) close();
  });
}
