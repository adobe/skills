#!/usr/bin/env node
/**
 * Fixture test: skills/stardust/scripts/preflight-transports.mjs — the gh-repo `absent` class (T12.1).
 * Run: node skills/stardust/scripts/test/preflight-transports.test.mjs   (exit 1 on failure)
 *
 * A `gh` shim on PATH answers per argument (mode from a file the test rewrites); the DA/admin/git probes
 * are --skip'ped so nothing leaves the machine. Pins:
 *   - repo 404 + `orgs/<org>` ok → `gh-repo absent (repo absent; <org> reachable)`, env.json transports.gh-repo
 *     = "absent", one `No origin … bootstrap: deploy/reference/site-bootstrap.md` line, exit 0 (not a denial);
 *   - repo 404 + orgs/ 404 + `users/<org>` ok → absent too (an org that is a user account);
 *   - repo 404 + owner 404 → unreachable, exit 1, no `No origin` line (nothing proves the org exists);
 *   - repo 200 → ok, no `No origin` line; repo 403 → denied, exit 2, `Blocked on owner:`;
 *   - the header names `absent` in the transports enum and points at site-bootstrap.md.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, '..', 'preflight-transports.mjs');
const dir = mkdtempSync(join(tmpdir(), 'preflight-transports-'));
const bin = join(dir, 'bin'); mkdirSync(bin);
const root = join(dir, 'project'); mkdirSync(root);
const modeFile = join(dir, 'mode');
const setMode = (m) => writeFileSync(modeFile, m);
// gh shim: `api repos/o/r` answers per mode; `api orgs/o` / `api users/o` per mode; `api user` ok
writeFileSync(join(bin, 'gh'), `#!/bin/sh
MODE=$(cat "${modeFile}")
case "$2" in
  user) echo '{"login":"t"}'; exit 0;;
  repos/*)
    case "$MODE" in
      exists) echo '{"private":true}'; exit 0;;
      denied) echo 'gh: Resource not accessible by integration (HTTP 403)' >&2; exit 1;;
      *) echo 'gh: Not Found (HTTP 404)' >&2; exit 1;;
    esac;;
  orgs/*)
    case "$MODE" in
      absent) echo '{"login":"o"}'; exit 0;;
      *) echo 'gh: Not Found (HTTP 404)' >&2; exit 1;;
    esac;;
  users/*)
    case "$MODE" in
      absent-user) echo '{"login":"o"}'; exit 0;;
      *) echo 'gh: Not Found (HTTP 404)' >&2; exit 1;;
    esac;;
esac
echo "shim: unexpected $@" >&2; exit 1
`); chmodSync(join(bin, 'gh'), 0o755);
const run = () => spawnSync(process.execPath, [CLI, '--org', 'o', '--repo', 'r', '--root', root, '--skip', 'git-push,da-write,admin-read'], { encoding: 'utf8', env: { PATH: `${bin}:${process.env.PATH}`, HOME: dir } });
const envJson = () => JSON.parse(readFileSync(join(root, 'stardust', '.work', 'env.json'), 'utf8'));

try {
  setMode('absent');
  let r = run();
  assert.equal(r.status, 0, `absent is not a denial: ${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /^gh-repo {5}absent {2}\(repo absent; o reachable\)$/m);
  assert.match(r.stdout, /^No origin \(bootstrap at Setup, not an owner action\): gh-repo — bootstrap: deploy\/reference\/site-bootstrap\.md$/m);
  assert.doesNotMatch(r.stdout, /Blocked on owner/);
  assert.equal(envJson().transports['gh-repo'], 'absent');
  assert.equal(envJson().transports['gh-user'], 'ok');

  setMode('absent-user');
  r = run();
  assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /gh-repo {5}absent/); assert.equal(envJson().transports['gh-repo'], 'absent');

  setMode('nowhere');
  r = run();
  assert.equal(r.status, 1, 'repo and owner both 404: nothing proves the org — unreachable, no verdict');
  assert.match(r.stdout, /gh-repo {5}unreachable/); assert.doesNotMatch(r.stdout, /No origin/); assert.equal(envJson().transports['gh-repo'], 'unreachable');

  setMode('exists');
  r = run();
  assert.equal(r.status, 0); assert.match(r.stdout, /^gh-repo {5}ok$/m); assert.doesNotMatch(r.stdout, /No origin/); assert.equal(envJson().transports['gh-repo'], 'ok');

  setMode('denied');
  r = run();
  assert.equal(r.status, 2, 'a 403 stays a denial'); assert.match(r.stdout, /gh-repo {5}denied/); assert.match(r.stdout, /Blocked on owner:\n {2}gh-repo: gh auth refresh -s repo/);

  const header = readFileSync(CLI, 'utf8').match(/\/\*\*([\s\S]*?)\*\//)[1];
  assert.match(header, /"ok" \| "denied" \| "unreachable" \| "absent"/, 'the header enum names absent');
  assert.match(header, /site-bootstrap\.md/);
  assert.equal(spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' }).status, 0);
  console.log('preflight-transports test: ok');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
