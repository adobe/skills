import { provenance } from './lib.mjs';

const TABLE_HEADER = '| # | id | feature | class | reach | disposition | reproducibility | status | pattern | decision / owner | evidence |';
const TABLE_SEPARATOR = '|---|---|---|---|---|---|---|---|---|---|---|';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function markdownEscape(value) {
  return String(value ?? '').replace(/\|/g, '/').replace(/\r?\n/g, ' ').trim();
}

function featureId(entry) {
  return String(entry.id || '').startsWith('api-') ? String(entry.id) : `api-${entry.id}`;
}

function isWrite(entry) {
  const method = String(entry.method || '').toUpperCase();
  const kind = String(entry.kind || '').toLowerCase();
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) || kind.includes('write') || kind.includes('mutation');
}

function featureClass(entry) {
  const text = `${entry.id || ''} ${entry.kind || ''} ${entry.endpoint || ''}`.toLowerCase();
  if (/search/.test(text)) return 'S';
  if (isWrite(entry) || asArray(entry.fieldMap).length) return 'F';
  return 'A';
}

function disposition(entry) {
  return isWrite(entry) ? 'rebuild-native' : 'data-fed';
}

function reproducibility(entry) {
  return entry.status === 'blocked-cors' ? 'needs-backend' : 'self';
}

function dynamicsStatus(entry) {
  if (['verified-L3', 'verified-L4'].includes(entry.status)) return 'done';
  if (['verified-L1', 'verified-L2', 'implemented'].includes(entry.status)) return 'interim';
  if (['blocked-cors', 'awaiting-owner'].includes(entry.status)) return 'scaffolded-awaiting-owner';
  return 'pending';
}

function pages(entry) {
  return asArray(entry.pages).map((page) => {
    try { return new URL(page).pathname || '/'; } catch { return page || '/'; }
  }).filter(Boolean);
}

function endpointPath(endpoint) {
  try { return `${new URL(endpoint, 'https://example.invalid').pathname}${new URL(endpoint, 'https://example.invalid').search}`; } catch { return endpoint || ''; }
}

function rowFor(entry, number) {
  const id = featureId(entry);
  const decision = entry.status === 'blocked-cors' ? 'backend owner: allow AEM origins' : '';
  const evidence = endpointPath(entry.endpoint);
  return `| ${number} | ${markdownEscape(id)} | ${markdownEscape(entry.feature || entry.id)} | ${featureClass(entry)} | ${entry.reach || pages(entry).length || 1} | ${disposition(entry)} | ${reproducibility(entry)} | ${dynamicsStatus(entry)} | api-integration | ${markdownEscape(decision)} | ${markdownEscape(evidence)} |`;
}

function parseRowId(row) {
  const cells = row.split('|').map((cell) => cell.trim());
  return cells[2] || '';
}

function parseRowNumber(row) {
  const cells = row.split('|').map((cell) => cell.trim());
  const n = Number(cells[1]);
  return Number.isFinite(n) ? n : null;
}

function baseFeaturesMd() {
  return [
    '# Dynamic features',
    '',
    '## Listings contract',
    'none',
    '',
    '## Features',
    TABLE_HEADER,
    TABLE_SEPARATOR,
    '',
    '## Decision batch',
    '',
    '## Register (decided-out)',
    '| feature | reason | production statement |',
    '|---|---|---|',
    '',
  ].join('\n');
}

function ensureFeaturesTable(content) {
  if (content && content.includes('## Features') && content.includes(TABLE_HEADER)) return content;
  if (!content) return baseFeaturesMd();
  const suffix = content.endsWith('\n') ? '' : '\n';
  return `${content}${suffix}\n## Features\n${TABLE_HEADER}\n${TABLE_SEPARATOR}\n`;
}

function upsertFeaturesMd(featuresMd, integrations) {
  const content = ensureFeaturesTable(featuresMd);
  const lines = content.split('\n');
  const headerIndex = lines.findIndex((line, index) => line.trim() === TABLE_HEADER && lines.slice(0, index).some((prev) => prev.trim() === '## Features'));
  if (headerIndex === -1) return upsertFeaturesMd(baseFeaturesMd(), integrations);
  const sepIndex = headerIndex + 1;
  let end = sepIndex + 1;
  while (end < lines.length && lines[end].startsWith('|')) end += 1;

  const existingRows = lines.slice(sepIndex + 1, end);
  const renderedById = new Map();
  const integrationById = new Map(integrations.map((entry) => [featureId(entry), entry]));
  let maxNumber = 0;
  const rows = [];
  for (const row of existingRows) {
    const id = parseRowId(row);
    const number = parseRowNumber(row);
    if (number && number > maxNumber) maxNumber = number;
    if (id.startsWith('api-') && integrationById.has(id)) {
      rows.push(rowFor(integrationById.get(id), number || maxNumber || 1));
      renderedById.set(id, true);
    } else if (!id.startsWith('api-')) {
      rows.push(row);
    }
  }
  let nextNumber = maxNumber + 1;
  for (const entry of integrations) {
    const id = featureId(entry);
    if (renderedById.has(id)) continue;
    rows.push(rowFor(entry, nextNumber));
    nextNumber += 1;
  }
  return [...lines.slice(0, sepIndex + 1), ...rows, ...lines.slice(end)].join('\n');
}

function pathList(entry) {
  const out = pages(entry);
  return out.length ? out : ['/'];
}

function dynamicsChecks(entry) {
  const paths = pathList(entry);
  const checks = [{ type: 'no-page-errors', paths }];
  const selector = entry.selector || entry.trigger?.selector || (isWrite(entry) ? 'form' : 'body');
  checks.push({ type: 'dom-count', path: paths[0], selector, min: 1 });
  const method = String(entry.method || 'GET').toUpperCase();
  const endpoint = endpointPath(entry.endpoint);
  if (method === 'GET' && entry.origin === 'first-party' && endpoint.startsWith('/')) checks.push({ type: 'fetch-json', url: endpoint });
  return checks;
}

function parityFeature(entry) {
  return {
    id: featureId(entry),
    feature: entry.feature || entry.id,
    class: featureClass(entry),
    pages: entry.reach || pathList(entry).length,
    disposition: disposition(entry),
    reproducibility: reproducibility(entry),
    status: dynamicsStatus(entry),
    ...(entry.status === 'blocked-cors' ? { owner: 'backend owner: allow AEM origins', environmentLimit: 'CORS policy blocks the migrated origin' } : {}),
    checks: dynamicsChecks(entry),
  };
}

function upsertDynamicsParity(dynamicsParity, integrations) {
  const base = dynamicsParity && typeof dynamicsParity === 'object' ? structuredClone(dynamicsParity) : {
    _provenance: provenance('writeback'),
    method: 'api-integrations write-back',
    features: [],
  };
  const apiFeatures = integrations.map(parityFeature);
  const byId = new Map(apiFeatures.map((feature) => [feature.id, feature]));
  const kept = asArray(base.features).filter((feature) => !String(feature.id || '').startsWith('api-'));
  base.features = [...kept, ...apiFeatures];
  for (const feature of base.features) {
    if (byId.has(feature.id)) Object.assign(feature, byId.get(feature.id));
  }
  return base;
}

export function writeBack(inventory, { featuresMd = null, dynamicsParity = null } = {}) {
  const integrations = asArray(inventory?.integrations);
  return {
    featuresMd: upsertFeaturesMd(featuresMd, integrations),
    dynamicsParity: upsertDynamicsParity(dynamicsParity, integrations),
  };
}
