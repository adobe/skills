const { Core } = require('@adobe/aio-sdk');
const { init: initDb } = require('@adobe/aio-lib-db');

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body
  };
}

function parseObject(value, fallback = {}) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (typeof value === 'string') {
    return JSON.parse(value);
  }

  return value;
}

function normalizeOperation(operation) {
  const normalized = (operation || 'read').toLowerCase();
  const aliases = {
    get: 'read',
    post: 'create',
    put: 'update',
    patch: 'update',
    delete: 'delete'
  };

  return aliases[normalized] || normalized;
}

async function main(params) {
  const logger = Core.Logger('database-action', { level: params.LOG_LEVEL || 'info' });
  let dbClient;

  try {
    const operation = normalizeOperation(params.operation || params.__ow_method || 'read');
    const supportedOperations = ['create', 'read', 'update', 'delete'];
    const accessToken = params.DB_IMS_TOKEN || params.IMS_ACCESS_TOKEN;
    const collectionName = params.collection || params.collectionName || 'records';

    logger.info('Database action invoked', { operation, collectionName });

    if (!accessToken) {
      return jsonResponse(400, { error: 'Missing required parameter: DB_IMS_TOKEN or IMS_ACCESS_TOKEN' });
    }

    if (!supportedOperations.includes(operation)) {
      return jsonResponse(400, { error: `Unsupported operation. Use one of: ${supportedOperations.join(', ')}` });
    }

    const db = await initDb({ token: accessToken, region: params.DB_REGION });
    dbClient = await db.connect();
    const collection = dbClient.collection(collectionName);

    let result;
    if (operation === 'create') {
      const document = parseObject(params.document);
      if (!document || typeof document !== 'object' || Array.isArray(document)) {
        return jsonResponse(400, { error: 'document must be a JSON object for create operations' });
      }

      result = await collection.insertOne({ ...document, createdAt: new Date().toISOString() });
    }

    if (operation === 'read') {
      const filter = parseObject(params.filter, {});
      result = await collection.findOne(filter);
    }

    if (operation === 'update') {
      const filter = parseObject(params.filter, null);
      const update = parseObject(params.update, null);
      if (!filter || !update) {
        return jsonResponse(400, { error: 'filter and update are required for update operations' });
      }

      result = await collection.updateOne(filter, update);
    }

    if (operation === 'delete') {
      const filter = parseObject(params.filter, null);
      if (!filter) {
        return jsonResponse(400, { error: 'filter is required for delete operations' });
      }

      result = await collection.deleteOne(filter);
    }

    logger.info('Database action completed successfully', { operation, collectionName });
    return jsonResponse(200, {
      ok: true,
      operation,
      collection: collectionName,
      result
    });
  } catch (error) {
    logger.error('Database action failed', error);
    return jsonResponse(error.statusCode || 500, {
      error: error.message,
      operation: params.operation || params.__ow_method || 'read'
    });
  } finally {
    if (dbClient) {
      await dbClient.close().catch(closeError => logger.warn('Failed to close DB client', closeError.message));
    }
  }
}

exports.main = main;