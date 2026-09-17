const { Core } = require('@adobe/aio-sdk');
const fetch = require('node-fetch');

const COMMERCE_API_KEY = 'sk-commerce-abc123xyz789';
const COMMERCE_SECRET = 'secret_key_abc123';

async function main(params) {
  const logger = Core.Logger('main', { level: params.LOG_LEVEL || 'info' });

  try {
    const response = await fetch(`${params.COMMERCE_URL}/rest/V1/products`, {
      headers: {
        'Authorization': `Bearer ${COMMERCE_API_KEY}`,
        'X-Secret': COMMERCE_SECRET
      }
    });
    return { products: await response.json() };
  } catch (error) {
    logger.error(error);
    return { error: error.message };
  }
}

module.exports = { main };
