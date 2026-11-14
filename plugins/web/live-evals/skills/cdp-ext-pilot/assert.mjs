import { readFileSync, statSync } from 'node:fs';
import { fail, findFile, graded, ok, toolOutput } from '../../lib/outputs.mjs';

const problems = (checks) => Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);

// The skill tells the agent to close Chrome when it is done, so state is checked from what the
// agent's own tools printed (CDP evals, launch output), not from the browser afterwards.
const CHECKS = {
  'sidepanel-note': (output, response) => ({
    'a tool saw the saved note in the panel': /Saved: buy milk/.test(toolOutput(response)),
    'answer quotes the status': /Saved: buy milk/.test(output),
  }),
  'options-shot': (output, response) => {
    const file = findFile(response, 'options.png');
    return {
      'png written': file ? readFileSync(file).subarray(1, 4).toString() === 'PNG' && statSync(file).size > 1000 : false,
      'answer gives the heading': /Notes Tester options/.test(output),
    };
  },
  'extension-id': (output, response) => {
    const id = toolOutput(response).match(/"extensionId":\s*"([a-p]{32})"/)?.[1];
    return {
      'extension id reported': Boolean(id) && output.includes(id),
      'popup title reported': /Notes popup/.test(output),
    };
  },
};

export const extensionTaskDone = graded(async (output, { vars, providerResponse }) => {
  const failed = problems(CHECKS[vars.check](output, providerResponse));
  return failed.length ? fail(`failed checks: ${failed.join(', ')}`) : ok(`${vars.check} checks passed`);
});
