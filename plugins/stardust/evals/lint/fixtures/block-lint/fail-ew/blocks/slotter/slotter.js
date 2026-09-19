/**
 * slotter — fixture: every EW value-slotting signature (N-55) in one block.
 * Rows: [title | body | cta]
 */
export default function decorate(block) {
  const out = document.createElement('div');
  [...block.children].forEach((row) => {
    const [titleCell, bodyCell, ctaCell] = row.children;
    const title = titleCell.textContent.trim();
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<div class="card-head"><span class="eyebrow">${title}</span></div><p class="body">${bodyCell.innerHTML}</p>`; // EW-VALUE ×1 (two interpolations, one literal)
    const caption = document.createElement('div');
    caption.textContent = ctaCell.querySelector('a').textContent; // EW-VALUE
    const blurb = [...bodyCell.querySelectorAll('p')].map((p) => p.textContent).join(' '); // EW-JOIN
    card.dataset.blurb = blurb;
    const pic = row.querySelector('picture');
    const ghost = pic.cloneNode(true); // EW-CLONE 🔴 (authored picture, no stripInstrumentation)
    ctaCell.querySelectorAll('a').forEach((a) => a.classList.add('cta')); // EW-CLASS
    out.append(card, caption, ghost);
  });
  block.replaceChildren(out);
}
