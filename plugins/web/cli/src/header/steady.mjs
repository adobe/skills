/**
 * Source of a RegExp literal matching requests to A/B testing and personalisation services. The
 * capture blocks them so every session gets the page's control variant: webflow-fr's header
 * flipped between two variants per load, decided server-side (api.intellimize.co), which seeding
 * Math.random cannot pin.
 * shortcut: a fixed host list; add a service when a page's same-page check flips between variants.
 */
export const AB_TESTS = String.raw`/^https?:\/\/([^/]*\.)?(intellimize\.co|optimizely\.com|visualwebsiteoptimizer\.com|tt\.omtrdc\.net|abtasty\.com|kameleoon\.(eu|io)|convertexperiments\.com)(:\d+)?\//`;

/**
 * Source of an init script (`addInitScript`) that holds a page still between two loads:
 * - a modal <dialog> opened more than a second after the last click, Enter or Space (a marketing
 *   splash on a timer, asianpaints) is closed at once, as a visitor closes it, so the page's own
 *   close handler removes it; a click opens one as usual (a mobile menu built on showModal).
 *   Hiding it by CSS is not enough (while modal the page is inert), nor not opening it (the
 *   page's CSS showed the unopened dialog, and its body kept the scroll lock).
 *   navigator.userActivation is no test: Chrome reported it active with no input at all.
 * - a setInterval of 2 s or more never fires, so a rotating text (asianpaints' search placeholder,
 *   every 3 s) or a carousel shows its first item on every load, on the source and on the build.
 * shortcut: a rotation chained with setTimeout or done in CSS still moves; add it when a page's
 * same-page check differs by one.
 */
export const STEADY = `() => {
  let input = -Infinity;
  // Escape is no opening input: menus.mjs presses it before every menu, and the splash opened
  const opens = (e) => e.type === 'pointerdown' || e.key === 'Enter' || e.key === ' ';
  for (const type of ['pointerdown', 'keydown']) {
    addEventListener(type, (e) => { if (opens(e)) input = performance.now(); }, { capture: true });
  }
  const showModal = HTMLDialogElement.prototype.showModal;
  HTMLDialogElement.prototype.showModal = function showModalUnlessSplash() {
    showModal.call(this);
    if (performance.now() - input >= 1000) this.close();
    return undefined;
  };
  const setInterval = window.setInterval;
  window.setInterval = function setIntervalUnlessRotation(fn, delay, ...rest) {
    if (Number(delay) >= 2000) return 0;
    return setInterval(fn, delay, ...rest);
  };
}`;
