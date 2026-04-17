const { Core } = require('@adobe/aio-sdk');
const eventsSdk = require('@adobe/aio-lib-events');

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body
  };
}

function normalizeEventData(eventData) {
  if (typeof eventData === 'string') {
    return JSON.parse(eventData);
  }

  return eventData;
}

async function main(params) {
  const logger = Core.Logger('event-provider', { level: params.LOG_LEVEL || 'info' });

  try {
    const requiredParams = ['EVENTS_ORG_ID', 'EVENTS_API_KEY', 'EVENTS_ACCESS_TOKEN', 'eventCode', 'eventData'];
    const missing = requiredParams.filter(name => !params[name]);
    if (missing.length > 0) {
      return jsonResponse(400, { error: `Missing required parameters: ${missing.join(', ')}` });
    }

    const client = await eventsSdk.init(
      params.EVENTS_ORG_ID,
      params.EVENTS_API_KEY,
      params.EVENTS_ACCESS_TOKEN,
      { retries: 2, timeout: 5000 }
    );

    let providerId = params.providerId;
    if ((params.createProvider === true || params.createProvider === 'true') && !providerId) {
      const lifecycleParams = ['CONSUMER_ORG_ID', 'PROJECT_ID', 'WORKSPACE_ID', 'PROVIDER_LABEL', 'EVENT_LABEL'];
      const lifecycleMissing = lifecycleParams.filter(name => !params[name]);
      if (lifecycleMissing.length > 0) {
        return jsonResponse(400, {
          error: `Missing required parameters for provider creation: ${lifecycleMissing.join(', ')}`
        });
      }

      const provider = await client.createProvider(params.CONSUMER_ORG_ID, params.PROJECT_ID, params.WORKSPACE_ID, {
        label: params.PROVIDER_LABEL,
        description: params.PROVIDER_DESCRIPTION || 'Custom provider created from the action template.',
        docs_url: params.PROVIDER_DOCS_URL
      });

      providerId = provider.id;
      await client.createEventMetadataForProvider(
        params.CONSUMER_ORG_ID,
        params.PROJECT_ID,
        params.WORKSPACE_ID,
        providerId,
        {
          label: params.EVENT_LABEL,
          description: params.EVENT_DESCRIPTION || 'Custom event published by this App Builder action.',
          event_code: params.eventCode
        }
      );
    }

    if (!providerId) {
      return jsonResponse(400, { error: 'providerId is required unless createProvider=true is used' });
    }

    const cloudEvent = {
      specversion: '1.0',
      id: params.eventId || `evt-${Date.now()}`,
      source: params.source || `urn:appbuilder:${providerId}`,
      type: params.eventCode,
      time: new Date().toISOString(),
      datacontenttype: 'application/json',
      data: normalizeEventData(params.eventData)
    };

    if (params.subject) {
      cloudEvent.subject = params.subject;
    }

    const publishResult = await client.publishEvent(cloudEvent);
    logger.info('Event published successfully', { providerId, eventCode: params.eventCode });

    return jsonResponse(202, {
      ok: true,
      providerId,
      eventCode: params.eventCode,
      publishResult: publishResult || 'OK',
      cloudEvent
    });
  } catch (error) {
    logger.error('Event provider action failed', error);
    return jsonResponse(error.statusCode || 500, { error: error.message });
  }
}

exports.main = main;