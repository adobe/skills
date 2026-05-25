# Motion runtime

The canonical inline JavaScript that powers every cinematic
prototype. This file is the **single source of truth** for the
runtime; `prototype --cinematic` embeds it verbatim and customizes
only the register-specific configuration constants at the top.

## Contract

The runtime is responsible for:

1. Booting **Lenis** smooth scroll (or skipping it under reduced
   motion).
2. Tracking the **nav scrolled state** (toggles `.scrolled` on the
   sticky/fixed nav element when scroll passes a threshold).
3. Registering every `[data-anim]` and `[data-tile-anim]` element
   for **scroll-progress reveal** with per-band stagger.
4. Driving the **rAF loop** that reads `lenis.scroll` once per frame
   and applies parallax + scroll-entrance transforms.
5. Wiring **IntersectionObservers** for `[data-countup]`,
   `[data-flip]`, and `[data-fill]` (one-shot reveals).
6. Splitting `[data-split]` element text into per-letter spans on
   measure.
7. Re-measuring on `resize` and on `window.load`.
8. **Reduced-motion** detection at boot — when on, neutralizes
   everything and forces final states.

## The canonical script

This block ships in every cinematic prototype, after the Lenis
`<script src="lenis.min.js">` load. Register-specific values
(parallax magnitude, stagger, sweep interval) are tuned at the top
per `motion-registers.md` § Token defaults.

```javascript
(function () {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Lenis bootstrap ────────────────────────────────────────────
  const lenis = new Lenis({ lerp: 0.1, smoothWheel: !prefersReducedMotion });
  window.__lenis = lenis;
  (function raf(t) { lenis.raf(t); requestAnimationFrame(raf); })(performance.now());

  // ── Nav scrolled state ─────────────────────────────────────────
  const nav = document.getElementById('nav');
  if (nav) lenis.on('scroll', ({ scroll }) => {
    nav.classList.toggle('scrolled', scroll > 40);
  });

  // ── Helpers ────────────────────────────────────────────────────
  const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
  const easeOut3 = t => 1 - Math.pow(1 - t, 3);
  const getDocTop = el => el.getBoundingClientRect().top + (window.__lenis ? window.__lenis.scroll : window.scrollY);

  // ── Register-specific configuration ────────────────────────────
  // `prototype --cinematic` rewrites this block per the active register.
  const animConfig = {
    parallax:      { translate: 35, fade: 0.55, rangeStart: 0, range: 80 },
    plansParallax: { translate: 16, rangeStart: 0, range: 80 },
    cards:         { trigger: 0.85, range: 0.32, slide: 40, stagger: 0.12 },
    wordmark:      { range: 0.6, clip: 80 },
  };

  // ── data-split: pre-process letter spans ───────────────────────
  document.querySelectorAll('[data-split]').forEach((el) => {
    const text = el.textContent;
    el.textContent = '';
    text.split('').forEach((ch) => {
      const s = document.createElement('span');
      s.textContent = ch === ' ' ? ' ' : ch;
      s.style.opacity = '0';
      s.style.transform = 'translateY(60%)';
      s.style.filter = 'blur(8px)';
      el.appendChild(s);
    });
  });

  // ── Register lists ─────────────────────────────────────────────
  const animList = [];     // [data-anim] / [data-tile-anim]
  const headWords = [];    // .display-head .word — clip-path reveals
  const splitLetters = []; // [data-split] letters
  let wordmarkEl = null, wordmarkTop = 0;

  function measure() {
    const postHeroEl = document.querySelector('.post-hero');
    const savedTransform = postHeroEl ? postHeroEl.style.transform : '';
    if (postHeroEl) postHeroEl.style.transform = '';

    animList.forEach(({ el }) => { el.style.opacity = el.style.transform = el.style.willChange = ''; });
    animList.length = 0;
    headWords.length = 0;
    splitLetters.length = 0;

    document.querySelectorAll('[data-anim], [data-tile-anim]').forEach((el) => {
      const parent = el.closest('.band, .ops-band, .alerts, .access, .news, .ops-section > div, .ops-tiles, .ops-alerts, .ops-mini, section');
      let stagger = 0;
      if (parent) {
        const peers = parent.querySelectorAll('[data-anim], [data-tile-anim]');
        const idx = Array.prototype.indexOf.call(peers, el);
        stagger = (idx % 8) * animConfig.cards.stagger;
      }
      el.style.opacity = '0';
      el.style.transform = el.hasAttribute('data-tile-anim')
        ? `translateY(28px) rotateX(8deg)`
        : `translateY(${animConfig.cards.slide}px)`;
      el.style.willChange = 'opacity, transform';
      animList.push({ el, triggerTop: getDocTop(el), staggerDelay: stagger });
    });

    // Display-head word clip-path reveals (kinetic-display register)
    document.querySelectorAll('.display-head, .terminals-band__head h2').forEach((head) => {
      const words = head.querySelectorAll('.word');
      const top = getDocTop(head);
      words.forEach((w, i) => {
        w.style.clipPath = 'inset(0 100% 0 0)';
        w.style.transform = 'translateY(110%)';
        w.style.willChange = 'clip-path, transform';
        headWords.push({ el: w, triggerTop: top, staggerDelay: i * 0.15 });
      });
    });

    // [data-split] letter list
    document.querySelectorAll('[data-split]').forEach((el) => {
      const top = getDocTop(el);
      el.querySelectorAll('span').forEach((s, i) => {
        splitLetters.push({ el: s, triggerTop: top, staggerDelay: i * 0.05 });
      });
    });

    // Footer wordmark wipe-up
    wordmarkEl = document.querySelector('.site-footer__wordmark');
    if (wordmarkEl) {
      wordmarkTop = getDocTop(wordmarkEl);
      wordmarkEl.style.clipPath = `inset(${animConfig.wordmark.clip}% 0 0 0)`;
      wordmarkEl.style.willChange = 'clip-path';
    }

    if (postHeroEl) postHeroEl.style.transform = savedTransform;
  }

  // ── [data-countup]: IO-triggered numeric tween ─────────────────
  const countSeen = new WeakSet();
  const countObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting || countSeen.has(entry.target)) return;
      countSeen.add(entry.target);
      const target = +entry.target.getAttribute('data-countup');
      const duration = target > 20 ? 1400 : target > 5 ? 900 : 600;
      const start = performance.now();
      (function step(now) {
        const t = clamp((now - start) / duration, 0, 1);
        entry.target.textContent = String(Math.round(easeOut3(t) * target));
        if (t < 1) requestAnimationFrame(step);
      })(performance.now());
    });
  }, { threshold: 0.4 });
  document.querySelectorAll('[data-countup]').forEach((el) => countObserver.observe(el));

  // ── [data-flip]: IO-triggered split-flap digit randomization ───
  const flipObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting || entry.target.dataset.flipped === '1') return;
      entry.target.dataset.flipped = '1';
      const target = +entry.target.getAttribute('data-flip');
      const total = 8 + Math.floor(Math.random() * 4);
      let i = 0;
      (function flap() {
        if (i >= total) { entry.target.textContent = String(target); return; }
        entry.target.textContent = String(Math.floor(Math.random() * 10));
        i++;
        setTimeout(flap, 60);
      })();
    });
  }, { threshold: 0.5 });
  document.querySelectorAll('[data-flip]').forEach((el) => flipObserver.observe(el));

  // ── [data-fill]: IO-triggered bar fill ─────────────────────────
  const fillObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting || entry.target.dataset.filled === '1') return;
      entry.target.dataset.filled = '1';
      const pct = +entry.target.getAttribute('data-fill');
      setTimeout(() => { entry.target.style.width = pct + '%'; }, 120);
    });
  }, { threshold: 0.4 });
  document.querySelectorAll('[data-fill]').forEach((el) => fillObserver.observe(el));

  // ── Live refresh sweep (live-systems register) ─────────────────
  const sweepEl = document.querySelector('.live-sweep');
  if (sweepEl && !prefersReducedMotion) {
    setInterval(() => {
      sweepEl.classList.add('sweep');
      setTimeout(() => sweepEl.classList.remove('sweep'), 1700);
    }, 5400);
  }

  // ── rAF loop: scroll-progress reveals + parallax ───────────────
  const heroMarqueeEl = document.querySelector('.hero-marquee');
  const postHeroEl = document.querySelector('.post-hero');
  let _lastMB = null;

  (function tick() {
    if (prefersReducedMotion) { requestAnimationFrame(tick); return; }
    const sY = window.__lenis ? window.__lenis.scroll : window.scrollY;
    const vh = window.innerHeight;
    const isDesktop = window.innerWidth > 767;

    // Hero parallax
    if (heroMarqueeEl) {
      const pp = animConfig.parallax;
      if (isDesktop) {
        const rs = pp.rangeStart / 100 * vh;
        const re = pp.range / 100 * vh;
        const p = easeOut3(clamp((sY - rs) / (re - rs), 0, 1));
        heroMarqueeEl.style.transform = `translateY(${p * -pp.translate}vh)`;
        document.documentElement.style.setProperty('--parallax-progress', p);
      } else {
        heroMarqueeEl.style.transform = '';
        document.documentElement.style.setProperty('--parallax-progress', 0);
      }
    }

    // Post-hero rises faster
    let postHeroOffsetPx = 0;
    if (postHeroEl) {
      const pp2 = animConfig.plansParallax;
      if (isDesktop) {
        const rs = pp2.rangeStart / 100 * vh;
        const re = pp2.range / 100 * vh;
        const p = easeOut3(clamp((sY - rs) / (re - rs), 0, 1));
        postHeroOffsetPx = p * -pp2.translate / 100 * vh;
        postHeroEl.style.transform = `translateY(${p * -pp2.translate}vh)`;
        const newMB = `${p * -pp2.translate}vh`;
        if (newMB !== _lastMB) { postHeroEl.style.marginBottom = newMB; _lastMB = newMB; }
      } else {
        postHeroEl.style.transform = '';
        if (_lastMB !== '') { postHeroEl.style.marginBottom = ''; _lastMB = ''; }
      }
    }

    // Scroll-progress entrances
    for (let i = 0; i < animList.length; i++) {
      const item = animList[i];
      const { trigger, range, slide } = animConfig.cards;
      const raw = (sY + vh * trigger - (item.triggerTop + postHeroOffsetPx)) / (vh * range);
      const p = easeOut3(clamp(raw - item.staggerDelay, 0, 1));
      item.el.style.opacity = String(p);
      if (item.el.hasAttribute('data-tile-anim')) {
        item.el.style.transform = `translateY(${(1 - p) * 28}px) rotateX(${(1 - p) * 8}deg)`;
      } else {
        item.el.style.transform = `translateY(${(1 - p) * slide}px)`;
      }
    }

    // Display-head clip-path word reveals
    for (let i = 0; i < headWords.length; i++) {
      const item = headWords[i];
      const raw = (sY + vh * 0.85 - (item.triggerTop + postHeroOffsetPx)) / (vh * 0.30);
      const p = easeOut3(clamp(raw - item.staggerDelay, 0, 1));
      item.el.style.clipPath = `inset(0 ${(1 - p) * 100}% 0 0)`;
      item.el.style.transform = `translateY(${(1 - p) * 110}%)`;
    }

    // [data-split] letter reveals
    for (let i = 0; i < splitLetters.length; i++) {
      const item = splitLetters[i];
      const raw = (sY + vh * 0.85 - (item.triggerTop + postHeroOffsetPx)) / (vh * 0.35);
      const p = easeOut3(clamp(raw - item.staggerDelay, 0, 1));
      item.el.style.opacity = String(p);
      item.el.style.transform = `translateY(${(1 - p) * 60}%)`;
      item.el.style.filter = `blur(${(1 - p) * 8}px)`;
    }

    // Footer wordmark wipe-up
    if (wordmarkEl) {
      const adjustedTop = wordmarkTop + postHeroOffsetPx;
      const wP = easeOut3(clamp((sY + vh - adjustedTop) / (vh * animConfig.wordmark.range), 0, 1));
      wordmarkEl.style.clipPath = `inset(${(1 - wP) * animConfig.wordmark.clip}% 0 0 0)`;
    }

    requestAnimationFrame(tick);
  })();

  measure();
  window.addEventListener('load',   () => requestAnimationFrame(measure), { once: true });
  window.addEventListener('resize', measure, { passive: true });

  // ── Reduced-motion: force final states ─────────────────────────
  if (prefersReducedMotion) {
    document.querySelectorAll('[data-anim], [data-tile-anim], [data-split] span').forEach((el) => {
      el.style.opacity = '1';
      el.style.transform = 'none';
      el.style.filter = 'none';
      el.style.clipPath = 'none';
    });
    document.querySelectorAll('.word').forEach((el) => {
      el.style.clipPath = 'none';
      el.style.transform = 'none';
    });
    document.querySelectorAll('[data-countup]').forEach((el) => { el.textContent = el.getAttribute('data-countup'); });
    document.querySelectorAll('[data-flip]').forEach((el) => { el.textContent = el.getAttribute('data-flip'); });
    document.querySelectorAll('[data-fill]').forEach((el) => { el.style.width = el.getAttribute('data-fill') + '%'; });
  }
})();
```

## Per-register tuning

`prototype --cinematic` rewrites the `animConfig` block per the
active register's token defaults (from `motion-registers.md`):

| Register | `parallax.translate` | `cards.slide` | `cards.stagger` |
|---|---|---|---|
| `arrival` | 35 | 40 | 0.12 |
| `kinetic-display` | 30 | 48 | 0.16 |
| `live-systems` | 0 (no hero parallax) | 36 | 0.10 |
| `editorial` | 10 | 24 | 0.18 |
| `kinetic-grid` | 0 | 28 | 0.08 |

Additional register-specific blocks are appended:

- `kinetic-display` adds the `[data-split]` letter-by-letter
  pre-process and the display-head clip-path loop (already in the
  canonical script — runs as a no-op if no markup matches).
- `live-systems` enables the `.live-sweep` interval and pulse
  animations (driven by CSS `@keyframes`, no extra JS required).
- `editorial` reduces `parallax.translate` to 10 and stretches
  durations by ~1.3× (already in `cards.stagger`).
- `kinetic-grid` disables hero parallax and tightens stagger.

The canonical script is **register-agnostic** — it handles every
attribute and every CSS hook the five registers emit. Register
choice rewires the configuration constants, not the runtime.

## No-JS fallback

A `<noscript>` block in `<head>` forces every motion-hidden initial
state to its visible end state:

```html
<noscript>
  <style>
    [data-anim], [data-tile-anim], [data-split] span {
      opacity: 1 !important;
      transform: none !important;
      filter: none !important;
      clip-path: none !important;
    }
    .word { clip-path: none !important; transform: none !important; }
    [data-parallax] { transform: none !important; }
    .hero-marquee { transform: none !important; }
    .post-hero { transform: none !important; }
  </style>
</noscript>
```

Without JS the cinematic prototype renders identically to its static
counterpart. The motion-validation gate Pass 4 enforces this.

## Per-register surface shape

Each register's runtime instantiation produces a recognisable
surface shape. The contract below names the moves the runtime is
expected to drive when the register is active; motion validation
Pass 6e (register-match audit) reads against this list.

- **arrival** — hero parallax + post-hero riser + scroll-stagger
  entrances + count-ups + footer wordmark clip-path wipe-up.
- **kinetic-display** — split-letter monogram reveal + display-head
  clip-path word wipes + split-flap numerals (`[data-flip]`) +
  infinite signage marquees + letter-by-letter cap reveals
  (`[data-split]`).
- **live-systems** — top ticker marquee + tile cascade with rotateX
  (`[data-tile-anim]`) + count-ups + bar fills (`[data-fill]`) +
  ambient micro-animations on supporting widgets + periodic
  refresh sweep (`.live-sweep`).
- **editorial** — long fade entrances + soft micro-parallax (≤ 12vh)
  + reading-paced reveals + hover-driven detail (image scale, link
  underline). No marquees, no flips, no fills.
- **kinetic-grid** — cascade tile reveals with directional stagger
  + hover lift system + tab/segment slide indicators + button
  sheen. No page-level parallax.

A rendered prototype that engages a register must pass every gate
in `motion-validation.md` including reduced-motion fallback,
no-JS render, and the multi-viewport scroll-driven check.

## Who reads, who writes

- **`prototype --cinematic`** embeds this script verbatim, tunes
  `animConfig` per register, and writes the rendered file.
- **Motion validation gate** reads the rendered file and verifies
  the runtime contract holds (no JS-hidden state at scrollY=0
  past the first 500ms; reduced-motion neutralizes everything;
  no-JS fallback renders).
- **`migrate`** copies the script through to the migrated page
  with relative-to-root-relative URL rewriting of the Lenis
  references; no other changes.
- **A reviewer** reading the proposed file sees the full motion
  contract inline — no context-switching to a separate file.
