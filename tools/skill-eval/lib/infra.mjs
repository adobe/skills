const INFRA = /connection error|econnreset|econnrefused|enotfound|etimedout|eai_again|fetch failed|socket hang up|network|stream ended without finish_reason|overloaded|rate.?limit|\b(429|502|503|504)\b|setup \S+ failed \(exit 128/i;

export function isInfraError(message) {
  return typeof message === 'string' && INFRA.test(message);
}

export const RETRY_DELAYS_MS = [5_000, 20_000];

export async function withInfraRetries(run, { isFailure, delays = RETRY_DELAYS_MS, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), onRetry = () => {} }) {
  let result = await run(0);
  for (let i = 0; i < delays.length && isFailure(result); i++) {
    onRetry(i + 1, result);
    await sleep(delays[i]);
    result = await run(i + 1);
  }
  return result;
}

export function createBreaker(limit) {
  let streak = 0;
  return {
    record(infraFailed) {
      streak = infraFailed ? streak + 1 : 0;
    },
    get tripped() {
      return streak >= limit;
    },
  };
}

export function reusablePrior(result) {
  return Boolean(result) && (result.status === 'ok' || result.status === 'timeout');
}
