#!/usr/bin/env node
/**
 * snapshot-forms.mjs — record a live form as a DEFINITION by probing controls,
 * not `<form>` tags (modern CMS front ends render forms without one). Output per
 * URL: `<out>/<name>.json` — sections, fields (type, label, options, required,
 * conditional), submit label, hidden field names, intro — with `_provenance`.
 * Selects the server ships empty are read after settle (client-injected options).
 * Feeds the definition-driven form block (reference/forms.md).
 *
 *   node snapshot-forms.mjs --urls <url,url> [--out data/forms] [--exclude "<extra selectors to skip>"] [--settle 3000]
 */
/* eslint-disable no-await-in-loop, no-restricted-syntax, max-len */
import { join } from 'node:path';
import { arg, list, writeJSON, provenance, loadPlaywright, settlePage, slug } from './lib.mjs';

const URLS = list(arg('urls', ''));
if (!URLS.length) { console.error('usage: snapshot-forms.mjs --urls <url,…> [--out data/forms]'); process.exit(2); }
const OUT = arg('out', 'data/forms'); const EXCLUDE = arg('exclude', ''); const SETTLE = Number(arg('settle', 3000));
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
for (const url of URLS) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await settlePage(page, { settleMs: SETTLE, maxScroll: 2400 });
  const def = await page.evaluate((extra) => {
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const root = document.querySelector('main, [role=main], .site-content') || document.body;
    const SKIP = `header, footer, nav, [role=navigation], [role=search], [role=banner], [role=contentinfo], [id*="onetrust" i], [class*="cookie" i], [class*="consent" i], [class*="login" i], [class*="signin" i], [class*="register" i], [class*="newsletter-footer" i]${extra ? `, ${extra}` : ''}`;
    const skip = (el) => (el.type || '').toLowerCase() === 'password' || !!el.closest(SKIP);
    const controls = [...root.querySelectorAll('input, select, textarea')].filter((el) => !skip(el) && !['hidden', 'submit', 'button', 'reset', 'search'].includes((el.type || '').toLowerCase()));
    if (!controls.length) return null;
    const labelOf = (el) => norm((el.id && root.querySelector(`label[for="${el.id}"]`))?.textContent) || norm(el.closest('label')?.textContent) || norm(el.getAttribute('aria-label')) || norm(el.closest('.form-group, .form-row, .field, fieldset, div')?.querySelector('label')?.textContent) || el.placeholder || '';
    const sectionOf = (el) => { const heads = [...root.querySelectorAll('h1, h2, h3, h4, legend')].filter((h) => h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING); return norm(heads.at(-1)?.textContent).slice(0, 80); };
    const fields = controls.map((el) => ({
      name: el.name || el.id || '', id: el.id || '', type: el.tagName === 'SELECT' ? 'select' : el.tagName === 'TEXTAREA' ? 'textarea' : (el.type || 'text').toLowerCase(), label: labelOf(el), section: sectionOf(el), placeholder: el.placeholder || '',
      required: el.required || el.getAttribute('aria-required') === 'true' || /\*\s*$/.test(labelOf(el)), hiddenNow: !(el.offsetWidth || el.offsetHeight) || !!el.closest('[hidden], [aria-hidden="true"], [style*="display: none"]'),
      options: el.tagName === 'SELECT' ? [...el.options].map((o) => norm(o.textContent)).filter(Boolean).slice(0, 400) : undefined, value: (el.type === 'radio' || el.type === 'checkbox') ? el.value : undefined, pattern: el.getAttribute('pattern') || undefined, maxlength: el.getAttribute('maxlength') || undefined,
    }));
    const merged = []; const groups = {};
    for (const f of fields) { if (f.type === 'radio' || f.type === 'checkbox') { const key = f.name || f.label; if (!groups[key]) { groups[key] = { ...f, label: sectionOf(controls.find((c) => c.name === f.name)) || f.label, options: [] }; merged.push(groups[key]); } groups[key].options.push(f.label || f.value); } else merged.push(f); }
    const container = controls[0].closest('form, section, article, [class*="form" i], main > div') || root;
    const submit = [...container.querySelectorAll('button, input[type=submit], [role=button]')].find((x) => !skip(x) && /submit|send|continue|enquir|subscribe|sign ?up|request|apply|pay|register/i.test(norm(x.textContent) || x.value || ''));
    const form = controls[0].closest('form');
    return {
      title: norm(root.querySelector('h1')?.textContent), intro: norm(container.querySelector('p')?.textContent).slice(0, 300), action: form?.getAttribute('action') || '', method: (form?.getAttribute('method') || 'post').toLowerCase(), hasFormTag: !!form,
      hidden: [...container.querySelectorAll('input[type=hidden]')].map((i) => i.name).filter(Boolean).slice(0, 20), submitLabel: norm(submit?.textContent) || norm(submit?.value) || 'Submit', fields: merged,
      piiSignals: merged.filter((f) => /ssn|social.?security|dob|birth|passport|account.?number|iban|card|cvv|minor|guardian|upload/i.test(`${f.name} ${f.label}`)).map((f) => f.name || f.label),
    };
  }, EXCLUDE);
  await page.close();
  if (!def) { console.error(`[forms] ${url}: no content-area controls`); continue; }
  const name = slug(new URL(url).pathname.replace(/\/$/, '').split('/').pop() || 'form');
  writeJSON(join(OUT, `${name}.json`), { _provenance: provenance('snapshot-forms', { source: url, settleMs: SETTLE }), ...def });
  console.error(`[forms] ${name}: ${def.fields.length} fields (${def.fields.filter((f) => f.hiddenNow).length} conditional, ${def.fields.filter((f) => f.options?.length).length} with options) · submit "${def.submitLabel}" · form tag ${def.hasFormTag}${def.piiSignals.length ? ` · REGULATED-PII: ${def.piiSignals.join(',')}` : ''}`);
}
await browser.close().catch(() => {});
setTimeout(() => process.exit(0), 200).unref();
