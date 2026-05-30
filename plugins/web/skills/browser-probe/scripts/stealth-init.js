/**
 * Stealth init script — patches browser fingerprints to avoid headless detection.
 * Injected via playwright-cli initScript (not eval — eval only accepts pure expressions).
 * Uses explicit window.* assignment for isolated execution context compatibility.
 */
(function () {
  // Hide webdriver property (primary headless signal)
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

  // Add realistic plugins (headless Chrome has empty plugins array)
  Object.defineProperty(navigator, 'plugins', {
    get: () => [
      { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
      { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
    ],
  });

  // Set realistic languages (headless may report empty)
  Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });

  // Add chrome runtime object (missing in headless)
  window.chrome = { runtime: {} };
})();
