# Finish a page reduction for block planning

We are planning AEM Edge Delivery Services blocks based on the structure of
https://www.aem.live/. The browser-side tokenization pass already ran against the
live page (there is no browser in this environment); its output is
`resources/phase1-output.json`: one entry per detected section, with content
replaced by tokens such as `{TEXT}`, `{HEADING:n}`, `{IMAGE:WxH}` and `{CTA:label}`.

Finish the reduction for the block-planning team: write `skeleton.html` and
`manifest.json` to the working directory, and summarise what you found in
`answer.md`.
