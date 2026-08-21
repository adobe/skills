/**
 * style-fingerprint.mjs — proactive per-instance variation probe (deploy Step 1, #90).
 *
 * Renders a prototype and, for every group of sibling instances, clusters each by a
 * COMBINED signature — computed style-delta (bg/border/color/bg-image/weight/align) AND
 * structural (hasImg/hasSvg/childCount). Any group with >1 cluster is a candidate
 * per-instance variation the owning block should reproduce (the agent filters legitimate
 * variation). The structural half catches :has()/:not() variants a style-only probe misses.
 *
 * Usage:
 *   node style-fingerprint.mjs "file:///abs/path/to/<prototype>.html"
 * Output: JSON — [{ section, bg, color, variationGroups:[{selector,count,variants:[{style,indices}]}] }]
 */
import { chromium } from 'playwright';
const url = process.argv[2];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
await p.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await p.waitForTimeout(1200);
const out = await p.evaluate(() => {
  const KEY = (el) => { const s = getComputedStyle(el); return {
    // STYLE-DELTA signals (the instance's own computed style)
    bg: s.backgroundColor, border: s.borderColor + ' ' + s.borderWidth, color: s.color,
    bgImg: s.backgroundImage === 'none' ? 'none' : 'img', weight: s.fontWeight,
    align: s.textAlign,
    // STRUCTURAL/CONTENT signals (what the instance CONTAINS — catches :has()/:not() variants)
    hasImg: !!el.querySelector('img,picture'), hasSvg: !!el.querySelector('svg'),
    kids: el.children.length }; };
  const sig = (f) => `${f.bg}|${f.border}|${f.color}|${f.bgImg}|${f.weight}|${f.align}|img:${f.hasImg}|svg:${f.hasSvg}|kids:${f.kids}`;
  const sections = [...document.querySelectorAll('[data-section],section')];
  const report = [];
  for (const sec of sections) {
    const name = sec.getAttribute('data-section') || sec.className.split(' ')[0] || 'section';
    const s = getComputedStyle(sec);
    const groups = [];
    // find containers whose direct children form a repeated group (>=2 same-tag+class)
    const containers = new Set([sec, ...sec.querySelectorAll('*')]);
    for (const c of containers) {
      const kids = [...c.children];
      if (kids.length < 2) continue;
      const byKey = {};
      kids.forEach((k, i) => { const key = k.tagName + '.' + (k.className.toString().split(' ')[0] || ''); (byKey[key] ||= []).push({ i, el: k }); });
      for (const [key, members] of Object.entries(byKey)) {
        if (members.length < 2) continue;
        const clusters = {};
        members.forEach((m) => { const g = sig(KEY(m.el)); (clusters[g] ||= []).push(m.i); });
        const variants = Object.entries(clusters);
        if (variants.length > 1) { // INTRA-GROUP VARIATION — the thing to preserve
          groups.push({ selector: key, count: members.length,
            variants: variants.map(([g, idx]) => ({ style: g, indices: idx })) });
        }
      }
    }
    if (name && (groups.length || s.backgroundColor !== 'rgba(0, 0, 0, 0)')) {
      report.push({ section: name, bg: s.backgroundColor, color: s.color, variationGroups: groups });
    }
  }
  return report;
});
console.log(JSON.stringify(out, null, 1));
await b.close();
