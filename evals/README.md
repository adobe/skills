# Skill Evaluation Framework

Automated evaluation system for Adobe skills following the [agentskills.io evaluation pattern](https://agentskills.io/skill-creation/evaluating-skills).

## 📖 Table of Contents

- [Overview](#overview)
- [Directory Structure](#directory-structure)
- [When Evals Run](#when-evals-run)
- [Writing Evals](#writing-evals)
- [Testing Locally](#testing-locally)
- [CI/CD Integration](#cicd-integration)
- [Interpreting Results](#interpreting-results)
- [Best Practices](#best-practices)

---

## Overview

The eval framework tests whether skills produce correct, high-quality outputs across varied prompts and edge cases. Each test case:

1. **Runs with the skill** - Simulates an AI agent with skill knowledge
2. **Runs without the skill** (baseline) - Tests the same prompt without skill context
3. **Grades assertions** - Validates output against specific criteria
4. **Reports results** - Generates pass/fail metrics and detailed evidence

## Directory Structure

```
evals/
├── README.md                          # This file
├── runner/
│   ├── package.json                   # Runner dependencies
│   └── eval-runner.js                 # Core evaluation engine
└── skills/
    ├── cloud-service/                 # AEM Cloud Service skills
    │   └── dispatcher/
    │       ├── config-authoring/
    │       │   ├── evals.json         # Test cases + assertions
    │       │   └── files/             # Input files (configs, etc.)
    │       ├── technical-advisory/
    │       └── ...
    └── 6.5-lts/                       # AEM 6.5 LTS skills
        └── dispatcher/
            ├── config-authoring/
            │   ├── evals.json
            │   └── files/
            └── ...

evals-workspace/                       # Git-ignored, local test runs
├── cloud-service/
│   └── dispatcher/
│       └── config-authoring/
│           └── iteration-1/
│               └── results.json
└── 6.5-lts/
    └── dispatcher/
        └── config-authoring/
            └── iteration-1/
                └── results.json
```

## When Evals Run

### Automatic (CI/CD)

Evals run automatically on **pull requests** when:
- Skill files change: `skills/aem/{cloud-service,6.5-lts}/skills/dispatcher/**`
- Eval files change: `evals/skills/**`

Results are posted as PR comments with pass/fail details.

### Manual (Local Development)

Run evals locally during skill development:
- Before submitting a PR
- When iterating on skill improvements
- To validate changes to `SKILL.md` or `references/`

---

## Writing Evals

### 1. Create the Eval Config

Create `evals/skills/<variant>/<skill-path>/evals.json`:

```json
{
  "skill_name": "dispatcher-config-authoring",
  "skill_variant": "cloud-service",
  "skill_path": "skills/aem/cloud-service/skills/dispatcher/config-authoring",
  "description": "Evaluates dispatcher config-authoring skill",
  "evals": [
    {
      "id": 1,
      "name": "create-basic-filter-rule",
      "prompt": "I need to add a filter rule to block /content/dam except for images. Help me create the config for AEM Cloud Service.",
      "expected_output": "A dispatcher filter config that denies /content/dam but allows image extensions",
      "files": [],
      "assertions": [
        "Output includes a valid dispatcher filter configuration section",
        "Configuration includes a deny rule for /content/dam",
        "Configuration includes allow rules for image extensions (png, jpg, jpeg, gif)",
        "Filter rules follow AEM Cloud Service best practices",
        "No security vulnerabilities in the filter rules"
      ],
      "tags": ["filter", "security", "cloud-service"]
    }
  ]
}
```

### 2. Design Good Test Cases

**Start with 2-3 test cases** per skill. Focus on:

- **Realistic prompts** - How users actually ask questions
- **Variety** - Different phrasings, detail levels, formality
- **Edge cases** - Boundary conditions, unusual requests
- **Variant-specific** - Cloud Service vs 6.5 LTS differences

#### Example: Good vs Bad Prompts

❌ **Bad** (too vague):
```
"Create a filter rule"
```

✅ **Good** (realistic context):
```
"I need to add a filter rule to block direct access to /content/dam except 
for images and PDFs. Can you help me create the appropriate filter 
configuration for AEM Cloud Service?"
```

### 3. Write Strong Assertions

Assertions must be **verifiable** - either programmatically or by an LLM grader.

#### Assertion Guidelines

✅ **Good Assertions:**
- "Output includes a valid dispatcher filter configuration section"
- "Configuration includes a deny rule for /content/dam"
- "Uses Cloud Service-specific patterns (not AMS patterns)"
- "Mentions dispatcher-sdk-2.x validation tools"

❌ **Weak Assertions:**
- "The output is good" (too vague)
- "Uses exactly the phrase 'Total: $X'" (too brittle)
- "Works correctly" (not verifiable from output)

#### Variant-Specific Assertions

For **Cloud Service** skills:
```json
"assertions": [
  "Includes Cloud Service-specific Include directives",
  "Does NOT include legacy AMS-specific patterns",
  "Mentions dispatcher-sdk-2.x validation",
  "Configuration is CDN-aware"
]
```

For **6.5 LTS** skills:
```json
"assertions": [
  "Includes AMS-specific Include directives",
  "Does NOT include Cloud Service-only patterns",
  "May suggest JMX or Felix Console for debugging",
  "Configuration handles AMS load balancer headers"
]
```

### 4. Add Input Files (Optional)

For skills that work with files, add sample inputs:

```
evals/skills/cloud-service/dispatcher/config-authoring/
├── evals.json
└── files/
    ├── sample-dispatcher.any
    ├── sample-vhost.conf
    └── broken-filter.any
```

Reference files in test cases:
```json
{
  "id": 2,
  "name": "fix-broken-filter",
  "prompt": "Review this filter config and fix any issues",
  "files": ["files/broken-filter.any"],
  "expected_output": "Corrected filter config with security issues fixed"
}
```

---

## Testing Locally

### Setup (First Time)

```bash
# 1. Install runner dependencies
cd evals/runner
npm install

# 2. Set your Anthropic API key
export ANTHROPIC_API_KEY=your-key-here
# Or add to ~/.bashrc or ~/.zshrc
```

### Run Evals

```bash
cd evals/runner

# Run Cloud Service dispatcher config-authoring evals
npm run eval -- --skill cloud-service/dispatcher/config-authoring

# Run 6.5 LTS dispatcher config-authoring evals
npm run eval -- --skill 6.5-lts/dispatcher/config-authoring

# Run specific iteration
npm run eval -- --skill cloud-service/dispatcher/config-authoring --iteration 2

# Skip baseline (faster, only tests with_skill)
npm run eval -- --skill cloud-service/dispatcher/config-authoring --no-baseline
```

### View Results

Results are saved to `evals-workspace/<skill-path>/iteration-N/results.json`:

```bash
# View results
cat ../../evals-workspace/cloud-service/dispatcher/config-authoring/iteration-1/results.json

# Or use jq for pretty output
jq . ../../evals-workspace/cloud-service/dispatcher/config-authoring/iteration-1/results.json
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
        "failed": 0
      }
    }
  ],
  "summary": {
    "total": 3,
    "passed": 2,
    "failed": 1
  }
}
```

---

## CI/CD Integration

### GitHub Actions Workflow

Evals run automatically on PRs via `.github/workflows/eval-skills.yml`:

1. **Detects changes** - Only runs if dispatcher skill files changed
2. **Runs evals** - Executes test cases for changed skills
3. **Posts results** - Comments on PR with pass/fail report
4. **Uploads artifacts** - Saves full results for 30 days

### Required Secrets

Add `ANTHROPIC_API_KEY` to your repository secrets:

1. Go to **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret**
3. Name: `ANTHROPIC_API_KEY`
4. Value: Your Anthropic API key
5. Click **Add secret**

### PR Comment Example

```markdown
## 🧪 Skill Evaluation Report

**Skill:** dispatcher-config-authoring
**Variant:** cloud-service
**Pass Rate:** 66.7%

### Summary
- **Total:** 3
- **✅ Passed:** 2
- **❌ Failed:** 1

### Test Cases

✅ **create-basic-filter-rule** - 6/6 assertions passed
✅ **cloud-service-vhost-pattern** - 6/6 assertions passed
❌ **cache-invalidation-cloud** - 3/5 assertions passed
  - ❌ Mentions Cloud Service validation tools
  - ❌ Does NOT suggest AMS-specific troubleshooting
```

---

## Interpreting Results

### Pass Rates

- **100%** - All test cases passed all assertions ✨
- **80-99%** - Most tests passed, minor issues to address
- **50-79%** - Significant gaps, skill needs improvement
- **<50%** - Major issues, review skill design

### Common Failure Patterns

| Failure Type | Likely Cause | Fix |
|--------------|--------------|-----|
| Missing configuration elements | Skill references lack examples | Add examples to `references/` |
| Wrong variant patterns | Cross-contamination (Cloud ↔ AMS) | Strengthen variant-specific guidance |
| Security vulnerabilities | Missing security guidance | Add security patterns to skill |
| Inconsistent output | Ambiguous instructions | Clarify instructions with examples |

### Iteration Loop

1. **Run evals** → Get baseline pass rate
2. **Fix failures** → Update `SKILL.md`, `references/`, or scripts
3. **Re-run evals** → Increment iteration number
4. **Compare** → Track pass rate improvement
5. **Repeat** until satisfied

---

## Best Practices

### 1. Start Small
- Begin with 2-3 test cases per skill
- Expand based on failure patterns
- Don't over-invest before seeing results

### 2. Test Both Variants
- Ensure Cloud Service and 6.5 LTS skills are distinct
- Use variant-specific assertions
- Catch cross-contamination early

### 3. Review Assertions
- Remove assertions that always pass (not useful)
- Fix assertions that always fail (broken or too hard)
- Focus on assertions that reveal skill quality

### 4. Use Evidence
- Require concrete evidence for PASS
- Quote specific output in failure evidence
- Don't give benefit of the doubt

### 5. Iterate Systematically
- Run locally before submitting PR
- Increment iteration numbers
- Track pass rate trends over time

### 6. Balance Coverage
- Mix basic and advanced scenarios
- Include common and edge cases
- Test positive and negative paths

---

## Examples

### Example 1: Basic Filter Rule (Cloud Service)

**Test Case:**
```json
{
  "id": 1,
  "name": "create-basic-filter-rule",
  "prompt": "Block /content/dam except images for AEM Cloud Service",
  "assertions": [
    "Valid filter configuration",
    "Deny rule for /content/dam",
    "Allow rules for image extensions"
  ]
}
```

**Expected Output:**
```apache
/filter {
  /0001 { /type "deny" /url "/content/dam/*" }
  /0002 { /type "allow" /url "/content/dam/*.png" }
  /0003 { /type "allow" /url "/content/dam/*.jpg" }
}
```

### Example 2: Cache Invalidation (6.5 LTS)

**Test Case:**
```json
{
  "id": 3,
  "name": "cache-invalidation-ams",
  "prompt": "Cache not invalidating, statfileslevel is 0. What's wrong?",
  "assertions": [
    "Explains statfileslevel 0 behavior",
    "Recommends increasing to 2+",
    "Provides configuration example",
    "Suggests AMS-specific tools"
  ]
}
```

---

## Troubleshooting

### "ANTHROPIC_API_KEY not set"
```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

### "Could not read evals config"
Check file exists:
```bash
ls -la evals/skills/cloud-service/dispatcher/config-authoring/evals.json
```

### "Grading error"
LLM grader may have failed. Check:
- API key is valid
- Network connection is stable
- Retry the eval run

### Low pass rates
1. Check if assertions are too strict
2. Review skill `SKILL.md` for missing patterns
3. Add examples to `references/`
4. Run locally to debug specific failures

---

## Contributing

When adding new skills, create matching evals:

1. Create `evals/skills/<variant>/<skill>/evals.json`
2. Start with 2-3 basic test cases
3. Run locally to validate
4. Submit PR - evals will run automatically
5. Iterate based on results

---

## Resources

- [agentskills.io - Evaluating Skills](https://agentskills.io/skill-creation/evaluating-skills)
- [Anthropic Claude API](https://docs.anthropic.com/en/api/getting-started)
- [GitHub Actions Docs](https://docs.github.com/en/actions)

---

*For questions or issues, see [CONTRIBUTING.md](../CONTRIBUTING.md)*
