/**
 * skills/diff/scripts/content-inventory.mjs
 *
 * The SHARED content-inventory engine: one role classifier + one inventory
 * differ, consumed by every gate that measures content fidelity —
 *   - skills/diff/scripts/content-diff.mjs          (post-deploy page probe, Step 10)
 *   - skills/deploy/scripts/section-schema.mjs      (pre-code ENCODE/DECODE contract, #93)
 *   - skills/deploy/scripts/block-roundtrip.mjs     (in-loop per-block gate, #94)
 *
 * Factoring it here is the point, not a convenience: the schema a block is
 * written FROM, the in-loop assertion it is checked WITH, and the post-deploy
 * diff it is finally proved BY must all classify roles identically, or a pass
 * at one layer means nothing at the next. Change the classifier here and every
 * gate moves together.
 *
 * `inventory` runs IN the page (Playwright-serialized, ONE arg):
 *   page.evaluate(inventory, [rootSelector, eyebrow{maxFontPx,maxLen}])
 * It returns { items: [{role, order, text, key, href?, w, family, loaded}], imgCount }
 * with role ∈ heading | eyebrow | cta | body, classified by COMPUTED STYLE +
 * tag so a prototype's .ds-* DOM and an EDS block DOM compare symmetrically.
 *
 * `diffInventories(srcItems, tgtItems, prof)` consumes each source item
 * against the first unused same-key target item (duplicates count correctly)
 * and returns { flags, matchedCount }. All stack-specific labels + hints come
 * from a diff-profiles.mjs profile. Pass fontDelta: Infinity to suppress the
 * FONT FORK pass (the in-loop harness renders with local fonts, so face
 * fidelity is Step 4/10's business there, not the round-trip's).
 */

/* eslint-disable no-plusplus, no-continue, max-len */

// Runs IN the page (serialized by Playwright, so it takes ONE arg). args =
// [rootSel, eyebrow{maxFontPx,maxLen}] — the content root + label classifier
// thresholds from the active profile. Returns the role-classified inventory.
/* eslint-disable no-undef */
export function inventory(args) {
  const [rootSel, eyebrow] = args;
  const root = document.querySelector(rootSel) || document.querySelector('main') || document.body;
  const ARROWS = /[→➔➜›⇒➤>]+/g;
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  // match key: lowercase, arrows + trailing punctuation stripped, whitespace collapsed.
  const norm = (s) => clean(s).replace(ARROWS, ' ').replace(/\s+/g, ' ').trim()
    .toLowerCase().replace(/[.,;:!?·•]+$/g, '').trim();

  // Off-screen probe for rendered-face width (#77 method): a FIXED-size string
  // under an element's computed family+weight. Comparing this width across pages
  // for the SAME normalised string reveals a different actual face (e.g. the
  // prototype's system-ui fallback vs the EDS self-hosted Bebas Neue).
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;left:-9999px;top:-9999px;visibility:hidden;white-space:nowrap;font-size:48px';
  document.body.appendChild(probe);
  const widthOf = (text, family, weight) => {
    probe.style.fontFamily = family; probe.style.fontWeight = weight;
    probe.textContent = text || 'Agw1996';
    return Math.round(probe.getBoundingClientRect().width);
  };
  const namedFamily = (ff) => {
    const m = ff.match(/"([^"]+)"|'([^']+)'/);
    return (m && (m[1] || m[2])) || ff.split(',')[0].trim();
  };
  // Per element: the rendered-face width (its full computed stack), and — using
  // the SAME width probe, never document.fonts.check (#77) — whether the first
  // NAMED family actually loaded (probe it alone vs a guaranteed-absent name; equal
  // width ⇒ it fell back). The label then reads e.g. "Bebas Neue" vs "Bellfort→sys".
  const face = (text, cs) => {
    const s = (text || 'Agw1996').slice(0, 40);
    const named = namedFamily(cs.fontFamily);
    const w = widthOf(s, cs.fontFamily, cs.fontWeight);
    const loaded = widthOf(s, `"${named}",monospace`, cs.fontWeight)
      !== widthOf(s, '__no_such_face__,monospace', cs.fontWeight);
    return { w, family: loaded ? named : `${named}→sys`, loaded };
  };

  const out = [];
  let imgCount = 0;
  let order = 0;
  root.querySelectorAll('*').forEach((el) => {
    const tag = el.tagName.toLowerCase();

    // Images are visual-diff's domain (load/stretch/imagery-gap) and their alt
    // text rarely matches verbatim across proto↔EDS — count them, don't diff them.
    if (tag === 'img') { imgCount += 1; return; }

    // A text CTA: an <a> whose label is text (not an image link). Use the FULL
    // label (textContent) so <strong><a>…</a></strong> and <a><strong>…</strong></a>
    // both resolve, then skip the link's inner nodes below via closest('a').
    if (tag === 'a') {
      if (el.querySelector('img, picture')) return; // image/logo link, not a text CTA
      const t = clean(el.textContent);
      if (!t) return;
      out.push({ role: 'cta', order: order++, text: t, key: norm(t), href: el.getAttribute('href') || '', ...face(norm(t), getComputedStyle(el)) });
      return;
    }

    // Own text = DIRECT child text nodes only, so a wrapper <div><p>…</p></div>
    // isn't double-counted (the <p> carries the text, the <div> is empty).
    const own = clean([...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' '));
    if (!own) return;
    if (el.closest('a')) return; // text inside a link — already captured by the <a>

    const cs = getComputedStyle(el);
    const item = { order: order++, text: own, key: norm(own), ...face(norm(own), cs) };
    if (/^h[1-6]$/.test(tag)) item.role = 'heading';
    else if (cs.textTransform === 'uppercase' && parseFloat(cs.fontSize) <= eyebrow.maxFontPx && own.length <= eyebrow.maxLen) item.role = 'eyebrow';
    else item.role = 'body';
    out.push(item);
  });
  probe.remove();
  return { items: out, imgCount };
}
/* eslint-enable no-undef */

// Diff: consume each source item against the first unused target item with the
// same key (duplicates count correctly), classifying the outcome by role. All
// stack-specific labels (S/T) + remediation hints (H) come from the profile.
export function diffInventories(srcItems, tgtItems, prof) {
  const flags = [];
  const matched = []; // {proto, eds} pairs for the font pass
  const S = prof.source; const T = prof.target; const H = prof.hints;
  const used = new Array(tgtItems.length).fill(false);
  const findTgt = (key, role) => {
    let fallback = -1;
    for (let i = 0; i < tgtItems.length; i++) {
      if (used[i] || tgtItems[i].key !== key || !key) continue;
      if (tgtItems[i].role === role) return i; // exact role match preferred
      if (fallback < 0) fallback = i; // same text, other role
    }
    return fallback;
  };

  srcItems.forEach((p) => {
    if (!p.key) return;
    const i = findTgt(p.key, p.role);
    if (i < 0) {
      const where = `${S} ${p.role} "${p.text.slice(0, 48)}"`;
      if (p.role === 'cta') flags.push({ sev: '🔴', kind: 'MISSING CTA', msg: `${where}${p.href ? ` → ${p.href}` : ''} has no ${T} link. ${H.MISSING_CTA}` });
      else if (p.role === 'heading') flags.push({ sev: '🔴', kind: 'MISSING HEADING', msg: `${where} has no ${T} heading of the same text. ${H.MISSING_HEADING}` });
      else if (p.role === 'eyebrow') flags.push({ sev: '🔴', kind: 'MISSING EYEBROW', msg: `${where} has no ${T} match. ${H.MISSING_EYEBROW}` });
      else flags.push({ sev: '🟡', kind: 'MISSING BODY', msg: `${where.slice(0, 70)}… not found in ${T}. ${H.MISSING_BODY}` });
      return;
    }
    used[i] = true;
    const e = tgtItems[i];
    if (e.role !== p.role) {
      flags.push({ sev: '🔴', kind: 'ROLE SWAP', msg: `"${p.text.slice(0, 40)}" is a ${p.role} in the ${S} but a ${e.role} in ${T} — ${H.ROLE_SWAP}` });
    }
    matched.push({ p, e });
  });

  // EXTRA: target content with no source — invented copy to verify (advisory).
  tgtItems.forEach((e, i) => {
    if (used[i] || !e.key) return;
    if (e.role === 'body') flags.push({ sev: '🟡', kind: 'EXTRA', msg: `${T} body "${e.text.slice(0, 48)}" has no ${S} source — ${H.EXTRA_BODY}` });
    else flags.push({ sev: '🟠', kind: 'EXTRA', msg: `${T} ${e.role} "${e.text.slice(0, 48)}" has no ${S} source — ${H.EXTRA}` });
  });

  // FONT FORK: matched lines whose rendered FACE differs (width probe, #77). A
  // proprietary→self-hosted-fallback substitution fires on EVERY display line, so
  // GROUP them into one advisory rather than N near-identical paragraphs — the
  // agent/user decides whether the fork is intended.
  const forks = matched
    .filter(({ p, e }) => p.w && e.w && Math.abs(1 - e.w / p.w) > prof.fontDelta)
    .map(({ p, e }) => ({ role: p.role, text: p.text.slice(0, 28), from: p.family, to: e.family, pct: Math.round((e.w / p.w - 1) * 100) }));
  if (forks.length) {
    const shown = forks.slice(0, 8).map((f) => `${f.role} "${f.text}": ${S} ${f.from} vs ${T} ${f.to} (${f.pct}%)`).join('; ');
    const more = forks.length > 8 ? ` (+${forks.length - 8} more)` : '';
    flags.push({ sev: '🟠', kind: 'FONT FORK', msg: `${forks.length} matched line(s) render a DIFFERENT face: ${shown}${more}. ${H.FONT_FORK}` });
  }

  return { flags, matchedCount: matched.length };
}

export function summarise(inv) {
  const by = (r) => inv.items.filter((x) => x.role === r).length;
  return `${inv.items.length} text nodes — ${by('heading')} headings, ${by('eyebrow')} eyebrows, ${by('cta')} CTAs, ${by('body')} body; ${inv.imgCount} img`;
}
