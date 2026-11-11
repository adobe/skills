import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  checkSiteConfig, detectMode, pageExperimentation, readSiteConfig, validate, validatePage,
} from '../validate-placeholders.mjs';
import { readText } from '../lib.mjs';
import { SITE, runHelp, tempDir } from './helpers.mjs';

describe('validate', () => {
  const section = (id, rows, body = '<h1>Title</h1>') => `<div>${body}<div class="section-metadata">`
    + `<div><div>Personalization</div><div>${id}</div></div>`
    + `${rows.map(([key, value]) => `<div><div>${key}</div><div>${value}</div></div>`).join('')}</div></div>`;

  it('passes the fixture site', async () => {
    const report = await validate([], { repo: SITE });
    assert.equal(report.ok, true, JSON.stringify(report.pages.map((p) => p.sections.map((x) => x.errors))));
    assert.deepEqual([report.mode, report.config.errors], ['client', []]);
    assert.deepEqual(report.pages.map((page) => page.file), ['content/index.html', 'content/offer.plain.html']);
    const [hero, welcome] = report.pages[0].sections;
    assert.deepEqual([hero.id, hero.section, welcome.id, welcome.section], ['home-hero', 0, 'welcome', 2]);
    assert.match(hero.warnings.join(), /first section \(LCP\)/);
    assert.match(welcome.info.join(), /state keys: quiz-persona/);
    assert.ok(hero.fragments.every((fragment) => fragment.found));
    const [offer] = report.pages[1].sections;
    assert.equal(offer.source, 'api');
    assert.ok(report.pages.flatMap((page) => page.sections).every((item) => !item.warnings.some((w) => /H1/.test(w))));
  });

  it('warns about the H1 only when a variant differs from the authored content', async () => {
    const { dir, cleanup } = tempDir();
    try {
      const base = join(dir, 'content', 'fragments', 'p');
      mkdirSync(base, { recursive: true });
      writeFileSync(join(base, 'in.html'), '<body><main><div><h1>Namaste</h1></div></main></body>');
      writeFileSync(join(base, 'us.html'), '<body><main><div><h2>Hey</h2></div></main></body>');
      const page = section('p', [['Personalization Variants', '/fragments/p/in, /fragments/p/us'], ['Personalization Rule In', 'geo: IN'], ['Personalization Rule Us', 'geo: US']]);
      const { sections: [result] } = await validatePage(page, { repo: dir, prefixes: ['/fragments/'] });
      const h1 = result.warnings.filter((warning) => /H1/.test(warning));
      assert.deepEqual(h1, ['fragment "us" drops the authored content\'s H1: keep the same heading structure in every variant (no cloaking)']);
    } finally {
      cleanup();
    }
  });

  it('warns when a variant link points to another site (only its path is used)', async () => {
    const page = section('p', [
      ['Personalization Variants', '<p><a href="https://evil.example/fragments/p/in">in</a></p><p><a href="https://main--site--org.aem.page/fragments/p/us">us</a></p>'],
      ['Personalization Rule In', 'geo: IN'], ['Personalization Rule Us', 'geo: US']]);
    const { dir, cleanup } = tempDir();
    try {
      const { sections: [result] } = await validatePage(page, { repo: dir, prefixes: ['/fragments/'] });
      const hosts = result.warnings.filter((warning) => /another site/.test(warning));
      assert.deepEqual(hosts, ['variant link https://evil.example/fragments/p/in points to another site: only its path is used, from this site']);
    } finally {
      cleanup();
    }
  });

  it('only warns about missing fragments when there is no local content to check', async () => {
    const { dir, cleanup } = tempDir();
    try {
      const page = section('a', [['Personalization Variants', '/fragments/a/in'], ['Personalization Rule In', 'geo: IN']], '<p>x</p>');
      const { sections } = await validatePage(page, { repo: dir, prefixes: ['/fragments/'] });
      assert.deepEqual(sections[0].errors, []);
      assert.match(sections[0].warnings.join(), /pass --base-url/);
    } finally {
      cleanup();
    }
  });
});

describe('validate sections', () => {
  const F = '/fragments/personalization';
  const cell = (value) => (Array.isArray(value) ? value.join('') : `<p>${value}</p>`);
  const metadata = (rows) => `<div class="section-metadata">${rows.map(([key, value]) => `<div><div><p>${key}</p></div><div>${cell(value)}</div></div>`).join('')}</div>`;
  const link = (path) => `<p><a href="https://main--site--org.aem.page${path}">https://main--site--org.aem.page${path}</a></p>`;
  const page = (...sections) => `<body><header></header><main>${sections.map((body) => `<div>${body}</div>`).join('')}</main></body>`;

  function site(files) {
    const temp = tempDir();
    Object.entries(files).forEach(([path, body]) => {
      const file = join(temp.dir, path);
      mkdirSync(join(file, '..'), { recursive: true });
      writeFileSync(file, body);
    });
    return temp;
  }

  it('reads source content the way the pipeline renders it', async () => {
    const { dir, cleanup } = site({
      [`content${F}/plan/enterprise.html`]: '<body><main><div><h2>Enterprise</h2></div></main></body>',
      [`content${F}/plan/agency.html`]: '<body><main><div><h2>Agency</h2></div></main></body>',
      'scripts/personalization/config.js': "export default { api: { endpoint: '/decide' }, target: { clientCode: '' }, audiences: {}, mock: false };",
    });
    try {
      const html = page('<h1>Hero</h1>', `<h2>Plans</h2>${metadata([
        ['Style', 'dark'],
        ['Personalization', 'plan'],
        ['Personalization Source', 'api'],
        ['Personalization Variants', [link(`${F}/plan/enterprise`), link(`${F}/plan/agency`)]],
        ['Personalization Rule Agency', 'param: utm_source=agency'],
      ])}`);
      const { sections: [plan] } = await validatePage(html, {
        repo: dir, prefixes: ['/fragments/'], config: readText(join(dir, 'scripts/personalization/config.js')),
      });
      assert.deepEqual(plan.errors, []);
      assert.deepEqual(plan.warnings, []);
      assert.equal(plan.section, 1);
      assert.equal(plan.source, 'api');
      assert.deepEqual(plan.variants.map((variant) => variant.path), [`${F}/plan/enterprise`, `${F}/plan/agency`]);
      assert.deepEqual(plan.rules, [{ variant: 'agency', condition: 'param: utm_source=agency' }]);
      assert.ok(plan.fragments.every((fragment) => fragment.found));
    } finally {
      cleanup();
    }
  });

  it('catches rows the pipeline mangles, overlap, nesting, missing fragments and LCP', async () => {
    const { dir, cleanup } = site({
      [`content${F}/hero/india.html`]: '<body><main><div><h2>India</h2><p>TODO: copy</p></div></main></body>',
      [`content${F}/hero/nested.html`]: `<body><main><div>${metadata([['Personalization', 'inner']])}</div></main></body>`,
      'scripts/personalization/config.js': 'export default { audiences: {} };',
    });
    try {
      const html = page(`<h1>Hero</h1>${metadata([
        ['Personalization', 'hero'],
        ['Personalization Variants', [link(`${F}/hero/india`), link(`${F}/hero/nested`), link(`${F}/hero/gone`)]],
        ['Personalization Rule India', 'geo: IN'],
        ['Personalization Rule India', 'param: utm_campaign=diwali'],
        ['Personalization Rule Nested', ['<p>geo: US</p>', '<p>device: mobile</p>']],
        ['Personalization Rule Gone', 'audience: vip'],
        ['Experiment', 'hero-test'],
      ])}`, `<p>x</p>${metadata([['Personalization', 'hero'], ['Personalization Source', 'split'], ['Personalization Variants', link(`${F}/hero/india`)]])}`);
      const { sections: [hero, second] } = await validatePage(html, {
        repo: dir, prefixes: ['/fragments/'], config: readText(join(dir, 'scripts/personalization/config.js')),
      });
      const errors = hero.errors.join('\n');
      assert.match(errors, /also carries AEM Experimentation metadata \(experiment\)/);
      assert.match(errors, /row "Personalization Rule India" appears more than once.*Rule India 2/);
      assert.match(errors, /"Personalization Rule Nested" holds 2 paragraphs/);
      assert.match(errors, /fragment for "gone" not found/);
      assert.match(errors, /fragment "nested" has a personalized section/);
      const warnings = hero.warnings.join('\n');
      assert.match(warnings, /audience "vip" is not registered/);
      assert.match(warnings, /fragment "india" still has TODO copy/);
      assert.match(warnings, /fragment "india" drops the authored content's H1/);
      assert.match(second.errors.join(), /id "hero" is used by more than one section on this page/);
      const clean = await validatePage(page(`<h1>Hero</h1>${metadata([
        ['Personalization', 'hero'], ['Personalization Variants', link(`${F}/hero/india`)], ['Personalization Rule India', 'geo: IN'],
      ])}`), { repo: dir, prefixes: ['/fragments/'] });
      assert.match(clean.sections[0].warnings.join(), /first section \(LCP\) stays hidden.*edge/);
    } finally {
      cleanup();
    }
  });

  it('checks source configuration and describes splits and popups', async () => {
    const html = page('<h1>Hi</h1>', metadata([
      ['Personalization', 'offer'], ['Personalization Source', 'target'], ['Personalization Trigger', 'scroll: 40%'],
    ]), metadata([
      ['Personalization', 'msg'], ['Personalization Source', 'split'], ['Personalization Split', '30, 20'],
      ['Personalization Variants', [link(`${F}/msg/a`), link(`${F}/msg/b`)]],
    ]), metadata([
      ['Personalization', 'opt'], ['Personalization Source', 'optimizely'], ['Personalization Variants', link(`${F}/opt/a`)],
    ]));
    const { dir, cleanup } = tempDir();
    try {
      const { sections: [offer, msg, opt] } = await validatePage(html, {
        repo: dir,
        prefixes: ['/fragments/'],
        config: "export default {\n  consent: { mode: 'deny' },\n  target: { clientCode: '' },\n};",
      });
      assert.match(offer.warnings.join(), /config.target.clientCode is empty/);
      assert.match(offer.info.join(), /popup on scroll past 40%/);
      assert.match(msg.info.join(), /30% \/ 20% to the variants/);
      assert.match(opt.errors.join(), /optimizely/, 'other engines use the api source');
    } finally {
      cleanup();
    }
  });

  it('enforces the engine profile and the slow engine on the first section', async () => {
    const plan = (variants, at = 0) => page(...[...Array(at)].map(() => '<p>x</p>'), metadata([
      ['Personalization', 'plan'], ['Personalization Source', 'api'],
      ['Personalization Variants', variants.map((name) => link(`${F}/plan/${name}`))],
    ]));
    const { dir, cleanup } = tempDir();
    try {
      const of1 = "export default { consent: { mode: 'allow' }, api: { endpoint: '/pzn/decide', engine: 'of1' } };";
      const client = await validatePage(plan(['a', 'b']), {
        repo: dir, prefixes: ['/fragments/'], config: of1, mode: 'client',
      });
      assert.match(client.sections[0].errors.join(), /must not decide the first section in the browser/);
      const edge = await validatePage(plan(['a', 'b']), {
        repo: dir, prefixes: ['/fragments/'], config: of1, mode: 'edge',
      });
      assert.doesNotMatch(edge.sections[0].errors.join(), /first section/);
      assert.match(edge.sections[0].warnings.join(), /the edge decides it/);
      assert.match(edge.sections[0].info.join(), /descriptions/);
      const later = await validatePage(plan(['a', 'b'], 1), {
        repo: dir, prefixes: ['/fragments/'], config: of1, mode: 'client',
      });
      assert.doesNotMatch(later.sections[0].errors.join(), /first section/);
    } finally {
      cleanup();
    }
  });
});

describe('site config (contract section 3)', () => {
  it('reads config.js textually', () => {
    assert.deepEqual(readSiteConfig(`export default {
      consent: { mode: 'cmp', tool: 'onetrust', withoutConsent: ['rules', 'rum'], policyRef: 'LEGAL-12' },
      hasConsent: () => window.OnetrustActiveGroups?.includes(',C0004,'),
      api: { endpoint: '/pzn/decide', engine: 'of1', mapRequest: (body) => { return { body }; } },
      target: { transport: 'websdk', clientCode: 'acme', endpoint: '' },
      /* mock: { api: {} }, */
      // providers: {},
      mock: false,
      audiences: { vip: () => true },
    };`), {
      present: true,
      consent: {
        mode: 'cmp', tool: 'onetrust', withoutConsent: ['rules', 'rum'], policyRef: 'LEGAL-12',
      },
      apiEndpoint: '/pzn/decide',
      engine: 'of1',
      targetClientCode: 'acme',
      targetTransport: 'websdk',
      targetEndpoint: '',
      mock: false,
      removed: [],
      audiences: ' vip: () => true ',
    });
    assert.equal(readSiteConfig('export default { mock: { api: {} } };').mock, true);
    assert.deepEqual(readSiteConfig('').present, false);
    assert.deepEqual(readSiteConfig("export default { providers: {}, sendWithoutConsent: true };").removed, ['providers', 'sendWithoutConsent']);
  });

  const problems = (source) => checkSiteConfig(readSiteConfig(source));

  it('requires the consent mode, the tool for cmp, and a policyRef for exceptions', () => {
    assert.match(problems('export default { api: {} };').errors.join(), /consent.mode is not recorded/);
    assert.match(problems("export default { consent: { mode: 'cmp' } };").errors.join(), /names the consent tool/);
    assert.match(problems("export default { consent: { mode: 'deny', tool: 'onetrust' } };").errors.join(), /only for mode cmp/);
    assert.match(problems("export default { consent: { mode: 'allow', withoutConsent: ['rules'], policyRef: 'x' } };").errors.join(), /no meaning with mode allow/);
    assert.match(problems("export default { consent: { mode: 'deny', withoutConsent: ['rules'] } };").errors.join(), /needs policyRef/);
    assert.match(problems("export default { consent: { mode: 'deny', withoutConsent: ['target'], policyRef: 'x' } };").errors.join(), /unknown exception "target"/);
    assert.match(problems("export default { consent: { mode: 'sometimes' } };").errors.join(), /cmp, allow or deny/);
    const deny = problems("export default { consent: { mode: 'deny', withoutConsent: ['rules', 'rum'], policyRef: 'LEGAL-1' } };");
    assert.deepEqual(deny.errors, []);
    assert.match(deny.warnings.join(), /mode is deny/);
    assert.match(deny.info.join(), /rules, rum \(LEGAL-1\)/);
    assert.deepEqual(problems("export default { consent: { mode: 'cmp', tool: 'onetrust' } };"), { errors: [], warnings: [], info: [] });
  });

  it('rejects removed options, unknown engines and transports, and flags mocks', () => {
    const ok = "consent: { mode: 'allow' }";
    assert.match(problems(`export default { ${ok}, providers: {} };`).errors.join(), /config.providers is not supported/);
    assert.match(problems(`export default { ${ok}, sendWithoutConsent: true };`).errors.join(), /withoutConsent/);
    assert.match(problems(`export default { ${ok}, api: { engine: 'optimizely' } };`).errors.join(), /generic or of1/);
    assert.match(problems(`export default { ${ok}, target: { transport: 'atjs' } };`).errors.join(), /delivery-api or websdk/);
    assert.match(problems(`export default { ${ok}, target: { transport: 'websdk', endpoint: '/x' } };`).errors.join(), /delivery-api transport only/);
    assert.match(problems(`export default { ${ok}, mock: true };`).warnings.join(), /config.mock is on/);
    assert.match(problems('').warnings.join(), /config.js not found/);
  });

  it('fails the run on config errors', async () => {
    const { dir, cleanup } = tempDir();
    try {
      mkdirSync(join(dir, 'scripts', 'personalization'), { recursive: true });
      writeFileSync(join(dir, 'scripts', 'personalization', 'config.js'), 'export default { providers: {} };');
      const report = await validate([], { repo: dir });
      assert.equal(report.ok, false);
      assert.equal(report.errorCount, report.config.errors.length);
    } finally {
      cleanup();
    }
  });
});

describe('pageExperimentation', () => {
  it('finds AEM Experimentation metadata in delivered and source pages', () => {
    assert.equal(pageExperimentation('<head><meta name="experiment" content="x"></head><body></body>'), 'experiment');
    assert.equal(pageExperimentation('<head><meta name="audience-mobile" content="/m"></head>'), 'audience-mobile');
    assert.equal(pageExperimentation('<main><div><div class="metadata"><div><div>Campaign-Spring</div><div>/s</div></div></div></div></main>'), 'campaign-spring');
    assert.equal(pageExperimentation('<head><meta name="description" content="x"></head>'), null);
  });

  it('fails personalized sections on an experiment page', async () => {
    const F = '/fragments/personalization';
    const metadata = (rows) => `<div class="section-metadata">${rows.map(([key, value]) => `<div><div><p>${key}</p></div><div>${value}</div></div>`).join('')}</div>`;
    const link = (path) => `<p><a href="${path}">${path}</a></p>`;
    const html = `<head><meta name="experiment" content="x"></head><body><main><div><p>a</p></div>${`<div><p>b</p>${metadata([['Personalization', 'p'], ['Personalization Variants', link(`${F}/p/a`)], ['Personalization Rule A', 'geo: IN']])}</div>`}</main></body>`;
    const { dir, cleanup } = tempDir();
    try {
      const { sections: [result] } = await validatePage(html, { repo: dir, prefixes: ['/fragments/'] });
      assert.match(result.errors.join(), /AEM Experimentation metadata \(experiment\)/);
    } finally {
      cleanup();
    }
  });
});

describe('detectMode', () => {
  it('is edge when the repo has the skill worker', () => {
    const { dir, cleanup } = tempDir();
    try {
      assert.equal(detectMode(dir), 'client');
      mkdirSync(join(dir, 'cdn', 'my-worker', 'src', 'personalization'), { recursive: true });
      writeFileSync(join(dir, 'cdn', 'my-worker', 'src', 'personalization', 'personalize.js'), '');
      assert.equal(detectMode(dir), 'edge');
    } finally {
      cleanup();
    }
  });
});

describe('validate-placeholders.mjs --help', () => {
  it('prints the usage, exits 0 and writes nothing', () => {
    const { status, stdout, wrote } = runHelp('validate-placeholders.mjs');
    assert.equal(status, 0);
    assert.match(stdout, /^Usage/);
    assert.deepEqual(wrote, []);
  });
});
