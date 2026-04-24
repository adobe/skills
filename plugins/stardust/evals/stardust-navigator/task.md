# Eval: stardust-navigator on a fresh project

## Setup

Create a temporary directory with no `stardust/` folder and no brand/briefing artifacts. `cd` into it.

## User prompt

"I'm starting a new marketing microsite. Where should I begin?"

## Expected behavior

The `stardust` navigator skill is invoked (either via description match or via the user prompt). It:

1. Reports "fresh project — no pipeline artifacts found".
2. Recommends running the brand skill or briefings skill first, noting they are independent.
3. Does NOT write any files.
4. Does NOT reference EDS, AEM, `localhost:3000`, or dev servers.
5. Does NOT invoke any sibling skill automatically.
