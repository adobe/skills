/**
 * Example Nested Blocks — Parent container block.
 *
 * Demonstrates the PARENT CONTAINER pattern:
 * - Has a filter (contains example-nested-group children)
 * - Does NOT use key-value configuration
 * - Reads own settings from dataset, NOT readBlockConfig()
 * - Queries child groups directly via DOM
 * - Calls moveInstrumentation for every restructured element
 *
 * Hierarchy: Section → [this block] → example-nested-group → example-nested-item
 *
 * NOTE: This JS decorates the SECTION-level component (example-nested-blocks).
 * The section model has a "title" field. The child group model has "heading"
 * and "expanded" fields — those are read by the GROUP's decoration, not here.
 *
 * @param {HTMLDivElement} block - The block element to decorate
 */
import { moveInstrumentation } from "../../scripts/scripts.js";
import { decorateIcons } from "../../scripts/aem.js";

export default function decorate(block) {
  // Section reads its own model field ("title") from dataset — NOT readBlockConfig()
  const title = block.dataset.title || "";

  const groups = [...block.querySelectorAll(":scope > div")];
  block.textContent = "";

  // Build section wrapper
  const wrapper = document.createElement("div");
  wrapper.className = "nested-blocks-wrapper";

  if (title) {
    const headingEl = document.createElement("h3");
    headingEl.className = "nested-blocks-heading";
    headingEl.textContent = title;
    wrapper.append(headingEl);
  }

  const groupList = document.createElement("ul");
  groupList.className = "nested-blocks-groups";
  groupList.setAttribute("role", "list");

  groups.forEach((group) => {
    const li = document.createElement("li");
    li.className = "nested-blocks-group";
    moveInstrumentation(group, li);

    // Transfer child content
    while (group.firstChild) li.append(group.firstChild);

    // Child groups manage their own expanded state via their model fields
    // (block.dataset.expanded on the group element, set by UE from the group model)

    groupList.append(li);
  });

  wrapper.append(groupList);
  decorateIcons(wrapper);
  block.append(wrapper);
}
