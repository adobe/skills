import { CliError } from '#src/errors.mjs';

export const ERROR_TITLE_PATTERN =
  /error|denied|blocked|not satisfied|403|captcha|challenge|attention required|just a moment/i;

export const MIN_BODY_LENGTH = 100;

export function checkHealth(health) {
  if (health.url && health.url.startsWith('chrome-error://')) return 'blocked';
  if (health.status === 0) return 'blocked';
  if (health.status >= 400) return 'blocked';
  if (ERROR_TITLE_PATTERN.test(health.title)) return 'blocked';
  if (health.bodyLength < MIN_BODY_LENGTH && !health.hasMainContent) {
    return 'blocked';
  }
  return 'success';
}

export const CHALLENGE_TITLE_PATTERN =
  /just a moment|attention required|access denied|captcha|challenge|request could not be satisfied|403 forbidden|blocked/i;

export function isHardBlocked(health) {
  return Boolean(
    (health.url && health.url.startsWith('chrome-error://')) ||
    health.status === 0 ||
    health.status >= 400 ||
    CHALLENGE_TITLE_PATTERN.test(health.title ?? ''),
  );
}

export function detectSignals(networkLines, healths) {
  const signals = [];
  const joined = networkLines.join('\n').toLowerCase();

  if (
    joined.includes('server: akamaighost') ||
    joined.includes('server: akamainetstorage') ||
    joined.includes('akamai-grn:')
  ) {
    signals.push('akamai-server');
  }
  if (joined.includes('bm_sz') || joined.includes('_abck')) {
    signals.push('akamai-bot-manager');
  }
  if (joined.includes('cf-ray')) {
    signals.push('cloudflare-ray');
  }
  if (joined.includes('x-datadome')) {
    signals.push('datadome');
  }
  if (joined.includes('x-amzn-waf-action')) {
    signals.push('aws-waf');
  }
  if (joined.includes('x-cdn: imperva') || joined.includes('x-iinfo')) {
    signals.push('incapsula');
  }
  if (joined.includes('server: cloudfront') || joined.includes('x-amz-cf-id')) {
    signals.push('cloudfront');
  }

  const healthArr = Array.isArray(healths) ? healths : [healths];
  for (const health of healthArr) {
    const title = (health.title || '').toLowerCase();
    if (title.includes('just a moment') || title.includes('checking your browser')) {
      signals.push('cloudflare-challenge');
    }
    if (title.includes('the request could not be satisfied')) {
      signals.push('cloudfront-block');
    }
  }

  return [...new Set(signals)];
}

// Indices of the redirect hops plus the final main document, whose
// responses carry the CDN/WAF headers.
export function findDocumentChain(requestsOutput, finalUrl) {
  const target = finalUrl.split('#')[0];
  const indices = [];
  for (const line of requestsOutput.split('\n')) {
    const match = line.match(/^(\d+)\. \[\w+\] (\S+)/);
    if (!match) continue;
    indices.push(match[1]);
    if (match[2] === target) return indices;
  }
  throw new Error(`main document ${target} not found in playwright-cli requests`);
}

/**
 * @param {{ title?: string, bodyLength?: number, status?: number, url?: string,
 *   networkLines?: string[] }} input
 * @returns {{ blocked: boolean, signals: string[] }}
 */
export function classifyPage({ networkLines = [], ...health }) {
  return {
    blocked: isHardBlocked(health),
    signals: detectSignals(networkLines, health),
  };
}

/**
 * Gate for `page *` commands: throws BLOCKED only on hard signals (chrome-error URL,
 * status 0 or >= 400, challenge-like title). The softer checkHealth heuristics
 * (any "error" title, thin body) are reserved for `probe` config comparison.
 * @param {Parameters<typeof classifyPage>[0]} health
 */
export function assertNotBlocked(health) {
  const { blocked, signals } = classifyPage(health);
  if (!blocked) return;
  const detail = signals.length ? ` (signals: ${signals.join(', ')})` : '';
  throw new CliError('BLOCKED', `page looks blocked: title "${health.title ?? ''}"${detail}`, {
    hint: 'web probe <url>, then retry with --recipe <file>',
  });
}
