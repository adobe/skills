const { Core } = require('@adobe/aio-sdk');

async function main(params) {
  const logger = Core.Logger('main', { level: params.LOG_LEVEL || 'info' });
  return { orders: [] };
}

module.exports = { main };
