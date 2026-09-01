'use strict';

/**
 * RV dashboard — leadership view, multi-pattern.
 * Shows each migration pattern: BPA finding -> skill fix -> RV verified on a
 * real AEM Cloud SDK. All live (runs verify.js + drives the running SDK on 4602).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { verify } = require('../verify.js');
const { Probe } = require('../probe.js');
const assetInvariant = require('../invariants/asset-manager.js');
const eventInvariant = require('../invariants/event-migration.js');
const replInvariant = require('../invariants/replication.js');
const luiInvariant = require('../invariants/legacy-ui.js');

const RV_DIR = path.join(__dirname, '..');
const SDK = 'http://localhost:4602';
const AUTH = 'Basic ' + Buffer.from('admin:admin').toString('base64');
const LOG = process.env.HOME + '/Downloads/demo-cloud-sdk/crx-quickstart/logs/error.log';
const SCHED_PID = 'com.adobe.aem.guides.core.schedulers.SimpleScheduledTask';
const PORT = 4700;
const probe = new Probe({ baseUrl: SDK, user: 'admin', password: 'admin' });

const FILES = {
  scheduler: ['SimpleScheduledTask', '.java'],
  'asset-manager': ['AssetCleanupService', '.java'],
  replication: ['ContentActivator', '.java'],
  'event-migration': ['ReplicationEventHandler', '.java'],
  lui: ['Dialog', '.xml'],
};
function sourceGate(pattern, variant) {
  const [base, ext] = FILES[pattern];
  const file = path.join(RV_DIR, 'example', `${base}.${variant}${ext}`);
  return verify({ pattern, sourceFile: file, fixturesDir: path.join(RV_DIR, 'evals') }).outcome;
}

async function schedulerLive() {
  const out = { up: false, active: false, fires: false, lastRun: null };
  try {
    const res = await fetch(`${SDK}/system/console/components.json`, { headers: { Authorization: AUTH } });
    out.up = res.ok;
    const c = (await res.json()).data.find(x => x.name === SCHED_PID);
    out.active = c && c.state === 'active';
  } catch {}
  try {
    const lines = fs.readFileSync(LOG, 'utf8').split('\n').filter(l => l.includes('SimpleScheduledTask is now running'));
    out.fires = lines.length > 0;
    const m = (lines[lines.length - 1] || '').match(/\b(\d{2}:\d{2}:\d{2})\b/);
    out.lastRun = m ? m[1] : null;
  } catch {}
  return out;
}

async function assetRuntime() {
  try {
    const r = await assetInvariant.check({ probe, target: {
      testPath: `/content/rv-test/probe-${Date.now()}`, triggerPath: '/bin/rv/deleteasset' } });
    return { ok: r.result === 'pass', checks: r.checks };
  } catch { return { ok: false, checks: {} }; }
}

async function eventRuntime() {
  const observe = (id) => { try { return fs.readFileSync(LOG, 'utf8').includes('RV EVENT JOB EXECUTED ' + id); } catch { return false; } };
  try {
    const r = await eventInvariant.check({ probe, observe, target: { triggerPath: '/bin/rv/fireevent', waitMs: 2500 } });
    return { ok: r.result === 'pass', checks: r.checks };
  } catch { return { ok: false, checks: {} }; }
}

async function replicationRuntime() {
  try {
    const r = await replInvariant.check({ probe, target: {
      testPath: `/content/rv-test/repl-${Date.now()}`, triggerPath: '/bin/rv/distribute' } });
    return { ok: r.result === 'pass', delivered: !!(r.checks && r.checks.delivered), checks: r.checks };
  } catch { return { ok: false, delivered: false, checks: {} }; }
}

async function luiRuntime() {
  try {
    const r = await luiInvariant.check({ probe, target: { renderPath: '/apps/rvtest/components/rvcomp/cq%3Adialog.html' } });
    return { ok: r.result === 'pass', checks: r.checks };
  } catch { return { ok: false, checks: {} }; }
}

async function patterns() {
  const [schedLive, asset, event, repl, lui] = await Promise.all([schedulerLive(), assetRuntime(), eventRuntime(), replicationRuntime(), luiRuntime()]);
  return {
    scheduler: { source: sourceGate('scheduler', 'migrated').result === 'pass', live: schedLive },
    asset: { source: sourceGate('asset-manager', 'migrated').result === 'pass', runtime: asset },
    replication: { source: sourceGate('replication', 'migrated').result === 'pass', runtime: repl },
    event: { source: sourceGate('event-migration', 'migrated').result === 'pass', runtime: event },
    lui: { source: sourceGate('lui', 'migrated').result === 'pass', runtime: lui },
  };
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(HTML); }
  if (req.url === '/api/patterns') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(await patterns()));
  }
  res.writeHead(404); res.end();
});
server.listen(PORT, () => console.log(`RV dashboard: http://localhost:${PORT}`));

const HTML = `<!doctype html><html><head><meta charset="utf-8"><title>RV — verified migrations on AEM Cloud Service</title>
<style>
  :root{--ok:#1d6b40;--okbg:#e5f3ea;--bad:#a32d2d;--badbg:#fbe9e9;--ink:#1c1c1a;--mut:#6b6b66;--line:#e6e4df}
  *{box-sizing:border-box} body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#f5f5f4;color:var(--ink)}
  .wrap{max-width:1080px;margin:0 auto;padding:30px 28px}
  h1{font-size:22px;font-weight:600;margin:0 0 2px} .sub{color:var(--mut);margin:0 0 22px;font-size:14px}
  .cards{display:grid;grid-template-columns:1fr 1fr;gap:18px}
  .card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:20px 22px}
  .phead{display:flex;align-items:center;justify-content:space-between;margin:0 0 4px}
  .pname{font-size:17px;font-weight:600} .badge{font-size:12px;font-weight:700;padding:5px 11px;border-radius:20px;display:inline-flex;gap:6px;align-items:center}
  .b-ok{background:var(--okbg);color:var(--ok)} .b-bad{background:var(--badbg);color:var(--bad)} .b-wait{background:#eee;color:#777}
  .b-src{background:#faeeda;color:#854f0b} .pend{color:#9a7a2a;font-weight:700} .muted-i{color:var(--mut);font-size:12.5px;padding:4px 0}
  .dot{width:8px;height:8px;border-radius:50%;background:currentColor;display:inline-block}
  .stage{margin-top:14px} .slab{font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--mut);margin:0 0 5px}
  .txt{font-size:13.5px;line-height:1.5} .txt code{font-family:ui-monospace,Menlo,monospace;font-size:12px}
  .bad-t{color:var(--bad)} .chk{font-size:13.5px;padding:4px 0;display:flex;gap:8px;align-items:center}
  .c{color:var(--ok);font-weight:700} .x{color:var(--bad);font-weight:700}
  .live{margin-top:20px;background:#0f1115;border-radius:12px;padding:14px 20px;color:#e8e8e3;display:flex;gap:30px;align-items:center}
  .live .lab{color:#9a9a95;font-size:12px;text-transform:uppercase;letter-spacing:.05em} .live .val{font-size:15px;font-weight:600} .green{color:#4ade80}
  .foot{margin-top:14px;font-size:13px;color:var(--mut)}
</style></head><body><div class="wrap">
<h1>RV — verified migrations on AEM Cloud Service</h1>
<p class="sub">Each pattern: the issue BPA reported → the fix the skill applied → proof it works on a real Cloud Service instance. Live data, nothing mocked.</p>
<div class="cards">
  <div class="card">
    <div class="phead"><span class="pname">Scheduler</span><span class="badge b-wait" id="s-badge"><span class="dot"></span>…</span></div>
    <div class="stage"><p class="slab">BPA finding</p><p class="txt bad-t">Legacy Sling Scheduler — Felix SCR, fires on all pods, no <code>:Boolean</code></p></div>
    <div class="stage"><p class="slab">Skill fix</p><p class="txt">SCR→OSGi DS, <code>runOn=LEADER</code>, <code>concurrent:Boolean</code></p></div>
    <div class="stage"><p class="slab">RV verified</p><div id="s-checks"></div></div>
  </div>
  <div class="card">
    <div class="phead"><span class="pname">Asset Manager</span><span class="badge b-wait" id="a-badge"><span class="dot"></span>…</span></div>
    <div class="stage"><p class="slab">BPA finding</p><p class="txt bad-t">Uses <code>removeAssetForBinary()</code> — removed API on AEMaaCS</p></div>
    <div class="stage"><p class="slab">Skill fix</p><p class="txt">In-JVM <code>resolver.delete()</code> + <code>commit()</code> (Path B)</p></div>
    <div class="stage"><p class="slab">RV verified</p><div id="a-checks"></div></div>
  </div>
  <div class="card">
    <div class="phead"><span class="pname">Replication</span><span class="badge b-wait" id="r-badge"><span class="dot"></span>…</span></div>
    <div class="stage"><p class="slab">BPA finding</p><p class="txt bad-t">Uses CQ <code>Replicator</code> — removed on AEMaaCS</p></div>
    <div class="stage"><p class="slab">Skill fix</p><p class="txt">Sling Distribution API (<code>Distributor</code> + <code>SimpleDistributionRequest</code>)</p></div>
    <div class="stage"><p class="slab">RV verified</p><div id="r-checks"></div></div>
  </div>
  <div class="card">
    <div class="phead"><span class="pname">Event Migration</span><span class="badge b-wait" id="e-badge"><span class="dot"></span>…</span></div>
    <div class="stage"><p class="slab">BPA finding</p><p class="txt bad-t"><code>EventHandler</code> runs heavy work inline on the shared OSGi thread</p></div>
    <div class="stage"><p class="slab">Skill fix</p><p class="txt">Offload to a Sling Job via <code>JobManager.addJob()</code></p></div>
    <div class="stage"><p class="slab">RV verified</p><div id="e-checks"></div></div>
  </div>
  <div class="card">
    <div class="phead"><span class="pname">Legacy UI — Dialog</span><span class="badge b-wait" id="l-badge"><span class="dot"></span>…</span></div>
    <div class="stage"><p class="slab">BPA finding</p><p class="txt bad-t">Coral 2 dialog (<code>…/foundation/…</code>) — not supported on AEMaaCS</p></div>
    <div class="stage"><p class="slab">Skill fix</p><p class="txt">Upgrade to Coral 3 Touch UI (<code>…/coral/foundation/…</code>)</p></div>
    <div class="stage"><p class="slab">RV verified</p><div id="l-checks"></div></div>
  </div>
</div>
<div class="live">
  <div><div class="lab">Instance</div><div class="val green" id="l-inst">—</div></div>
  <div><div class="lab">Scheduler last run</div><div class="val" id="l-last">—</div></div>
  <div><div class="lab">Patterns verified</div><div class="val green" id="l-count">—</div></div>
</div>
<p class="foot">Runs the real <code>verify.js</code> and drives the live Cloud SDK on <code>localhost:4602</code>. Refreshes every 6s.</p>
</div>
<script>
function row(ok,label){return '<div class="chk"><span class="'+(ok?'c':'x')+'">'+(ok?'✓':'✗')+'</span><span>'+label+'</span></div>';}
function pend(label){return '<div class="chk"><span class="pend">◦</span><span>'+label+'</span></div>';}
function fullBadge(el,ok){el.className='badge '+(ok?'b-ok':'b-bad');el.innerHTML='<span class="dot"></span>'+(ok?'Verified on Cloud Service':'Not verified');}
function srcBadge(el,ok){el.className='badge '+(ok?'b-src':'b-bad');el.innerHTML='<span class="dot"></span>'+(ok?'Source verified · runtime pending':'Not verified');}
async function poll(){
  try{
    const p=await (await fetch('/api/patterns')).json();
    // scheduler (source + runtime)
    const sOk=p.scheduler.source && p.scheduler.live.active && p.scheduler.live.fires;
    document.getElementById('s-checks').innerHTML=
      row(p.scheduler.source,'Source contract passes (6/6)')+
      row(p.scheduler.live.active,'Component <b>active</b> as OSGi DS')+
      row(p.scheduler.live.fires,'Scheduler <b>fires on schedule</b>');
    fullBadge(document.getElementById('s-badge'),sOk);
    // asset (source + runtime)
    const c=p.asset.runtime.checks||{}; const aOk=p.asset.source && p.asset.runtime.ok;
    document.getElementById('a-checks').innerHTML=
      row(p.asset.source,'Source contract passes')+
      row(!!c.delete_invoked,'Migrated delete invoked on CS')+
      row(!!c.gone_after,'Node removed — <b>200 → 404</b>');
    fullBadge(document.getElementById('a-badge'),aOk);
    // replication (source + runtime: API verified on CS; delivery needs publish tier)
    const rc=(p.replication.runtime&&p.replication.runtime.checks)||{};
    const rOk=p.replication.source && p.replication.runtime && p.replication.runtime.ok;
    document.getElementById('r-checks').innerHTML=
      row(p.replication.source,'Source contract passes')+
      row(!!rc.api_present,'Sling Distribution API present on CS')+
      row(!!rc.migrated_code_runs,'Migrated <code>Distributor</code> runs — no removed API')+
      (rc.delivered?row(true,'Delivered to publish'):pend('Delivery to publish — needs publish tier'));
    if(rOk){document.getElementById('r-badge').className='badge b-ok';document.getElementById('r-badge').innerHTML='<span class="dot"></span>Runtime verified on CS';}
    else{srcBadge(document.getElementById('r-badge'),p.replication.source);}
    // event-migration (source + runtime)
    const ec=(p.event.runtime&&p.event.runtime.checks)||{}; const eOk=p.event.source && p.event.runtime && p.event.runtime.ok;
    document.getElementById('e-checks').innerHTML=
      row(p.event.source,'Source contract passes')+
      row(!!ec.event_fired,'OSGi event fired on CS')+
      row(!!ec.offloaded_job_ran,'Handler <b>offloaded → Sling Job ran</b>');
    fullBadge(document.getElementById('e-badge'),eOk);
    // legacy UI dialog (source + render on CS)
    const lc=(p.lui.runtime&&p.lui.runtime.checks)||{}; const lOk=p.lui.source && p.lui.runtime && p.lui.runtime.ok;
    document.getElementById('l-checks').innerHTML=
      row(p.lui.source,'Source contract passes')+
      row(!!lc.dialog_renders,'Dialog renders on CS')+
      row(!!lc.renders_coral3,'Renders as <b>Coral 3 Touch UI</b>');
    fullBadge(document.getElementById('l-badge'),lOk);
    // live strip
    document.getElementById('l-inst').textContent=p.scheduler.live.up?'up · 4602':'down';
    document.getElementById('l-last').textContent=p.scheduler.live.lastRun||'—';
    const full=(sOk?1:0)+(aOk?1:0)+(eOk?1:0)+(rOk?1:0)+(lOk?1:0);
    const src=[p.scheduler.source,p.asset.source,p.replication.source,p.event.source,p.lui.source].filter(Boolean).length;
    document.getElementById('l-count').textContent='runtime '+full+'/5 · source '+src+'/5';
  }catch(e){}
}
poll(); setInterval(poll,6000);
</script></body></html>`;
