const { Core } = require('@adobe/aio-sdk');
const eventsSdk = require('@adobe/aio-lib-events');

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body
  };
}

function getHeaders(params) {
  return Object.entries(params.__ow_headers || {}).reduce((acc, [key, value]) => {
    acc[key.toLowerCase()] = value;
    return acc;
  }, {});
}

function getContentType(headers) {
  return (headers['content-type'] || '').split(';')[0].trim().toLowerCase();
}

// Uses CloudEvents-compliant field names (eventid, recipientclientid).
// Legacy event_id/recipient_client_id deprecated, removed end of 2026.
function getEventId(payload = {}) {
  return payload.eventid || payload.id || payload.event?.id;
}

function extractEventPayload(params, headers) {
  if (params.__ow_body) {
    const contentType = getContentType(headers);
    if (contentType && contentType !== 'application/json' && contentType !== 'application/cloudevents+json') {
      const error = new Error('Webhook payload must use application/json or application/cloudevents+json');
      error.statusCode = 415;
      throw error;
    }

    return JSON.parse(Buffer.from(params.__ow_body, 'base64').toString('utf8'));
  }

  if (params.event && typeof params.event === 'object') {
    return params.event;
  }

  const allowedFields = [
    'specversion',
    'type',
    'source',
    'id',
    'eventid',
    'time',
    'data',
    'recipientclientid',
    'datacontenttype',
    'validationUrl'
  ];

  return allowedFields.reduce((payload, key) => {
    if (params[key] !== undefined) {
      payload[key] = params[key];
    }
    return payload;
  }, {});
}

async function verifySignature(eventPayload, params, headers) {
  const client = await eventsSdk.init(
    params.EVENTS_ORG_ID,
    params.EVENTS_API_KEY,
    params.EVENTS_ACCESS_TOKEN,
    { retries: 2, timeout: 5000 }
  );

  return client.verifyDigitalSignatureForEvent(eventPayload, params.RECIPIENT_CLIENT_ID, {
    digiSignature1: headers['x-adobe-digital-signature-1'] || headers['x-adobe-digital-signature1'],
    digiSignature2: headers['x-adobe-digital-signature-2'] || headers['x-adobe-digital-signature2'],
    publicKeyPath1: headers['x-adobe-public-key1-path'],
    publicKeyPath2: headers['x-adobe-public-key2-path']
  });
}

async function main(params) {
  const logger = Core.Logger('event-webhook', { level: params.LOG_LEVEL || 'info' });

  try {
    const method = (params.__ow_method || 'post').toLowerCase();
    if (method === 'get' && params.challenge) {
      logger.info('Responding to Adobe I/O Events challenge request');
      return jsonResponse(200, { challenge: params.challenge });
    }

    const headers = getHeaders(params);
    const eventPayload = extractEventPayload(params, headers);
    const eventId = getEventId(eventPayload) || getEventId(params);

    if (eventPayload.validationUrl) {
      logger.warn('Received asynchronous validation request', { validationUrl: eventPayload.validationUrl });
      return jsonResponse(200, {
        ok: true,
        message: 'Validation URL received. Complete the Adobe validation flow before the link expires.',
        validationUrl: eventPayload.validationUrl
      });
    }

    if (!eventId) {
      return jsonResponse(400, { error: 'Webhook payload must include an event id' });
    }

    const shouldValidateSignature = params.VALIDATE_SIGNATURE !== 'false';
    if (shouldValidateSignature) {
      const validationParams = ['EVENTS_ORG_ID', 'EVENTS_API_KEY', 'EVENTS_ACCESS_TOKEN', 'RECIPIENT_CLIENT_ID'];
      const missing = validationParams.filter(name => !params[name]);
      if (missing.length > 0) {
        return jsonResponse(400, {
          error: `Missing required parameters for signature validation: ${missing.join(', ')}`
        });
      }

      const isValid = await verifySignature(eventPayload, params, headers);
      if (!isValid || eventPayload.recipientclientid !== params.RECIPIENT_CLIENT_ID) {
        logger.warn('Webhook signature verification failed', {
          eventId,
          type: eventPayload.type
        });
        return jsonResponse(401, { error: 'Event signature validation failed' });
      }
    }

    logger.info('Processing event webhook delivery', {
      eventId,
      type: eventPayload.type
    });

    return jsonResponse(202, {
      ok: true,
      receivedAt: new Date().toISOString(),
      eventId,
      eventType: eventPayload.type,
      source: eventPayload.source,
      message: 'Replace this block with product-specific event handling logic.'
    });
  } catch (error) {
    logger.error('Event webhook failed', error);
    return jsonResponse(error.statusCode || 500, { error: error.message });
  }
}

exports.main = main;