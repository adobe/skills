/** header — chrome block: the same value-slot is capped at 🟡; <header> in block DOM is 🔴 (#107). */
export default function decorate(block) {
  const bar = document.createElement('header'); // EW-HEADER
  const pill = document.createElement('span');
  pill.textContent = block.querySelector('a').textContent.trim(); // EW-VALUE capped 🟡 (chrome)
  bar.append(pill);
  block.replaceChildren(bar);
}
