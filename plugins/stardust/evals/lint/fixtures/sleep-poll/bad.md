# Fixture — every snippet below must fire (sleep-poll lint self-test)

Poll the batch: `sleep 240; tail -n 3 stardust/.work/deploy/batch.log`.

```bash
sleep 540; for i in 0 1 2; do echo done; done
sleep 300 && grep -c '^=== ' stardust/migrated/batch.log
sleep 120; cat stardust/.work/tasks/abc.output
sleep 60;pgrep -f deploy-batch
sleep 5m; wc -l crawl.log
```
