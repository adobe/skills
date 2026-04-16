const { Core, Files } = require('@adobe/aio-sdk');

function getPayloadBuffer(params) {
  if (params.fileContent) {
    return params.contentEncoding === 'base64'
      ? Buffer.from(params.fileContent, 'base64')
      : Buffer.from(params.fileContent, 'utf8');
  }

  if (params.payload !== undefined) {
    const serialized = typeof params.payload === 'string' ? params.payload : JSON.stringify(params.payload, null, 2);
    return Buffer.from(serialized, 'utf8');
  }

  if (params.__ow_body) {
    return Buffer.from(params.__ow_body, 'base64');
  }

  return null;
}

async function main(params) {
  const logger = Core.Logger('large-payload', { level: params.LOG_LEVEL || 'info' });

  try {
    const payloadBuffer = getPayloadBuffer(params);
    if (!payloadBuffer || payloadBuffer.length === 0) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: { error: 'Provide payload, fileContent, or __ow_body before generating a redirect.' }
      };
    }

    const files = await Files.init();
    const storagePath = params.storagePath || `large-payload/${Date.now()}-${params.fileName || 'payload.bin'}`;
    const expiryInSeconds = Number(params.urlExpirySeconds || 60);

    await files.write(storagePath, payloadBuffer);
    const presignedUrl = await files.generatePresignURL(storagePath, { expiryInSeconds });

    logger.info('Large payload stored and redirect generated', {
      storagePath,
      payloadBytes: payloadBuffer.length,
      expiryInSeconds
    });

    return {
      statusCode: 302,
      headers: {
        location: presignedUrl,
        'Cache-Control': 'no-store',
        'x-storage-path': storagePath
      },
      body: ''
    };
  } catch (error) {
    logger.error('Large payload action failed', error);
    return {
      statusCode: error.statusCode || 500,
      headers: { 'Content-Type': 'application/json' },
      body: { error: error.message }
    };
  }
}

exports.main = main;