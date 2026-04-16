const { Core } = require('@adobe/aio-sdk');

async function main(params) {
  const logger = Core.Logger('main', { level: params.LOG_LEVEL || 'info' });

  try {
    logger.info('Action invoked with params:', JSON.stringify(params));

    // Input validation
    const requiredParams = ['requiredField'];
    const missingParams = requiredParams.filter(p => !params[p]);
    if (missingParams.length > 0) {
      return {
        statusCode: 400,
        body: {
          error: `Missing required parameters: ${missingParams.join(', ')}`
        }
      };
    }

    // Business logic here
    const result = {
      message: `Processed: ${params.requiredField}`
    };

    logger.info('Action completed successfully');
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: result
    };
  } catch (error) {
    logger.error('Action failed:', error.message);
    return {
      statusCode: 500,
      body: { error: error.message }
    };
  }
}

exports.main = main;
