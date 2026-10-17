// Columns block: sets the column count as a class.
export default function decorate(block) {
  const cols = block.firstElementChild ? block.firstElementChild.children.length : 0;
  block.classList.add(`columns-${cols}-cols`);
}
