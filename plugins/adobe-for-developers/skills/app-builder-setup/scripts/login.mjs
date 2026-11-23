// The CLI persists the token itself. Neither stdout nor stderr needs to be captured.
import { aio } from './lib/run.mjs';

try {
  if (process.argv.length !== 2) throw new Error();
  const result = aio(['login'], { timeoutMs: 300_000, discardOutput: true });
  if (!result.ok) {
    console.log(JSON.stringify({
      ok: false,
      error: result.timedOut ? 'CLI sign-in timed out. Retry the login helper.' : 'CLI sign-in did not complete. Check the browser sign-in and CLI installation, then retry the login helper.',
    }));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ ok: true }));
  }
} catch {
  console.log(JSON.stringify({ ok: false, error: 'Could not run CLI sign-in. This helper does not accept arguments.' }));
  process.exitCode = 1;
}
