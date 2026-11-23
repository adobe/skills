// Read-only deploy preflight: prints which org/project/workspace the app folder targets and what it contains.
import { readAppContext } from './lib/app-config.mjs';

try {
  console.log(JSON.stringify({ ok: true, ...readAppContext() }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: error.message }));
  process.exitCode = 1;
}
