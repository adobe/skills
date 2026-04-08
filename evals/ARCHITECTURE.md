# Eval Framework Architecture

## Overview

This document provides a comprehensive view of the skill evaluation framework architecture, data flow, and integration points.

## Directory Structure

```
skills/ (repo root)
├── package.json                           # Updated with eval scripts
├── .gitignore                             # Excludes evals-workspace/
│
├── .github/
│   ├── workflows/
│   │   ├── validate.yml                   # Existing: validates SKILL.md
│   │   └── eval-skills.yml                # NEW: runs evals on PR
│   └── scripts/
│       └── generate-eval-report.js        # NEW: generates PR comment
│
├── skills/aem/
│   ├── cloud-service/skills/dispatcher/   # Skill being tested
│   └── 6.5-lts/skills/dispatcher/         # Skill being tested
│
├── evals/                                 # NEW: Eval framework
│   ├── README.md                          # Full documentation
│   ├── QUICKSTART.md                      # 5-minute getting started
│   ├── ARCHITECTURE.md                    # This file
│   │
│   ├── runner/                            # Execution engine
│   │   ├── package.json                   # Dependencies
│   │   └── eval-runner.js                 # Core eval logic
│   │
│   └── skills/                            # Test cases
│       ├── cloud-service/
│       │   └── dispatcher/
│       │       └── config-authoring/
│       │           ├── evals.json         # 3 test cases
│       │           └── files/             # Input files (future)
│       └── 6.5-lts/
│           └── dispatcher/
│               └── config-authoring/
│                   ├── evals.json         # 3 test cases
│                   └── files/             # Input files (future)
│
└── evals-workspace/                       # Git-ignored, local runs
    ├── cloud-service/dispatcher/config-authoring/
    │   ├── iteration-1/
    │   │   └── results.json
    │   └── iteration-2/
    │       └── results.json
    └── 6.5-lts/dispatcher/config-authoring/
        └── iteration-1/
            └── results.json
```

## Data Flow

### Local Development Flow

```
┌─────────────┐
│ Developer   │
│ updates     │
│ SKILL.md    │
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────┐
│ npm run eval:cloud-dispatcher  │
└───────────┬─────────────────────┘
            │
            ▼
      ┌─────────────┐
      │ eval-runner │
      │   (Node.js) │
      └──────┬──────┘
             │
             ├─→ Read evals.json
             │   (test cases + assertions)
             │
             ├─→ For each test case:
             │   ┌──────────────────────┐
             │   │ 1. Run with_skill    │ ─→ Claude API (with skill context)
             │   │ 2. Run without_skill │ ─→ Claude API (baseline)
             │   │ 3. Grade assertions  │ ─→ Claude API (Haiku grader)
             │   └──────────────────────┘
             │
             ▼
      ┌─────────────────┐
      │ results.json    │
      │ in workspace/   │
      │ iteration-N/    │
      └─────────────────┘
             │
             ▼
      ┌─────────────────┐
      │ Developer       │
      │ reviews         │
      │ failures        │
      └─────────────────┘
```

### CI/CD Flow (GitHub Actions)

```
┌──────────────┐
│ PR Created/  │
│ Updated      │
└──────┬───────┘
       │
       ▼
┌───────────────────────┐
│ paths-filter@v3       │
│ Detect changed files  │
└───────┬───────────────┘
        │
        ├─→ skills/aem/cloud-service/skills/dispatcher/** changed?
        │   └─→ Trigger eval-cloud-service-dispatcher job
        │
        └─→ skills/aem/6.5-lts/skills/dispatcher/** changed?
            └─→ Trigger eval-lts-dispatcher job
```

**Per-Variant Job:**
```
┌────────────────────┐
│ Checkout code      │
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│ Setup Node.js      │
│ Install deps       │
└─────────┬──────────┘
          │
          ▼
┌────────────────────────────────┐
│ npm run eval -- --skill X --ci │
│ ANTHROPIC_API_KEY from secrets │
└───────┬────────────────────────┘
        │
        ▼
┌───────────────────────────┐
│ generate-eval-report.js   │
│ Create Markdown summary   │
└────────┬──────────────────┘
         │
         ▼
┌────────────────────────────┐
│ Post comment to PR         │
│ with pass/fail summary     │
└────────┬───────────────────┘
         │
         ▼
┌────────────────────────────┐
│ Upload artifacts           │
│ (full results.json)        │
│ Retention: 30 days         │
└────────────────────────────┘
```

## Component Details

### 1. Test Case Definition (`evals.json`)

```json
{
  "skill_name": "dispatcher-config-authoring",
  "skill_variant": "cloud-service",
  "skill_path": "skills/aem/cloud-service/skills/dispatcher/config-authoring",
  "description": "Evaluates dispatcher config-authoring skill",
  "evals": [
    {
      "id": 1,
      "name": "test-name",
      "prompt": "user question",
      "expected_output": "what success looks like",
      "files": ["optional input files"],
      "assertions": ["verifiable claims"],
      "tags": ["categorization"]
    }
  ]
}
```

**Fields:**
- `skill_name` - Unique skill identifier
- `skill_variant` - `cloud-service` or `6.5-lts`
- `skill_path` - Relative path to SKILL.md
- `evals[]` - Array of test cases
  - `id` - Unique test case number
  - `name` - Descriptive name (kebab-case)
  - `prompt` - User question/request
  - `expected_output` - Success criteria
  - `assertions` - Pass/fail checks
  - `tags` - Categorization (filter, cache, etc.)

### 2. Eval Runner (`eval-runner.js`)

**Responsibilities:**
1. Load `evals.json` configuration
2. Execute test cases sequentially
3. Call Claude API for:
   - with_skill response (system prompt includes skill context)
   - without_skill response (baseline)
   - Assertion grading (Haiku for cost efficiency)
4. Aggregate results
5. Save to `evals-workspace/`

**Key Functions:**
```javascript
main()                           // Entry point, CLI arg parsing
runEvalCase(config, evalCase)    // Execute one test case
gradeAssertions(assertions, output) // LLM-based grading
```

**Models Used:**
- **Sonnet 4.5** for with_skill / without_skill runs
- **Haiku 4.5** for assertion grading (cheaper, faster)

### 3. Report Generator (`generate-eval-report.js`)

**Input:** `results.json` from workspace
**Output:** Markdown report for PR comment

**Report Structure:**
```markdown
## 🧪 Skill Evaluation Report
- Summary table (pass/fail counts)
- Per test case details (collapsible)
- Evidence for failures
- Guidance for next steps
```

### 4. GitHub Actions Workflow

**Triggers:**
- `pull_request` on `main` or `beta`
- When dispatcher skill files change

**Strategy:**
- **Parallel jobs** - Cloud Service and 6.5 LTS run independently
- **Conditional execution** - Only run if relevant files changed
- **Path filtering** - Uses `dorny/paths-filter@v3`

**Secrets Required:**
- `ANTHROPIC_API_KEY` - For Claude API calls

## Execution Modes

### Mode 1: Local Development

```bash
cd evals/runner
npm run eval -- --skill cloud-service/dispatcher/config-authoring
```

**Characteristics:**
- Interactive output (spinners, colors)
- Results saved locally
- Can iterate quickly
- No PR comments

### Mode 2: CI/CD (GitHub Actions)

```yaml
npm run eval -- --skill X --ci
```

**Characteristics:**
- `--ci` flag makes failures exit with code 1
- Results uploaded as artifacts
- PR comments posted
- Runs on ANTHROPIC_API_KEY secret

### Mode 3: Iteration Tracking

```bash
npm run eval -- --skill X --iteration 2
```

**Characteristics:**
- Saves to `iteration-2/` subdirectory
- Allows comparison across iterations
- Tracks improvement over time

### Mode 4: Fast Mode (skip baseline)

```bash
npm run eval -- --skill X --no-baseline
```

**Characteristics:**
- Skips without_skill run
- 2x faster
- Useful for rapid iteration
- No delta comparison

## Integration Points

### 1. With Skills Repository

```
evals/skills/cloud-service/dispatcher/config-authoring/
  └─→ tests skills/aem/cloud-service/skills/dispatcher/config-authoring/
```

**Convention:** Eval path mirrors skill path (after `/skills/aem/`)

### 2. With Claude API

```javascript
// with_skill run
const systemPrompt = buildVariantSystemPrompt(variant);
const response = await anthropic.messages.create({
  model: 'claude-sonnet-4-5-20241022',
  system: systemPrompt, // Includes skill knowledge
  messages: [{ role: 'user', content: prompt }]
});
```

### 3. With GitHub

**Secrets:**
- Repository Settings → Secrets → `ANTHROPIC_API_KEY`

**Comments:**
- Posted via `actions/github-script@v7`
- Includes pass/fail badge
- Collapsible test case details

**Artifacts:**
- Full `results.json` uploaded
- Downloadable for 30 days
- Useful for debugging

## Variant Handling

### Cloud Service vs 6.5 LTS

**Separate eval files:**
```
evals/skills/cloud-service/dispatcher/config-authoring/evals.json
evals/skills/6.5-lts/dispatcher/config-authoring/evals.json
```

**Variant-specific assertions:**

**Cloud Service:**
```json
"assertions": [
  "Includes Cloud Service-specific Include directives",
  "Does NOT include AMS-specific patterns",
  "Mentions dispatcher-sdk-2.x"
]
```

**6.5 LTS:**
```json
"assertions": [
  "Includes AMS-specific Include directives",
  "Does NOT include Cloud Service-only patterns",
  "May suggest JMX or Felix Console"
]
```

**System prompts vary by variant:**
```javascript
const variantContext = variant === 'cloud-service'
  ? 'Focus on immutable configs, CDN, Cloud Manager'
  : 'Focus on mutable configs, AMS load balancers, traditional tools';
```

## Extensibility

### Adding New Skills

1. Create eval directory structure:
   ```
   evals/skills/<variant>/<skill>/
   ├── evals.json
   └── files/
   ```

2. Add test cases to `evals.json`

3. Update GitHub workflow (optional):
   ```yaml
   # Add path filter
   new-skill:
     - 'skills/aem/<variant>/skills/<skill>/**'
     - 'evals/skills/<variant>/<skill>/**'
   ```

4. Add convenience script to root `package.json`:
   ```json
   "eval:<skill-name>": "cd evals/runner && npm run eval -- --skill <path>"
   ```

### Adding Programmatic Assertions

For assertions that can be verified by code (not LLM):

1. Create `evals/runner/validators/<domain>.js`
2. Export validator functions
3. Import in `eval-runner.js`
4. Check assertion text patterns, dispatch to validator

Example:
```javascript
// validators/dispatcher.js
export function validateFilterSyntax(output) {
  const hasFilterBlock = /\/filter\s*\{/.test(output);
  const hasClosingBrace = /\}/.test(output);
  return hasFilterBlock && hasClosingBrace;
}

// eval-runner.js
if (assertion.includes("valid dispatcher filter")) {
  return { passed: validateFilterSyntax(output), evidence: "..." };
}
```

## Performance Considerations

### Token Usage

Per test case (3 assertions):
- **with_skill:** ~4k input + 1-2k output = ~6k tokens
- **without_skill:** ~4k input + 1-2k output = ~6k tokens
- **grading:** 3 × (1k input + 200 output) = ~3.6k tokens
- **Total:** ~15k tokens/test case

**3 test cases × 2 variants = 6 test cases = ~90k tokens/PR**

At $3/$15 per MTok (Sonnet 4.5):
- **Cost per PR:** ~$0.54 (mostly Sonnet)
- **Annual (100 PRs):** ~$54

### Runtime

- **Sequential execution:** ~30-60 seconds per test case
- **3 test cases:** ~2-3 minutes
- **GitHub Actions:** ~4-5 minutes total (including setup)

### Optimization Opportunities

1. **Parallel test execution** - Run test cases concurrently
2. **Caching** - Cache with_skill/without_skill results per prompt hash
3. **Batch grading** - Grade multiple assertions in one API call
4. **Haiku for all** - Use Haiku instead of Sonnet (cheaper, may reduce quality)

## Monitoring & Debugging

### Local Debugging

```bash
# Verbose output
DEBUG=* npm run eval -- --skill X

# Save full outputs
npm run eval -- --skill X > eval-log.txt 2>&1

# Inspect specific assertion
cat evals-workspace/X/iteration-1/results.json | \
  jq '.test_cases[0].assertions.results[] | select(.passed == false)'
```

### CI Debugging

1. Check workflow run logs
2. Download artifacts (results.json)
3. Review PR comment for summary
4. Re-run locally with same iteration number

### Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| All assertions fail | API key invalid | Check `ANTHROPIC_API_KEY` |
| Grading errors | Rate limit hit | Retry with backoff |
| Inconsistent results | LLM non-determinism | Add temperature=0 or use programmatic validators |
| Missing evidence | Grader failed to parse | Improve grader prompt |

---

## Next Steps

1. **Test the framework**
   ```bash
   cd evals/runner
   npm install
   export ANTHROPIC_API_KEY=sk-ant-...
   npm run eval -- --skill cloud-service/dispatcher/config-authoring
   ```

2. **Expand test coverage**
   - Add more test cases to existing evals.json
   - Create evals for other dispatcher sub-skills
   - Create evals for non-dispatcher skills

3. **Tune assertions**
   - Review failing assertions
   - Add variant-specific assertions
   - Implement programmatic validators

4. **Enable CI/CD**
   - Add `ANTHROPIC_API_KEY` to GitHub secrets
   - Merge PR to enable workflow
   - Monitor PR comments

---

*For detailed usage instructions, see [README.md](README.md) or [QUICKSTART.md](QUICKSTART.md)*
