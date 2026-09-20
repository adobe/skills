/**
 * cards — coverage tiles. NOTE: value-slotting (EW1 violation) left in on purpose for the eval:
 * the tile heading is rebuilt from text instead of moving the authored element.
 */
export default function decorate(block) {
  const ul = document.createElement('ul');
  [...block.children].forEach((row) => {
    const li = document.createElement('li');
    const [pic, body] = row.children;
    const h = document.createElement('h3');
    h.textContent = body.querySelector('h3, h2, p')?.textContent || ''; // value-slotting: authored heading becomes dead text
    li.append(pic, h);
    ul.append(li);
  });
  block.replaceChildren(ul);
}
