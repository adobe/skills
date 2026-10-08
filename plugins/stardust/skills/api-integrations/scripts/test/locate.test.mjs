import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';

import { locateDynamics } from '../lib/locate.mjs';

const FIXTURES = mkdtempSync(join(tmpdir(), 'api-integrations-locate-'));

after(() => rmSync(FIXTURES, { recursive: true, force: true }));

function makeDir(label) {
  const dir = join(FIXTURES, `${label}-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeDynamicsFiles(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'lib.mjs'), 'export const ok = true;\n');
  writeFileSync(join(dir, 'vendors.json'), '{"vendors":[]}\n');
}

test('env override wins', (t) => {
  const dir = makeDir('env');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeDynamicsFiles(dir);

  assert.equal(locateDynamics({ env: { STARDUST_DYNAMICS_DIR: dir }, home: '/nope' }), dir);
});


test('finds the plugin source sibling layout', (t) => {
  const root = makeDir('plugin-layout');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const here = join(root, 'skills', 'api-integrations', 'scripts', 'lib');
  const dir = join(root, 'skills', 'dynamics', 'scripts');
  mkdirSync(here, { recursive: true });
  writeDynamicsFiles(dir);

  assert.equal(locateDynamics({ env: {}, home: '/nope', here }), dir);
});

test('finds the project script-copy sibling layout', (t) => {
  const root = makeDir('project-layout');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const here = join(root, 'stardust', 'scripts', 'api-integrations', 'lib');
  const dir = join(root, 'stardust', 'scripts', 'dynamics');
  mkdirSync(here, { recursive: true });
  writeDynamicsFiles(dir);

  assert.equal(locateDynamics({ env: {}, home: '/nope', here }), dir);
});

test('finds the copilot plugin path', (t) => {
  const home = makeDir('home-copilot');
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const dir = join(home, '.copilot', 'installed-plugins', 'adobe-skills', 'stardust', 'skills', 'dynamics', 'scripts');
  writeDynamicsFiles(dir);

  assert.equal(locateDynamics({ env: {}, home, here: join(home, 'missing', 'scripts') }), dir);
});

test('clear error when missing', (t) => {
  const home = makeDir('home-empty');
  t.after(() => rmSync(home, { recursive: true, force: true }));

  assert.throws(
    () => locateDynamics({ env: {}, home, here: join(home, 'missing', 'scripts') }),
    (error) => {
      assert.match(error.message, /^stardust dynamics not found/);
      assert.match(error.message, /copy dynamics to stardust\/scripts\/dynamics/);
      return true;
    },
  );
});

test('finds the real install', (t) => {
  let dir;
  try {
    dir = locateDynamics();
  } catch (error) {
    t.skip(error.message);
    return;
  }

  assert.ok(existsSync(join(dir, 'vendors.json')));
});
