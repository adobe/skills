import assert from 'node:assert/strict';
import { cpSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { detect, projectType } from '../detect-project.mjs';
import { installRuntime } from '../install-runtime.mjs';
import { SITE, runHelp, siteRepo, tempDir } from './helpers.mjs';

describe('detect', () => {
  it('reports project type, hook and placeholders', () => {
    const { dir, cleanup } = siteRepo();
    try {
      cpSync(join(SITE, 'content'), join(dir, 'content'), { recursive: true });
      const before = detect(dir);
      assert.equal(before.projectType, 'da');
      assert.equal(before.supported, true);
      assert.equal(before.scriptsJs.decorateMainInLoadEager, true);
      assert.equal(before.scriptsJs.hookInstalled, false);
      assert.equal(before.runtime.installed, false);
      assert.deepEqual(before.content.pagesWithPlaceholders.sort(), ['content/index.html', 'content/offer.plain.html']);
      assert.equal(before.edge.cloudflare, false);
      writeFileSync(join(dir, 'wrangler.toml'), 'name = "site"\n');
      assert.equal(detect(dir).edge.cloudflare, true);
      rmSync(join(dir, 'wrangler.toml'));
      installRuntime(dir, { applyHook: true });
      const after = detect(dir);
      assert.equal(after.scriptsJs.hookInstalled, true);
      assert.equal(after.runtime.installed, true);
      assert.ok(Object.values(after.runtime.files).every((state) => state === 'current'));
    } finally {
      cleanup();
    }
  });

  it('fails fast on xwalk and doc projects', () => {
    const { dir, cleanup } = tempDir();
    try {
      writeFileSync(join(dir, 'component-models.json'), '[]');
      assert.equal(projectType(dir).type, 'xwalk');
      assert.equal(detect(dir).supported, false);
      rmSync(join(dir, 'component-models.json'));
      writeFileSync(join(dir, 'fstab.yaml'), 'mountpoints:\n  /: https://drive.google.com/drive/folders/x\n');
      assert.equal(projectType(dir).type, 'doc');
      assert.match(detect(dir).reason, /DA projects only/);
    } finally {
      cleanup();
    }
  });
});

describe('detect-project.mjs --help', () => {
  it('prints the usage, exits 0 and writes nothing', () => {
    const { status, stdout, wrote } = runHelp('detect-project.mjs');
    assert.equal(status, 0);
    assert.match(stdout, /^Usage/);
    assert.deepEqual(wrote, []);
  });
});
