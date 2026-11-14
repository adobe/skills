/*
 * AEM Cloudflare worker with personalization.
 *
 * aem-worker.mjs is the official adobe/aem-cloudflare-prod-worker, unchanged.
 * This wrapper only adds the decision-engine route and post-processes HTML
 * responses; if personalization fails, the origin response is served as is.
 * Fragments (variants, and texts for engine descriptions) come from the same
 * origin, through the same worker logic.
 */

// The upstream worker ships as .mjs; keep its file name unchanged.
// eslint-disable-next-line import/extensions
import aemWorker from './aem-worker.mjs';
import config from './personalization/edge-config.js';
import { handleApiRoute, personalizeResponse } from './personalization/personalize.js';

export default {
  async fetch(request, env, ctx) {
    const fetchPlain = (path) => aemWorker.fetch(new Request(new URL(`${path}.plain.html`, request.url), {
      headers: { host: request.headers.get('host') || new URL(request.url).host },
    }), env, ctx);
    const routed = await handleApiRoute(request, env, config, { fetchPlain });
    if (routed) return routed;
    const response = await aemWorker.fetch(request, env, ctx);
    return personalizeResponse(request, response, {
      config, env, cf: request.cf, ctx, fetchFragment: fetchPlain,
    });
  },
};
