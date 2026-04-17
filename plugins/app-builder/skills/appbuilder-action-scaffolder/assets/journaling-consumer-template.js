// Uses CloudEvents-compliant field names (eventid, recipientclientid).
// Legacy event_id/recipient_client_id deprecated, removed end of 2026.
const { Core, State } = require('@adobe/aio-sdk');
const eventsSdk = require('@adobe/aio-lib-events');

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body
  };
}

function getNextCursor(response, fallback) {
  return response.next || response.links?.next || response._links?.next || response.page?.next || fallback;
}

async function main(params) {
  const logger = Core.Logger('journaling-consumer', { level: params.LOG_LEVEL || 'info' });

  try {
    const requiredParams = ['EVENTS_ORG_ID', 'EVENTS_API_KEY', 'EVENTS_ACCESS_TOKEN', 'JOURNAL_URL'];
    const missing = requiredParams.filter(name => !params[name]);
    if (missing.length > 0) {
      return jsonResponse(400, { error: `Missing required parameters: ${missing.join(', ')}` });
    }

    const checkpointKey = params.CHECKPOINT_KEY || 'journaling-consumer-position';
    const batchSize = Number(params.limit || 25);
    const state = await State.init();
    const checkpointRecord = await state.get(checkpointKey).catch(() => null);
    const journalCursor = checkpointRecord?.value || params.JOURNAL_URL;

    const client = await eventsSdk.init(
      params.EVENTS_ORG_ID,
      params.EVENTS_API_KEY,
      params.EVENTS_ACCESS_TOKEN,
      { retries: 2, timeout: 5000 }
    );

    const response = await client.getEventsFromJournal(journalCursor, { limit: batchSize });
    const events = Array.isArray(response.events) ? response.events : [];

    for (const event of events) {
      logger.info('Processing journal event', {
        eventId: event.id || event.eventid,
        eventType: event.type
      });
    }

    const nextCursor = getNextCursor(response, journalCursor);
    if (nextCursor && nextCursor !== journalCursor) {
      const putOptions = params.CHECKPOINT_TTL ? { ttl: Number(params.CHECKPOINT_TTL) } : {};
      await state.put(checkpointKey, nextCursor, putOptions);
    }

    logger.info('Journal batch processed', { processedCount: events.length, checkpointKey });
    return jsonResponse(200, {
      ok: true,
      processedCount: events.length,
      checkpointKey,
      nextCursor,
      lastEventId: events.length > 0 ? events[events.length - 1].id || events[events.length - 1].eventid : null
    });
  } catch (error) {
    logger.error('Journaling consumer failed', error);
    return jsonResponse(error.statusCode || 500, { error: error.message });
  }
}

exports.main = main;