# Martech — carry the source tag stack over, switched off

**Opt-in.** Run this only when the owner asks to keep analytics, tags or consent on the migrated
site. Nothing is wired autonomously: CMP ids, tag-manager properties and report suites belong to the
owner's accounts, so the scaffold writes everything disabled and the owner turns each part on.

## Flow

1. **Evidence.** `node skills/spec/scripts/spec-martech.mjs --urls <home,archetypes…> --out stardust/martech`
   (or a spec's `stardust/spec/knowledge`): the OneTrust configuration (consent categories, geo rule
   sets) and the Launch library (rules with their consent groups, data elements).
2. **Contract.** `node skills/dynamics/scripts/dynamics-plan.mjs … --martech [stardust/martech]` writes
   `stardust/martech-contract.json` and `stardust/martech-handoff.md`. Vendor knowledge (CMP script,
   id attribute, consent globals, tag-manager loaders) comes from `scripts/vendors.json`. A rebuild
   keeps the owner's `enabled`, `category` and CMP id.
3. **Owner.** Hand over `martech-handoff.md`. The owner sets `enabled: true` on `consent.cmp` and on
   each route, and copies the CMP id if it was not found.
4. **Runtime.** `node skills/deploy/scripts/martech-scaffold.mjs` writes `scripts/martech.js` from the
   enabled parts: the CMP loads first in `loadEager()`, tag managers from `scripts/delayed.js`. Re-run it
   after every contract edit.
5. **Verify.** `dynamics-check.mjs` adds a `martech` feature whenever the contract exists (below).

## Consent model — keep the source's

- **`per-tag`**: Launch rules carry consent groups; the tag manager loads ungated and gates its own
  tags. Leave every route `category` null.
- **`google-consent-mode`**: the pages set a Google Consent Mode default inline; GTM loads ungated and
  the CMP updates the state. Leave routes ungated and copy the default into `head.html` before the tag manager.
- **`owner-decision`**: no gating seen inside the tag manager. Keep it ungated, or set a route
  `category` to a CMP group id (`C0002`) so that tag manager loads only once the group is granted.

Categories and geo rule sets come from the CMP configuration and stay in the CMP; nothing is
re-implemented on the site. When a tag-manager rule injects the CMP, leave `consent.cmp` disabled.

## Runtime switches

Tags load only on the contract's `productionHosts`. On preview, `?martech=on` loads the enabled parts
and `&consent=accept` grants every category; neither override works on a production host.

## Before go-live

The hand-off lists Launch rules and data elements that read old paths or selectors; the owner
rewrites them in the tag manager, including the data-layer (`datalayerPushListener`) rules, which
need the new pages to push the same events. Each rule shows the event it listens for, read from
the rule settings; payload shapes come from the owner's tagging plan. Other tag managers (GTM, Tealium, ...)
are not parsed: `spec-martech.mjs` saves each library, listed in `martech/tags.json`. Read them (or write a
throwaway extractor in the work folder) into the contract's `tagNotes`, keyed by tag manager, in Launch's shape:
`rules` (`name`, `paths`, `selectors`, `events`, `consentGroups`), `dataElements` (`name`, `selectors`, `source`) and
free `notes`. Every entry cites where in the library it was read (`from`); uncited ones are dropped. Rebuild: they
survive and render in the same sections as Launch's marked "read by the model" — evidence only, they never change the consent model. Collector CNAMEs on the new host are an owner item.

## Web SDK via `aem-martech` (owner switch)

When the source runs the Launch Web SDK extension (or a page loads `alloy.js`), the contract gains
`aemMartech`, off: orgId, datastream (or the candidates when a data element picks one), instance
name, edge domain and the source's `defaultConsent` (the plugin defaults to `pending`). The hand-off
gives the switch steps. Once `aemMartech.enabled`, the scaffold loads Web SDK eagerly after the CMP,
sends from `loadLazy()` after the footer, and loads the Launch property from `martechDelayed()`. A
category starts the SDK `pending` and grants `collect` once the CMP grants it. The scaffold refuses an empty orgId, datastream or
consent, a missing `plugins/martech`, or an enabled `adobe-launch` route for the same property.

Target (at.js, or Web SDK rules that render decisions) becomes `target`, off. Once `target.enabled`,
the scaffold sets `personalization`; it refuses unless `aemMartech` is on and the source renders
decisions through the Web SDK. at.js activities are an owner move.

## Verification

`martech` checks abort every cross-site request after recording its host, so a replay never sends a
hit to a production account; they skip on a production host. `/` must request no route or CMP host
(off by default). With an enabled `category` route, `/?martech=on` must not request it before consent.
With anything enabled, `/?martech=on&consent=accept` must request each enabled host.
