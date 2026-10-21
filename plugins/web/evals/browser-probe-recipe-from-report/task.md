# Unblock headless access to a retail site

Our headless Chrome automation (playwright-cli) gets an error page instead of
https://shop.northwind-outdoor.com/. A colleague already ran the bot-protection
probe against the site; its report is at `resources/probe-report.json`. There is no
browser in this environment, so work from the report.

Write the browser recipe our `web` CLI consumes (`--recipe`) to
`browser-recipe.json` in the working directory, in the format `web probe`
writes (the stealth init script goes in its own file that the recipe lists). Then
explain in a few sentences, in `answer.md`, what is blocking us and why this
configuration gets through.
