// Applies known template fix-ups after `aio app init` and checks the result. Prints JSON; never reads .env or .aio.
// Usage: node fixup.mjs --surface <key> --dir <folder>
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const fail = (message) => {
  console.log(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
};

let opt;
try {
  opt = parseArgs({ options: { surface: { type: 'string' }, dir: { type: 'string' } } }).values;
} catch (error) {
  fail(error.message);
}
const surfaces = JSON.parse(readFileSync(new URL('./templates.json', import.meta.url), 'utf8'));
const surface = surfaces[opt.surface];
const dir = resolve(opt.dir ?? '.');
if (!surface) fail(`Unknown surface "${opt.surface}".`);
if (!existsSync(join(dir, 'package.json'))) fail(`No generated app in "${dir}". Check the aio app init output.`);

const applied = [];
const todo = [];
const notes = [];
const web = (file) => join(surface.folder, 'web-src/src', file);
const edit = (file, change, note) => {
  const path = join(dir, file);
  if (!existsSync(path)) return;
  const before = readFileSync(path, 'utf8');
  const after = change(before);
  if (after !== before) {
    writeFileSync(path, after);
    applied.push(`${file}: ${note}`);
  }
};

const fixups = {
  // Older templates generate actions for Node versions I/O Runtime no longer runs.
  'node-runtime': () => edit(join(surface.folder, 'ext.config.yaml'), (s) => s.replace(/nodejs:1\d\b/g, 'nodejs:22'), 'action runtime set to nodejs:22'),
  // Generated code logs credentials: at debug level every action dumps its parameters (inputs from .env included) into
  // Runtime logs, and the Experience Cloud Shell UI prints the user's IMS token and profile to the browser console.
  'quiet-logging': () => {
    for (const file of [join(surface.folder, 'ext.config.yaml'), 'app.config.yaml']) {
      edit(file, (s) => s.replace(/LOG_LEVEL: debug\b/g, 'LOG_LEVEL: info'), 'action log level set to info (debug logs every parameter)');
    }
    for (const file of [web('index.js'), web('components/App.js')]) {
      edit(file, (s) => s.replace(/^[ \t]*console\.log\([^\n]*\b(ims\w*|imsToken|imsProfile|runtime object)\b[^\n]*\)[ \t]*;?[ \t]*\r?\n/gm, ''),
        'removed console logging of the IMS token, profile and runtime object');
    }
  },
  // The template passes the extension id only inside `methods`; the host also expects it at the top level.
  'workfront-id': () => edit(web('components/ExtensionRegistration.js'),
    (s) => (/register\(\{\s*id:/.test(s) ? s : s.replace('register({', 'register({\n      id: extensionId,')), 'extension id added to register()'),
  // Experience Hub imports @adobe/uix-guest but swallows its own npm install failures.
  'uix-guest': () => {
    if (!existsSync(join(dir, 'node_modules/@adobe/uix-guest'))) todo.push('Run `npm install @adobe/uix-guest` in the app folder.');
  },
  // The Experience Hub template copies a whole sample project over the generated one.
  'hub-notes': () => notes.push(
    `The widget title and description are placeholders in ${web('components/ExtensionRegistration.js')}; set them from the app name.`,
    'The template adds sample files you can remove: root index.js, root actions/, test/, e2e/, and the publish-events action (it needs SERVICE_API_KEY and an I/O Events provider).',
  ),
};
const unknown = surface.fixups.filter((name) => !fixups[name]);
if (unknown.length) fail(`templates.json names unknown fix-ups: ${unknown.join(', ')}.`);
surface.fixups.forEach((name) => fixups[name]());

const gitignore = join(dir, '.gitignore');
const ignored = existsSync(gitignore) ? readFileSync(gitignore, 'utf8').split(/\r?\n/).map((l) => l.trim()) : [];
// `.env*` already covers `.env`; `logs` holds the private `aio app dev` log.
const missing = ['.env', '.aio', 'logs'].filter((f) => !ignored.includes(f) && !ignored.includes(`${f}*`) && !ignored.includes(`${f}/`));
if (missing.length) {
  appendFileSync(gitignore, `\n${missing.join('\n')}\n`);
  applied.push(`.gitignore: added ${missing.join(', ')} so credentials and local logs are never committed`);
}

const checks = {
  appConfig: existsSync(join(dir, 'app.config.yaml')),
  extensionFolder: existsSync(join(dir, surface.folder)),
  linkedToProject: existsSync(join(dir, '.aio')) && existsSync(join(dir, '.env')),
  dependenciesInstalled: existsSync(join(dir, 'node_modules')),
};
if (!checks.dependenciesInstalled) todo.push('Run `npm install` in the app folder.');

console.log(JSON.stringify({ ok: Object.values(checks).every(Boolean) && todo.length === 0, checks, applied, todo, notes }, null, 2));
