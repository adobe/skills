/**
 * showcase — cards with one declared showcase video link per row.
 * Rows: [title | price | blurb | video link]
 * @ew-exempt <a> /youtu/ — integration: the showcase video link is swallowed by the player
 */
export default function decorate(block) {
  [...block.children].forEach((row) => {
    const [titleCell, priceCell, blurbCell] = row.children;
    const card = document.createElement('div');
    card.className = 'showcase-card';
    const title = document.createElement('h3');
    title.textContent = titleCell.textContent.trim(); // EW-RETAG: line 13 — capped by the ONE declared item
    const price = document.createElement('span');
    price.textContent = priceCell.textContent.trim(); // EW-VALUE: stays 🔴 — the item is spent
    const blurb = document.createElement('div');
    blurb.innerHTML = `<p class="blurb">${blurbCell.textContent}</p>`; // EW-VALUE: stays 🔴
    card.append(title, price, blurb);
    row.replaceWith(card);
  });
}
