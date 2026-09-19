/**
 * promo — index-driven; @ew-exempt all — authored rows are the no-JS fallback
 */
export default function decorate(block) {
  const label = document.createElement('div');
  label.textContent = block.querySelector('p').textContent; // capped 🟡 by @ew-exempt all
  block.append(label);
}
