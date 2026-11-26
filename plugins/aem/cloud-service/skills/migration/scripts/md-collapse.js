/**
 * Collapsible Markdown lists and tables for the migration runbook.
 *
 * The first `limit` rows render normally; the rest go into an HTML
 * `<details>` block, which GitHub, the VS Code preview and most Markdown
 * renderers show collapsed. Renderers without `<details>` support show every
 * row, so nothing is ever hidden from a reader or an agent parsing the file.
 *
 * A Markdown table cannot continue across an HTML element, so the hidden part
 * repeats the table header. The blank lines around the hidden rows are
 * required: without them most renderers treat the rows as raw text.
 */

'use strict';

const DEFAULT_VISIBLE_ROWS = 10;

/**
 * @param {string[]} head   Lines repeated before each part: a table's header and
 *                          separator rows, or `[]` for a bullet list.
 * @param {string[]} rows   One Markdown line per row.
 * @param {object} [opts]
 * @param {number} [opts.limit=10]  Rows shown before the fold.
 * @param {string} [opts.noun='more'] Summary wording, e.g. `more findings` → "Show 14 more findings".
 * @returns {string[]} Markdown lines (no trailing blank line).
 */
function collapsible(head, rows, { limit = DEFAULT_VISIBLE_ROWS, noun = 'more' } = {}) {
  if (rows.length <= limit) return [...head, ...rows];
  const hidden = rows.slice(limit);
  const label = hidden.length === 1 ? noun.replace(/s$/, '') : noun;
  return [
    ...head,
    ...rows.slice(0, limit),
    '',
    '<details>',
    `<summary>Show ${hidden.length} ${label} (${rows.length} in total)</summary>`,
    '',
    ...head,
    ...hidden,
    '',
    '</details>',
  ];
}

module.exports = { collapsible, DEFAULT_VISIBLE_ROWS };
