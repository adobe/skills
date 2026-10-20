/** Evaluation arm: `skill` (skill + CLI), `cli` (CLI only) or `none`; SKILLS=off is an alias for none. */
export const ARM = process.env.ARM || (process.env.SKILLS === 'off' ? 'none' : 'skill');
if (!['skill', 'cli', 'none'].includes(ARM)) throw new Error(`ARM must be skill, cli or none, got "${ARM}"`);
/** Value stored in result files; `none` keeps the historical name. */
export const ARM_STORED = ARM === 'none' ? 'no-skill' : ARM;
export const ARM_SUFFIX = { skill: '', cli: '-cli', none: '-noskill' }[ARM];
export const CLI_HINT = 'A `web` CLI is installed; `web --help` documents it.';
