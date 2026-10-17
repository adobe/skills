/*
 * AEM Cloudflare worker with placeholder personalization.
 *
 * aem-worker.mjs is the official adobe/aem-cloudflare-prod-worker, unchanged.
 * This wrapper only adds the decision-engine route and post-processes HTML
 * responses; if personalization fails, the origin response is served as is.
 */

// The upstream worker ships as .mjs; keep its file name unchanged.
// eslint-disable-next-line import/extensions
import aemWorker from './aem-worker.mjs';
import config from './personalization/edge-config.js';
import { handleApiRoute, personalizeResponse } from './personalization/personalize.js';

export default {
  async fetch(request, env, ctx) {
    const routed = await handleApiRoute(request, env, config);
    if (routed) return routed;
    const response = await aemWorker.fetch(request, env, ctx);
    return personalizeResponse(request, response, {
      config, env, cf: request.cf, ctx,
    });
  },
};
