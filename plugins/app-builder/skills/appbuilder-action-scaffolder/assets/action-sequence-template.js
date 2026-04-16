/*
Preferred manifest sequence wiring:

runtimeManifest:
  packages:
    order-pipeline:
      actions:
        validate-order:
          function: actions/validate-order/index.js
          runtime: nodejs:20
        store-order:
          function: actions/store-order/index.js
          runtime: nodejs:20
      sequences:
        process-order:
          actions: validate-order, store-order
          web: true

Local-dev fallback when aio app dev advertises the sequence URL but returns 404:
- expose the downstream step as a normal web action
- set ENABLE_INLINE_ORCHESTRATION=true and NEXT_ACTION_URL on the first action
- call the first action directly; it will POST the step output to the next action
*/

const { Core } = require('@adobe/aio-sdk');

function shouldOrchestrateInline(params) {
  return params.ENABLE_INLINE_ORCHESTRATION === true || params.ENABLE_INLINE_ORCHESTRATION === 'true';
}

function getForwardHeaders(params) {
  const requestHeaders = params.__ow_headers || {};
  const forwardHeaders = { 'Content-Type': 'application/json' };

  ['authorization', 'x-gw-ims-org-id', 'x-api-key'].forEach(name => {
    if (requestHeaders[name]) {
      forwardHeaders[name] = requestHeaders[name];
    }
  });

  return forwardHeaders;
}

function getSequenceInput(params) {
  if (params.previousResult && typeof params.previousResult === 'object') {
    return params.previousResult;
  }

  const { __ow_headers, __ow_method, __ow_body, __ow_path, LOG_LEVEL, ...upstream } = params;
  return upstream;
}

async function invokeNextAction(params, nextActionInput, logger) {
  if (!params.NEXT_ACTION_URL) {
    return {
      ok: false,
      error: 'NEXT_ACTION_URL is required when ENABLE_INLINE_ORCHESTRATION is enabled.'
    };
  }

  logger.info('Invoking downstream action inline', { nextActionUrl: params.NEXT_ACTION_URL });

  const response = await fetch(params.NEXT_ACTION_URL, {
    method: 'POST',
    headers: getForwardHeaders(params),
    body: JSON.stringify(nextActionInput)
  });

  const responseText = await response.text();
  let responseBody;

  try {
    responseBody = responseText ? JSON.parse(responseText) : {};
  } catch (error) {
    responseBody = { raw: responseText };
  }

  if (!response.ok) {
    return {
      ok: false,
      error: `Downstream action returned ${response.status}`,
      downstream: responseBody
    };
  }

  return responseBody;
}

async function main(params) {
  const logger = Core.Logger('action-sequence', { level: params.LOG_LEVEL || 'info' });

  try {
    const upstream = getSequenceInput(params);
    const workflowId = upstream.workflowId || params.workflowId;
    const stepName = params.stepName || upstream.stepName || 'transform';

    if (!workflowId) {
      return {
        ok: false,
        error: 'workflowId is required for sequence actions so downstream steps can correlate work.'
      };
    }

    logger.info('Sequence action invoked', { workflowId, stepName });

    const nextActionInput = {
      workflowId,
      stepName: `${stepName}-next`,
      previousStepSucceeded: true,
      upstream
    };

    if (shouldOrchestrateInline(params)) {
      return invokeNextAction(params, nextActionInput, logger);
    }

    return {
      ok: true,
      workflowId,
      stepName,
      processedAt: new Date().toISOString(),
      upstream,
      nextActionInput
    };
  } catch (error) {
    logger.error('Sequence action failed', error);
    return {
      ok: false,
      error: error.message,
      failedAt: new Date().toISOString()
    };
  }
}

exports.main = main;