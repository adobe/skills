/*
 * Scroll reveal — the source's site-wide behaviour (shared/app.js, carried by the prototype):
 * an element fades + rises in once 14 % of it is on screen (rootMargin -8 % bottom).
 * Blocks call reveal(wrapper, delay) on WRAPPERS they own (EW2: never on an authored element).
 */

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let observer;

function getObserver() {
  if (observer || !('IntersectionObserver' in window)) return observer;
  observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-in');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.14, rootMargin: '0px 0px -8% 0px' });
  return observer;
}

/**
 * Marks an element for scroll reveal and observes it.
 * @param {Element} el the element to reveal (a block-owned wrapper)
 * @param {number} [delay] transition delay in seconds (prototype --reveal-delay)
 */
export function reveal(el, delay = 0) {
  if (!el) return;
  el.classList.add('reveal');
  if (delay) el.style.setProperty('--reveal-delay', `${delay}s`);
  const io = reduce ? null : getObserver();
  if (io) io.observe(el);
  else el.classList.add('is-in');
}

/**
 * Observes every `.reveal` element under root that is not yet revealed.
 * @param {Element} [root] container to scan (default: document)
 */
export function observeReveals(root = document) {
  root.querySelectorAll('.reveal:not(.is-in)').forEach((el) => reveal(el));
}
