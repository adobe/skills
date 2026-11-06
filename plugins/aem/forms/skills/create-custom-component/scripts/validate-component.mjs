#!/usr/bin/env node
/*
 * Static validator for an AEM Forms (Edge Delivery Services) custom form component.
 *
 * Checks the files the create-custom-component skill generates — folder layout, the
 * `_<name>.json` authoring schema, the `<name>.js` decorator, registration in
 * `blocks/form/mappings.js` / `_form.json` / `models/_component-definition.json`, and
 * whether `npm run build:json` output includes the component. No dependencies; Node 18+.
 *
 * Exit codes: 0 = no errors (warnings allowed), 1 = errors found, 2 = usage error.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';

const USAGE = `validate-component.mjs — statically validate an AEM Forms custom component

Usage:
  node validate-component.mjs <component-name> [--root <project-root>] [--json]

Options:
  --root <dir>  Project root containing blocks/form (default: current directory;
                falls back to ./code if blocks/form is not found).
  --json        Print machine-readable JSON instead of text.
  -h, --help    Show this help.

Exit codes: 0 = pass (warnings allowed), 1 = errors found, 2 = usage error.`;

const AUTHORING_COMPONENTS = new Set([
  'text', 'textarea', 'richtext', 'number', 'boolean', 'select', 'multiselect',
  'radio-group', 'checkbox-group', 'date-time', 'container', 'tab', 'reference',
  'aem-content', 'aem-content-fragment', 'aem-experience-fragment', 'aem-tag',
]);
const OPTION_COMPONENTS = new Set(['select', 'multiselect', 'radio-group', 'checkbox-group']);
const README_SECTIONS = [
  { label: 'How to Use / Authoring Properties', re: /^##\s+(How to Use|Authoring Properties)\b/im },
  { label: 'Usage Notes', re: /^##\s+Usage Notes\b/im },
];

function parseArgs(argv) {
  const opts = { name: null, root: null, json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') opts.help = true;
    else if (arg === '--json') opts.json = true;
    else if (arg === '--root') {
      opts.root = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--root=')) opts.root = arg.slice('--root='.length);
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else if (!opts.name) opts.name = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  return opts;
}

function resolveRoot(root) {
  const base = resolve(root || process.cwd());
  if (existsSync(join(base, 'blocks/form'))) return base;
  if (!root && existsSync(join(base, 'code/blocks/form'))) return join(base, 'code');
  return base;
}

function readText(file) {
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

function stringsInArrayLiteral(source, varName) {
  const re = new RegExp(`\\b${varName}\\s*=\\s*(?:new\\s+Set\\(\\s*)?\\[([^\\]]*)\\]`);
  const match = source.match(re);
  if (!match) return null;
  return [...match[1].matchAll(/['"`]([^'"`]+)['"`]/g)].map((m) => m[1]);
}

function findDeep(node, key, out = []) {
  if (Array.isArray(node)) node.forEach((n) => findDeep(n, key, out));
  else if (node && typeof node === 'object') {
    Object.entries(node).forEach(([k, v]) => {
      if (k === key) out.push({ value: v, parent: node });
      findDeep(v, key, out);
    });
  }
  return out;
}

export function validateComponent(name, rootDir) {
  const root = resolveRoot(rootDir);
  const checks = [];
  const add = (level, id, message) => checks.push({ level, id, message });
  const pass = (id, message) => add('pass', id, message);
  const error = (id, message) => add('error', id, message);
  const warn = (id, message) => add('warn', id, message);

  const formDir = join(root, 'blocks/form');
  const compDir = join(formDir, 'components', name);
  const jsFile = join(compDir, `${name}.js`);
  const cssFile = join(compDir, `${name}.css`);
  const jsonFile = join(compDir, `_${name}.json`);
  const readmeFile = join(compDir, 'README.md');
  const rel = (p) => p.slice(root.length + 1);

  const finish = () => {
    const errors = checks.filter((c) => c.level === 'error').length;
    const warnings = checks.filter((c) => c.level === 'warn').length;
    return {
      component: name, root, status: errors ? 'fail' : 'pass', errors, warnings, checks,
    };
  };

  // ---- naming & layout -------------------------------------------------------------
  if (!/^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/.test(name)) {
    error('name.format', `"${name}" is not a valid component name (letters, digits, single hyphens)`);
  } else if (name !== name.toLowerCase()) {
    warn('name.case', `"${name}" contains uppercase letters; prefer lowercase kebab-case`);
  } else {
    pass('name.format', `"${name}" is kebab-case`);
  }

  if (!existsSync(formDir)) {
    error('project.form-block', `No blocks/form directory under ${root}. Run from the project root or pass --root.`);
    return finish();
  }
  if (!existsSync(compDir) || !statSync(compDir).isDirectory()) {
    error('files.folder', `Missing component folder ${rel(compDir)}`);
    return finish();
  }
  pass('files.folder', `Found ${rel(compDir)}`);

  const js = readText(jsFile);
  if (js === null) {
    const others = readdirSync(compDir).filter((f) => f.endsWith('.js'));
    error('files.js', `Missing ${rel(jsFile)} (folder and JS file names must match)${others.length ? `; found ${others.join(', ')}` : ''}`);
  } else pass('files.js', `Found ${rel(jsFile)}`);

  const hasCss = existsSync(cssFile);
  if (hasCss) pass('files.css', `Found ${rel(cssFile)}`);

  const jsonText = readText(jsonFile);
  let schema = null;
  if (jsonText === null) {
    error('files.json', `Missing ${rel(jsonFile)}`);
  } else {
    try {
      schema = JSON.parse(jsonText);
      pass('files.json', `${rel(jsonFile)} is valid JSON`);
    } catch (e) {
      error('files.json', `${rel(jsonFile)} is not valid JSON: ${e.message}`);
    }
  }

  const readme = readText(readmeFile);
  if (readme === null) {
    warn('files.readme', `Missing ${rel(readmeFile)}`);
  } else {
    const missing = README_SECTIONS.filter((s) => !s.re.test(readme)).map((s) => s.label);
    if (!/^#\s+\S/m.test(readme)) missing.unshift('# <Component Name> title');
    if (missing.length) warn('files.readme', `README.md is missing sections: ${missing.join(', ')}`);
    else pass('files.readme', 'README.md has the required sections');
  }

  // ---- JSON schema -----------------------------------------------------------------
  if (schema) {
    const definitions = Array.isArray(schema.definitions) ? schema.definitions : [];
    const viewTypeOf = (d) => d?.plugins?.xwalk?.page?.template?.['fd:viewType'];
    const definition = definitions.find((d) => d?.id === name)
      || definitions.find((d) => viewTypeOf(d) === name)
      || (definitions.length === 1 ? definitions[0] : undefined);
    if (!definitions.length) error('json.definitions', 'JSON has no "definitions" array');
    else if (!definition) {
      error('json.definitions', `No definition with "id" or "fd:viewType" "${name}" (found ids: ${definitions.map((d) => d?.id).join(', ')})`);
    } else if (definition.id !== name) {
      warn('json.definitions', `Definition id "${definition.id}" differs from component name "${name}"; new components should use "id": "${name}"`);
    } else pass('json.definitions', `Definition "${name}" present`);

    const page = definition?.plugins?.xwalk?.page;
    const template = page?.template;
    if (definition && !template) {
      error('json.template', `Definition "${name}" has no plugins.xwalk.page.template`);
    }
    if (template) {
      const viewType = template['fd:viewType'];
      if (viewType === name) pass('json.viewType', `fd:viewType is "${name}"`);
      else if (viewType === undefined) error('json.viewType', `template is missing "fd:viewType": "${name}" — the runtime will never load this component`);
      else error('json.viewType', `fd:viewType "${viewType}" does not match component name "${name}"`);

      if (template.fieldType) pass('json.fieldType', `Extends OOTB fieldType "${template.fieldType}"`);
      else error('json.fieldType', 'template is missing "fieldType" (the OOTB type being extended)');
    }
    if (page) {
      if (typeof page.resourceType === 'string' && page.resourceType.startsWith('core/fd/components/form/')) {
        pass('json.resourceType', `resourceType ${page.resourceType}`);
      } else {
        error('json.resourceType', `resourceType "${page.resourceType}" should be an AEM Forms core component (core/fd/components/form/...)`);
      }
    }

    const models = Array.isArray(schema.models) ? schema.models : [];
    const modelIds = [name, definition?.id, template?.model].filter(Boolean);
    const model = models.find((m) => modelIds.includes(m?.id));
    if (!model) {
      error('json.model', `No model with "id": "${name}" — the properties dialog will be empty`);
    } else if (!Array.isArray(model.fields)) {
      error('json.model', `Model "${name}" has no "fields" array`);
    } else {
      pass('json.model', `Model "${name}" has ${model.fields.length} top-level field entries`);
      validateFields(model.fields, 'models[0].fields');
    }

    // Every "..." reference must resolve to a file relative to the JSON file.
    const refs = findDeep(schema, '...').map((r) => r.value).filter((v) => typeof v === 'string');
    const broken = refs.filter((ref) => !existsSync(resolve(dirname(jsonFile), ref.split('#')[0])));
    if (broken.length) error('json.refs', `Unresolvable "..." references: ${broken.join(', ')}`);
    else if (refs.length) pass('json.refs', `${refs.length} shared-field reference(s) resolve`);
  }

  function validateFields(fields, path) {
    const seen = new Map();
    fields.forEach((field, i) => {
      const at = `${path}[${i}]`;
      if (!field || typeof field !== 'object') {
        error('json.fields', `${at} is not an object`);
        return;
      }
      if (field['...'] && !field.component) return; // pure include
      if (!field.component) {
        error('json.fields', `${at} is missing "component"`);
        return;
      }
      if (!AUTHORING_COMPONENTS.has(field.component)) {
        warn('json.fields', `${at} uses unknown authoring component "${field.component}"`);
      }
      if (field.component !== 'tab' && !field.name) {
        error('json.fields', `${at} (${field.component}) is missing "name"`);
      }
      if (field.name && field.component !== 'container' && field.component !== 'tab') {
        if (seen.has(field.name)) error('json.fields', `Duplicate field name "${field.name}" at ${seen.get(field.name)} and ${at}`);
        else seen.set(field.name, at);
      }
      if (OPTION_COMPONENTS.has(field.component) && !Array.isArray(field.options) && !field['...']) {
        warn('json.fields', `${at} "${field.name}" (${field.component}) has no "options" array`);
      }
      if (Array.isArray(field.fields)) validateFields(field.fields, `${at}.fields`);
    });
  }

  // ---- JS decorator ----------------------------------------------------------------
  if (js !== null) {
    const syntax = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: js, encoding: 'utf8' });
    if (syntax.status === 0) pass('js.syntax', `${name}.js parses as an ES module`);
    else error('js.syntax', `${name}.js has a syntax error: ${(syntax.stderr || '').split('\n').find((l) => /Error/.test(l)) || 'see node --check'}`);

    if (/export\s+default\s+(async\s+)?function\b|export\s+default\s+[A-Za-z_$][\w$]*\s*;|export\s*\{[^}]*\bas\s+default\b/.test(js)) {
      pass('js.export', 'Has a default export (decorate)');
    } else {
      error('js.export', `${name}.js must \`export default function decorate(element, fd, container, formId)\``);
    }

    const subscribeImport = js.match(/import\s*\{[^}]*\bsubscribe\b[^}]*\}\s*from\s*['"]([^'"]+)['"]/);
    const usesSubscribe = /\bsubscribe\s*\(/.test(js.replace(/\.\s*subscribe\s*\(/g, ''));
    if (subscribeImport) {
      if (subscribeImport[1] === '../../rules/index.js') pass('js.subscribe-import', 'Imports subscribe from ../../rules/index.js');
      else error('js.subscribe-import', `subscribe is imported from "${subscribeImport[1]}"; expected '../../rules/index.js'`);
    } else if (usesSubscribe) {
      error('js.subscribe-import', 'subscribe() is called but not imported from ../../rules/index.js');
    }
    if (subscribeImport || usesSubscribe) {
      if (/listenChanges\s*:\s*true/.test(js)) pass('js.listenChanges', 'subscribe() uses { listenChanges: true }');
      else warn('js.listenChanges', 'subscribe() is called without { listenChanges: true } (legacy pattern)');
    }

    if (/\.subscribe\s*\([\s\S]{0,400}?,\s*['"]change['"]\s*\)/.test(js)) {
      warn('js.legacy-change', "fieldModel.subscribe(cb, 'change') is the legacy pattern; use subscribe(..., { listenChanges: true }) and handle eventType === 'change'");
    }

    const changeEvents = [...js.matchAll(/new\s+Event\(\s*['"]change['"]\s*(,\s*\{[^}]*\})?\s*\)/g)];
    if (changeEvents.some((m) => !/bubbles\s*:\s*true/.test(m[1] || ''))) {
      warn('js.change-bubbles', "new Event('change') without { bubbles: true } will not reach the form model");
    }

    if (/querySelector\(\s*`#\$\{/.test(js)) {
      warn('js.child-selector', 'querySelector(`#${id}`) selects the inner input; use `[data-id="${id}"]` to get the field wrapper');
    }

    const badImports = [...js.matchAll(/(?:import|from)\s*['"](\.{1,2}\/[^'"]+)['"]/g)]
      .map((m) => m[1]).filter((p) => !/\.(m?js|json|css)$/.test(p));
    if (badImports.length) error('js.import-ext', `Relative imports must include the .js extension: ${badImports.join(', ')}`);

    if (/\bdocument\.querySelector(All)?\(/.test(js)) {
      warn('js.scope', 'Uses document.querySelector — scope DOM queries to the component element where possible');
    }
  }

  // ---- registration ----------------------------------------------------------------
  const mappingsFile = join(formDir, 'mappings.js');
  const mappings = readText(mappingsFile);
  let noCss = [];
  if (mappings === null) {
    error('register.mappings', `Missing ${rel(mappingsFile)}`);
  } else {
    const custom = stringsInArrayLiteral(mappings, 'customComponents') || [];
    const ootb = stringsInArrayLiteral(mappings, 'OOTBComponentDecorators') || [];
    noCss = stringsInArrayLiteral(mappings, 'NO_CSS_COMPONENTS') || [];
    const inCustom = custom.includes(name);
    const inOotb = ootb.includes(name);
    if (inCustom && inOotb) warn('register.mappings', `"${name}" is listed in both customComponents and OOTBComponentDecorators`);
    else if (inCustom || inOotb) pass('register.mappings', `Registered in ${inCustom ? 'customComponents' : 'OOTBComponentDecorators'} (mappings.js)`);
    else error('register.mappings', `"${name}" is not in customComponents or OOTBComponentDecorators in blocks/form/mappings.js — it will never load`);
  }

  if (!hasCss && !noCss.includes(name)) {
    warn('files.css', `No ${name}.css and not listed in NO_CSS_COMPONENTS — the loader will request a missing stylesheet`);
  }

  const formJson = readText(join(formDir, '_form.json'));
  if (formJson !== null) {
    try {
      const form = JSON.parse(formJson);
      const filter = (form.filters || []).find((f) => f.id === 'form');
      if (filter && Array.isArray(filter.components)) {
        if (filter.components.includes(name)) pass('register.form-filter', '_form.json "form" filter allows the component');
        else warn('register.form-filter', `"${name}" is not in the _form.json "form" filter — authors cannot insert it in Universal Editor`);
      }
    } catch (e) {
      error('register.form-filter', `blocks/form/_form.json is not valid JSON: ${e.message}`);
    }
  }

  const defIndex = readText(join(root, 'models/_component-definition.json'));
  if (defIndex !== null) {
    const ref = `components/${name}/_${name}.json`;
    if (defIndex.includes(ref) || /components\/\*\/_\*\.json/.test(defIndex) || /components\/\*\/_\*\.json/.test(formJson || '')) {
      pass('register.definition-index', 'Component definition is included in models/_component-definition.json');
    } else {
      warn('register.definition-index', `models/_component-definition.json does not reference ${ref}`);
    }
  }

  // ---- build:json output -----------------------------------------------------------
  const builtModels = readText(join(root, 'component-models.json'));
  const builtDefs = readText(join(root, 'component-definition.json'));
  if (builtModels === null || builtDefs === null) {
    warn('build.json', 'component-models.json / component-definition.json not found — run `npm run build:json`');
  } else {
    let models = [];
    try { models = JSON.parse(builtModels); } catch { /* reported below */ }
    const hasModel = Array.isArray(models) && models.some((m) => m?.id === name);
    const hasDef = builtDefs.includes(`"fd:viewType": "${name}"`) || builtDefs.includes(`"fd:viewType":"${name}"`);
    if (hasModel && hasDef) pass('build.json', 'Built component-models.json and component-definition.json include the component');
    else warn('build.json', `Built JSON is stale (model: ${hasModel ? 'yes' : 'no'}, definition: ${hasDef ? 'yes' : 'no'}) — run \`npm run build:json\``);
  }

  return finish();
}

function printText(result) {
  const icon = { pass: '✔', warn: '⚠', error: '✖' };
  console.log(`Validating custom component "${result.component}" in ${result.root}\n`);
  result.checks.forEach((c) => console.log(`${icon[c.level]} [${c.id}] ${c.message}`));
  console.log(`\n${result.status.toUpperCase()}: ${result.errors} error(s), ${result.warnings} warning(s)`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`${e.message}\n\n${USAGE}`);
    process.exit(2);
  }
  if (opts.help) {
    console.log(USAGE);
    process.exit(0);
  }
  if (!opts.name) {
    console.error(`Missing <component-name>\n\n${USAGE}`);
    process.exit(2);
  }
  const result = validateComponent(opts.name, opts.root);
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else printText(result);
  process.exit(result.errors ? 1 : 0);
}
