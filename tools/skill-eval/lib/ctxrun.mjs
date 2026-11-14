import { parseArgs } from 'node:util';
import { buildContext, removeContext } from './ctxbuild.mjs';

const CTX_HELP = `Usage: skill-eval ctx --base <ref> [--take <ref>:<path>]... --out <dir> [--name <label>] [--repo <dir>]
       skill-eval ctx rm <dir> [--drop-ref] [--repo <dir>]

Builds a plugin tree for --context from git refs: a detached worktree at --base, then each
--take replaces <path> with its state at <ref> (files absent at <ref> are removed, so deleted
files cannot linger). The result is committed, verified against each ref and kept reachable as
refs/skill-eval/ctx/<name>; a manifest is written to <repo>/.skill-eval/ctx/<name>.json.
Prints the manifest as JSON. 'ctx rm' removes the worktree (the ref stays unless --drop-ref).

Example: skill-eval ctx --base origin/main --take pr/aem-cli:plugins/p/skills/aem-cli --out /tmp/ctx-final`;

export async function ctxMain(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      base: { type: 'string' },
      take: { type: 'string', multiple: true, default: [] },
      out: { type: 'string' },
      name: { type: 'string' },
      repo: { type: 'string', default: '.' },
      'drop-ref': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) {
    console.log(CTX_HELP);
    return;
  }
  if (positionals[0] === 'rm') {
    if (positionals.length !== 2) throw new Error('ctx rm <dir>');
    console.log(JSON.stringify(await removeContext({ repo: values.repo, target: positionals[1], dropRef: values['drop-ref'] }), null, 2));
    return;
  }
  if (positionals.length) throw new Error(`ctx: unexpected argument ${positionals[0]}`);
  console.log(JSON.stringify(await buildContext({ repo: values.repo, base: values.base, takes: values.take, out: values.out, name: values.name }), null, 2));
}
