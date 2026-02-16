/**
 * Example: Editor-support patterns for nested blocks.
 *
 * This code would be added to scripts/editor-support.js to handle
 * Universal Editor re-decoration events for the example-nested-blocks.
 *
 * Key patterns demonstrated:
 * - getState() to capture state before re-decoration
 * - setState() to restore state after re-decoration
 * - applyChanges() to handle content patches
 * - handleSelection() to respond to component selection in UE
 *
 * This is an EXAMPLE — adapt to your project's editor-support.js structure.
 */

/**
 * Capture the current state of the nested blocks before re-decoration.
 * Called by editor-support.js before applyChanges triggers decorate().
 *
 * @param {HTMLElement} block - The block element
 * @returns {object} State to preserve across re-decoration
 */
export function getState(block) {
  return {
    expandedGroups: [...block.querySelectorAll('.nested-blocks-group[aria-expanded="true"]')]
      .map((group) => group.dataset.aueResource),
  };
}

/**
 * Restore state after re-decoration.
 * Called by editor-support.js after decorate() completes.
 *
 * @param {HTMLElement} block - The re-decorated block element
 * @param {object} state - The state captured by getState()
 */
export function setState(block, state) {
  if (!state?.expandedGroups?.length) return;

  block.querySelectorAll('.nested-blocks-group').forEach((group) => {
    if (state.expandedGroups.includes(group.dataset.aueResource)) {
      group.setAttribute('aria-expanded', 'true');
    }
  });
}

/**
 * Apply content changes from Universal Editor.
 * Handles aue:content-patch events for the nested blocks.
 *
 * @param {HTMLElement} block - The block element
 * @param {object} detail - The event detail from aue:content-patch
 */
export function applyChanges(block, detail) {
  const state = getState(block);

  // Re-run decoration (the block's decorate function handles DOM)
  // The caller (editor-support.js) typically does:
  //   const state = getState(block);
  //   await decorate(block);
  //   setState(block, state);

  return state; // Return state for the caller to use
}

/**
 * Handle component selection in Universal Editor.
 * Scrolls to and highlights the selected nested component.
 *
 * @param {HTMLElement} block - The block element
 * @param {string} resource - The data-aue-resource of the selected component
 */
export function handleSelection(block, resource) {
  // Find the selected group or item
  const selected = block.querySelector(`[data-aue-resource="${resource}"]`);
  if (!selected) return;

  // Expand parent group if selecting an item within a collapsed group
  const parentGroup = selected.closest('.nested-blocks-group');
  if (parentGroup && parentGroup.getAttribute('aria-expanded') !== 'true') {
    parentGroup.setAttribute('aria-expanded', 'true');
  }

  // Scroll into view
  selected.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
