// evals/harness-smoke/harnesses.mjs — one adapter per target harness: how stardust and impeccable
// get into a fresh workspace, and the headless command that runs one prompt there.
//
// Two layouts. `plugin`: the harness loads the stardust checkout as a plugin for the session
// (Claude Code `--plugin-dir` with the marketplace copy disabled for the session; Copilot CLI
// `--plugin-dir`) and impeccable from the user's own install. `loose`: the workspace gets what
// `npx skills add --copy` would write — stardust's sixteen skills in the harness's project skills
// dir — plus impeccable's per-harness build copied from an impeccable checkout (--impeccable-repo).
// `verified` marks adapters whose command line has run against the real CLI; the others follow
// vendor docs and are fixed by their first run.
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const env = (k) => process.env[k];
const modelArgs = (flag) => (env('SMOKE_MODEL') ? [flag, env('SMOKE_MODEL')] : []);

/** Copy the sixteen stardust skills (and impeccable's build for this harness) into `<ws>/<dir>/skills/`. */
export function installLoose(ws, { skillsDir, impeccableRepo, skillsDot, impeccableDot }) {
  const dest = join(ws, skillsDot, 'skills');
  mkdirSync(dest, { recursive: true });
  for (const s of readdirSync(skillsDir)) if (existsSync(join(skillsDir, s, 'SKILL.md'))) cpSync(join(skillsDir, s), join(dest, s), { recursive: true, filter: (p) => !p.includes('/scripts/test') });
  const imp = join(impeccableRepo, impeccableDot, 'skills', 'impeccable');
  if (!existsSync(join(imp, 'SKILL.md'))) throw new Error(`no impeccable build at ${imp} — pass --impeccable-repo <pbakaus/impeccable checkout>`);
  cpSync(imp, join(ws, impeccableDot, 'skills', 'impeccable'), { recursive: true });
}

export const HARNESSES = {
  claude: {
    name: 'Claude Code', layout: 'plugin', verified: true, bin: 'claude',
    command: ({ prompt, pluginDir }) => ['claude', ['-p', prompt, '--dangerously-skip-permissions',
      '--plugin-dir', pluginDir, '--settings', JSON.stringify({ enabledPlugins: { 'stardust@adobe-skills': false } }), ...modelArgs('--model')]],
  },
  copilot: {
    name: 'GitHub Copilot CLI', layout: 'plugin', verified: true, bin: 'copilot',
    command: ({ prompt, pluginDir }) => ['copilot', ['-p', prompt, '--allow-all-tools', '--allow-all-paths', '--plugin-dir', pluginDir, ...modelArgs('--model')]],
  },
  grok: {
    name: 'Grok Build', layout: 'loose', skillsDot: '.grok', impeccableDot: '.grok', verified: false, bin: 'grok',
    command: ({ prompt }) => ['grok', ['-p', prompt, '--always-approve', ...modelArgs('--model')]],
  },
  opencode: {
    name: 'OpenCode', layout: 'loose', skillsDot: '.agents', impeccableDot: '.opencode', verified: false, bin: 'opencode',
    command: ({ prompt }) => ['opencode', ['run', ...modelArgs('-m'), prompt]],
  },
  cursor: {
    name: 'Cursor CLI', layout: 'loose', skillsDot: '.agents', impeccableDot: '.cursor', verified: false, bin: 'agent',
    command: ({ prompt }) => ['agent', ['-p', '--force', '--output-format', 'text', ...modelArgs('--model'), prompt]],
  },
  codex: {
    name: 'Codex CLI', layout: 'loose', skillsDot: '.agents', impeccableDot: '.agents', verified: false, bin: 'codex',
    // SMOKE_CODEX_SANDBOX=danger-full-access measures the documented escalation; the default measures the stock sandbox with network on.
    command: ({ prompt, lastMessage }) => ['codex', ['exec', '--skip-git-repo-check', '--sandbox', env('SMOKE_CODEX_SANDBOX') || 'workspace-write',
      '-c', 'sandbox_workspace_write.network_access=true', '--output-last-message', lastMessage, ...modelArgs('--model'), prompt]],
  },
  antigravity: {
    name: 'Antigravity CLI', layout: 'loose', skillsDot: '.agents', impeccableDot: '.agent', verified: false, bin: 'agy',
    command: ({ prompt, ws }) => ['agy', ['-p', prompt, '--add-dir', ws, ...modelArgs('--model')]],
  },
  pi: {
    name: 'Pi', layout: 'loose', skillsDot: '.agents', impeccableDot: '.pi', verified: false, bin: 'pi',
    command: ({ prompt }) => ['pi', ['-p', ...modelArgs('--model'), prompt]],
  },
};
