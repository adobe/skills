# Facts

Verified claims the EDS skills and evals rely on. Each entry: claim, source, used by.

## Block CSS scoping

- **Claim:** block selectors start with `.{block}` or `main .{block}`; both are valid. `main .{block}` excludes copies of the block in header/footer.
- **Source:** aem-boilerplate `5cea543`, `blocks/*/*.css` use `.{block}`.
- **Used by:** `evals/css-block-scoping-and-custom-properties`, `skills/building-blocks/references/css-guidelines.md` (still `main .{block}` only).
