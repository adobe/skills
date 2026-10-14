// skills/reskin/scripts/figma/client.mjs — the Figma REST client figma-donor.mjs capture uses. The
// token comes from the caller (FIGMA_TOKEN) and is sent as X-Figma-Token to the API base only; image
// bytes come from signed storage URLs fetched without it. Failure policy: 401/403 → exit 3 (not
// retried); 404 and other 4xx → exit 2; 429 waits Retry-After when it is within maxWaitSec, else
// exit 3 at once quoting the plan headers; 5xx and network errors back off min(2^n s, maxWaitSec)
// up to maxRetries, then exit 3. Every error message is redacted of the token.
import { FigmaError, UsageError } from './errors.mjs';

const DEFAULT_BASE = 'https://api.figma.com';
const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function redact(text, token) {
  const s = String(text ?? '');
  return token ? s.split(token).join('[redacted]') : s;
}

const query = (params) => Object.entries(params)
  .filter(([, v]) => v !== undefined && v !== null)
  .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(Array.isArray(v) ? v.join(',') : String(v))}`)
  .join('&');

// Origin and path only: a signed URL's query is a credential and never goes into a message.
const safeUrl = (url) => { try { const u = new URL(url); return `${u.origin}${u.pathname}`; } catch { return '(invalid url)'; } };

const reasonOf = async (res) => {
  const text = await res.text().catch(() => '');
  try { const j = JSON.parse(text); return String(j.err ?? j.message ?? text).slice(0, 300); } catch { return text.slice(0, 300); }
};

export function createClient({
  token,
  base = process.env.FIGMA_API_BASE || DEFAULT_BASE,
  fetchImpl = fetch,
  maxRetries = 3,
  maxWaitSec = 60,
  sleep = realSleep,
} = {}) {
  const apiBase = String(base).replace(/\/+$/, '');
  const state = { planTier: null };
  const fail = (msg, opts) => {
    const info = Object.fromEntries(Object.entries(opts.info || {}).map(([k, v]) => [k, typeof v === 'string' ? redact(v, token) : v]));
    return new FigmaError(redact(msg, token), { ...opts, info });
  };

  async function request(url, { withToken, label }) {
    for (let attempt = 0; ; attempt += 1) {
      const backoff = Math.min(1000 * 2 ** attempt, maxWaitSec * 1000);
      let res;
      try {
        res = await fetchImpl(url, { headers: withToken ? { 'X-Figma-Token': token } : {} });
      } catch (e) {
        if (attempt < maxRetries) { await sleep(backoff); continue; }
        throw fail(`Figma unreachable (${label}): ${e.cause?.code || e.message} after ${attempt + 1} attempt(s)`, { exitCode: 3, status: 0 });
      }
      const tier = res.headers.get('x-figma-plan-tier');
      if (tier) state.planTier = tier;
      if (res.ok) return res;
      const { status } = res;
      const reason = await reasonOf(res);
      if (!withToken && status < 500 && status !== 429) {
        throw fail(`Image download refused (HTTP ${status}) for ${label}: the signed render URL may have expired; re-run capture with --refresh.`, { exitCode: 3, status });
      }
      if (status === 401 || status === 403) {
        throw fail(`Figma refused the request (HTTP ${status}${reason ? `: ${reason}` : ''}) for ${label}. Check that FIGMA_TOKEN holds a current personal access token (not expired or revoked), that it has the file_content:read scope, and that the file is shared with the token's account.`, { exitCode: 3, status, info: { reason } });
      }
      if (status === 404) {
        throw fail(`Figma has no such file or node (HTTP 404) for ${label}. Check the file key and node-id in the URL, and that the file is shared with the token's account.`, { exitCode: 2, status, info: { reason } });
      }
      if (status === 429) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const info = {
          reason,
          retryAfter: Number.isFinite(retryAfter) ? retryAfter : null,
          planTier: tier,
          rateLimitType: res.headers.get('x-figma-rate-limit-type'),
          upgradeLink: res.headers.get('x-figma-upgrade-link'),
        };
        const wait = Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter * 1000 : backoff;
        if (wait <= maxWaitSec * 1000 && attempt < maxRetries) { await sleep(wait); continue; }
        throw fail(`Figma rate limit (HTTP 429) for ${label}: Retry-After ${info.retryAfter ?? 'absent'}s exceeds --max-wait ${maxWaitSec}s or retries ran out. X-Figma-Plan-Tier: ${info.planTier ?? 'absent'}; X-Figma-Rate-Limit-Type: ${info.rateLimitType ?? 'absent'}; X-Figma-Upgrade-Link: ${info.upgradeLink ?? 'absent'}. Completed calls are cached; re-run later or raise --max-wait.`, { exitCode: 3, status, info });
      }
      if (status >= 500) {
        if (attempt < maxRetries) { await sleep(backoff); continue; }
        throw fail(`Figma server error (HTTP ${status}) for ${label} after ${attempt + 1} attempt(s)${reason ? `: ${reason}` : ''}`, { exitCode: 3, status, info: { reason } });
      }
      throw fail(`Figma rejected the request (HTTP ${status}) for ${label}${reason ? `: ${reason}` : ''}`, { exitCode: 2, status, info: { reason } });
    }
  }

  return {
    get planTier() { return state.planTier; },
    async getJson(path, params = {}) {
      if (!token) throw new UsageError('FIGMA_TOKEN is not set: create a Figma personal access token with the file_content:read scope and export it as FIGMA_TOKEN.');
      const qs = query(params);
      const res = await request(`${apiBase}${path}${qs ? `?${qs}` : ''}`, { withToken: true, label: path });
      const text = await res.text();
      try { return JSON.parse(text); } catch {
        throw fail(`Figma returned a non-JSON body for ${path}`, { exitCode: 3, status: res.status });
      }
    },
    async getBytes(url) {
      const res = await request(url, { withToken: false, label: safeUrl(url) });
      return Buffer.from(await res.arrayBuffer());
    },
  };
}
