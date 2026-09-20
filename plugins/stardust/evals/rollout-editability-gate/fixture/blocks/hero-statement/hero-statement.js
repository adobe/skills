/** hero-statement — node-slotting: authored elements are MOVED into wrappers (EW1–EW3). */
export default function decorate(block) {
  const wrap = document.createElement('div');
  wrap.className = 'hero-statement-body';
  [...block.querySelectorAll('h1, h2, p')].forEach((el) => wrap.append(el));
  block.append(wrap);
}
