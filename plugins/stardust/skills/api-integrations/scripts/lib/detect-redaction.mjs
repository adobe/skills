import { TEST_DATA } from './lib.mjs';
import { redact } from './shape.mjs';

const testValues = new Map(Object.entries(TEST_DATA).map(([key, value]) => [String(value), `<test:${key}>`]));
const secretEqualsRe = /\b((?:api[-_]?key|token|secret|password|passwd|authorization|auth|client[-_]?secret|access[-_]?key)\s*=\s*)(['"]?)([^&\s"',;)}\]]+)/gi;
const secretQuotedPropertyRe = /\b((?:api[-_]?key|token|secret|password|passwd|authorization|auth|client[-_]?secret|access[-_]?key)\s*:\s*)(['"])(.*?)\2/gi;
const urlWithQueryRe = /\bhttps?:\/\/[^\s"'<>]+?\?[^\s"'<>]+/gi;

function replaceKnownSecrets(text, sources = {}) {
  let out = String(text || '');
  for (const [name, value] of Object.entries(sources.cookies || {})) {
    if (String(value || '').length >= 6) out = out.split(String(value)).join(`<cookie:${name}>`);
  }
  for (const token of sources.tokens || []) {
    if (String(token?.value || '').length >= 6) out = out.split(String(token.value)).join('<recaptcha>');
  }
  return out;
}

function redactAssignedSecret(raw, sources = {}) {
  const value = replaceKnownSecrets(raw, sources);
  if (/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(value)) return '<email>';
  if (/^\+?\d[\d .-]{8,}\d$/.test(value)) return '<phone>';
  if (/^[A-Za-z0-9._-]{40,}$/.test(value)) return '<token>';
  return testValues.get(value) || '<redacted>';
}

export function stripQueryValues(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    for (const key of [...parsed.searchParams.keys()]) {
      const count = parsed.searchParams.getAll(key).length || 1;
      parsed.searchParams.delete(key);
      for (let i = 0; i < count; i += 1) parsed.searchParams.append(key, '<redacted>');
    }
    return parsed.href;
  } catch {
    try {
      const parsed = new URL(rawUrl, 'https://placeholder.invalid/');
      for (const key of [...parsed.searchParams.keys()]) {
        const count = parsed.searchParams.getAll(key).length || 1;
        parsed.searchParams.delete(key);
        for (let i = 0; i < count; i += 1) parsed.searchParams.append(key, '<redacted>');
      }
      return rawUrl.startsWith('/')
        ? `${parsed.pathname}${parsed.search}${parsed.hash}`
        : parsed.href.replace('https://placeholder.invalid/', '');
    } catch {
      return String(rawUrl || '');
    }
  }
}

export function redactText(value, sources = {}, { stripUrlQueryValues = false } = {}) {
  let out = replaceKnownSecrets(value, sources);
  if (stripUrlQueryValues) out = out.replace(urlWithQueryRe, (url) => stripQueryValues(url));
  out = out.replace(secretEqualsRe, (_match, prefix, quote, secret) => `${prefix}${quote}${redactAssignedSecret(secret, sources)}`);
  out = out.replace(secretQuotedPropertyRe, (_match, prefix, quote, secret) => `${prefix}${quote}${redactAssignedSecret(secret, sources)}${quote}`);
  out = out.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '<email>');
  out = out.replace(/\b\+?\d[\d .-]{8,}\d\b/g, '<phone>');
  out = out.replace(/\b[A-Za-z0-9._-]{40,}\b/g, '<token>');
  for (const [raw, label] of [...testValues].sort((a, b) => b[0].length - a[0].length)) {
    if (raw.length >= 5) out = out.split(raw).join(label);
  }
  return out;
}

export function redactPersisted(value, sources = {}) {
  if (Array.isArray(value)) return value.map((item) => redactPersisted(item, sources));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, redactPersisted(child, sources)]));
  }
  if (typeof value === 'string') {
    const exact = redact(value);
    return exact === value ? redactText(value, sources) : exact;
  }
  return redact(value);
}

export function redactUrl(rawUrl, sources = {}, { stripQueryValues: stripAllQueryValues = false } = {}) {
  try {
    const parsed = new URL(rawUrl);
    for (const key of [...parsed.searchParams.keys()]) {
      const values = parsed.searchParams.getAll(key).map((value) => {
        if (stripAllQueryValues) return '<redacted>';
        try {
          return JSON.stringify(redactPersisted(JSON.parse(value), sources));
        } catch {
          const redacted = redactText(value, sources);
          return redacted === value ? '<redacted>' : redacted;
        }
      });
      parsed.searchParams.delete(key);
      for (const value of values) parsed.searchParams.append(key, value);
    }
    return parsed.href;
  } catch {
    return stripAllQueryValues ? stripQueryValues(redactText(rawUrl, sources, { stripUrlQueryValues: true })) : redactText(rawUrl, sources);
  }
}

export function redactResponseBody(body, headers = {}, sources = {}) {
  const text = String(body || '');
  const contentType = headers['content-type'] || headers['Content-Type'] || '';
  if (String(contentType).toLowerCase().includes('json')) {
    try {
      return JSON.stringify(redactPersisted(JSON.parse(text), sources));
    } catch {
      return redactText(text, sources);
    }
  }
  return redactText(text, sources);
}

export function scrubKnownSecrets(value, sources = {}) {
  if (Array.isArray(value)) return value.map((item) => scrubKnownSecrets(item, sources));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, scrubKnownSecrets(child, sources)]));
  }
  return typeof value === 'string' ? replaceKnownSecrets(value, sources) : value;
}
