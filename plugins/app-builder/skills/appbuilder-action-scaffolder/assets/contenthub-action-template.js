const { Core } = require('@adobe/aio-sdk');

/**
 * Content Hub web action.
 *
 * Data flow: a Content Hub panel / card action / bulk action passes the selected
 * asset ID(s) plus auth context to this action, which calls the AEM Assets Author
 * API server-side (CORS blocks the browser from calling AEM directly) and returns
 * the result to the panel to render.
 *
 * Params passed from the extension (see contenthub-extensions.md):
 *   assetId  — asset URN from host.assetDetails.getCurrentAsset() (or assetIds[] for bulk)
 *   aemHost  — AEM author host from host.discovery.getAemHost()
 *   apiKey   — from host.auth.getApiKey() (never hardcode)
 *   imsOrg   — from host.auth.getIMSInfo()
 *
 * For authenticated AEM API calls, set require-adobe-auth: true in ext.config.yaml,
 * send the Authorization header from the panel, and read the token below.
 */
async function main(params) {
  const logger = Core.Logger('main', { level: params.LOG_LEVEL || 'info' });

  try {
    logger.info('Content Hub action invoked', JSON.stringify({ assetId: params.assetId }));

    // Input validation
    const requiredParams = ['assetId', 'aemHost'];
    const missingParams = requiredParams.filter(p => !params[p]);
    if (missingParams.length > 0) {
      return {
        statusCode: 400,
        body: { error: `Missing required parameters: ${missingParams.join(', ')}` }
      };
    }

    const { assetId, aemHost, apiKey, imsOrg } = params;
    // When require-adobe-auth: true, the gateway injects the bearer token here:
    const token = params.__ow_headers?.authorization?.substring(7);

    const response = await fetch(`https://${aemHost}/adobe/assets/${assetId}/metadata`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-Api-Key': apiKey,           // always from the frontend — never hardcode
        'x-gw-ims-org-id': imsOrg,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`AEM Assets Author API failed (${response.status})`);
    }

    const data = await response.json();
    const metadata = data.value ?? data;

    logger.info('Content Hub action completed successfully');
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: { metadata }
    };
  } catch (error) {
    logger.error('Content Hub action failed:', error.message);
    return {
      statusCode: 500,
      body: { error: error.message }
    };
  }
}

exports.main = main;
