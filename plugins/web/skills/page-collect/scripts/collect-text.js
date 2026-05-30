/**
 * Text collector — extracts visible body text, heading hierarchy,
 * word count, and language from a webpage.
 */

export async function collectText(page) {
  return page.evaluate(() => {
    const lang =
      document.documentElement.getAttribute('lang') || 'und';

    const headings = [];
    for (const h of document.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
      const text = h.textContent.trim();
      if (text) {
        headings.push({
          level: parseInt(h.tagName.substring(1), 10),
          text,
        });
      }
    }

    const exclude = 'nav, footer, script, style, noscript, svg, [hidden]';
    const clone = document.body.cloneNode(true);
    for (const el of clone.querySelectorAll(exclude)) {
      el.remove();
    }
    const text = clone.textContent
      .replace(/\s+/g, ' ')
      .trim();

    const wordCount = text
      .split(/\s+/)
      .filter((w) => w.length > 0).length;

    return { language: lang, headings, text, wordCount };
  });
}
