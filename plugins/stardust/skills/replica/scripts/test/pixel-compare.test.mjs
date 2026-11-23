#!/usr/bin/env node
// skills/replica/scripts/test/pixel-compare.test.mjs — pixel-compare.mjs's aligned mode (--align) on synthetic pages
// built in memory; no browser, no capture. Importing the module runs no compare and needs neither pngjs nor
// pixelmatch, so the PURE part runs in the plugin tree with an exact-match stand-in for the per-pixel rule:
// identical pages (not used, 0 %); a blank band inserted / rows deleted / two insertions (one step each, cumulative
// offsets, inserted / deleted row counts, the shifts summing to the height difference); HONESTY — a section replaced
// by different content of the same height still scores its share with no step, of a different height its share plus
// ONE net step placed where matching rows resume, and a page of near-identical cards with one card's text changed is not slid by a card height (alone,
// and together with a real insertion above it); never-worse (unrelated content → not used, aligned = unaligned);
// masks mapped through the alignment; the tail (rows only B has) counted; the implausible-map fallback; determinism;
// the unit pieces (rowSignatures, offsetBreakpoints, offsetMap, stepsOf, alignVerdict, alignedLine).
// Where pngjs and pixelmatch are importable (a project copy), the same suite runs again on pixelmatch and the CLI is
// run end to end: --help in an empty cwd, the JSON shape (existing fields untouched, no `aligned` without --align),
// the text line, <out stem>-aligned.png, --mask, --verdict aligned vs the default exit code, flag errors, and
// byte-identical JSON on a second run.
// Run: node plugins/stardust/skills/replica/scripts/test/pixel-compare.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALIGN, alignVerdict, alignedCompare, alignedPathOf, chroma, alignedLine, offsetBound, offsetBreakpoints, offsetMap, offsetsText, pixelVerdict, rowSignatures, stepsOf,
} from '../pixel-compare.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'pixel-compare.mjs');
let checks = 0; let failed = 0;
const check = (name, fn) => { checks += 1; try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };

// ── synthetic pages ──────────────────────────────────────────────────────────
const W = 96;
const hash = (a, b, c) => { let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return (h ^ (h >>> 16)) >>> 0; };
// a page as an array of rows (each a Buffer of W RGBA pixels), so rows can be spliced
const row = (fn) => { const r = Buffer.alloc(W * 4, 255); for (let x = 0; x < W; x += 1) { const [R, G, B] = fn(x); r[x * 4] = R; r[x * 4 + 1] = G; r[x * 4 + 2] = B; } return r; };
const blank = () => row(() => [255, 255, 255]);
// blocks 8 px wide × 6 rows tall, a white separator of 10 rows every 150; `lo`/`span` pick the palette
const blocks = (y, seed, lo = 0, span = 120) => (y % 150 >= 140 ? blank() : row((x) => { const h = hash(seed, Math.floor(y / 6), x >> 3); return [lo + (h % span), lo + ((h >> 8) % span), lo + ((h >> 16) % span)]; }));
const page = (H, seed = 1) => Array.from({ length: H }, (_, y) => blocks(y, seed));
const other = (n, seed = 99) => Array.from({ length: n }, (_, y) => row((x) => { const h = hash(seed, Math.floor(y / 5), x >> 2); return [160 + (h % 95), 160 + ((h >> 8) % 95), 160 + ((h >> 16) % 95)]; }));
const buf = (rows) => Buffer.concat(rows);
// ten near-identical cards, 120 rows each: frame, dark title bar, six "text" lines whose dashes depend on the card
const cards = (textSeed = (c) => c) => {
  const rows = [];
  for (let c = 0; c < 10; c += 1) {
    for (let y = 0; y < 120; y += 1) {
      rows.push(row((x) => {
        if (y < 8 || y >= 112 || x < 6 || x >= W - 6) return [255, 255, 255];
        if (y < 10 || y >= 110 || x < 8 || x >= W - 8) return [200, 200, 200];
        if (y >= 16 && y < 30) return [30, 40, 90];
        const line = Math.floor((y - 38) / 12); const inLine = y >= 38 && line < 6 && (y - 38) % 12 < 6;
        if (inLine && x >= 14 && x < W - 14 && hash(textSeed(c), line, x >> 1) % 3 === 0) return [20, 20, 20];
        return [246, 246, 246];
      }));
    }
  }
  return rows;
};

// the exact-match stand-in for pixelmatch: a pixel differs when any colour channel differs; red where it does
const exact = (a, b, out, w, h) => {
  let n = 0;
  for (let i = 0; i < w * h * 4; i += 4) {
    const d = a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2];
    if (d) n += 1;
    if (out) { out[i] = d ? 255 : 230; out[i + 1] = d ? 0 : 230; out[i + 2] = d ? 0 : 230; out[i + 3] = 255; }
  }
  return n;
};

// what main() does around alignedCompare: the overlap number, the candidate, the never-worse / plausibility decision
const compare = (rowsA, rowsB, countDiff, { masks = [], alignMax = 400 } = {}) => {
  const A = buf(rowsA); const B = buf(rowsB); const HA = rowsA.length; const HB = rowsB.length; const h = Math.min(HA, HB);
  const maskA = new Uint8Array(HA); const maskB = new Uint8Array(HB);
  for (const mk of masks) {
    for (let y = mk.yA; y < Math.min(HA, mk.yA + mk.h); y += 1) { maskA[y] = 1; A.fill(128, y * W * 4, (y + 1) * W * 4); }
    for (let y = mk.yB; y < Math.min(HB, mk.yB + mk.h); y += 1) { maskB[y] = 1; B.fill(128, y * W * 4, (y + 1) * W * 4); }
  }
  const cand = alignedCompare(A, B, W, HA, HB, { alignMax, maskA, maskB, countDiff });
  let maskedRows = 0;
  for (let y = 0; y < h; y += 1) if (masks.some((mk) => (y >= mk.yA && y < mk.yA + mk.h) || (y >= mk.yB && y < mk.yB + mk.h))) { maskedRows += 1; A.fill(128, y * W * 4, (y + 1) * W * 4); B.fill(128, y * W * 4, (y + 1) * W * 4); }
  const n = countDiff(A.subarray(0, h * W * 4), B.subarray(0, h * W * 4), null, W, h);
  const pct = h - maskedRows ? (100 * n) / (W * (h - maskedRows)) : 0;
  const reason = alignVerdict(cand, pct, HB - HA);
  return { pct, n, cand, used: reason === null, reason, alignedPct: reason === null ? cand.pct : pct };
};
const near = (got, want, tol, what) => assert.ok(Math.abs(got - want) <= tol, `${what}: ${got}, expected ${want} ± ${tol}`);
const insertAt = (rows, y, extra) => [...rows.slice(0, y), ...extra, ...rows.slice(y)];
const blanks = (n) => Array.from({ length: n }, blank);

function suite(label, countDiff) {
  const H = 1200; const A = page(H);

  check(`${label}: identical pages → no step, 0 %, not used`, () => {
    const r = compare(A, page(H), countDiff);
    assert.equal(r.pct, 0); assert.equal(r.cand.pct, 0); assert.deepEqual(r.cand.steps, []);
    assert.equal(r.used, false); assert.equal(r.reason, 'no offset step found'); assert.equal(r.alignedPct, 0);
  });

  check(`${label}: a blank band of 10 rows inserted at row 330 → one step +10, 10 inserted rows, aligned ≈ 0`, () => {
    const r = compare(A, insertAt(A, 330, blanks(10)), countDiff);
    assert.ok(r.pct > 50, `unaligned ${r.pct}`);
    assert.equal(r.used, true);
    assert.equal(r.cand.steps.length, 1);
    assert.deepEqual({ shift: r.cand.steps[0].shift, cumulative: r.cand.steps[0].cumulative }, { shift: 10, cumulative: 10 });
    assert.equal(r.cand.steps[0].y, 330);
    assert.equal(r.cand.insertedRows, 10); assert.equal(r.cand.deletedRows, 0);
    assert.equal(r.cand.maxOffset, 10); assert.equal(r.cand.totalShift, 10);
    // nothing but the 10 inserted rows differs; the denominator is A rows + inserted rows
    assert.equal(r.cand.rows, H + 10); assert.equal(r.cand.differing, 10 * W);
    near(r.cand.pct, (100 * 10) / (H + 10), 1e-9, 'aligned pct');
    // the per-band breakdown names the one band that still differs
    assert.deepEqual(r.cand.bands.filter((b) => b.pct > 0).map((b) => b.y0), [0]);
    assert.equal(r.cand.diff.length, H * W * 4);
  });

  check(`${label}: an inserted band inside a blank separator is found too (the step lands in the separator)`, () => {
    const r = compare(A, insertAt(A, 144, blanks(9)), countDiff);
    assert.equal(r.cand.steps.length, 1); assert.equal(r.cand.steps[0].shift, 9);
    assert.ok(r.cand.steps[0].y >= 140 && r.cand.steps[0].y <= 150, `y ${r.cand.steps[0].y}`);
    assert.equal(r.cand.differing, 9 * W);
  });

  check(`${label}: 7 rows deleted → one step −7, 7 deleted rows`, () => {
    const r = compare(A, [...A.slice(0, 500), ...A.slice(507)], countDiff);
    assert.equal(r.used, true);
    assert.deepEqual(r.cand.steps.map((s) => [s.shift, s.cumulative]), [[-7, -7]]);
    near(r.cand.steps[0].y, 500, 6, 'step y'); // rows repeat in 6-row blocks: the cut is ambiguous inside one
    assert.equal(r.cand.deletedRows, 7); assert.equal(r.cand.insertedRows, 0);
    assert.equal(r.cand.rows, H); assert.equal(r.cand.differing, 7 * W);
  });

  check(`${label}: two insertions far apart → two steps, cumulative offsets, shifts sum to the height difference`, () => {
    const B = insertAt(insertAt(A, 930, blanks(6)), 330, blanks(10));
    const r = compare(A, B, countDiff);
    assert.deepEqual(r.cand.steps.map((s) => [s.shift, s.cumulative]), [[10, 10], [6, 16]]);
    assert.deepEqual(r.cand.steps.map((s) => s.y), [330, 930]);
    assert.equal(r.cand.steps.reduce((s, x) => s + x.shift, 0), B.length - A.length);
    assert.equal(r.cand.insertedRows, 16); assert.equal(r.cand.differing, 16 * W);
  });

  check(`${label}: HONESTY — a 400-row section replaced by different content of the same height still scores its share, no step`, () => {
    const B = [...A.slice(0, 400), ...other(400), ...A.slice(800)];
    const r = compare(A, B, countDiff);
    const trueShare = (100 * 400) / H;
    assert.deepEqual(r.cand.steps, []);
    assert.ok(r.cand.pct >= 0.8 * trueShare, `candidate ${r.cand.pct} < 80 % of ${trueShare}`);
    assert.ok(r.alignedPct >= 0.8 * trueShare); assert.equal(r.used, false); assert.equal(r.alignedPct, r.pct);
  });

  check(`${label}: HONESTY — 400 rows replaced by 460 different rows → the changed rows still count, plus ONE net step +60`, () => {
    const B = [...A.slice(0, 400), ...other(460), ...A.slice(800)];
    const r = compare(A, B, countDiff);
    assert.equal(r.cand.steps.length, 1); assert.equal(r.cand.steps[0].shift, 60); assert.equal(r.cand.steps[0].cumulative, 60);
    near(r.cand.steps[0].y, 800, 6, 'step y (where matching rows resume)');
    assert.equal(r.cand.insertedRows, 60);
    assert.ok(r.cand.differing >= 0.8 * 400 * W + 60 * W, `differing ${r.cand.differing}`);
    assert.ok(r.cand.pct >= 0.8 * ((100 * 400) / H), `candidate ${r.cand.pct}`);
    assert.equal(r.used, true); assert.ok(r.alignedPct < r.pct);
    // every band of the replaced section is still named
    assert.deepEqual(r.cand.bands.filter((b) => b.pct > 15).map((b) => b.y0), [0, 500]);
  });

  check(`${label}: HONESTY — ten near-identical cards, one card's text changed → no slide by a card height`, () => {
    const cA = cards(); const cB = cards((c) => (c === 4 ? 77 : c));
    const r = compare(cA, cB, countDiff);
    assert.ok(r.n > 0);
    assert.deepEqual(r.cand.steps, []); assert.equal(r.cand.differing, r.n);
    assert.equal(r.used, false); assert.equal(r.alignedPct, r.pct);
    // the same change under a real insertion above it: one small step, the changed text still counted
    const r2 = compare(cA, insertAt(cB, 130, blanks(10)), countDiff);
    assert.deepEqual(r2.cand.steps.map((s) => s.shift), [10]);
    assert.ok(r2.cand.differing >= 0.8 * r.n + 10 * W, `differing ${r2.cand.differing}, changed text ${r.n}`);
    assert.ok(r2.cand.bands[0].pct > 0 && r2.cand.bands[1].pct > 0, 'the inserted band and the changed card are both named');
    // a card removed is a card removed: one step of a card height, 120 rows counted whole
    const r3 = compare(cA, [...cA.slice(0, 480), ...cA.slice(600)], countDiff);
    assert.deepEqual(r3.cand.steps.map((s) => s.shift), [-120]); assert.equal(r3.cand.deletedRows, 120);
    assert.ok(r3.cand.differing >= 120 * W);
  });

  check(`${label}: never worse — unrelated content, 3 rows of height jitter → not used, aligned = unaligned`, () => {
    const B = Array.from({ length: H + 3 }, (_, y) => row((x) => { const h = hash(5, y, x); return [h % 256, (h >> 8) % 256, (h >> 16) % 256]; }));
    const r = compare(A, B, countDiff);
    assert.ok(r.pct > 80);
    assert.equal(r.used, false); assert.equal(r.alignedPct, r.pct); assert.ok(r.reason.length > 0);
  });

  check(`${label}: rows only B has at the end are counted (a taller build is not a free pass)`, () => {
    const r = compare(A, [...A, ...other(40)], countDiff);
    assert.equal(r.pct, 0);
    assert.deepEqual(r.cand.steps, [{ y: H, shift: 40, cumulative: 40 }]); assert.equal(r.cand.differing, 40 * W);
    assert.equal(r.used, false); assert.equal(r.alignedPct, 0);
  });

  check(`${label}: masks stay excluded, mapped through the alignment (A's rows in A, B's rows in B)`, () => {
    // B: 10 blank rows inserted at 100, and the rows A has at 600..660 replaced (they sit at 610..670 in B)
    const B = insertAt([...A.slice(0, 600), ...other(60), ...A.slice(660)], 100, blanks(10));
    const open = compare(A, B, countDiff);
    assert.ok(open.cand.differing >= 10 * W + 0.8 * 60 * W, 'unmasked: the replaced rows count');
    const r = compare(A, B, countDiff, { masks: [{ yA: 600, h: 60, yB: 610 }] });
    assert.deepEqual(r.cand.steps.map((s) => s.shift), [10]);
    assert.equal(r.cand.rows, H + 10 - 60); assert.equal(r.cand.differing, 10 * W);
    near(r.cand.pct, (100 * 10) / (H + 10 - 60), 1e-9, 'aligned pct');
    assert.equal(r.cand.bands[1].pct, 0);
    // an inserted row that is masked on B's side is not counted either
    const r2 = compare(A, B, countDiff, { masks: [{ yA: 600, h: 60, yB: 610 }, { yA: 5000, h: 10, yB: 100 }] });
    assert.equal(r2.cand.differing, 0); assert.equal(r2.cand.rows, H - 60); assert.equal(r2.cand.insertedRows, 10);
  });

  check(`${label}: --align-max bounds the offset — a 30-row insertion is out of reach at 20`, () => {
    const B = insertAt(A, 300, blanks(30));
    assert.deepEqual(compare(A, B, countDiff).cand.steps.map((s) => s.shift), [30]);
    const r = compare(A, B, countDiff, { alignMax: 20 });
    assert.ok(r.cand.maxOffset <= 30 && r.alignedPct <= r.pct);
    assert.ok(r.cand.steps.every((s) => Math.abs(s.cumulative) <= 20 || s.y === H), JSON.stringify(r.cand.steps));
  });

  check(`${label}: deterministic — the same inputs give the same result`, () => {
    const B = insertAt([...A.slice(0, 700), ...other(55), ...A.slice(740)], 300, blanks(10));
    const strip = (r) => JSON.stringify({ ...r.cand, diff: r.cand.diff.toString('base64').length, pct: r.pct, used: r.used });
    assert.equal(strip(compare(A, B, countDiff)), strip(compare(A, B, countDiff)));
  });
}

// ── unit pieces ──────────────────────────────────────────────────────────────
check('chroma: a signature byte is clamped — pure red (R−G = 255) is 255, never 256 wrapped to 0', () => {
  assert.deepEqual([chroma(255), chroma(-255), chroma(0), chroma(254)], [255, 1, 128, 255]);
  const red = Buffer.alloc(16 * 4); for (let i = 0; i < 16; i += 1) { red[i * 4] = 255; red[i * 4 + 3] = 255; }
  const near = Buffer.from(red); for (let i = 0; i < 16; i += 1) near[i * 4] = 250;
  const { sig: a } = rowSignatures(red, 16, 1); const { sig: b } = rowSignatures(near, 16, 1);
  assert.ok(Math.max(...[...a].map((v, i) => Math.abs(v - b[i]))) <= 4, 'a saturated row and a near-identical one stay close');
  assert.equal(alignedPathOf('d/diff-iter1'), 'd/diff-iter1-aligned.png');
});
check('rowSignatures: one signature per row, uniform rows flagged, equal rows equal', () => {
  const rows = [blank(), blocks(0, 1), blocks(1, 1), blocks(6, 1)];
  const s = rowSignatures(buf(rows), W, rows.length);
  assert.equal(s.rows, 4); assert.equal(s.sig.length, 4 * s.S); assert.deepEqual([...s.flat], [1, 0, 0, 0]);
  const sigOf = (i) => [...s.sig.subarray(i * s.S, (i + 1) * s.S)];
  assert.deepEqual(sigOf(1), sigOf(2)); assert.notDeepEqual(sigOf(1), sigOf(3));
  assert.ok(s.S <= ALIGN.buckets + 2 * Math.ceil(ALIGN.buckets / 4));
});

check('offsetBreakpoints / offsetMap / stepsOf: a delete next to an insert is folded into compared rows', () => {
  const NONE = -0x40000000;
  // rows 0..3 at offset 0, rows 4..5 unmatched, rows 6..9 at offset +3 (so B has 5 rows A lacks next to them)
  const bps = offsetBreakpoints(Int32Array.from([0, 0, 0, 0, NONE, NONE, 3, 3, 3, 3]));
  assert.deepEqual(bps, [{ a0: 6, d: 3 }]);
  const map = offsetMap(bps, 10, 13);
  assert.deepEqual([...map], [0, 1, 2, 3, 4, 5, 9, 10, 11, 12]); // rows 4, 5 are compared in place; 3 B rows are inserts
  const s = stepsOf(map, 10, 13);
  assert.deepEqual(s.steps, [{ y: 6, shift: 3, cumulative: 3 }]); assert.equal(s.insertedRows, 3); assert.equal(s.deletedRows, 0);
  // a negative step deletes exactly |shift| rows of A, and the tail closes the sum on HB − HA
  const s2 = stepsOf(offsetMap([{ a0: 8, d: -4 }], 12, 10), 12, 10);
  assert.deepEqual(s2.steps, [{ y: 4, shift: -4, cumulative: -4 }, { y: 12, shift: 2, cumulative: -2 }]);
  assert.equal(s2.deletedRows, 4); assert.equal(s2.insertedRows, 2); assert.equal(s2.totalShift, 6); assert.equal(s2.maxOffset, 4);
  assert.deepEqual(stepsOf(offsetMap([], 5, 5), 5, 5).steps, []);
});

check('alignVerdict: lower and plausible → used; not lower, too many steps, back-and-forth → a reason', () => {
  const cand = (over) => ({ pct: 1, steps: [{ y: 1, shift: 5, cumulative: 5 }], totalShift: 5, ...over });
  assert.equal(alignVerdict(cand(), 2, 5), null);
  assert.match(alignVerdict(cand({ pct: 2 }), 2, 5), /not lower/);
  assert.match(alignVerdict(cand({ pct: 3 }), 2, 5), /not lower/);
  assert.match(alignVerdict(cand({ steps: [] }), 1, 0), /no offset step/);
  assert.match(alignVerdict(cand({ steps: Array.from({ length: ALIGN.maxSteps + 1 }, (_, i) => ({ y: i, shift: 1, cumulative: i })) }), 50, 0), /implausible map: \d+ offset steps/);
  assert.match(alignVerdict(cand({ totalShift: ALIGN.maxChurn + 11 }), 50, 10), /implausible map: \d+ rows of back-and-forth/);
  assert.equal(alignVerdict(cand({ totalShift: ALIGN.maxChurn + 10 }), 50, -10), null);
});

// ── the gates' pixel criterion (--offset-max): aligned % ≤ threshold AND the offsets within the bound ─────────────────
const stepsN = (...shifts) => { let c = 0; return shifts.map((shift, i) => { c += shift; return { y: 100 + 1000 * i, shift, cumulative: c }; }); };
const pxj = (pct, al = null, height = 5000, heightDelta = 0) => ({ pct, heightDelta, compared: { width: 1440, height }, ...(al ? { aligned: { used: al.used !== false, pct: al.pct ?? pct, steps: al.steps || [], totalShift: (al.steps || []).reduce((n, s) => n + Math.abs(s.shift), 0), reason: al.reason || null } } : {}) });
check('offsetBound: a number as given; prototype = 8; published = the larger of 8 and 1 % of the origin height; null = no bound', () => {
  assert.equal(offsetBound(20, 99999), 20); assert.equal(offsetBound('prototype', 99999), 8);
  assert.equal(offsetBound('published', 500), 8); assert.equal(offsetBound('published', 5000), 50); assert.equal(offsetBound('published', 849), 8); assert.equal(offsetBound('published', 850), 9);
  assert.equal(offsetBound(null, 5000), null); assert.equal(offsetBound(0, 5000), 0);
});
check('pixelVerdict: aligned % within the threshold and offsets within the bound → pass, both numbers on the line', () => {
  const v = pixelVerdict(pxj(16.62, { pct: 1.23, steps: stepsN(-5, 2) }), { threshold: 10, offsetMax: 'prototype' });
  assert.equal(v.pass, true); assert.equal(v.reason, null); assert.equal(v.used, true); assert.equal(v.alignedPct, 1.23); assert.equal(v.pct, 16.62); assert.equal(v.totalShift, 7); assert.equal(v.bound, 8);
  assert.equal(v.line, 'pixel: aligned 1.23% (unaligned 16.62%) → PASS — offsets: 2 step(s), 7px total — −5px at y=103, +2px at y=1100 (bound 8px)'.replace('y=103', 'y=100'));
});
check('pixelVerdict: aligned % within the threshold but offsets over the bound → FAIL, and the reason names the offsets, not a percentage', () => {
  const v = pixelVerdict(pxj(16.62, { pct: 1.23, steps: stepsN(-5, -20, -12) }), { threshold: 10, offsetMax: 'prototype' });
  assert.equal(v.pass, false); assert.equal(v.offsetsPass, false);
  assert.equal(v.reason, 'offsets: 3 step(s), 37px total — −5px at y=100, −20px at y=1100, −12px at y=2100 (bound 8px)');
  assert.doesNotMatch(v.reason, /%/);
  assert.match(v.line, /^pixel: aligned 1\.23% \(unaligned 16\.62%\) → FAIL — offsets: 3 step\(s\), 37px total/);
});
check('pixelVerdict: the bound per stage — 37 px fail the prototype bound (8) and pass the published one on a 5000 px origin (50); an explicit number wins', () => {
  const p = pxj(16.62, { pct: 1.23, steps: stepsN(-5, -20, -12) });
  assert.equal(pixelVerdict(p, { offsetMax: 'prototype' }).pass, false);
  const pub = pixelVerdict(p, { offsetMax: 'published' }); assert.equal(pub.pass, true); assert.equal(pub.bound, 50);
  assert.equal(pixelVerdict(pxj(16.62, { pct: 1.23, steps: stepsN(-5, -20, -12) }, 600), { offsetMax: 'published' }).pass, false, '1 % of 600 is under 8: the floor rules');
  assert.equal(pixelVerdict(p, { offsetMax: 40 }).pass, true); assert.equal(pixelVerdict(p, { offsetMax: 36 }).pass, false);
  assert.equal(pixelVerdict(p, { offsetMax: null }).pass, true, 'no bound asked: the aligned number alone');
});
check('pixelVerdict: the origin height is the overlap plus the origin\'s own tail (heightDelta = A − B > 0)', () => {
  assert.equal(pixelVerdict(pxj(3, { pct: 1, steps: stepsN(-30) }, 2000, 1000), { offsetMax: 'published' }).bound, 30);
  assert.equal(pixelVerdict(pxj(3, { pct: 1, steps: stepsN(30) }, 2000, -1000), { offsetMax: 'published' }).bound, 20);
});
check('pixelVerdict: the aligned % over the threshold fails on the percentage, the offsets still listed on the line', () => {
  const v = pixelVerdict(pxj(30.1, { pct: 12, steps: stepsN(4) }), { threshold: 10, offsetMax: 'prototype' });
  assert.equal(v.pass, false); assert.equal(v.reason, 'pixel aligned 12% (unaligned 30.1%) > 10%');
  assert.equal(v.line, 'pixel: aligned 12.00% (unaligned 30.10%) > 10% → FAIL — offsets: 1 step(s), 4px total — +4px at y=100 (bound 8px)');
});
check('pixelVerdict: alignment not used (used false, or a summary from before --align) → the unaligned rule, no bound', () => {
  for (const p of [pxj(9.9, { used: false, pct: 9.9, reason: 'no offset step found' }), pxj(9.9)]) {
    const v = pixelVerdict(p, { threshold: 10, offsetMax: 'prototype' });
    assert.equal(v.pass, true); assert.equal(v.used, false); assert.equal(v.bound, null); assert.equal(v.alignedPct, 9.9); assert.deepEqual(v.steps, []);
    assert.equal(v.line, 'pixel: 9.90% (alignment not used — the unaligned number rules) → PASS');
  }
  const f = pixelVerdict(pxj(16.62, { used: false, pct: 16.62 }), { threshold: 10, offsetMax: 'prototype' });
  assert.equal(f.pass, false); assert.equal(f.reason, 'pixel 16.62% > 10%');
});
check('pixelVerdict: a page that passed on the unaligned number still passes unless its offsets exceed the bound', () => {
  // the aligned number is never above the unaligned one, so the percentage half can only get easier
  for (const pct of [0, 1.2, 9.99, 10]) {
    assert.equal(pixelVerdict(pxj(pct), { threshold: 10, offsetMax: 'prototype' }).pass, true, `unaligned ${pct}, no alignment`);
    assert.equal(pixelVerdict(pxj(pct, { used: false, pct }), { threshold: 10, offsetMax: 'prototype' }).pass, true, `unaligned ${pct}, not used`);
    assert.equal(pixelVerdict(pxj(pct, { pct: pct / 2, steps: stepsN(3, -5) }), { threshold: 10, offsetMax: 'prototype' }).pass, true, `unaligned ${pct}, 8 px of offsets`);
    assert.equal(pixelVerdict(pxj(pct, { pct: pct / 2, steps: stepsN(3, -6) }), { threshold: 10, offsetMax: 'prototype' }).pass, pct === 0 ? false : false, `unaligned ${pct}, 9 px of offsets: the one new way to fail`);
  }
});
check('offsetsText / pixelVerdict: at most 6 steps on the line then "… N more"; at most 12 kept in steps, stepCount says how many there were', () => {
  const s = stepsN(1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1);
  assert.equal(offsetsText(s.slice(0, 6)), '+1px at y=100, +1px at y=1100, +1px at y=2100, +1px at y=3100, +1px at y=4100, +1px at y=5100');
  assert.match(offsetsText(s), /\+1px at y=5100, … 8 more$/);
  const v = pixelVerdict(pxj(20, { pct: 1, steps: s }), { offsetMax: 'prototype' });
  assert.equal(v.steps.length, 12); assert.equal(v.stepCount, 14); assert.equal(v.totalShift, 14); assert.match(v.reason, /^offsets: 14 step\(s\), 14px total — .*… 8 more \(bound 8px\)$/);
});

check('alignedLine: the one text line, used and not used', () => {
  assert.equal(alignedLine({ used: true, pct: 0.21, steps: [{ y: 64, shift: -5, cumulative: -5 }], insertedRows: 0, deletedRows: 5 }, 13.57), 'aligned: 0.21% (unaligned 13.57%) — 1 offset step: −5px at y=64  [0 rows only in B, 5 only in A — counted as differing]');
  assert.match(alignedLine({ used: true, pct: 1, steps: [{ y: 3, shift: 10, cumulative: 10 }, { y: 9, shift: 6, cumulative: 16 }], insertedRows: 16, deletedRows: 0 }, 40), /2 offset steps: \+10px at y=3, \+6px at y=9/);
  assert.match(alignedLine({ used: false, pct: 4.2, reason: 'no offset step found', candidate: { pct: 4.2, steps: 0 } }, 4.2), /^aligned: 4\.20% = unaligned — alignment not used \(no offset step found/);
});

suite('aligned (exact stand-in)', exact);

// ── with pngjs + pixelmatch (a project copy): the same suite on pixelmatch, then the CLI ─────────────────────────────
let PNG = null; let pixelmatch = null;
try { ({ PNG } = await import('pngjs')); ({ default: pixelmatch } = await import('pixelmatch')); } catch { console.log('skip  pixelmatch suite + CLI end to end (pngjs / pixelmatch not importable here — run from a project copy)'); }

const help = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd: mkdtempSync(join(tmpdir(), 'pc-help-')), encoding: 'utf8' });
check('--help: exit 0 before any I/O, names the aligned flags', () => {
  assert.equal(help.status, 0);
  for (const f of ['--align ', '--align-max <px>', '--verdict <which>', '--mask', '--timeout']) assert.ok(help.stdout.includes(f), f);
  assert.equal(help.stderr, '');
});
check('flag errors: a bad --verdict / --align-max is exit 1 before any read', () => {
  for (const bad of [['--verdict', 'best'], ['--align-max', '0'], ['--align-max', 'x']]) {
    const r = spawnSync(process.execPath, [SCRIPT, 'nope-a.png', 'nope-b.png', ...bad], { encoding: 'utf8' });
    assert.equal(r.status, 1, bad.join(' ')); assert.match(r.stderr, /bad --/);
  }
});

if (PNG && pixelmatch) {
  suite('aligned (pixelmatch)', (a, b, out, w, h) => pixelmatch(a, b, out, w, h, { threshold: 0.1 }));

  const dir = mkdtempSync(join(tmpdir(), 'pc-align-'));
  const write = (name, rows) => { const p = join(dir, name); writeFileSync(p, PNG.sync.write({ width: W, height: rows.length, data: buf(rows) })); return p; };
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  const H = 1200; const A = page(H);
  const a = write('a.png', A); const ins = write('ins.png', insertAt(A, 330, blanks(10)));

  check('CLI: without --align the JSON has no `aligned` and no aligned image is written', () => {
    const r = run(a, ins, '--json', '--out', join(dir, 'plain', 'diff.png'));
    assert.equal(r.status, 2);
    const j = JSON.parse(r.stdout);
    assert.deepEqual(Object.keys(j), ['a', 'b', 'compared', 'heightDelta', 'differingPixels', 'pct', 'threshold', 'pass', 'diff', 'masks', 'maskedRows', 'textPct', 'textBoxes', 'textPixels', 'bands']);
    assert.deepEqual(readdirSync(join(dir, 'plain')), ['diff.png']);
  });

  check('CLI --align --json: existing fields unchanged, `aligned` beside them, exit code still on the unaligned number', () => {
    const plain = JSON.parse(run(a, ins, '--json', '--out', join(dir, 'p2', 'diff.png')).stdout);
    const r = run(a, ins, '--align', '--json', '--out', join(dir, 'al', 'diff.png'));
    assert.equal(r.status, 2);
    const j = JSON.parse(r.stdout);
    for (const k of ['compared', 'heightDelta', 'differingPixels', 'pct', 'threshold', 'pass', 'masks', 'maskedRows', 'bands']) assert.deepEqual(j[k], plain[k], k);
    assert.equal(j.pass, false); assert.equal(j.verdict, 'unaligned');
    assert.deepEqual(Object.keys(j.aligned), ['used', 'pct', 'differingPixels', 'compared', 'steps', 'maxOffset', 'totalShift', 'insertedRows', 'deletedRows', 'bands', 'diff', 'reason']);
    assert.equal(j.aligned.used, true); assert.equal(j.aligned.reason, null);
    assert.deepEqual(j.aligned.steps, [{ y: 330, shift: 10, cumulative: 10 }]);
    assert.equal(j.aligned.pct, 0.83); assert.equal(j.aligned.differingPixels, 10 * W);
    assert.deepEqual(j.aligned.compared, { width: W, height: H + 10, mode: 'aligned' });
    assert.equal(j.aligned.insertedRows, 10); assert.equal(j.aligned.deletedRows, 0); assert.equal(j.aligned.maxOffset, 10); assert.equal(j.aligned.totalShift, 10);
    assert.deepEqual(j.aligned.bands.map((b) => [b.y0, b.y1]), [[0, 500], [500, 1000], [1000, 1200]]);
    assert.ok(j.aligned.bands[0].pct > 0 && j.aligned.bands[1].pct === 0 && j.aligned.bands[1].unaligned > 50);
    assert.ok(j.aligned.pct <= j.pct);
    assert.equal(j.aligned.diff, join(dir, 'al', 'diff-aligned.png'));
    const img = PNG.sync.read(readFileSync(j.aligned.diff));
    assert.equal(img.width, W); assert.equal(img.height, H);
  });

  check('CLI --verdict aligned: the exit code and `pass` follow the aligned number; the default does not', () => {
    assert.equal(run(a, ins, '--align', '--threshold', '5', '--out', join(dir, 'v0', 'diff.png')).status, 2);
    const r = run(a, ins, '--verdict', 'aligned', '--threshold', '5', '--json', '--out', join(dir, 'v1', 'diff.png'));
    assert.equal(r.status, 0);
    const j = JSON.parse(r.stdout);
    assert.equal(j.pass, true); assert.equal(j.verdict, 'aligned'); assert.ok(j.pct > 50); assert.equal(j.aligned.used, true);
    // still a FAIL when the aligned number is over the bar
    assert.equal(run(a, ins, '--verdict', 'aligned', '--threshold', '0.5', '--out', join(dir, 'v2', 'diff.png')).status, 2);
  });

  check('CLI text output: one "aligned:" line after the verdict line, per-band aligned % beside the unaligned one', () => {
    const r = run(a, ins, '--align', '--out', join(dir, 't', 'diff.png'));
    const lines = r.stdout.split('\n');
    const at = lines.findIndex((l) => l.startsWith('differing pixels:'));
    assert.equal(lines[at + 1], 'aligned: 0.83% (unaligned ' + lines[at].match(/= ([\d.]+)%/)[1] + '%) — 1 offset step: +10px at y=330  [10 rows only in B, 0 only in A — counted as differing]');
    assert.match(lines.find((l) => l.includes('500–1000')), /◄◄ hot band {2}aligned 0\.0%$/);
    assert.equal(lines.filter((l) => l.startsWith('aligned:')).length, 1);
  });

  check('CLI: identical pages and a pair alignment cannot help → used false, aligned = unaligned, no aligned image', () => {
    const same = JSON.parse(run(a, a, '--align', '--json', '--out', join(dir, 's', 'diff.png')).stdout);
    assert.equal(same.aligned.used, false); assert.equal(same.aligned.pct, 0); assert.equal(same.pct, 0); assert.deepEqual(same.aligned.steps, []);
    const noise = write('noise.png', Array.from({ length: H + 3 }, (_, y) => row((x) => { const h = hash(5, y, x); return [h % 256, (h >> 8) % 256, (h >> 16) % 256]; })));
    const r = run(a, noise, '--align', '--json', '--out', join(dir, 'n', 'diff.png'));
    const j = JSON.parse(r.stdout);
    assert.equal(j.aligned.used, false); assert.equal(j.aligned.pct, j.pct); assert.equal(j.aligned.differingPixels, j.differingPixels);
    assert.deepEqual(j.aligned.compared, j.compared); assert.deepEqual(j.aligned.steps, []); assert.equal(j.aligned.diff, null);
    assert.ok(j.aligned.reason.length > 0);
    assert.deepEqual(j.aligned.bands.map((b) => b.pct), j.bands.map((b) => b.pct));
    assert.deepEqual(readdirSync(join(dir, 'n')), ['diff.png']);
    assert.equal(run(a, noise, '--verdict', 'aligned', '--out', join(dir, 'n2', 'diff.png')).status, 2);
  });

  check('CLI --mask under --align: masked rows leave numerator and denominator, the unaligned mask fields are unchanged', () => {
    const b = write('masked.png', insertAt([...A.slice(0, 600), ...other(60), ...A.slice(660)], 100, blanks(10)));
    const j = JSON.parse(run(a, b, '--align', '--json', '--mask', '600:60@610', '--out', join(dir, 'm', 'diff.png')).stdout);
    assert.equal(j.maskedRows, 70); assert.deepEqual(j.masks, [{ yA: 600, h: 60, yB: 610 }]);
    assert.equal(j.aligned.used, true); assert.equal(j.aligned.differingPixels, 10 * W);
    assert.deepEqual(j.aligned.compared, { width: W, height: H + 10 - 60, mode: 'aligned' });
    const open = JSON.parse(run(a, b, '--align', '--json', '--out', join(dir, 'm2', 'diff.png')).stdout);
    assert.ok(open.aligned.differingPixels >= 10 * W + 0.8 * 60 * W);
  });

  check('CLI --offset-max: one +10 step fails the prototype bound (exit 2, the offsets reason, a pixel: line) and passes at 10 px; --json-out writes the same summary beside the text', () => {
    const b = write('shift10.png', insertAt(A, 330, blanks(10)));
    const out = join(dir, 'om', 'diff.png'); const jf = join(dir, 'om.json');
    const r = run(a, b, '--offset-max', 'prototype', '--json-out', jf, '--out', out);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stdout, /^differing pixels: .* → FAIL$/m); assert.match(r.stdout, /^aligned: .* 1 offset step: \+10px at y=\d+/m);
    assert.match(r.stdout, /^pixel: aligned \d+\.\d\d% \(unaligned \d+\.\d\d%\) → FAIL — offsets: 1 step\(s\), 10px total — \+10px at y=\d+ \(bound 8px\)$/m);
    const j = JSON.parse(readFileSync(jf, 'utf8'));
    assert.equal(j.pass, false); assert.equal(j.verdict, 'aligned'); assert.deepEqual(j.offsets, { bound: 8, totalShift: 10, pass: false }); assert.match(j.reason, /^offsets: 1 step\(s\), 10px total/);
    assert.equal(j.aligned.used, true); assert.ok(j.aligned.pct < 10 && j.pct > 10);
    const ok = run(a, b, '--offset-max', '10', '--json', '--out', out);
    assert.equal(ok.status, 0); const k = JSON.parse(ok.stdout); assert.equal(k.pass, true); assert.equal(k.reason, null); assert.deepEqual(k.offsets, { bound: 10, totalShift: 10, pass: true });
    assert.equal(run(a, a, '--offset-max', 'prototype', '--out', out).status, 0, 'identical pages: alignment not used, the unaligned rule');
    assert.equal(run(a, b, '--offset-max', 'wide', '--out', out).status, 1);
  });

  check('CLI: deterministic — two runs print byte-identical JSON; --timeout 0 (no supervisor) prints the same', () => {
    const b = write('mix.png', insertAt([...A.slice(0, 700), ...other(55), ...A.slice(740)], 300, blanks(10)));
    const args = [a, b, '--align', '--json', '--out', join(dir, 'd', 'diff.png')];
    const r1 = run(...args); const r2 = run(...args); const r3 = run(...args, '--timeout', '0');
    assert.ok(r1.stdout.length > 0); assert.equal(r1.stdout, r2.stdout); assert.equal(r1.stdout, r3.stdout); assert.equal(r1.status, r3.status);
  });

  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${checks - failed}/${checks} checks passed`);
process.exit(failed ? 1 : 0);
