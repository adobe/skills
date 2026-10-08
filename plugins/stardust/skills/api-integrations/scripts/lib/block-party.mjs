import { dirname, join } from 'node:path';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { registrable } from './lib.mjs';
import { scopeOf } from './classify.mjs';

const BLOCK_PARTY_URL = 'https://www.aem.live/developer/block-party/block-party.json?sheet=curated-list-new';
const DAY_MS = 24 * 60 * 60 * 1000;
const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = dirname(HERE);
const DEFAULT_CACHE = join(SKILL_ROOT, '.cache/block-party.json');

function unique(values) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null && value !== ''))];
}

function parsedUrl(endpoint, base) {
  try {
    return new URL(endpoint, base);
  } catch {
    return null;
  }
}

function displayEndpoint(endpoint) {
  const parsed = parsedUrl(endpoint);
  return parsed ? `${parsed.pathname}${parsed.search}` : (endpoint || '');
}

function words(text) {
  return String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

export function termsFor(contract) {
  const terms = new Set();
  try {
    const scoped = scopeOf(contract.endpoint, contract.pages?.[0] || contract.endpoint);
    for (const word of words(scoped.vendor?.role || '')) terms.add(word);
    for (const part of words(registrable(new URL(contract.endpoint).hostname))) terms.add(part);
  } catch {
    // Relative or malformed endpoints still contribute path terms below.
  }
  if (String(contract.kind || '').startsWith('graphql') || contract.graphql) terms.add('graphql');
  if ((contract.fieldMap || []).length) terms.add('form');
  const pathWords = new Set(['search', 'form', 'newsletter', 'subscribe', 'login', 'contact', 'calendar', 'map']);
  for (const word of words(displayEndpoint(contract.endpoint))) if (pathWords.has(word)) terms.add(word);
  return [...terms];
}

function approvedEntries(entries) {
  return (entries || []).filter((entry) => String(entry.approved ?? 'TRUE').toUpperCase() === 'TRUE');
}

export function rankBlockParty(entries, terms) {
  const wanted = unique((terms || []).map((term) => String(term).toLowerCase()).filter(Boolean));
  if (!wanted.length) return [];
  return approvedEntries(entries).map((entry) => {
    const matched = [];
    let score = 0;
    const title = String(entry.title || '').toLowerCase();
    const category = String(entry.category || '').toLowerCase();
    const description = String(entry.description || '').toLowerCase();
    for (const term of wanted) {
      let termScore = 0;
      if (title.includes(term)) termScore += 3;
      if (category.includes(term)) termScore += 2;
      if (description.includes(term)) termScore += 1;
      if (termScore) {
        matched.push(term);
        score += termScore;
      }
    }
    return {
      title: entry.title,
      url: entry.githubUrl || entry.showcaseUrl || '',
      category: entry.category,
      score,
      reason: matched.length ? `matched ${matched.join(', ')}` : '',
    };
  }).filter((entry) => entry.score >= 2)
    .sort((a, b) => b.score - a.score || String(a.title).localeCompare(String(b.title)))
    .slice(0, 3);
}

async function readCache(cacheFile, now, { allowStale = false } = {}) {
  try {
    const meta = await stat(cacheFile);
    if (!allowStale && now - meta.mtimeMs > DAY_MS) return null;
    const cached = JSON.parse(await readFile(cacheFile, 'utf8'));
    if (Array.isArray(cached.entries)) return approvedEntries(cached.entries);
    if (Array.isArray(cached.data)) return approvedEntries(cached.data);
    if (Array.isArray(cached)) return approvedEntries(cached);
  } catch {
    return null;
  }
  return null;
}

function markUnavailable(entries) {
  Object.defineProperty(entries, 'unavailable', { value: true, enumerable: false });
  return entries;
}

export async function loadBlockPartyIndex({
  cacheFile = DEFAULT_CACHE,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  offline = false,
} = {}) {
  if (offline) return [];
  const nowValue = typeof now === 'function' ? now() : now;
  const cached = await readCache(cacheFile, nowValue);
  if (cached) return cached;

  try {
    const response = await fetchImpl(BLOCK_PARTY_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = await response.json();
    const entries = approvedEntries(json.data || json.entries || []);
    await mkdir(dirname(cacheFile), { recursive: true });
    await writeFile(cacheFile, `${JSON.stringify({ fetchedAt: new Date(nowValue).toISOString(), entries }, null, 2)}\n`);
    return entries;
  } catch (error) {
    const stale = await readCache(cacheFile, nowValue, { allowStale: true });
    const fallback = markUnavailable(stale || []);
    console.warn(`[api-integrations] Block Party unavailable: ${String(error.message || error)}`);
    return fallback;
  }
}
