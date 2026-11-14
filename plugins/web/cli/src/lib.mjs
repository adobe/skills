// Public surface for programs that extend `web` with their own commands (dist/lib.mjs).
// Keep it small: every name here is a semver commitment.
export { createProgram, runCli } from '#src/cli.mjs';
export { runPageCommand } from '#src/page/run.mjs';
export { createContext } from '#src/context.mjs';
export { withSession, artifactDir, artifactPath } from '#src/session.mjs';
export { emit, fail } from '#src/output.mjs';
export { CliError, EXIT } from '#src/errors.mjs';
export { createDriver } from '#src/driver/playwright-cli.mjs';
