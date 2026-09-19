/**
 * gallery — TWO declared items, ONE value-slotting site, ONE authored-picture clone.
 * Rows: [picture | caption | video link]
 * @ew-exempt <a> /youtu/ — integration: the gallery video link is swallowed by the player
 * @ew-exempt <p> /^\d{4}-/ — derived: the caption date is reformatted
 */
export default function decorate(block) {
  [...block.children].forEach((row) => {
    const [picCell, captionCell] = row.children;
    const caption = document.createElement('span');
    caption.textContent = captionCell.textContent.trim(); // EW-VALUE: line 11 — capped by an item (1 of 2 spent)
    const pic = picCell.querySelector('picture');
    const thumb = pic.cloneNode(true); // EW-CLONE 🔴: line 13 — an item declares a text, never a clone; stays 🔴
    thumb.classList.add('gallery-thumb');
    row.append(caption, thumb);
  });
}
