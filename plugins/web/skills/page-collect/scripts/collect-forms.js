/**
 * Forms collector — extracts form structures, fields, and actions.
 */

export async function collectForms(page) {
  return page.evaluate(() => {
    const forms = [];
    for (const form of document.querySelectorAll('form')) {
      const fields = [];
      const inputs = form.querySelectorAll(
        'input, select, textarea, button[type="submit"]'
      );
      for (const input of inputs) {
        const label =
          input.getAttribute('aria-label') ||
          input.getAttribute('placeholder') ||
          form.querySelector(`label[for="${input.id}"]`)?.textContent?.trim() ||
          null;
        fields.push({
          tag: input.tagName.toLowerCase(),
          type: input.getAttribute('type') || null,
          name: input.getAttribute('name') || null,
          required: input.hasAttribute('required'),
          label,
        });
      }
      forms.push({
        action: form.getAttribute('action') || null,
        method: (form.getAttribute('method') || 'get').toLowerCase(),
        id: form.id || null,
        className: form.className || null,
        fields,
      });
    }
    return { forms };
  });
}
