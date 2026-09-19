/* promo — a block-granular exemption with no category: @ew-exempt config rows */
export default function decorate(block) {
  const out = document.createElement('div');
  [...block.querySelectorAll('p')].forEach((p) => {
    const q = document.createElement('p');
    q.textContent = p.textContent; // rebuilt → dead; swallowed by the granular tag
    out.append(q);
  });
  block.replaceChildren(out);
}
