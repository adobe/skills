// Safe replacement for printing `aio config list`; credentials never leave the helper.
import { readCliConfig } from './lib/cli-config.mjs';

const result = process.argv.length === 2
  ? readCliConfig({ includeDetails: true })
  : { configError: 'This helper does not accept arguments.' };
console.log(JSON.stringify({ ok: !result.configError, ...result }, null, 2));
process.exitCode = result.configError ? 1 : 0;
