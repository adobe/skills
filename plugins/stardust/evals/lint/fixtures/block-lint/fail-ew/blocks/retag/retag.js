/** retag — a heading rebuilt as a new element (EW-RETAG). */
export default function decorate(block) {
  const authored = block.querySelector('h2');
  const h = document.createElement('h2');
  h.textContent = authored.textContent; // EW-RETAG (not a second EW-VALUE)
  block.replaceChildren(h);
}
