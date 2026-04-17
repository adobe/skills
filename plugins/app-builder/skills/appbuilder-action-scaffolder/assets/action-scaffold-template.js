'use strict';

exports.main = async function main(params) {
  const logger = params.logger || console;

  if (!params.inputId) {
    return {
      statusCode: 400,
      body: { error: 'inputId is required' },
    };
  }

  logger.info('action-invoked', { inputId: params.inputId });

  return {
    statusCode: 200,
    body: {
      ok: true,
      inputId: params.inputId,
    },
  };
};