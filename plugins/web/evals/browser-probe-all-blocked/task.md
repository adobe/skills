# Headless access blocked on an airline site

Our flight-status scraper can't load https://www.contoso-airlines.com/en-us/ in
headless Chrome (`web` CLI). `web probe` ran overnight and exited 3 (blocked); its
report is at `resources/probe-report.json`. There is no browser in this environment,
so work from the report.

Set up whatever our `web` tooling needs to load the page (it reads a recipe via
`--recipe`), or tell me what to do instead. Put your answer in
`answer.md`.
