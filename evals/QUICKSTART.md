# Quick Start Guide - Skill Evals

Get up and running with skill evaluations in 5 minutes.

## 1️⃣ One-Time Setup

```bash
# Install eval runner dependencies
cd evals/runner
npm install

# Set your API key (get one from https://console.anthropic.com)
export ANTHROPIC_API_KEY=sk-ant-...

# Or add to your shell profile for permanence
echo 'export ANTHROPIC_API_KEY=sk-ant-...' >> ~/.zshrc
source ~/.zshrc
```

## 2️⃣ Run Your First Eval

```bash
# From repo root
npm run eval:cloud-dispatcher
```

You should see output like:

```
🧪 Adobe Skills Evaluation Runner

📋 Skill: dispatcher-config-authoring
🏷️  Variant: cloud-service
📁 Path: skills/aem/cloud-service/skills/dispatcher/config-authoring
🧪 Test cases: 3
🔄 Iteration: 1

━━━ Test Case 1: create-basic-filter-rule ━━━

  Prompt: I need to add a filter rule to block direct access...
  Expected: A dispatcher filter configuration...

✔ Test case 1 passed (6/6 assertions)

━━━ Test Case 2: cloud-service-vhost-pattern ━━━

✔ Test case 2 passed (6/6 assertions)

━━━ Test Case 3: cache-invalidation-cloud ━━━

✖ Test case 3 failed (3/5 assertions)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 Evaluation Summary

Total:   3
Passed:  2
Failed:  1

Pass rate: 66.7%

Results saved to: evals-workspace/cloud-service/dispatcher/config-authoring/iteration-1/results.json
```

## 3️⃣ View Detailed Results

```bash
# Pretty-print the results
cat evals-workspace/cloud-service/dispatcher/config-authoring/iteration-1/results.json | jq

# Or if jq is not installed
cat evals-workspace/cloud-service/dispatcher/config-authoring/iteration-1/results.json
```

Example output:

```json
{
  "skill": "dispatcher-config-authoring",
  "variant": "cloud-service",
  "iteration": 1,
  "test_cases": [
    {
      "id": 1,
      "name": "create-basic-filter-rule",
      "status": "passed",
      "assertions": {
        "total": 6,
        "passed": 6,
        "failed": 0,
        "results": [
          {
            "assertion": "Output includes a valid dispatcher filter configuration section",
            "passed": true,
            "evidence": "The output contains a complete /filter { ... } block"
          }
        ]
      }
    }
  ]
}
```

## 4️⃣ Iterate and Improve

If you see failures:

1. **Identify the issue** - Look at which assertions failed
2. **Update the skill** - Edit `SKILL.md` or add examples to `references/`
3. **Re-run with new iteration** - Track improvement over time

```bash
# Run iteration 2 after making changes
cd evals/runner
npm run eval -- --skill cloud-service/dispatcher/config-authoring --iteration 2

# Compare iteration 1 vs 2
diff \
  <(jq .summary ../../evals-workspace/cloud-service/dispatcher/config-authoring/iteration-1/results.json) \
  <(jq .summary ../../evals-workspace/cloud-service/dispatcher/config-authoring/iteration-2/results.json)
```

## 5️⃣ Test the Other Variant

```bash
# Test 6.5 LTS dispatcher skill
npm run eval:lts-dispatcher

# Or manually
cd evals/runner
npm run eval -- --skill 6.5-lts/dispatcher/config-authoring
```

## Common Commands

```bash
# From repo root
npm run eval:cloud-dispatcher              # Cloud Service dispatcher
npm run eval:lts-dispatcher                # 6.5 LTS dispatcher

# From evals/runner
npm run eval -- --skill <path>             # Any skill
npm run eval -- --skill <path> --iteration 2
npm run eval -- --skill <path> --no-baseline  # Skip baseline (faster)
npm run eval -- --skill <path> --ci        # CI mode (fail on errors)
```

## What's Next?

- Read the [full README](README.md) for detailed documentation
- Add your own test cases to `evals/skills/*/dispatcher/*/evals.json`
- Create evals for other skills (create-component, migration, etc.)
- Set up GitHub Actions to run evals on PRs automatically

## Troubleshooting

### Issue: `ANTHROPIC_API_KEY environment variable not set`

**Fix:**
```bash
export ANTHROPIC_API_KEY=sk-ant-your-key-here
```

### Issue: `Could not read evals config`

**Fix:** Make sure you're running from the correct directory:
```bash
cd evals/runner
npm run eval -- --skill cloud-service/dispatcher/config-authoring
```

### Issue: Low pass rates (< 50%)

**Fix:** Check if assertions are too strict or if skill needs improvement:
```bash
# View which assertions failed
jq '.test_cases[].assertions.results[] | select(.passed == false)' \
  ../../evals-workspace/cloud-service/dispatcher/config-authoring/iteration-1/results.json
```

---

**Happy evaluating! 🧪**
