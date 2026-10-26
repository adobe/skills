'use strict';

const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { FAILURE_CLASSES } = require('../../../failure-classes.js');
const { pngSize } = require('../../lib/png.js');

/** Verify tool-captured template comparison evidence without contacting AEM. */
function verifyTemplateEvidence({ artifactPath, template, evidencePath, runStartedAt }) {
  const unavailable = (reason) => ({
    result: 'fail', verification_level: 'source-only', failure_class: FAILURE_CLASSES.UNKNOWN,
    evidence: `${template}: ${reason}`, checks: { runtime_evidence: false },
  });
  if (!evidencePath) return unavailable('template runtime comparison requires captured browser evidence');
  let evidence;
  try {
    const document = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
    evidence = document.templates ? document.templates[template] : document;
  } catch {
    return unavailable('cannot read template evidence JSON; provide the actual credential-free browser observations');
  }
  if (!evidence || evidence.template !== template) return unavailable('runtime evidence does not select this template');
  const digest = createHash('sha256').update(fs.readFileSync(artifactPath)).digest('hex');
  const captured = Date.parse(evidence.captured_at);
    const runStart = runStartedAt ? Date.parse(runStartedAt) : 0;
  if (evidence.artifact_sha256 !== digest || !Number.isFinite(captured)
      || !Number.isFinite(runStart) || captured < runStart
      || captured < fs.statSync(artifactPath).mtimeMs - 1000 || captured > Date.now() + 5000) {
    return unavailable('runtime evidence is stale or belongs to a different built package; repeat deployment and comparison');
  }
  const { source, target, captures, cleanup } = evidence;
  let sourceUrl;
  let targetUrl;
  try {
    sourceUrl = pageUrl(source?.url);
    targetUrl = pageUrl(target?.url);
  } catch {
    return unavailable('provide credential-free source and target /content page URLs');
  }
  const identity = (url) => `${['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ? 'loopback' : url.hostname}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`;
  if (identity(sourceUrl) === identity(targetUrl)) return unavailable('source and target must be different AEM instances');
  if (sourceUrl.pathname !== targetUrl.pathname) return unavailable('compare the same page path: the target page must be the converted copy of the source page');
  if (typeof source?.template !== 'string' || !source.template.startsWith('/apps/') || target?.template !== template) {
    return unavailable('the observed source must use a static /apps template and the target must use the selected /conf template');
  }
  if (evidence.deployment?.status !== 'succeeded' || evidence.deployment.target_origin !== targetUrl.origin) {
    return unavailable('successful package deployment to the selected target has not been confirmed');
  }
  const bundles = evidence.deployment.bundles;
  if (!Array.isArray(bundles) || !bundles.length
      || !bundles.every((bundle) => typeof bundle?.symbolic_name === 'string' && bundle.symbolic_name && typeof bundle.state === 'string')) {
    return unavailable('MCP bundle state on the target is required before page comparison');
  }
  const inactive = bundles.filter((bundle) => bundle.state !== 'Active');
  if (inactive.length) {
    return {
      result: 'fail', verification_level: 'runtime', failure_class: FAILURE_CLASSES.BUNDLE_NOT_ACTIVE,
      evidence: `${template}: bundle not active on target: ${inactive.map((bundle) => `${bundle.symbolic_name}=${bundle.state}`).join(', ')}`,
      checks: { runtime_evidence: true, bundles_active: false },
    };
  }
  const stringArray = (value) => Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.trim().length > 0);
  if (![source, target].every((page) => ['components', 'texts', 'images'].every((key) => stringArray(page[key])))
      || !source.components.length || !target.components.length) {
    return unavailable('both pages require captured component, text and image inventories; empty component inventories are not coverage');
  }
  const mapping = evidence.component_mapping || {};
  if (typeof mapping !== 'object' || Array.isArray(mapping) || !Object.values(mapping).every((value) => typeof value === 'string' && value.length)) {
    return unavailable('component_mapping must contain explicit source-to-target resource-type mappings');
  }
    if (!Array.isArray(captures) || !captures.some((capture) => capture?.viewport?.width >= 1024)
      || !captures.some((capture) => capture?.viewport?.width <= 480 && capture?.viewport?.width > 0)) {
    return unavailable('actual desktop and mobile browser comparisons are both required');
  }
  const screenshotRoot = path.dirname(path.resolve(evidencePath));
  const screenshots = new Set();
  const verifiedCaptures = [];
  try {
    for (const capture of captures) {
      if (!Number.isInteger(capture?.viewport?.width) || !Number.isInteger(capture?.viewport?.height)
          || capture.viewport.width <= 0 || capture.viewport.height <= 0
          || !['pass', 'fail', 'not_verified'].includes(capture.result)
          || !Array.isArray(capture.differences) || !capture.differences.every((difference) => typeof difference === 'string')) {
        return unavailable('each browser comparison needs viewport dimensions, an actual review result and a differences array');
      }
      const verified = { ...capture };
      for (const key of ['source', 'target']) {
        const relative = capture[key];
        if (typeof relative !== 'string' || path.isAbsolute(relative)) return unavailable('screenshot paths must be relative to the evidence file');
        const screenshot = fs.realpathSync(path.resolve(screenshotRoot, relative));
        if (!screenshot.startsWith(fs.realpathSync(screenshotRoot) + path.sep) || screenshots.has(screenshot)) {
          return unavailable('each viewport and instance needs its own screenshot inside the evidence directory');
        }
        const image = pngSize(fs.readFileSync(screenshot));
        const scale = capture.device_scale_factor ?? 1;
        if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0 || scale > 4
            || image.width !== capture.viewport.width * scale || image.height < capture.viewport.height * scale
            || fs.statSync(screenshot).mtimeMs + 1000 < runStart) {
          return unavailable('screenshot dimensions or freshness do not match this run and viewport');
        }
        screenshots.add(screenshot);
        verified[key] = screenshot;
      }
      verifiedCaptures.push(verified);
    }
  } catch {
    return unavailable('a screenshot is missing, invalid or unreadable');
  }
  const differences = [];
  const missing = (kind, expected, actual) => {
    const counts = new Map();
    for (const value of actual) counts.set(value, (counts.get(value) || 0) + 1);
    for (const value of expected) {
      const remaining = counts.get(value) || 0;
      if (remaining) counts.set(value, remaining - 1);
      else differences.push(`${kind}: missing on target: ${value}`);
    }
    return !differences.some((difference) => difference.startsWith(`${kind}:`));
  };
  const normalizeText = (text) => text.replace(/\s+/g, ' ').trim();
  const checks = {
    runtime_evidence: true,
    bundles_active: true,
    source_renders: source.status === 200,
    target_renders: target.status === 200,
    component_parity: missing('component', source.components.map((component) => Object.hasOwn(mapping, component) ? mapping[component] : component), target.components),
    text_preserved: missing('text', source.texts.map(normalizeText), target.texts.map(normalizeText)),
    images_preserved: missing('image', source.images, target.images),
    visual_comparison: captures.every((capture) => capture.result === 'pass' && !capture.differences.length),
    cleanup: Array.isArray(cleanup?.created_pages)
      && (cleanup.created_pages.length ? cleanup.status === 'completed' : cleanup.status === 'not_required'),
    business_behavior: 'not_tested',
  };
  for (const capture of captures) {
    for (const difference of capture.differences) differences.push(`visual ${capture.viewport.width}x${capture.viewport.height}: ${difference}`);
  }
  const failed = Object.entries(checks).filter(([key, value]) => key !== 'business_behavior' && value !== true).map(([key]) => key);
  checks.template_comparison = {
    source_url: source.url, target_url: target.url, captured_at: evidence.captured_at,
    artifact_sha256: digest, component_mapping: mapping, captures: verifiedCaptures, differences,
    cleanup: { status: cleanup?.status || 'not_verified', created_pages: Array.isArray(cleanup?.created_pages) ? cleanup.created_pages : [] },
    coverage: 'Source-to-target component counts, rendered text, images and reviewed desktop/mobile screenshots; authoring and business behavior not tested.',
  };
  return {
    result: failed.length ? 'fail' : 'pass', verification_level: 'runtime', checks,
    ...(failed.length ? {
      failure_class: FAILURE_CLASSES.CONTRACT_MISMATCH,
      evidence: `${template}: failed ${failed.join(', ')}${differences.length ? '; ' + differences.join('; ') : ''}`,
    } : {}),
  };
}

function pageUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash
      || !/^\/content\/.+\.html$/.test(url.pathname)
      || [...url.searchParams].some(([key, entry]) => key !== 'wcmmode' || entry !== 'disabled')) throw new Error('Invalid page URL');
  return url;
}

module.exports = { verifyTemplateEvidence };