'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const INV = require('./dispatcher-inventory.js');
const RUN = require('./dispatcher-run.js');
const VERIFY = require('./dispatcher-verify.js');

const REAL = process.env.DISPATCHER_E2E_SRC;   // path to a real on-prem config root
const SDK = process.env.DISPATCHER_SDK_SRC;     // path to a Dispatcher SDK src
test('E2E: convert a real flexible config, and the verify gate catches filter loss', { skip: !REAL || !SDK }, () => {
  const inv = INV.buildInventory(REAL);
  assert.ok(inv.mode === 'flexible' || inv.mode === 'v1');
  const wd = fs.mkdtempSync(path.join(os.tmpdir(), 'disp-e2e-'));
  RUN.ensureToolInstalled(RUN.TOOL_DIR);
  RUN.writeToolConfig(wd, {
    sdkSrc: SDK, mode: inv.mode,
    onPremise: {
      dispatcherAnySrc: inv.dispatcherAny, httpdSrc: inv.httpd,
      vhostsToConvert: inv.vhostFiles.filter(f => /vhost.*\.conf$/.test(f)),
      variablesToReplace: [], pathToPrepend: [path.dirname(inv.dispatcherAny) + '/'], portsToMap: null,
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
});
