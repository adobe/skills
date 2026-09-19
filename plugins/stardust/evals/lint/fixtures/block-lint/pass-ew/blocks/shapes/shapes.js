/**
 * shapes — the three legal template shapes that read cell text but never DISPLAY it (#79):
 * a class from a cell word, an attribute interpolation, and a template of EMPTY slots
 * built on a line that also mentions .textContent. Rows: [shape word | score | title + copy]
 */
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export default function decorate(block) {
  [...block.children].forEach((row, i) => {
    const [shapeCell, scoreCell, textCell] = row.children;
    const named = [...shapeCell.querySelectorAll('p')].find((p) => /^(arch|oval|none)$/i.test(p.textContent.trim()));
    const shape = named ? named.textContent.trim().toLowerCase() : 'arch'; // ternary: classification, not a re-emission
    const score = scoreCell.textContent.trim(); // a text read — used in an ATTRIBUTE only
    const slide = document.createElement('div');
    slide.innerHTML = `<div class="teaser${shape !== 'none' ? ` teaser--shape-${shape}` : ''}"><article class="teaser-card" aria-label="${score ? `${score} rating` : 'rating'}"><div class="teaser-text ew-text"></div></article></div>`; // class + attribute positions — legal
    const inner = `<div class="item-head"><div class="item-name ew-text"></div></div>${textCell.querySelector('p') ? '<div class="item-copy ew-text"></div>' : ''}<button type="button" aria-label="More about ${esc(textCell.querySelector('h3').textContent.trim())}">i</button>`; // empty slots; the read is an attribute
    const card = document.createElement('article');
    card.innerHTML = i % 2 ? `<div class="item-body">${inner}</div>` : inner; // ${inner} at text position: a template var, not a text read
    card.querySelector('.item-name').append(textCell.querySelector('h3')); // MOVE (EW1)
    slide.querySelector('.teaser-text').append(...textCell.querySelectorAll('p'));
    row.replaceChildren(slide, card);
  });
}
