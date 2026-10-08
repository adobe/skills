import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_TEMPLATE = join(HERE, '..', 'report-template.html');

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

function hostFor(endpoint) {
  const parsed = parsedUrl(endpoint);
  return parsed?.host || 'relative';
}

function authLabel(auth) {
  return auth?.scheme || 'none';
}

function triggerLabel(trigger) {
  if (!trigger) return 'load';
  return trigger.selector ? `${trigger.type}:${trigger.selector}` : trigger.type;
}

function blockPartyLabel(matches = []) {
  return matches.length ? matches.map((entry) => `${entry.title} (${entry.score})`).join(', ') : '—';
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null && value !== ''))];
}

function lineText(value) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ');
}

function cell(value) {
  return lineText(value).replace(/\|/g, '\\|');
}

export function ownerActions(inventory) {
  const actions = [];
  for (const item of inventory.integrations || []) {
    if (item.origin === 'third-party' && item.inspect) actions.push(`Inspect third-party host ${hostFor(item.endpoint)} for ${item.id}.`);
    if (item.auth && item.auth.scheme && item.auth.scheme !== 'none') actions.push(`Provide ${item.auth.scheme} credentials or configuration for ${item.id}.`);
    if (item.confirmed === false) actions.push(`Confirm static-only integration ${item.id} (${displayEndpoint(item.endpoint)}).`);
  }
  for (const error of inventory.errors || []) actions.push(`Resolve detection error on ${error.url}: ${error.error}`);
  return unique(actions).map(lineText);
}

function withOwnerActions(inventory) {
  return { ...inventory, ownerActions: inventory.ownerActions || ownerActions(inventory) };
}

export function renderMarkdown(inventory) {
  const data = withOwnerActions(inventory);
  const integrations = data.integrations || [];
  const lines = ['# API Integrations Report', ''];
  lines.push('## Summary', '');
  lines.push(`- Total integrations: ${integrations.length}`);
  if (data.blockPartyUnavailable) lines.push('- Block Party unavailable.');
  for (const [kind, count] of Object.entries(integrations.reduce((acc, item) => {
    acc[item.kind || 'unknown'] = (acc[item.kind || 'unknown'] || 0) + 1;
    return acc;
  }, {})).sort()) lines.push(`- ${kind}: ${count}`);
  for (const [host, count] of Object.entries(integrations.reduce((acc, item) => {
    acc[hostFor(item.endpoint)] = (acc[hostFor(item.endpoint)] || 0) + 1;
    return acc;
  }, {})).sort()) lines.push(`- ${host}: ${count}`);
  lines.push('', '## Integrations', '');
  lines.push('| integration | method | endpoint | trigger | pages | auth | Block Party | status |');
  lines.push('|---|---|---|---|---:|---|---|---|');
  for (const item of integrations) {
    lines.push(`| ${cell(item.id)} | ${cell(item.method || '—')} | ${cell(displayEndpoint(item.endpoint))} | ${cell(triggerLabel(item.trigger))} | ${cell((item.pages || []).length)} | ${cell(authLabel(item.auth))} | ${cell(blockPartyLabel(item.blockParty))} | ${cell(item.status)} |`);
  }
  lines.push('', '## Owner action items', '');
  if (data.ownerActions.length) {
    for (const action of data.ownerActions) lines.push(`- ${lineText(action)}`);
  } else {
    lines.push('- None.');
  }
  return `${lines.join('\n')}\n`;
}

function escapeJsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function renderHtml(inventory, template = null) {
  const html = template ?? readFileSync(DEFAULT_TEMPLATE, 'utf8');
  const json = escapeJsonForScript(withOwnerActions(inventory));
  if (html.includes('__API_DATA__')) return html.replace('__API_DATA__', json);
  return html.replace('</body>', `<script type="application/json" id="api-data">${json}</script></body>`);
}
