#!/usr/bin/env node
/*
 * Static validator for a new AEM Adaptive Forms Core Component.
 *
 * Checks the files the create-core-component skill generates in a working copy of
 * adobe/aem-core-forms-components: Java interface and Sling Model, HTL, dialog, clientlibs,
 * tests, examples, and the wiring outside the component folder (ui.af.apps/pom.xml replace
 * line, core-forms-components-runtime-all embed, README, Cypress spec). No dependencies.
 *
 * Exit codes: 0 = no errors (warnings allowed), 1 = errors found, 2 = usage error.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE = `validate-component.mjs — statically validate a new AEM Core Form Component

Usage:
  node validate-component.mjs <component-name> [--root <checkout>] [--json]

Options:
  --root <dir>  Root of the aem-core-forms-components checkout (default: current directory).
  --json        Print machine-readable JSON instead of text.
  -h, --help    Show this help.

Exit codes: 0 = pass (warnings allowed), 1 = errors found, 2 = usage error.`;

const JAVA = 'bundles/af-core/src/main/java/com/adobe/cq/forms/core/components';
const COMPONENTS = 'ui.af.apps/src/main/content/jcr_root/apps/core/fd/components/form';
const RUNTIME_ALL = 'ui.af.apps/src/main/content/jcr_root/apps/core/fd/af-clientlibs/core-forms-components-runtime-all/.content.xml';

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const text = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : null);

export function pascalName(name, root) {
  const dir = join(root, JAVA, 'models/form');
  if (existsSync(dir)) {
    const hit = readdirSync(dir).find((f) => f.endsWith('.java') && f.slice(0, -5).toLowerCase() === name);
    if (hit) return hit.slice(0, -5);
  }
  return name[0].toUpperCase() + name.slice(1);
}

export function validateComponent(name, root) {
  const passed = [];
  const failed = [];
  const warnings = [];
  const ok = (msg) => passed.push(msg);
  const fail = (msg) => failed.push(msg);
  const warn = (msg) => warnings.push(msg);
  const exists = (file, label) => {
    if (existsSync(file)) ok(`${label}: ${file.split('/').pop()}`);
    else fail(`${label}: MISSING — ${file}`);
    return existsSync(file);
  };
  const contains = (content, needle, label) => {
    if (content === null) return;
    const hit = needle instanceof RegExp ? needle.test(content) : content.includes(needle);
    if (hit) ok(label);
    else fail(label);
  };

  const pascal = pascalName(name, root);
  const bem = `cmp-adaptiveform-${name}`;

  // 1. Files
  const java = join(root, JAVA);
  const iface = join(java, `models/form/${pascal}.java`);
  const impl = join(java, `internal/models/v1/form/${pascal}Impl.java`);
  const constants = join(java, 'internal/form/FormConstants.java');
  exists(iface, 'Java interface');
  exists(impl, 'Java implementation');

  const tests = join(root, 'bundles/af-core/src/test');
  const testClass = join(tests, `java/com/adobe/cq/forms/core/components/internal/models/v1/form/${pascal}ImplTest.java`);
  const testContent = join(tests, `resources/form/${name}/test-content.json`);
  exists(testClass, 'Unit test class');
  exists(testContent, 'Test content JSON');
  exists(join(tests, `resources/form/${name}/exporter-${name}.json`), 'Exporter JSON');

  const ui = join(root, COMPONENTS, `${name}/v1/${name}`);
  const htl = join(ui, `${name}.html`);
  const renderer = join(ui, `${name}.js`);
  const componentXml = join(ui, '.content.xml');
  const dialog = join(ui, '_cq_dialog/.content.xml');
  exists(componentXml, 'Component definition (.content.xml)');
  exists(htl, 'HTL template');
  exists(renderer, 'Renderer JS');
  exists(dialog, 'Author dialog');

  const siteClientlib = join(ui, 'clientlibs/site/.content.xml');
  const jsTxt = join(ui, 'clientlibs/site/js.txt');
  const cssTxt = join(ui, 'clientlibs/site/css.txt');
  const viewJs = join(ui, `clientlibs/site/js/${name}view.js`);
  const less = join(ui, `clientlibs/site/css/${name}.less`);
  const css = join(ui, `clientlibs/site/css/${name}view.css`);
  exists(siteClientlib, 'Site clientlib definition');
  exists(jsTxt, 'js.txt manifest');
  exists(cssTxt, 'css.txt manifest');
  exists(viewJs, 'Client-side view JS');
  const style = [less, css].find((f) => existsSync(f)) ?? null;
  if (style) ok(`Stylesheet: ${style.split('/').pop()}`);
  else fail(`Stylesheet: MISSING — expected ${name}.less or ${name}view.css`);
  exists(join(ui, 'clientlibs/editor/.content.xml'), 'Editor clientlib definition');

  const exampleProxy = join(root, `examples/ui.apps/src/main/content/jcr_root/apps/forms-components-examples/components/form/${name}/.content.xml`);
  const exampleContent = join(root, `examples/ui.content/src/main/content/jcr_root/content/core-components-examples/library/adaptive-form/${name}/.content.xml`);
  exists(exampleProxy, 'Example proxy component');
  exists(exampleContent, 'Example content page');

  // 2. FormConstants
  const constantsText = text(constants);
  if (constantsText !== null) {
    if (new RegExp(`RT_FD_FORM_\\w+\\s*=\\s*.*"${escapeRe(name)}/v\\d+/${escapeRe(name)}"`).test(constantsText)) {
      ok('FormConstants: resource type constant registered');
    } else {
      fail(`FormConstants: no constant found matching resource type pattern '${name}/vN/${name}'`);
    }
  }

  // 3. Interface
  const ifaceText = text(iface);
  contains(ifaceText, '@ConsumerType', 'Interface: @ConsumerType annotation');
  contains(ifaceText, 'extends', 'Interface: extends a base interface');
  contains(ifaceText, 'Copyright', 'Interface: copyright header');

  // 4. Implementation
  const implText = text(impl);
  contains(implText, '@Model', 'Impl: @Model annotation');
  contains(implText, '@Exporter', 'Impl: @Exporter annotation');
  contains(implText, 'SlingHttpServletRequest.class', 'Impl: SlingHttpServletRequest adaptable');
  contains(implText, 'Resource.class', 'Impl: Resource adaptable');
  contains(implText, 'ComponentExporter.class', 'Impl: ComponentExporter adapter');
  contains(implText, 'getFieldType', 'Impl: getFieldType() override');
  contains(implText, 'Copyright', 'Impl: copyright header');
  if (implText?.includes('@ValueMapValue')) {
    if (implText.includes('OPTIONAL')) ok('Impl: @ValueMapValue uses OPTIONAL injection strategy');
    else warn('Impl: @ValueMapValue found without explicit OPTIONAL injection strategy');
  }

  // 5. HTL
  const htlText = text(htl);
  if (htlText !== null) {
    for (const attr of ['is', 'visible', 'enabled', 'required', 'readonly', 'data-layer', 'adaptiveformcontainer-path']) {
      contains(htlText, `data-cmp-${attr}=`, `HTL: data-cmp-${attr} attribute`);
    }
    const shared = htlText + (text(renderer) ?? '');
    for (const [label, file] of [['label', 'label.html'], ['errorMessage', 'errorMessage.html'],
      ['shortDescription', 'shortDescription.html'], ['longDescription', 'longDescription.html'],
      ['questionMark', 'questionMark.html']]) {
      if (shared.includes(file)) ok(`HTL/JS: uses shared ${label} template`);
      else fail(`HTL/JS: missing shared ${label} template reference`);
    }
    if (htlText.includes(bem)) ok(`HTL: uses BEM block '${bem}'`);
    else fail(`HTL: missing BEM block '${bem}'`);
    if (htlText.includes('widget') && (htlText.includes('format=') || htlText.includes('-widget'))) ok('HTL: widget ID convention (componentId-widget)');
    else warn("HTL: could not verify widget ID convention '{componentId}-widget'");
    contains(htlText, 'FormStructureParser', 'HTL: uses FormStructureParser for container path');
  }

  // 6. Accessibility
  if (htlText !== null) {
    if (/for=|componentId=|aria-label/.test(htlText)) ok('A11y: widget has label linkage (label[for] or aria-label)');
    else fail('A11y: no label linkage found — need <label for=...> or aria-label on widget');
    if (htlText.includes(`${bem}__errormessage`) || htlText.includes('errorMessage')) ok('A11y: error message container present');
    else fail('A11y: missing error message container');
  }
  const viewText = text(viewJs);
  if (viewText !== null) {
    for (const method of ['getWidget', 'getLabel', 'getErrorDiv', 'getDescription', 'getTooltipDiv', 'getQuestionMarkDiv']) {
      if (viewText.includes(method)) ok(`A11y JS: ${method}() implemented`);
      else fail(`A11y JS: ${method}() MISSING — required by all view classes`);
    }
    if (viewText.includes('setActive') && viewText.includes('setInactive')) ok('A11y JS: setActive()/setInactive() focus management');
    else warn('A11y JS: setActive()/setInactive() not found — verify focus management in setModel()');
    if (viewText.includes('setModelValue') || viewText.includes('updateValue')) ok('A11y JS: value synchronization (setModelValue/updateValue)');
    else warn('A11y JS: no value sync found (setModelValue or updateValue)');
  }
  const styleText = style ? text(style) : null;
  if (styleText !== null) {
    if (styleText.includes(':focus')) ok('A11y CSS: :focus styles defined');
    else warn('A11y CSS: no :focus styles — ensure visible focus indicator (WCAG 2.4.7)');
    if (styleText.includes('aria-invalid')) ok('A11y CSS: aria-invalid error styling');
    else warn('A11y CSS: no [aria-invalid] styling — consider adding error state styles');
  }

  // 7. Component definition
  const xml = text(componentXml);
  if (xml !== null) {
    contains(xml, 'jcr:primaryType="cq:Component"', 'Component XML: jcr:primaryType=cq:Component');
    contains(xml, 'sling:resourceSuperType=', 'Component XML: sling:resourceSuperType defined');
    if (xml.includes('sling:resourceSuperType="core/fd/components/form/base/')) ok('Component XML: extends base component');
    else warn('Component XML: does not directly extend base — verify inheritance chain');
    contains(xml, 'componentGroup=', 'Component XML: componentGroup defined');
  }

  // 8. Dialog
  const dialogText = text(dialog);
  if (dialogText !== null) {
    contains(dialogText, 'sling:resourceType="cq/gui/components/authoring/dialog"', 'Dialog: correct resourceType');
    contains(dialogText, 'trackingFeature=', 'Dialog: trackingFeature defined');
    if (dialogText.includes('extraClientlibs=')) ok('Dialog: extraClientlibs defined for editor JS');
    else warn("Dialog: no extraClientlibs — editor-specific JS won't load");
    if (dialogText.includes('core/fd/components/form/base/')) ok('Dialog: includes base dialog fields');
    else warn('Dialog: no base dialog includes found — verify help/accessibility tabs');
  }

  // 9. Clientlibs
  const clientlibText = text(siteClientlib);
  if (clientlibText !== null) {
    if (clientlibText.toLowerCase().includes(`core.forms.components.${name}`)) ok('Site clientlib: category follows naming convention');
    else fail(`Site clientlib: expected category containing 'core.forms.components.${name}'`);
    if (clientlibText.includes('core.forms.components.runtime.base')) ok('Site clientlib: depends on runtime.base');
    else warn('Site clientlib: missing dependency on core.forms.components.runtime.base');
    contains(clientlibText, 'allowProxy="{Boolean}true"', 'Site clientlib: allowProxy enabled');
  }
  contains(text(jsTxt), '#base=js', 'js.txt: has #base=js directive');
  contains(text(cssTxt), '#base=css', 'css.txt: has #base=css directive');
  if (viewText !== null) {
    contains(viewText, 'FormView.Utils.setupField', 'View JS: registers via FormView.Utils.setupField');
    contains(viewText, /static\s+IS\s+=/, 'View JS: static IS property defined');
    contains(viewText, /static\s+bemBlock\s+=/, 'View JS: static bemBlock property defined');
    contains(viewText, /static\s+selectors\s+=/, 'View JS: static selectors defined');
    if (viewText.includes(`'${bem}'`) || viewText.includes(`"${bem}"`)) ok(`View JS: BEM block matches '${bem}'`);
    else fail(`View JS: BEM block mismatch — expected '${bem}'`);
  }

  // 10. BEM consistency
  const bemFiles = [htl, viewJs, style, join(ui, '_cq_styleConfig/.content.xml'), renderer]
    .filter((f) => f && existsSync(f))
    .map((f) => [f.split('/').pop(), readFileSync(f, 'utf8')]);
  for (const el of ['__widget', '__label', '__errormessage', '__shortdescription', '__longdescription', '__questionmark', '__label-container']) {
    const full = `${bem}${el}`;
    const found = bemFiles.filter(([, c]) => c.includes(full) || (c.includes(el) && c.includes(bem))).map(([n]) => n);
    if (found.length) ok(`BEM: '${full}' found in ${found.join(', ')}`);
    else if (['__widget', '__label', '__errormessage'].includes(el)) fail(`BEM: '${full}' not found in any file — required element`);
    else warn(`BEM: '${full}' not found — may be handled by shared templates`);
  }

  // 11. Examples
  const proxyText = text(exampleProxy);
  if (proxyText !== null) {
    if (proxyText.includes(`core/fd/components/form/${name}/`)) ok('Example proxy: sling:resourceSuperType points to correct component');
    else fail(`Example proxy: sling:resourceSuperType doesn't reference '${name}'`);
    contains(proxyText, 'componentGroup="Core Components Examples', 'Example proxy: correct componentGroup');
  }
  const exampleText = text(exampleContent);
  if (exampleText !== null) {
    if (exampleText.includes('fd:version')) {
      if (exampleText.includes('xmlns:fd')) ok('Example content: fd namespace declared and fd:version used');
      else fail('Example content: fd:version used WITHOUT xmlns:fd namespace — invalid XML');
    } else warn('Example content: no fd:version attribute — may be needed for form container');
    contains(exampleText, 'guideContainer', 'Example content: guideContainer present');
  }

  // 12. Tests
  const testText = text(testClass);
  contains(testText, '@ExtendWith(AemContextExtension.class)', 'Test: @ExtendWith(AemContextExtension)');
  contains(testText, 'FormsCoreComponentTestContext.newAemContext()', 'Test: uses FormsCoreComponentTestContext');
  contains(testText, 'testFieldType', 'Test: tests getFieldType()');
  contains(testText, 'testJSONExport', 'Test: tests JSON export');
  const contentText = text(testContent);
  if (contentText !== null) {
    if (contentText.includes(`core/fd/components/form/${name}/`)) ok('Test content JSON: sling:resourceType matches component');
    else fail(`Test content JSON: sling:resourceType doesn't reference '${name}'`);
    contains(contentText, '"fieldType"', 'Test content JSON: fieldType property present');
  }

  // 13. Wiring outside the component folder
  const pomText = text(join(root, 'ui.af.apps/pom.xml'));
  if (pomText === null) warn('ui.af.apps/pom.xml not found — wiring check skipped');
  else if (new RegExp(`<replace[^>]*form/${escapeRe(name)}/[^>]*token="\\.core-adaptiveform"`).test(pomText)) ok('pom.xml: component group token replace present');
  else fail(`pom.xml: no <replace token=".core-adaptiveform"> line for form/${name}/ in ui.af.apps/pom.xml`);

  const runtimeText = text(join(root, RUNTIME_ALL));
  const category = clientlibText?.match(/categories="\[([^\]]+)\]"/)?.[1].split(',')[0].trim();
  if (runtimeText === null) warn('core-forms-components-runtime-all/.content.xml not found — wiring check skipped');
  else if (category) {
    if (runtimeText.includes(category)) ok(`runtime-all: embed contains '${category}'`);
    else fail(`runtime-all: '${category}' missing from the embed list of core-forms-components-runtime-all`);
  }
  exists(join(ui, 'README.md'), 'Component README.md');
  const specs = join(root, `ui.tests/test-module/specs/${name}`);
  if (existsSync(specs) && readdirSync(specs).some((f) => f.endsWith('.cy.js'))) ok('Cypress spec present');
  else fail(`Cypress spec: expected ui.tests/test-module/specs/${name}/*.cy.js`);

  return { name, pascal, passed, failed, warnings };
}

function parseArgs(argv) {
  const opts = { name: null, root: null, json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') opts.help = true;
    else if (arg === '--json') opts.json = true;
    else if (arg === '--root') { opts.root = argv[i + 1]; i += 1; }
    else if (arg.startsWith('--root=')) opts.root = arg.slice('--root='.length);
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else if (!opts.name) opts.name = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  return opts;
}

export function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    console.error(`${err.message}\n\n${USAGE}`);
    return 2;
  }
  if (opts.help) {
    console.log(USAGE);
    return 0;
  }
  if (!opts.name || (opts.root !== null && !opts.root)) {
    console.error(USAGE);
    return 2;
  }
  const root = resolve(opts.root || process.cwd());
  if (!existsSync(join(root, 'bundles/af-core'))) {
    console.error(`'${root}' does not look like an aem-core-forms-components checkout (no bundles/af-core). Use --root.`);
    return 2;
  }
  const result = validateComponent(opts.name.trim().toLowerCase(), root);
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Validating ${result.name} (${result.pascal}) in ${root}`);
    for (const msg of result.passed) console.log(`  [PASS] ${msg}`);
    for (const msg of result.warnings) console.log(`  [WARN] ${msg}`);
    for (const msg of result.failed) console.log(`  [FAIL] ${msg}`);
    console.log(`\n${result.passed.length} passed, ${result.warnings.length} warnings, ${result.failed.length} failed`);
  }
  return result.failed.length ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
