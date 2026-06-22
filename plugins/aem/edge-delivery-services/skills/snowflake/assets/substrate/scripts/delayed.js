/**
 * Delayed phase — non-LCP-critical work that can wait.
 * For overlay pages, this loads the template's animation engine
 * if one is shipped. Templates without animations skip silently —
 * we HEAD-probe the expected URL first so a missing engine doesn't
 * log a console 404 and doesn't pull CDN dependencies.
 */
const main = document.querySelector('main');
const template = main?.dataset?.overlay;

if (template) {
  const enginePath = `${window.hlx.codeBasePath}/scripts/${template}-animations.js`;

  const cdnDeps = [
    'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js',
    'https://cdn.jsdelivr.net/gh/studio-freight/lenis@1.0.42/bundled/lenis.min.js',
  ];

  const loadScript = (src) => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve(src);
    s.onerror = () => reject(new Error(`failed: ${src}`));
    document.head.appendChild(s);
  });

  const loadEngine = async () => {
    const cdnResults = await Promise.allSettled(cdnDeps.map(loadScript));
    cdnResults.forEach((r) => {
      if (r.status === 'rejected') {
        // eslint-disable-next-line no-console
        console.warn('[animations] CDN dep missed:', r.reason.message);
      }
    });
    const engine = document.createElement('script');
    engine.src = enginePath;
    document.head.appendChild(engine);
  };

  // Probe first. If the template ships no animation engine, the URL
  // 404s and we skip silently — no CDN deps loaded either.
  fetch(enginePath, { method: 'HEAD' })
    .then((probe) => { if (probe.ok) loadEngine(); })
    .catch(() => {
      // Network error on the probe itself — also a "no engine"
      // signal; skip silently.
    });
}
