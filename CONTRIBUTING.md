# Contributing to Adobe Skills for AI Coding Agents

This project is an Open Development/Inner Source project and welcomes contributions from everyone who finds it useful or lacking.

## Code of Conduct

This project adheres to the Adobe [code of conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to cstaub at adobe dot com.

## Community

Have questions, want feedback on a skill, or need a review? Adobe employees can reach out on [#agentskills](https://adobe.enterprise.slack.com/archives/C0APTKDNPEY) on Slack. Everyone else, please [open an issue](https://github.com/adobe/skills/issues/new/choose).

For background on the skills format, see [agentskills.io](https://agentskills.io) and the [agentskills GitHub org](https://github.com/agentskills/agentskills).

## Contributor License Agreement

All third-party contributions to this project must be accompanied by a signed contributor license. This gives Adobe permission to redistribute your contributions as part of the project. [Sign our CLA](http://opensource.adobe.com/cla.html)! You only need to submit an Adobe CLA one time, so if you have submitted one previously, you are good to go!

## Security

Don't open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).

## Before You Contribute

- Check the [open issues](https://github.com/adobe/skills/issues) and [pull requests](https://github.com/adobe/skills/pulls) for work that overlaps with yours.
- For a new plugin, or a change that spans plugins, open an issue first and describe what you plan. The owners of the area are in [CODEOWNERS](.github/CODEOWNERS).
- Read [AGENTS.md](AGENTS.md). It holds the rules for skills, plugins and pull requests, for people and for coding agents alike.

## Writing Skills

A skill follows the [Agent Skills specification](https://agentskills.io): a folder with a `SKILL.md` whose frontmatter has `name`, `description` and `license: Apache-2.0`. It lives in a plugin, at `plugins/<plugin>/skills/<skill>/` (AEM, Commerce and Creative Cloud plugins are one level deeper). [AGENTS.md](AGENTS.md) says what makes a skill good and what a new plugin needs.

### How long a skill may be

What a `SKILL.md` says is put into the context of every session that loads the skill. So its length has a limit, counted in tokens of four characters each:

| The skill has | Limit for its `SKILL.md` |
| --- | --- |
| An eval | 5,000 tokens, which the [Agent Skills specification](https://agentskills.io/specification) recommends as the most |
| No eval | 1,000 tokens, about 60 lines |

Without an eval nobody has shown that what a skill says changes what an agent does, so it gets a page. An eval of a skill is one of these:

- `skills/<skill>/evals/evals.json`, with at least one entry that has a `prompt` and an `expected_output`, `assertions` or `expectations`.
- A scenario of the plugin, `evals/<scenario>/` with `task.md` and `criteria.json`, whose folder is named after the skill: `<skill>` or `<skill>-<what it tests>`. The folder name is how a scenario says which skill it tests.
- Any scenario of the plugin, when the plugin has only this one skill.

`references/` are not counted: an agent reads them when it needs them.

```bash
node scripts/check-skills.mjs --tokens plugins/<your plugin>   # each skill's tokens, limit and eval
```

Many skills are over their limit today. Nobody has to fix a skill they don't touch: the `boy-scout` check fails a pull request only when it changes a `SKILL.md` that is over its limit, also when it adds one. Then the fix comes with the change: an eval, or a shorter `SKILL.md` with the detail in `references/`.

## Quality Checks

Run the local checks before you open a pull request:

```bash
npm ci
npm run validate
node scripts/check-release-configs.mjs
```

CI runs these on every pull request:

| Check | What it does |
|---|---|
| Validate Skills | `npm run validate` checks every `SKILL.md` against the specification. The same workflow checks that every skill has a `license` field, that every plugin has a CODEOWNERS entry, and runs the tests of the `web` CLI and the lints of `stardust`. |
| Tessl Plugin Lint | `tessl plugin lint` for every plugin. |
| Validate Skills | `npm run plugins:check`: the pull request leaves alone the files that `x927` generates from each plugin's root `plugin.json` and `mcp.json` (the Claude Code, Tessl and Cursor manifests, `.mcp.json`, and the description and version of marketplace entries). Change `plugin.json`; after the merge, the Release workflow builds the generated files on `main` and pushes them. |
| Tessl Skill Review | An LLM review of each changed skill's content, activation and security. A skill must score at least 80%. |
| Plugin Test Drive | Installs each changed plugin into Claude Code, Codex, Grok and Google Antigravity, each with an empty home directory, and reports the skills, MCP servers and hooks the client then lists. It fails when a client can't install the plugin or loads fewer skills than the plugin has. No sign-in and no model is involved. |
| AI Review | Claude and Codex review the pull request against [AGENTS.md](AGENTS.md) and leave a verdict, a summary and line comments. They get the result of the test drive, and can run a task in an agent with the plugin and without it to see what a changed skill does. Drafts are not reviewed. |
| Conventional Commits | At least one commit of the pull request follows [Conventional Commits](https://www.conventionalcommits.org). |
| Adobe CLA | You have signed the CLA. |
| Tessl Skill Eval | Only on request, see below. |

To test-drive a plugin on your machine (about 600 MB of CLIs, in `.agent-clis/` and `scripts/agent-clis/node_modules/`, both ignored by git):

```bash
npm ci
node scripts/setup-agent-clis.mjs     # claude, codex, grok and agy, at the versions CI uses
node scripts/test-drive.mjs --build plugins/<your plugin>
```

`--build` builds the manifests the clients read from your `plugin.json`, and puts those files back afterwards: they are not part of a pull request.

Pull requests from forks: the Tessl review of a pull request whose author has no write access to this repository waits for a maintainer to approve the run.

## Requesting Evals

Evals measure whether a skill improves what an agent does: the same task with and without the skill. They run for plugins that have scenarios in their `evals/` directory (`<scenario>/task.md`, `criteria.json`, optional `resources/`).

To request a run, push an empty commit whose message starts with `eval:`:

```bash
git commit --allow-empty -m "eval: describe what you're testing"
git push
```

- The run starts as soon as the commit is pushed. Nobody has to approve it.
- Secrets are not available to pull requests from forks. Ask a maintainer to run the evals from a branch in this repository.
- A run takes several minutes per plugin. The results are linked in a comment on the pull request.

## How to Contribute

1. Fork the repository. Maintainers can push a branch to this repository instead.
2. Make your changes on a branch.
3. Open a pull request and fill in the template.

The title of the pull request is a conventional commit with the plugin as its scope, for example `fix(stardust): …` or `feat(aem-cloud-service): …`. Pull requests are squash-merged, so the title becomes the commit message, and the commit message decides what is released.

Keep a pull request to one plugin where you can. It is reviewed by the owners of that plugin.

### AI-Generated Contributions

If your pull request contains code or text that was generated or co-authored by AI tools (such as GitHub Copilot, ChatGPT, Claude, or similar), apply the `ai-generated` label to it. If you can't set labels, say so in the description and a maintainer will add it.

### Without scenarios

A plugin without scenarios is still run. The AI reviewers write a task of their own, aimed at what the pull request changes in a skill, and run it in an agent with the plugin and without it. The summary of the review says which task they ran and what the two runs did. You can do the same with the client you are signed in to:

```bash
node scripts/skill-eval.mjs --client claude --plugin plugins/<your plugin> \
  --prompt "<a task, as a user would put it>" --auth-home "$HOME"
```

It prints both answers and the files each run wrote or removed. `--scenario plugins/<your plugin>/evals/<name>` takes the task of a scenario and adds its criteria to the result. The agent of such a run may do whatever you may do on that machine: run it for plugins you trust.

## How Contributions Get Reviewed

This project uses a **commit then review** process: approved maintainers can merge changes to the plugins they own once the checks pass, and others review afterwards. For other contributors, a maintainer of the plugin has to approve the pull request.

A maintainer will look at a pull request within one week. Feedback is given in writing, on GitHub.

## Releases

There is nothing to publish by hand. People install plugins from `main`, so a merged pull request is what they get next.

On every push to `main`, [semantic-release](https://semantic-release.gitbook.io) computes versions from the commit messages. `feat` is a minor release; `fix`, `perf`, `docs`, `refactor` and `style` are patch releases; a breaking change is a major release. Nobody sets a version by hand, and a pull request that changes one fails.

- **Skills.** Each changed skill is released: its version goes into `metadata.version` of its `SKILL.md`, its `CHANGELOG.md` is written, and a GitHub release with the packaged skill is created, tagged `<skill>-v<version>`. A skill needs no release files of its own.
- **Plugins.** Each changed plugin that has a root `plugin.json` is released as well, also when only one of its skills changed: its version goes into `plugin.json`, the manifests and the marketplace entry are built from that, and the release is tagged `plugin/<name>/v<version>`. Claude Code keeps an installed plugin at its version until the version changes, so this is what brings a merged change to the people who installed it. In a `CHANGELOG.md` that a plugin's owners write by hand, put the entry under `## Unreleased`; the release renames that heading to the version.
- **Not released here:** skills and plugins brought in from another repository (the Commerce plugins, `adobe-for-creativity`, the `run-workflow` skill), which keep the versions they have there; and a skill whose folder name another skill has.

Every plugin is published to the Tessl registry, as `adobe/<plugin name>`, when the `version` in its Tessl manifest changes: with every release of the plugin, and when a plugin that is brought in from another repository comes with a new version. That is why every `plugin.json` has a Tessl target; CI fails without it. A publish that times out is tried again, and a version that is already on the registry is not an error, so a failed Release job can be run again. Tessl accepts an upload first and runs its own publication checks afterwards: a version is on the registry only when those pass. The job prints what the registry says about each version at its end.

The Release workflow pushes to `main` with its own token: the rebuilt manifests, and the release commits. A ruleset or a branch protection on `main` has to let GitHub Actions bypass it. Without that, the workflow fails at its first push and says so, and nothing is released or published.
