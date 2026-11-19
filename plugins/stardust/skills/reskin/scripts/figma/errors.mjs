// skills/reskin/scripts/figma/errors.mjs — the error kinds figma-donor.mjs maps to exit codes.
// UsageError mirrors state.mjs's (same shape, no cross-skill import): .code is the exit code, 2 by
// default. FigmaError is an API outcome: .exitCode (2 not found or bad request, 3 blocked), .status
// (HTTP status, 0 for a network failure) and .info (rate-limit headers and Figma's reason).
// RulesError is a curation-rules problem list: .exitCode 1, .problems.

export class UsageError extends Error {
  constructor(msg, code = 2) { super(msg); this.name = 'UsageError'; this.code = code; }
}

export class FigmaError extends Error {
  constructor(msg, { exitCode = 3, status = 0, info = {} } = {}) {
    super(msg);
    this.name = 'FigmaError';
    this.exitCode = exitCode;
    this.status = status;
    this.info = info;
  }
}

// curation-rules.json problems (or a capture the rules cannot be applied to): exit 1, every problem
// listed at once so one edit pass can fix them all.
export class RulesError extends Error {
  constructor(problems) {
    super(`curation-rules.json: ${problems.length} problem(s)\n  - ${problems.join('\n  - ')}`);
    this.name = 'RulesError';
    this.problems = problems;
    this.exitCode = 1;
  }
}
