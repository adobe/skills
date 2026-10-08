import { CAPS, TEST_DATA } from './lib.mjs';
import { redactPersisted, redactText } from './detect-redaction.mjs';

export const INIT_SCRIPT = String.raw`(() => {
  const probe = window.__apiProbe = window.__apiProbe || { tokens: [], dataLayer: [] };

  function wrapExecute(owner, key, kind) {
    if (!owner || typeof owner[key] !== 'function' || owner[key].__apiProbeWrapped) return;
    const original = owner[key];
    owner[key] = function apiProbeExecute(siteKey, options) {
      const result = original.apply(this, arguments);
      return Promise.resolve(result).then((value) => {
        probe.tokens.push({ siteKey, action: options && options.action || null, value: String(value || ''), kind });
        return value;
      });
    };
    owner[key].__apiProbeWrapped = true;
  }

  function wrapGrecaptcha(value) {
    if (!value || typeof value !== 'object') return value;
    wrapExecute(value, 'execute', 'recaptcha');
    if (value.enterprise) wrapExecute(value.enterprise, 'execute', 'recaptcha-enterprise');
    let enterprise = value.enterprise;
    try {
      Object.defineProperty(value, 'enterprise', {
        configurable: true,
        get() { return enterprise; },
        set(next) {
          enterprise = next;
          if (enterprise) wrapExecute(enterprise, 'execute', 'recaptcha-enterprise');
        },
      });
    } catch (e) { /* ignore non-configurable vendor objects */ }
    return value;
  }

  let grecaptchaValue = wrapGrecaptcha(window.grecaptcha);
  try {
    Object.defineProperty(window, 'grecaptcha', {
      configurable: true,
      get() { return grecaptchaValue; },
      set(next) { grecaptchaValue = wrapGrecaptcha(next); },
    });
  } catch (e) { if (window.grecaptcha) wrapGrecaptcha(window.grecaptcha); }

  function wrapDataLayer(value) {
    const arr = Array.isArray(value) ? value : [];
    if (arr.__apiProbeWrapped) return arr;
    const original = arr.push;
    arr.push = function apiProbeDataLayerPush() {
      probe.dataLayer.push(...Array.from(arguments));
      return original.apply(this, arguments);
    };
    arr.__apiProbeWrapped = true;
    return arr;
  }

  let dataLayerValue = wrapDataLayer(window.dataLayer);
  try {
    Object.defineProperty(window, 'dataLayer', {
      configurable: true,
      get() { return dataLayerValue; },
      set(next) { dataLayerValue = wrapDataLayer(next); },
    });
  } catch (e) { window.dataLayer = wrapDataLayer(window.dataLayer); }
})();`;

function textBits(field = {}) {
  return [field.type, field.name, field.id, field.label, field.placeholder, field.autocomplete]
    .filter(Boolean).join(' ').toLowerCase();
}

export function synthValueFor(field = {}) {
  const text = textBits(field);
  if (String(field.type || '').toLowerCase() === 'email' || /\b(?:e-?mail|email)\b/.test(text)) return TEST_DATA.email;
  if (String(field.type || '').toLowerCase() === 'tel' || /\b(?:tel|phone|mobile)\b/.test(text)) return TEST_DATA.phone;
  if (/\b(?:first|given)\b/.test(text)) return TEST_DATA.firstName;
  if (/\b(?:last|family|surname)\b/.test(text)) return TEST_DATA.lastName;
  if (/\b(?:company|organisation|organization)\b/.test(text)) return TEST_DATA.company;
  if (String(field.type || '').toLowerCase() === 'textarea' || /\b(?:message|comment)\b/.test(text)) return TEST_DATA.message;
  if (String(field.type || '').toLowerCase() === 'select') return field.options?.[1]?.value || field.options?.[1]?.text || '';
  return TEST_DATA.firstName;
}

function uiSelectorNear(selector) { return selector || 'body'; }

export async function uiAfter(page, selector) {
  return page.evaluate((baseSelector) => {
    const start = document.querySelector(baseSelector) || document.body;
    const selectors = '[role=status],[aria-live],[class*=error i],[class*=success i],[class*=message i]';
    const candidates = [];
    if (start.matches && start.matches(selectors)) candidates.push(start);
    candidates.push(...start.querySelectorAll(selectors));
    let parent = start.parentElement;
    while (parent && candidates.length === 0) {
      if (parent.matches(selectors)) candidates.push(parent);
      candidates.push(...parent.querySelectorAll(selectors));
      parent = parent.parentElement;
    }
    const found = candidates.find((node) => node.textContent.trim());
    return found ? { selector: found.id ? `#${found.id}` : selectors, text: found.textContent.trim().slice(0, 500) } : null;
  }, uiSelectorNear(selector)).catch(() => null);
}

async function dataLayerCount(page) {
  return page.evaluate(() => (window.__apiProbe?.dataLayer || []).length).catch(() => 0);
}

async function dataLayerSince(page, start) {
  const events = await page.evaluate((from) => (window.__apiProbe?.dataLayer || []).slice(from), start).catch(() => []);
  return redactPersisted(events);
}

export async function fieldsFor(page, rootSelector = 'body') {
  return page.evaluate((root) => {
    const css = (value) => (window.CSS && CSS.escape ? CSS.escape(value) : String(value).replace(/"/g, '\\"'));
    const selector = (el) => {
      if (el.id) return `#${css(el.id)}`;
      if (el.name) return `${el.tagName.toLowerCase()}[name="${css(el.name)}"]`;
      return null;
    };
    const labelText = (el) => {
      if (el.id) {
        const label = document.querySelector(`label[for="${css(el.id)}"]`);
        if (label) return label.textContent.trim();
      }
      const label = el.closest('label');
      return label ? label.textContent.trim() : '';
    };
    const rootEl = document.querySelector(root) || document.body;
    return Array.from(rootEl.querySelectorAll('input,textarea,select')).filter((el) => {
      const type = (el.getAttribute('type') || el.tagName).toLowerCase();
      return !['hidden', 'submit', 'button', 'reset', 'file', 'checkbox', 'radio'].includes(type) && !el.disabled;
    }).map((el) => ({
      selector: selector(el),
      type: el.tagName.toLowerCase() === 'textarea' ? 'textarea' : (el.getAttribute('type') || el.tagName).toLowerCase(),
      name: el.getAttribute('name') || '',
      id: el.id || '',
      label: labelText(el),
      placeholder: el.getAttribute('placeholder') || '',
      autocomplete: el.getAttribute('autocomplete') || '',
      options: el.tagName.toLowerCase() === 'select' ? Array.from(el.options).map((option) => ({ value: option.value, text: option.textContent.trim() })) : [],
    })).filter((field) => field.selector);
  }, rootSelector);
}

export async function fillFields(page, fields, filledInputs) {
  for (const field of fields) {
    const value = synthValueFor(field);
    if (!field.selector) continue;
    try {
      if (field.type === 'select') await page.selectOption(field.selector, value, { timeout: 1000 });
      else await page.fill(field.selector, value, { timeout: 1000 });
      filledInputs.set(field.selector, { selector: field.selector, name: field.name || field.id || '', value });
    } catch { /* hidden or detached controls are ignored */ }
  }
}

async function formSelectors(page) {
  return page.evaluate(() => Array.from(document.forms).map((form, index) => {
    if (form.id) return `form#${CSS.escape(form.id)}`;
    return `form:nth-of-type(${index + 1})`;
  }).slice(0, 5));
}

async function formlessGroupSelectors(page, limit) {
  return page.evaluate((max) => {
    const selectors = [];
    const roots = Array.from(document.querySelectorAll('section,div,article,main')).filter((el) => !el.closest('form') && !el.querySelector('form'));
    roots.forEach((el, index) => {
      if (selectors.length >= max) return;
      const fields = el.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]),textarea,select');
      const button = el.querySelector('button,input[type=button],[role=button]');
      if (fields.length < 2 || !button) return;
      if (el.id) selectors.push(`#${CSS.escape(el.id)}`);
      else {
        el.setAttribute('data-api-probe-group', String(index));
        selectors.push(`[data-api-probe-group="${index}"]`);
      }
    });
    return selectors;
  }, limit);
}

export async function submitForm(page, selector) {
  const button = await page.$(`${selector} button[type=submit], ${selector} input[type=submit], ${selector} button:not([type])`);
  if (button) await button.click({ timeout: 3000, noWaitAfter: true }).catch(() => {});
  else await page.$eval(selector, (form) => form.requestSubmit()).catch(() => {});
}

export async function runAction(page, observations, triggerRef, selector, type, action) {
  const startObs = observations.length;
  const startData = await dataLayerCount(page);
  triggerRef.current = { type, selector };
  await action().catch(() => {});
  await page.waitForTimeout(1500);
  const events = await dataLayerSince(page, startData);
  const ui = await uiAfter(page, selector);
  const safeUi = ui ? { ...ui, text: redactText(ui.text) } : null;
  for (const observation of observations.slice(startObs)) {
    observation.dataLayerAfter = events;
    observation.uiAfter = safeUi;
  }
  triggerRef.current = { type: 'load', selector: null };
}

export async function driveInteractions(page, observations, triggerRef, filledInputs) {
  const groups = await formlessGroupSelectors(page, CAPS.formsPerPage);
  for (const selector of groups) {
    const fields = await fieldsFor(page, selector);
    await fillFields(page, fields, filledInputs);
    await runAction(page, observations, triggerRef, selector, 'submit', () => page.click(`${selector} button, ${selector} input[type=button], ${selector} [role=button]`, { timeout: 1000 }));
  }

  const forms = (await formSelectors(page)).slice(0, Math.max(0, CAPS.formsPerPage - groups.length));
  for (const selector of forms) {
    const fields = await fieldsFor(page, selector);
    await fillFields(page, fields, filledInputs);
    await runAction(page, observations, triggerRef, selector, 'submit', () => submitForm(page, selector));
  }

  const searches = (await page.evaluate(() => Array.from(document.querySelectorAll('input')).filter((el) => {
    const type = (el.getAttribute('type') || '').toLowerCase();
    const name = (el.getAttribute('name') || '').toLowerCase();
    return type === 'search' || ['q', 's', 'query', 'search'].includes(name);
  }).map((el) => (el.id ? `#${CSS.escape(el.id)}` : `input[name="${CSS.escape(el.name)}"]`)))).slice(0, CAPS.formsPerPage);
  for (const selector of searches) {
    await runAction(page, observations, triggerRef, selector, 'search', async () => {
      await page.fill(selector, TEST_DATA.search, { timeout: 1000 });
      await page.press(selector, 'Enter', { timeout: 1000 });
    });
  }

  const clicks = (await page.evaluate(() => Array.from(document.querySelectorAll('button,a,[role=button]')).filter((el) => /load more|show more|next|filter/i.test(el.textContent || el.getAttribute('aria-label') || '')).map((el, index) => {
    if (el.id) return `#${CSS.escape(el.id)}`;
    el.setAttribute('data-api-probe-click', String(index));
    return `[data-api-probe-click="${index}"]`;
  }))).slice(0, CAPS.clicksPerPage);
  for (const selector of clicks) await runAction(page, observations, triggerRef, selector, 'click', () => page.click(selector, { timeout: 1000 }));

  const selects = (await page.evaluate(() => Array.from(document.querySelectorAll('select')).map((el, index) => {
    if (el.id) return `#${CSS.escape(el.id)}`;
    if (el.name) return `select[name="${CSS.escape(el.name)}"]`;
    el.setAttribute('data-api-probe-select', String(index));
    return `[data-api-probe-select="${index}"]`;
  }))).slice(0, CAPS.selectsPerPage);
  for (const selector of selects) {
    await runAction(page, observations, triggerRef, selector, 'select', async () => {
      const fields = await fieldsFor(page, selector);
      if (fields[0]) await page.selectOption(selector, synthValueFor(fields[0]));
    });
  }
}
