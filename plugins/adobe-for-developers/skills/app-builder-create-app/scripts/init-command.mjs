// Validates create-app inputs and prints the exact, non-interactive `aio app init` command as JSON.
// Usage: node init-command.mjs --surface <key> --name "<App name>" --dir <folder> --org <orgCode> --project <name|id> [--workspace <name>] [--with-action]
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { parseArgs } from 'node:util';

const fail = (message) => {
  console.log(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
};

let opt;
try {
  opt = parseArgs({
    options: {
      surface: { type: 'string' }, name: { type: 'string' }, dir: { type: 'string' },
      org: { type: 'string' }, project: { type: 'string' }, workspace: { type: 'string', default: 'Stage' }, 'with-action': { type: 'boolean', default: false },
    },
  }).values;
} catch (error) {
  fail(error.message);
}

const surfaces = JSON.parse(readFileSync(new URL('./templates.json', import.meta.url), 'utf8'));
const surface = surfaces[opt.surface];
if (!surface) fail(`Unknown surface "${opt.surface}". Choose one of: ${Object.keys(surfaces).join(', ')}.`);

// Labels become file and component names in the generated code, so keep them to letters, digits and spaces,
// and capitalise each word so generated React components start with an upper-case letter.
const label = (opt.name ?? '').replace(/[^A-Za-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40).trim()
  .split(' ').map((w) => w && w[0].toUpperCase() + w.slice(1)).join(' ');
if (!/^[A-Za-z]/.test(label)) fail('The app name must start with a letter.');
const id = label.toLowerCase().replace(/ /g, '-');
const pascal = label.replace(/ /g, '');

if (!/^[A-Za-z0-9._@-]+$/.test(opt.org ?? '')) fail('Pass the org code from get_organisations, e.g. 1234ABCD@AdobeOrg.');
if (!/^([A-Za-z][A-Za-z0-9]{2,19}|\d+)$/.test(opt.project ?? '')) {
  fail('Project name: 3-20 letters or digits, starting with a letter (or pass an existing project id).');
}
// aio app init creates a missing workspace (with its own Runtime namespace) without asking.
if (!/^[A-Za-z][A-Za-z0-9]{0,44}$/.test(opt.workspace)) fail('Workspace name: up to 45 letters or digits, starting with a letter.');
// A relative folder of plain characters keeps the printed command safe to paste into any shell.
if (!/^[A-Za-z0-9][\w.-]*(\/[\w.-]+)*$/.test(opt.dir ?? '')) fail('Folder: a relative path of letters, digits, dots, dashes or underscores.');
if (existsSync(opt.dir) && (!statSync(opt.dir).isDirectory() || readdirSync(opt.dir).length > 0)) {
  fail(`"${opt.dir}" already exists and is not an empty folder. Choose a new folder.`);
}

const args = ['app', 'init', opt.dir, '-y', '--org', opt.org, '--project', opt.project, '-w', opt.workspace, '-t', surface.template];
if (surface.mode === 'is-test' || surface.mode === 'manifest') {
  const fill = (text) => text.replaceAll('{{label}}', label).replaceAll('{{id}}', id).replaceAll('{{Pascal}}', pascal);
  const manifest = {
    name: label, id, description: `${label} App Builder extension`, version: '0.0.1',
    ...JSON.parse(fill(JSON.stringify(surface.manifest))),
    ...(opt['with-action'] && surface.actions === 'optional' ? { runtimeActions: [{ name: 'generic' }] } : {}),
  };
  const options = surface.mode === 'is-test' ? { 'is-test': true, 'extension-manifest': manifest } : { 'extension-manifest': manifest };
  args.push('--template-options', Buffer.from(JSON.stringify(options)).toString('base64'));
}

console.log(JSON.stringify({
  ok: true,
  command: ['aio', ...args].join(' '),
  args,
  // The template asks one question (accepting the default is right) only after its npm installs, so stdin must
  // stay open until then: feed blank lines continuously, e.g. `yes '' | <command>`.
  answerWithBlankLines: surface.mode === 'stdin',
  extensionPoint: surface.extensionPoint,
  extensionFolder: surface.folder,
  actions: surface.actions,
  needs: surface.needs,
}, null, 2));
