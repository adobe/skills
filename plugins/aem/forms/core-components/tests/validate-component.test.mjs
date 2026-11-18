import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateComponent, pascalName } from '../skills/create-core-component/scripts/validate-component.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '../skills/create-core-component/scripts/validate-component.mjs');
const NAME = 'rangefield';
const PASCAL = 'RangeField';
const JAVA = 'bundles/af-core/src/main/java/com/adobe/cq/forms/core/components';
const UI = `ui.af.apps/src/main/content/jcr_root/apps/core/fd/components/form/${NAME}/v1/${NAME}`;
const CATEGORY = `core.forms.components.${NAME}.v1.runtime`;

const bem = `cmp-adaptiveform-${NAME}`;
const files = () => ({
  [`${JAVA}/models/form/${PASCAL}.java`]: '/* Copyright */\n@ConsumerType\npublic interface RangeField extends Field {}\n',
  [`${JAVA}/internal/models/v1/form/${PASCAL}Impl.java`]: [
    '/* Copyright */',
    '@Model(adaptables = {SlingHttpServletRequest.class, Resource.class}, adapters = {RangeField.class, ComponentExporter.class}, resourceType = FormConstants.RT_FD_FORM_RANGEFIELD_V1)',
    '@Exporter(name = ExporterConstants.SLING_MODEL_EXPORTER_NAME)',
    'public class RangeFieldImpl {',
    '  @ValueMapValue(injectionStrategy = InjectionStrategy.OPTIONAL) private String step;',
    '  public String getFieldType() { return "number-input"; }',
    '}',
  ].join('\n'),
  [`${JAVA}/internal/form/FormConstants.java`]: `public static final String RT_FD_FORM_RANGEFIELD_V1 = RT_FD_FORM_PREFIX + "${NAME}/v1/${NAME}";\n`,
  [`bundles/af-core/src/test/java/com/adobe/cq/forms/core/components/internal/models/v1/form/${PASCAL}ImplTest.java`]:
    '@ExtendWith(AemContextExtension.class)\nclass T { FormsCoreComponentTestContext.newAemContext(); void testFieldType() {} void testJSONExport() {} }\n',
  [`bundles/af-core/src/test/resources/form/${NAME}/test-content.json`]: `{"sling:resourceType":"core/fd/components/form/${NAME}/v1/${NAME}","fieldType":"number-input"}`,
  [`bundles/af-core/src/test/resources/form/${NAME}/exporter-${NAME}.json`]: '{}',
  [`${UI}/${NAME}.html`]: [
    `<div class="${bem}" data-cmp-is="adaptiveFormRangeField" data-cmp-visible="1" data-cmp-enabled="1" data-cmp-required="0" data-cmp-readonly="0"`,
    ' data-cmp-data-layer="x" data-cmp-adaptiveformcontainer-path="${formstructparser.formContainerPath}" id="${component.id}">',
    ` <label for="\${component.id}-widget" class="${bem}__label">\${'label.html'}</label>`,
    ` <input class="${bem}__widget" id="\${component.id}-widget" aria-label="x"/>`,
    ` <div class="${bem}__errormessage" data-sly-use.err="errorMessage.html"></div>`,
    ` <div data-sly-use.s="shortDescription.html longDescription.html questionMark.html FormStructureParser"></div>`,
    '</div>',
  ].join('\n'),
  [`${UI}/${NAME}.js`]: '"use strict";\n',
  [`${UI}/.content.xml`]: 'jcr:primaryType="cq:Component" sling:resourceSuperType="core/fd/components/form/base/v1/base" componentGroup=".core-adaptiveform"',
  [`${UI}/_cq_dialog/.content.xml`]: 'sling:resourceType="cq/gui/components/authoring/dialog" trackingFeature="x" extraClientlibs="[a]" core/fd/components/form/base/v1/base',
  [`${UI}/clientlibs/site/.content.xml`]: `allowProxy="{Boolean}true" categories="[${CATEGORY}]" dependencies="[core.forms.components.runtime.base]"`,
  [`${UI}/clientlibs/site/js.txt`]: '#base=js\nrangefieldview.js\n',
  [`${UI}/clientlibs/site/css.txt`]: '#base=css\nrangefield.less\n',
  [`${UI}/clientlibs/site/js/${NAME}view.js`]: [
    'class RangeField extends FormView.FormFieldBase {',
    `  static NS = FormView.Constants.NS; static IS = "adaptiveFormRangeField"; static bemBlock = '${bem}';`,
    `  static selectors = { self: "[data-" + this.NS + '-is="' + this.IS + '"]' };`,
    '  getWidget() {} getLabel() {} getErrorDiv() {} getDescription() {} getTooltipDiv() {} getQuestionMarkDiv() {}',
    '  setActive() {} setInactive() {} updateValue() {}',
    `  // ${bem}__widget ${bem}__label ${bem}__errormessage`,
    '}',
    'FormView.Utils.setupField(({ element, formContainer }) => new RangeField({ element, formContainer }), RangeField.selectors.self);',
  ].join('\n'),
  [`${UI}/clientlibs/site/css/${NAME}.less`]: `.${bem} { &:focus {} [aria-invalid] {} }`,
  [`${UI}/clientlibs/editor/.content.xml`]: '<x/>',
  [`${UI}/README.md`]: '# Range Field\n',
  [`examples/ui.apps/src/main/content/jcr_root/apps/forms-components-examples/components/form/${NAME}/.content.xml`]:
    `componentGroup="Core Components Examples" sling:resourceSuperType="core/fd/components/form/${NAME}/v1/${NAME}"`,
  [`examples/ui.content/src/main/content/jcr_root/content/core-components-examples/library/adaptive-form/${NAME}/.content.xml`]:
    'xmlns:fd="http://x" fd:version="2.1" <guideContainer/>',
  [`ui.tests/test-module/specs/${NAME}/${NAME}.runtime.cy.js`]: 'describe("x", () => {});\n',
  'ui.af.apps/pom.xml': `<replace file="target/jcr_root/libs/core/fd/components/form/${NAME}/v1/${NAME}/.content.xml" token=".core-adaptiveform" value="Core Adaptive Form" />`,
  'ui.af.apps/src/main/content/jcr_root/apps/core/fd/af-clientlibs/core-forms-components-runtime-all/.content.xml':
    `embed="[core.forms.components.runtime.base,${CATEGORY}]"`,
});

function run(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ccc-'));
  try {
    Object.entries({ ...files(), ...overrides }).forEach(([path, content]) => {
      if (content === null) return;
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    });
    return { root, result: validateComponent(NAME, root) };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const failures = (overrides) => run(overrides).result.failed.join('\n');

test('a fully wired component passes with no failures', () => {
  assert.deepEqual(run().result.failed, []);
});

test('missing pom.xml replace line fails', () => {
  assert.match(failures({ 'ui.af.apps/pom.xml': '<project/>' }), /pom\.xml: no <replace/);
});

test('pom.xml replace line for another component does not count', () => {
  const pom = `<replace file="target/jcr_root/libs/core/fd/components/form/other/v1/other/.content.xml" token=".core-adaptiveform" value="x" />`;
  assert.match(failures({ 'ui.af.apps/pom.xml': pom }), /pom\.xml: no <replace/);
});

test('category missing from the runtime-all embed fails', () => {
  const path = 'ui.af.apps/src/main/content/jcr_root/apps/core/fd/af-clientlibs/core-forms-components-runtime-all/.content.xml';
  assert.match(failures({ [path]: 'embed="[core.forms.components.runtime.base]"' }), /runtime-all: .* missing from the embed/);
});

test('category is read from the clientlib, so a mixed-case category passes', () => {
  const mixed = 'core.forms.components.rangeField.v1.runtime';
  const path = 'ui.af.apps/src/main/content/jcr_root/apps/core/fd/af-clientlibs/core-forms-components-runtime-all/.content.xml';
  const result = run({
    [`${UI}/clientlibs/site/.content.xml`]: `allowProxy="{Boolean}true" categories="[${mixed}]" dependencies="[core.forms.components.runtime.base]"`,
    [path]: `embed="[${mixed}]"`,
  }).result;
  assert.deepEqual(result.failed, []);
});

test('missing Cypress spec fails', () => {
  assert.match(failures({ [`ui.tests/test-module/specs/${NAME}/${NAME}.runtime.cy.js`]: null }), /Cypress spec/);
});

test('missing FormConstants entry fails', () => {
  assert.match(failures({ [`${JAVA}/internal/form/FormConstants.java`]: '// none\n' }), /FormConstants/);
});

test('view JS that does not register with setupField fails', () => {
  assert.match(failures({ [`${UI}/clientlibs/site/js/${NAME}view.js`]: 'class X {}' }), /setupField/);
});

test('HTL missing the data-layer attribute fails', () => {
  const html = files()[`${UI}/${NAME}.html`].replace(' data-cmp-data-layer="x"', '');
  assert.match(failures({ [`${UI}/${NAME}.html`]: html }), /data-cmp-data-layer/);
});

test('@ValueMapValue without OPTIONAL warns', () => {
  const impl = files()[`${JAVA}/internal/models/v1/form/${PASCAL}Impl.java`].replace('InjectionStrategy.OPTIONAL', 'X');
  assert.ok(run({ [`${JAVA}/internal/models/v1/form/${PASCAL}Impl.java`]: impl }).result.warnings.some((w) => /OPTIONAL/.test(w)));
});

test('pascalName takes the case from the interface file', () => {
  const root = mkdtempSync(join(tmpdir(), 'ccc-'));
  try {
    mkdirSync(join(root, JAVA, 'models/form'), { recursive: true });
    writeFileSync(join(root, JAVA, 'models/form/ImageChoice.java'), '');
    assert.equal(pascalName('imagechoice', root), 'ImageChoice');
    assert.equal(pascalName('slider', root), 'Slider');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI exits 2 without a name, 2 outside a checkout, 1 on failures, 0 when it passes', () => {
  const cli = (...args) => spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8' });
  assert.equal(cli().status, 2);

  const empty = mkdtempSync(join(tmpdir(), 'ccc-'));
  const missing = mkdtempSync(join(tmpdir(), 'ccc-'));
  const good = mkdtempSync(join(tmpdir(), 'ccc-'));
  try {
    assert.equal(cli(NAME, '--root', empty).status, 2);
    mkdirSync(join(missing, 'bundles/af-core'), { recursive: true });
    assert.equal(cli(NAME, '--root', missing).status, 1);
    Object.entries(files()).forEach(([path, content]) => {
      mkdirSync(dirname(join(good, path)), { recursive: true });
      writeFileSync(join(good, path), content);
    });
    const ok = cli(NAME, '--root', good, '--json');
    assert.equal(ok.status, 0, ok.stdout);
    assert.deepEqual(JSON.parse(ok.stdout).failed, []);
  } finally {
    [empty, missing, good].forEach((d) => rmSync(d, { recursive: true, force: true }));
  }
});
