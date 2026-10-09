// playwright-cli run-code script — extract language signals and visible text.
// Usage: playwright-cli run-code --filename=collect.js
async page => {
  return await page.evaluate(() => {
    const htmlLang = document.documentElement.getAttribute('lang') || null;

    const langCounts = new Map();
    for (const el of document.querySelectorAll('[lang]')) {
      if (el === document.documentElement) continue;
      const lang = el.getAttribute('lang');
      if (lang) langCounts.set(lang, (langCounts.get(lang) || 0) + 1);
    }
    const nestedLangs = [...langCounts.entries()]
      .map(([lang, count]) => ({ lang, count }));

    const hreflang = [...document.querySelectorAll('link[rel="alternate"][hreflang]')]
      .map((l) => ({ hreflang: l.getAttribute('hreflang'), href: l.getAttribute('href') }));

    const metaEl = document.querySelector(
      'meta[http-equiv="content-language"], meta[name="language"]'
    );
    const metaContentLanguage = metaEl ? metaEl.getAttribute('content') : null;

    // Visible body text, one line per block, so detect.mjs can classify each
    // block separately. Nav/footer stay in: language switchers live there.
    const text = document.body.innerText
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join('\n');

    return {
      url: window.location.href,
      htmlLang,
      nestedLangs,
      hreflang,
      metaContentLanguage,
      text,
      wordCount: text.split(/\s+/).filter((w) => w.length > 0).length,
    };
  });
}
