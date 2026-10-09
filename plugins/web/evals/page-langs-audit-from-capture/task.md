# Language audit of a product page

Our support team says the Trailhead 2 product page
(https://shop.northwind-outdoor.com/en/trailhead-2) "has the wrong languages in it".
There is no browser in this environment, so I captured the page's language
signals and visible text with the browser step on my laptop: the raw
`playwright-cli run-code` output is in `resources/collect-output.txt`.

Run a language audit on it: which languages does the page actually contain, how
do they compare with what the markup declares, and what should we fix? Keep the
machine-readable result in the working directory and write your findings to
`answer.md`.
