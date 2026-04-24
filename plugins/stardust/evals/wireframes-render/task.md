# Eval: wireframe rendered from a briefing

## Setup

Project contains `stardust/briefings/landing.md` with the following content:

```
# Landing page

## Intent
Convert SaaS shoppers into trial signups.

## Audience
SMB product managers evaluating team tools.

## Key messages
1. Saves 10 hours per week.
2. Integrates with the tools you already use.
3. Free for teams under 5.

## CTAs
Start free trial. Book demo.
```

No `stardust/wireframes/` folder. No brand-profile.json.

## User prompt

"Wireframe the landing page."

## Expected behavior

The `wireframes` skill is invoked. It:

1. Reads `stardust/briefings/landing.md`.
2. Produces `stardust/wireframes/landing.html` — grey-on-white, no brand fonts or colors.
3. Each section has `data-section="..."` and `data-intent="..."` attributes.
4. Sections cover hero, value props, CTA — consistent with the briefing.
5. No brand styling, no imagery, no real copy beyond placeholders.
6. No dev-server references; the file opens directly in a browser.
