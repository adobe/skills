/**
 * dated — press listing head. Rows: [ISO date | title]
 * @ew-exempt <p> /^\d{4}-/ — derived: the ISO date is re-rendered as a month label
 */
export default function decorate(block) {
  [...block.children].forEach((row) => {
    const [dateCell] = row.children;
    const month = document.createElement('span');
    month.className = 'dated-month';
    month.textContent = new Date(dateCell.textContent.trim()).toLocaleString('en', { month: 'short' }); // EW-VALUE, capped 🟡 by the declared item
    row.prepend(month);
  });
}
