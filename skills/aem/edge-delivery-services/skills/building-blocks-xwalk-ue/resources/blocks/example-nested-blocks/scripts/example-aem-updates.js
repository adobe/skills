/**
 * Example: Autoblocking pattern for aem.js decorateSections.
 *
 * This code would be added to the decorateSections function in scripts/aem.js
 * to automatically create the example-nested-blocks section when specific
 * content patterns are detected.
 *
 * This is an EXAMPLE — adapt the detection logic to your project's needs.
 */

/**
 * Autoblock example-nested-blocks sections.
 * Call this from within decorateSections() in aem.js.
 *
 * @param {HTMLElement} main - The main content element
 */
export function autoblockExampleNestedBlocks(main) {
  main.querySelectorAll(':scope > div').forEach((section) => {
    // Detect sections that should become example-nested-blocks
    // Adapt this condition to your content pattern
    const hasNestedContent = section.querySelector('.example-nested-group');
    if (!hasNestedContent) return;

    // Add section metadata to trigger the section type
    section.dataset.sectionStatus = 'initialized';
    section.classList.add('example-nested-blocks-container');
  });
}
