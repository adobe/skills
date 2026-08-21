# Media reconciliation (per-image delivery decision)

Imagery is the #1 fidelity risk at scale. A migration reuses source images at
their original URLs (Mode A image-reuse contract), but those URLs live on hosts
the EDS preview ingester treats in three incompatible ways — and the failure is
silent: `<img src="about:error">` still "renders". This reference makes the
per-image decision **explicit and resolvable** instead of ad-hoc.

It is the systematized form of delivery Gate 2 (`reference/delivery-gates.md`).
Where Gate 2 says "curl each external image, omit if not 200", this adds the
*decision tree* — optimize / keep / rewrite / omit — and a script that resolves
every image on the network and can apply the fix.

## The four decisions

For every authored image URL (`<img src>`, `srcset`, inline/`<style>` `url(...)`):

1. **optimize** — the URL is **same-origin** with the deploy host (a Content Bus
   asset). Safe to run `createOptimizedPicture`; EDS owns the rendition pipeline.
2. **keep** — **external**, resolves `200`. Reference as-is, but the block must
   **skip optimization** for it (see § Cross-origin optimization). Most reused
   source images land here.
3. **rewrite** — external, the literal URL breaks but a known repair resolves:
   - **missing query delimiter** — `…/<id>&wid=600` (no `?`) makes `<id>&wid=600`
     a bogus asset id → 403. Repair the first `&` after the id to `?`.
   - **wrong host** — the same asset family lives on two CDNs and only one
     serves to EDS (e.g. `cdn.shopify.com/s/files/...` returns `about:error`
     while the store's own `www.store.com/cdn/shop/files/...` resolves). Prefer
     the store-domain host. Provide the mapping with `--host-rewrite bad=good`.
   - **wrong rendition variant** — a derivative 404s where a sibling resolves
     (`…/4x3/768/…` 404, `…/original/768/…` 200). Not auto-repaired; flag for
     manual rewrite.
4. **omit** — external, a **definitive 4xx** (404/403/410) with no repair.
   **Drop the `<img>`** (and its enclosing `<picture>`/`<source>`) so the block
   renders gracefully. Never ship `about:error`, never substitute a placeholder.
5. **unresolved** — a network error, timeout, or **5xx** (transient). The image
   may be fine; the script flags it for a human and **never auto-deletes it on
   `--apply`**. Re-run, or resolve manually. The gate fails until it's cleared.

## Run it

```bash
node skills/rollout/scripts/media-reconcile.mjs --file <content.html> \
  --deploy-host <branch>--<repo>--<owner>.aem.live \
  [--host-rewrite cdn.shopify.com/s/files=www.store.com/cdn/shop/files] \
  [--json] [--apply]
```

Without `--apply` it reports the decision per image (exit `1` if any `omit`).
With `--apply` it rewrites the file in place: `rewrite` → suggested URL,
`omit` → the `<img>` (and any emptied `<picture>`) removed. Run it in Phase C
after `delivery-lint`, before the PUT.

## Cross-origin optimization (the createOptimizedPicture trap)

`createOptimizedPicture` rebuilds a URL from `origin + pathname` and appends
`?width=&format=webply&optimize=medium` — **dropping the original query** (e.g.
a Shopify `?v=` cache key) and adding params foreign CDNs mishandle. The result
is a broken `<source>`/rendition for any **cross-origin** image. Therefore:

> Blocks that call `createOptimizedPicture` (cards, columns, hero, …) must guard
> it: optimize **same-origin** assets only; for cross-origin `src`, keep the
> original `<img>` untouched.

This is a block-code rule, not just an authoring rule — bake the same-origin
guard into the stardust block templates so reused source imagery survives. The
`cross-origin-optimize` P2 in `delivery-lint` flags candidates; `media-reconcile`
is the authoritative resolver.

## Rehost vs reference

`keep` references the source CDN forever — fine for a faithful migration, but it
couples delivery to the source host staying up. When a project wants assets on
the Content Bus (decoupled, EDS-optimized), **rehost**: download the resolving
rendition into the migrated tree / DA and rewrite the `src` to the same-origin
path — which then qualifies for `optimize`. Asset bundling
(`reference/asset-bundling.md`) is the bulk mechanism; media-reconciliation is
the per-image decision that precedes it.
