# Style the horizontal cards variant

Authors already use a `horizontal` variant of our `cards` block
(`blocks/cards/`), but it has no styles yet: the cards still stack. On
desktop, each card should show its image left of its text.

Follow our content-driven workflow: before you change the CSS, settle the
test content. Our site's content is cloned into `./content/` and `aem up`
serves it locally.

1. Write `TEST-CONTENT.md`: one entry per page you will test against, with
   its local URL, the `cards` variants on it, and what to check there.
2. Then make the CSS change.

I'm not available for questions. Decide, and note your assumptions in
`TEST-CONTENT.md`.
