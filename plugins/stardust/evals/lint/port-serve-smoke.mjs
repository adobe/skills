#!/usr/bin/env node
// port.mjs / serve.mjs / served-identity.mjs contract test — no browser, no
// network beyond 127.0.0.1. Ports are bound for real (port 0 for the identity
// server; the allocator's own slot for the proto role of a temp root).
//   port     `proto --root <tmp> --json` returns a port in 8800–8899, never 8791/3000/8765,
//            stable across two calls, and writes stardust/.work/ports.json
//            {role, port, cwd, marker, …}; a listener bound on that slot from a
//            DIFFERENT cwd makes the next call return the next slot and list the
//            foreign pid (never killed — it is still alive afterwards); `--port`
//            pinned to that foreign listener exits 3; `list` shows it as foreign;
//            `stop proto` with no pidfile is a no-op exit 0.
//   serve    serves /.stardust-marker.txt = marker and files under <dir>, 404s a
//            missing file and a directory without index.html, never escapes <dir>;
//            a second serve on the same pinned port exits 98 (the BLOCKING branch);
//            `port.mjs stop proto` ends it (pidfile pid, cwd under root) and removes the pidfile.
//   identity assertServedIdentity: marker file → ok; page body with the marker → ok;
//            block-name fallback → ok; wrong marker file / 404 / no answer → code 4
//            (no verdict, never a pass); CLI exit 4 and 0.
// The foreign-listener cases need lsof (cwd lookup); without it they print SKIP.
// Usage: node plugins/stardust/evals/lint/port-serve-smoke.mjs
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';

const HERE = import.meta.dirname;
const S = (n) => resolve(HERE, '..', '..', 'skills', 'replica', 'scripts', n);
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };
const run = (script, args, cwd) => { const r = spawnSync(process.execPath, [S(script), ...args], { encoding: 'utf8', cwd }); return { status: r.status, out: `${r.stdout}\n${r.stderr}`, stdout: r.stdout.trim() }; };
// async for anything that talks to a server living in THIS process (spawnSync would starve it)
const runAsync = (script, args, cwd) => new Promise((res) => { const ch = spawn(process.execPath, [S(script), ...args], { cwd }); let so = ''; let se = ''; ch.stdout.on('data', (d) => { so += d; }); ch.stderr.on('data', (d) => { se += d; }); ch.on('close', (status) => res({ status, out: `${so}\n${se}`, stdout: so.trim() })); });
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const get = async (url) => { try { const r = await fetch(url); return { status: r.status, body: await r.text() }; } catch (e) { return { status: 0, body: '', error: e.message }; } };
const hasLsof = !spawnSync('lsof', ['-v'], { encoding: 'utf8' }).error;

const root = mkdtempSync(join(tmpdir(), 'stardust-port-root-'));
const other = mkdtempSync(join(tmpdir(), 'stardust-port-other-'));
const protos = join(root, 'stardust', 'prototypes'); mkdirSync(protos, { recursive: true }); mkdirSync(join(protos, 'sub'));
writeFileSync(join(protos, 'home-proposed.html'), '<!doctype html><title>home</title><main class="hero">Fixture home</main>');
writeFileSync(join(protos, 'sub', 'x.css'), 'body{margin:0}');
const children = [];
const spawnKeep = (args, cwd) => { const ch = spawn(process.execPath, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }); children.push(ch); let out = ''; ch.stdout.on('data', (d) => { out += d; }); ch.stderr.on('data', (d) => { out += d; }); ch.out = () => out; return ch; };

try {
  const { RANGES, EXCLUDED, slotFor, fnv1a } = await import(S('port.mjs'));
  check(fnv1a('a') !== fnv1a('b') && slotFor(root, 'proto') >= 8800 && slotFor(root, 'proto') <= 8899, 'slotFor hashes the root into the proto range');
  check(run('port.mjs', ['--help']).status === 0 && run('port.mjs', []).status === 1 && run('port.mjs', ['bogus']).status === 1, 'port --help 0, no args 1, unknown role 1');

  // ---- allocate
  const a1 = run('port.mjs', ['proto', '--root', root, '--json']);
  check(a1.status === 0, `port proto exits 0 (got ${a1.status}): ${a1.out.slice(-300)}`);
  const j1 = a1.status === 0 ? JSON.parse(a1.stdout) : null;
  const inRange = (p) => p >= RANGES.proto[0] && p <= RANGES.proto[1] && !EXCLUDED.has(p);
  check(j1 && inRange(j1.port), `allocated port in range and not a documented default (got ${j1 && j1.port})`);
  const a2 = run('port.mjs', ['proto', '--root', root]);
  check(a2.status === 0 && Number(a2.stdout) === j1.port, `a second call is stable (got ${a2.stdout})`);
  const pf = join(root, 'stardust', '.work', 'ports.json');
  const pj = existsSync(pf) ? JSON.parse(readFileSync(pf, 'utf8')) : null;
  check(pj && pj.proto && pj.proto.port === j1.port && pj.proto.cwd === resolve(root) && pj.proto.marker && 'pid' in pj.proto && 'startedAt' in pj.proto, `ports.json records role/port/cwd/marker/pid/startedAt (got ${JSON.stringify(pj && pj.proto)})`);
  check(run('port.mjs', ['stop', 'proto', '--root', root]).status === 0, 'stop with no pidfile is exit 0');

  // ---- a foreign listener on the slot (different cwd) → move, list, never kill
  if (!hasLsof) console.log('SKIP port-serve foreign-listener cases: lsof not available (cwd lookup) — allocation, serve and identity cases still run');
  else {
    const decoy = spawnKeep(['-e', `require('net').createServer().listen(${j1.port}, '127.0.0.1', () => console.log('up'))`], other);
    for (let i = 0; i < 50 && !/up/.test(decoy.out()); i += 1) await sleep(100);
    const a3 = run('port.mjs', ['proto', '--root', root, '--json']);
    const j3 = a3.status === 0 ? JSON.parse(a3.stdout) : null;
    check(j3 && j3.port !== j1.port && inRange(j3.port), `a foreign listener on the slot moves the allocation (got ${j3 && j3.port} vs ${j1.port})`);
    check(j3 && j3.foreign.some((f) => f.port === j1.port && f.pid === decoy.pid), `the foreign listener is listed with its pid (got ${JSON.stringify(j3 && j3.foreign)})`);
    check(decoy.exitCode === null, 'the foreign listener is never killed');
    const pin = run('port.mjs', ['proto', '--root', root, '--port', String(j1.port)]);
    check(pin.status === 3 && /outside this project/.test(pin.out), `--port pinned to a foreign listener exits 3 (got ${pin.status})`);
    const list = run('port.mjs', ['list', '--root', root, '--json']);
    const rows = list.status === 0 ? JSON.parse(list.stdout) : [];
    check(rows.some((r) => r.port === j1.port && r.owner === 'foreign'), `list marks the decoy as foreign (got ${JSON.stringify(rows.map((r) => [r.port, r.owner]))})`);
    decoy.kill(); await sleep(150);
  }

  // ---- serve
  const r1 = run('port.mjs', ['proto', '--root', root, '--json']); const port = JSON.parse(r1.stdout).port;
  const srv = spawnKeep([S('serve.mjs'), protos, '--role', 'proto', '--root', root, '--port', String(port), '--json'], root);
  for (let i = 0; i < 50 && !/"url"/.test(srv.out()); i += 1) await sleep(100);
  const info = (() => { try { return JSON.parse(srv.out().split('\n').find((l) => l.startsWith('{'))); } catch { return null; } })();
  check(info && info.port === port && info.pid === srv.pid, `serve prints url/port/pid (got ${srv.out().slice(0, 200)})`);
  const base = `http://127.0.0.1:${port}`;
  const m = await get(`${base}/.stardust-marker.txt`);
  check(m.status === 200 && m.body.trim() === info.marker, `/.stardust-marker.txt answers the marker (got ${m.status} "${m.body.trim()}")`);
  const h = await get(`${base}/home-proposed.html`);
  check(h.status === 200 && /Fixture home/.test(h.body), 'serves a file under <dir>');
  check((await get(`${base}/sub/x.css`)).status === 200, 'serves nested files');
  check((await get(`${base}/nope.html`)).status === 404, '404 for a missing file');
  check((await get(`${base}/sub/`)).status === 404, 'a directory without index.html is 404 (no listing)');
  check((await get(`${base}/..%2F..%2Fetc%2Fpasswd`)).status !== 200, 'paths never escape <dir>');
  const pidf = join(root, 'stardust', '.work', 'proto.pid');
  check(existsSync(pidf) && JSON.parse(readFileSync(pidf, 'utf8')).pid === srv.pid, 'pidfile written with the server pid');
  // BLOCKING branch: a second serve on the same port
  const dup = run('serve.mjs', [protos, '--role', 'proto', '--root', root, '--port', String(port)], root);
  check(dup.status === 98 && /already/.test(dup.out), `a second serve on a bound port exits 98 (got ${dup.status}): ${dup.out.slice(-200)}`);
  const dupOther = run('serve.mjs', [protos, '--role', 'proto', '--root', other, '--port', String(port)], other);
  check(dupOther.status === 98, `another project pinning our port exits 98, nothing killed (got ${dupOther.status})`);
  check(srv.exitCode === null, 'our server survived the refusals');

  // ---- identity
  const { assertServedIdentity } = await import(S('served-identity.mjs'));
  const ok1 = await assertServedIdentity(`${base}/home-proposed.html`, info.marker);
  check(/marker-file/.test(ok1.via), `identity via the marker file (got ${ok1.via})`);
  await assertServedIdentity(`${base}/home-proposed.html`, 'nope-marker').then(() => check(false, 'a wrong marker must throw'), (e) => check(e.code === 4 && /another project/.test(e.message), `wrong marker → code 4 (got ${e.code}: ${e.message.slice(0, 80)})`));
  const idSrv = createServer((req, res) => { if (req.url === '/page') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<main class="hero-band">Larkspur fixture</main>'); } else res.writeHead(404).end('nope'); });
  await new Promise((r) => idSrv.listen(0, '127.0.0.1', r)); const idBase = `http://127.0.0.1:${idSrv.address().port}`;
  check((await assertServedIdentity(`${idBase}/page`, 'larkspur')).via === 'page-body', 'identity via the page body (no marker file, case-insensitive)');
  check(/block-name/.test((await assertServedIdentity(`${idBase}/page`, 'other-site', { fallbackNames: ['cards', 'hero-band'] })).via), 'identity via a block-name fallback');
  await assertServedIdentity(`${idBase}/page`, 'other-site', { fallbackNames: ['cards'] }).then(() => check(false, 'no marker, no block name must throw'), (e) => check(e.code === 4, 'mismatch → code 4'));
  await assertServedIdentity(`${idBase}/missing`, 'x').then(() => check(false, '404 must throw'), (e) => check(e.code === 4, '404 → code 4 (no verdict)'));
  const cli4 = await runAsync('served-identity.mjs', [`${idBase}/page`, '--marker', 'other-site']);
  check(cli4.status === 4 && /not scoring/.test(cli4.out), `CLI mismatch exits 4 (got ${cli4.status})`);
  check((await runAsync('served-identity.mjs', [`${idBase}/page`, '--marker', 'larkspur'])).status === 0, 'CLI match exits 0');
  check(run('served-identity.mjs', []).status === 1, 'CLI without args exits 1');
  idSrv.close();

  // ---- stop: only ours, pidfile removed
  const st = run('port.mjs', ['stop', 'proto', '--root', root]);
  await sleep(300);
  check(st.status === 0 && /stopped/.test(st.out) && srv.exitCode !== null && !existsSync(pidf), `stop proto ends our server and removes the pidfile (got ${st.status}, exit ${srv.exitCode})`);
} finally {
  for (const ch of children) { try { ch.kill('SIGKILL'); } catch { /* gone */ } }
  rmSync(root, { recursive: true, force: true }); rmSync(other, { recursive: true, force: true });
}
if (failures.length) { console.error(`port-serve-smoke: ${failures.length} failure(s)\n - ${failures.join('\n - ')}`); process.exit(1); }
console.log('port-serve-smoke: ok (range + stability + ports.json, foreign listener moves/lists/never killed, pin exit 3, serve marker/404/escape, second serve exit 98, identity ok/4, stop own only)');
