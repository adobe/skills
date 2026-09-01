# RV live demo — runbook (leadership)

Pre-baked state: AEM **Cloud SDK** running on `http://localhost:4602` (admin/admin),
migrated WKND scheduler already deployed + firing. All steps below are instant —
no builds during the demo.

Working dir: `scratchpad/rv/`

## Beat 1 — legacy fails, and the failure becomes a test
```
node verify.js scheduler example/SimpleScheduledTask.legacy.java
```
Shows `result: fail` (Felix SCR, no :Boolean, no runOn) and auto-writes a regression
eval under `evals/scheduler-source-.../`. Point out: every failure becomes a permanent test.

## Beat 2 — the skill migrates it
```
diff example/SimpleScheduledTask.legacy.java example/SimpleScheduledTask.migrated.java
```
Call out: SCR → OSGi DS, `scheduler.concurrent:Boolean`, `scheduler.runOn=LEADER`.

## Beat 3 — verify on a REAL Cloud Service instance
Source gate:
```
node verify.js scheduler example/SimpleScheduledTask.migrated.java   # result: pass
```
Live runtime proof (component active + actually firing on the Cloud SDK):
```
curl -s -u admin:admin http://localhost:4602/system/console/components.json \
  | python3 -c "import sys,json;d=json.load(sys.stdin);c=[x for x in d['data'] if x['name'].endswith('SimpleScheduledTask')][0];print('state:',c['state'])"

grep -c "SimpleScheduledTask is now running" \
  ~/Downloads/demo-cloud-sdk/crx-quickstart/logs/error.log   # count keeps climbing = firing
```

## The one-line pitch
Fail → skill fixes → **provably passes on real cloud infra** → and every failure
became a permanent regression test. That is the skill-improvement loop.

## Housekeeping
- Restart the Cloud SDK later: `JAVA_HOME=<java11> CQ_PORT=4602 ~/Downloads/demo-cloud-sdk/crx-quickstart/bin/start`
- Stop it: `~/Downloads/demo-cloud-sdk/crx-quickstart/bin/stop` (or `CQ_PORT=4602 ... stop`)
