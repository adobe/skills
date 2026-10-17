/**
 * Splits a page path into its trail segments.
 * @param {string} path the page path
 * @returns {string[]} the segments
 */
function segments(path) {
  return path.split('/').filter(Boolean);
}

/** loads and decorates the block
 * @param {Element} block */
export default function decorate(block) {
  block.textContent = segments(window.location.pathname).join(' / ');
}
