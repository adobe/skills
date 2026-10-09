import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { validate, validatePage } from '../validate-placeholders.mjs';
import { SITE, runHelp, tempDir } from './helpers.mjs';

describe('validate', () => {
  it('passes the fixture site', async () => {
    const report = await validate([], { repo: SITE });
    assert.equal(report.ok, true, JSON.stringify(report.pages.map((p) => p.placeholders.map((x) => x.errors))));
    assert.deepEqual(report.pages.map((page) => page.file), ['content/index.html', 'content/offer.plain.html']);
    const [hero, welcome] = report.pages[0].placeholders;
    assert.equal(hero.section, 0);
    assert.match(hero.info.join(), /consider edge mode/);
    assert.match(welcome.info.join(), /state keys: quiz-persona/);
    assert.ok(hero.fragments.every((fragment) => fragment.found));
    const [offer] = report.pages[1].placeholders;
    assert.equal(offer.source, 'api');
    assert.deepEqual(offer.default, { type: 'inline' });
  });

  it('reports page-level authoring errors', async () => {
    const page = `<div>
      <div class="personalization">
        <div><div>id</div><div>hero</div></div>
        <div><div>geo: IN</div><div><a href="/fragments/personalization/home-hero/missing">x</a></div></div>
        <div><div>audience: vip</div><div><a href="/fragments/personalization/home-hero/india">y</a></div></div>
        <div><div>default</div><div><h1>Title</h1><p>Body</p></div></div>
      </div>
      <div class="personalization">
        <div><div>id</div><div>hero</div></div>
        <div><div>source</div><div>api</div></div>
        <div><div>default</div><div>none</div></div>
      </div>
    </div>`;
    const { placeholders } = await validatePage(page, {
      repo: SITE, prefixes: ['/fragments/'], config: 'export default { api: { endpoint: \'\' }, audiences: {} }',
    });
    const [first, second] = placeholders;
    assert.match(first.errors.join(), /not found: \/fragments\/personalization\/home-hero\/missing/);
    assert.match(first.warnings.join(), /audience "vip" is not registered/);
    assert.match(first.warnings.join(), /fragment "india" drops the default's H1/);
    assert.match(second.errors.join(), /used by more than one placeholder/);
    assert.match(second.warnings.join(), /config.api.endpoint is empty/);
  });

  it('warns about the H1 only when a variant differs from the default', async () => {
    const { dir, cleanup } = tempDir();
    try {
      const base = join(dir, 'content', 'fragments', 'p');
      mkdirSync(base, { recursive: true });
      writeFileSync(join(base, 'default.html'), '<body><main><div><h1>Hi</h1></div></main></body>');
      writeFileSync(join(base, 'in.html'), '<body><main><div><h1>Namaste</h1></div></main></body>');
      writeFileSync(join(base, 'us.html'), '<body><main><div><h2>Hey</h2></div></main></body>');
      const page = '<div class="personalization"><div><div>id</div><div>p</div></div>'
        + '<div><div>geo: IN</div><div>/fragments/p/in</div></div><div><div>geo: US</div><div>/fragments/p/us</div></div>'
        + '<div><div>default</div><div>/fragments/p/default</div></div></div>';
      const { placeholders: [placeholder] } = await validatePage(page, { repo: dir, prefixes: ['/fragments/'] });
      const h1 = placeholder.warnings.filter((warning) => /H1/.test(warning));
      assert.deepEqual(h1, ['fragment "us" drops the default\'s H1: keep the same heading structure in every variant (no cloaking)']);
    } finally {
      cleanup();
    }
  });

  it('only warns about missing fragments when there is no local content to check', async () => {
    const { dir, cleanup } = tempDir();
    try {
      const page = '<div class="personalization"><div><div>id</div><div>a</div></div><div><div>geo: IN</div><div>/fragments/a/in</div></div><div><div>default</div><div>none</div></div></div>';
      const { placeholders } = await validatePage(page, { repo: dir, prefixes: ['/fragments/'] });
      assert.deepEqual(placeholders[0].errors, []);
      assert.match(placeholders[0].warnings.join(), /pass --base-url/);
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
