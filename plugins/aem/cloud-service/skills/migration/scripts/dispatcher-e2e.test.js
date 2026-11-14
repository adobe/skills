'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const INV = require('./dispatcher-inventory.js');
const RUN = require('./dispatcher-run.js');
const VERIFY = require('./dispatcher-verify.js');
const CB = require('./dispatcher-crossboundary.js');
const REP = require('./dispatcher-report.js');

const REAL = process.env.DISPATCHER_E2E_SRC;   // path to a real on-prem config root
const SDK = process.env.DISPATCHER_SDK_SRC;     // path to a Dispatcher SDK src
test('E2E: convert a real flexible config, and the verify gate catches filter loss', { skip: !REAL || !SDK }, () => {
  const inv = INV.buildInventory(REAL);
  assert.ok(inv.mode === 'flexible' || inv.mode === 'v1');
  // A flexible/v1 config must expose a dispatcher.any; assert it so a null doesn't throw a bare
  // TypeError inside path.dirname(...) below (it would mask the real diagnostic).
  assert.ok(inv.dispatcherAny, 'flexible/v1 config must expose a dispatcher.any for the on-prem converter');
  const wd = fs.mkdtempSync(path.join(os.tmpdir(), 'disp-e2e-'));
  try {
    RUN.ensureToolInstalled(RUN.TOOL_DIR);
    RUN.writeToolConfig(wd, {
      sdkSrc: SDK, mode: inv.mode,
      onPremise: {
        dispatcherAnySrc: inv.dispatcherAny, httpdSrc: inv.httpd,
        vhostsToConvert: inv.vhostFiles.filter(f => /vhost.*\.conf$/.test(f)),
        variablesToReplace: [], pathToPrepend: inv.dispatcherAny ? [path.dirname(inv.dispatcherAny) + '/'] : [], portsToMap: null,
      },
    });
    const res = RUN.runConverter(wd, inv.mode, RUN.TOOL_DIR);
    assert.strictEqual(res.code, 0);
    const v = VERIFY.verifyOutput(res.outputSrcDir, inv.ruleCounts);
    // The verify layer is the point: it must SURFACE the tool's known filter/ACL loss on a poorly-configured run.
    console.log('verify:', JSON.stringify(v, null, 2));
    assert.ok(Array.isArray(v.failures));
    // A well-configured run should preserve filters; assert the gate is wired (ok or a filter-acl-loss failure, never a silent pass with 0 filters):
    if ((inv.ruleCounts.filter || 0) > 0) {
      const filterPreserved = v.ok || v.failures.some(f => f.category === 'filter-acl-loss');
      assert.ok(filterPreserved, 'filter preservation must be either satisfied or flagged, never silently dropped');
    }
  } finally {
    // Best-effort cleanup of the temp working dir (target/, config.yaml, …).
    fs.rmSync(wd, { recursive: true, force: true });
  }
});

test('E2E: render conversion-report.md from the real converted output', { skip: !REAL || !SDK }, () => {
  const inv = INV.buildInventory(REAL);
  const wd = fs.mkdtempSync(path.join(os.tmpdir(), 'disp-rep-'));
  try {
    RUN.ensureToolInstalled(RUN.TOOL_DIR);
    RUN.writeToolConfig(wd, {
      sdkSrc: SDK, mode: inv.mode,
      onPremise: {
        dispatcherAnySrc: inv.dispatcherAny, httpdSrc: inv.httpd,
        vhostsToConvert: inv.vhostFiles.filter(f => /vhost.*\.conf$/.test(f)),
        variablesToReplace: [], pathToPrepend: inv.dispatcherAny ? [path.dirname(inv.dispatcherAny) + '/'] : [], portsToMap: null,
      },
    });
    const res = RUN.runConverter(wd, inv.mode, RUN.TOOL_DIR);
    assert.strictEqual(res.code, 0);
    const verify = VERIFY.verifyOutput(res.outputSrcDir, inv.ruleCounts);
    const crossBoundary = CB.analyzeCrossBoundary({ configRoot: REAL, inventory: inv });
    const md = REP.renderReport({ inventory: inv, verifyResult: verify, crossBoundary, outputSrcDir: res.outputSrcDir });
    console.log(md);
    assert.match(md, /## Conversion coverage/);
    assert.match(md, /## Next checks \(delegated/);
    assert.match(md, /diff-baseline/);
    // the report must reflect the same filter verdict the gate produced
    assert.strictEqual(/ok`: \*\*false\*\*/.test(md), !verify.ok);
  } finally {
    fs.rmSync(wd, { recursive: true, force: true });
  }
});
