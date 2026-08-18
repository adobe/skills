const { Core } = require('@adobe/aio-sdk');

async function main(params) {
  const logger = Core.Logger('main', { level: params.LOG_LEVEL || 'info' });

  if (!params.orderId) {
    return { error: 'orderId is required', statusCode: 400 };
  }

  return { orderId: params.orderId, status: 'pending' };
}

module.exports = { main };
