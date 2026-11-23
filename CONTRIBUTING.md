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
- Read [AGENTS.md](AGENTS.md): the rules that catch people and agents out, in short. This file has them in full.

## Writing Skills

A skill follows the [Agent Skills specification](https://agentskills.io): a folder with a `SKILL.md` whose frontmatter has `name`, `description` and `license: Apache-2.0`. It lives in a plugin, at `plugins/<plugin>/skills/<skill>/` (AEM, Commerce and Creative Cloud plugins are one level deeper), with optional `references/`, `scripts/` and `assets/` next to it.

### What goes in a skill

- `name` is the directory name. Don't reuse a skill name that another plugin already has: GitHub Copilot CLI exposes skills under their bare name, so two installed plugins with a same-named skill are ambiguous.
- The `description` is what an agent reads to decide whether to load the skill. Say what the skill does and when to use it, in words a user would use. Don't describe a skill so broadly that it loads for tasks it adds nothing to.
- Keep `SKILL.md` short: what a capable agent gets wrong without it, not general practice. Put detail in `references/` and link it by a path that exists. Don't grow a `SKILL.md` past 500 lines.
- The AI review tests that. It asks a small model without tools, files or web access, which has not read the skill, the questions the skill answers. What that model gets right by itself, twice, doesn't belong in a skill: the review names each such line and denies the pull request until the line is gone or cut down to what the model missed. A line that guards an action (see [Security in AGENTS.md](AGENTS.md#security)) is not redundant, whatever the small model knows: it stays.
- Every path, command, flag, tool name and other skill that a skill names must exist. A skill that routes to something that isn't there fails at the worst moment.
- Write for any agent harness unless the plugin says it needs one. Don't name a harness's tools or slash commands where a plain instruction does.
- State facts about Adobe products that you checked against the product or its documentation. Version-specific behaviour says which version.
- A version number in a skill goes stale. Renovate keeps these current in skills and their assets: GitHub Actions written as `owner/repo@version`, jsDelivr and cdnjs URLs, and `npx pkg@1.2.3` or `npm install pkg@1.2.3`. For any other version, put a comment with `renovate: datasource=<datasource> depName=<name>` on the line above it. If a version is pinned on purpose, say why next to it and disable it in `renovate.json`.
- A skill that installs a package of this repository from git (`github:adobe/skills#<sha>&path:/plugins/…`) pins the full commit of a release on `main`: `git rev-list -n 1 <tag>`. Pull requests are squash-merged, so a commit of your branch is never on `main`. Renovate doesn't move these pins: bump them by hand, together with any cache folder named after the commit. `scripts/check-pins.mjs` fails otherwise.
- A plugin that has `evals/` gets a scenario for behaviour you add or change. A claim that a skill helps is a claim an eval can check.

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

### Facts

A plugin may keep a `facts.yaml` that says what its skills know. It is not required. Once a plugin has one, a pull request keeps it true: CI checks it against the tree, and the AI review checks it against the change.

`facts.yaml`, at the plugin's root, lists the facts its skills and evals rely on:

```yaml
- id: block-collection
  claim: >-
    The Block Collection (github.com/adobe/aem-block-collection, blocks/) is
    Adobe's reference set of common blocks.
  question: Where are Adobe's reference implementations of common blocks?
  source: https://www.aem.live/developer/block-collection
  used_by:
    - skills/block-collection-and-party/SKILL.md
```

- `claim` is a fact that can be checked, not advice. What an agent should do stays in the skill.
- `question` is how a user who never saw the skill would ask for it, without the answer in it. The AI review asks it in place of a question of its own.
- `source` is where the claim can be checked: the product's documentation or code, wherever there is one. A fact that no skill states needs a source.
- `used_by` names the files, relative to the plugin, that state or test the fact: a `SKILL.md`, a reference, an eval. A fact with no file goes. A fact whose line left a skill may stay while an eval tests it, so a later model that gets it wrong shows up.

```bash
node scripts/check-facts.mjs     # facts name files that exist
node scripts/skill-quiz.mjs plugins/<your plugin> --changed main...HEAD
```

`skill-quiz.mjs` asks the models and the system prompt of the AI review's baseline the questions of the facts your change touches, twice, and has a model of another vendor grade the answers. A fact one model knew both times is a line the review denies, unless the line guards an action: that stays. It also lists the changed skill files that no fact names: ask about a line with `--ask "<question>"`. It runs on `AWS_BEARER_TOKEN_BEDROCK`, with Claude Code signed in (`--auth-home "$HOME"`), where only Claude models answer, or through [pi](https://pi.dev) with `--pi`, which asks the review's models through GitHub Copilot unless you name others with `--model` and `--judge`.

### Trigger queries

A plugin may keep a set of trigger queries for a skill, `trigger-queries/<skill>.json`: requests a user would write, each saying whether it should make an agent load the skill. It is not required. Once a skill has one, a pull request that changes the skill's `description` keeps the set true, and the AI review reads the two together.

```json
{
  "name": "aem-cli trigger queries",
  "fixture": { "repoUrl": "https://github.com/adobe/aem-boilerplate.git", "ref": "<commit>" },
  "queries": [
    { "id": "y-port-in-use", "query": "aem up says the port is in use. What now?", "should_trigger": true, "skill": "aem-cli" },
    { "id": "n-block-css", "query": "The cards block looks wrong on mobile.", "should_trigger": false, "skill": "aem-cli" }
  ]
}
```

- `should_trigger: true`: the request is what the description says the skill is for. `false`: a near miss, close to it but owned by another skill or by none.
- A query is written as a user would, without the skill's name or the words of its description.
- `fixture` is the repository the agent starts in, as a commit fixture of a scenario.

```bash
node scripts/check-trigger-queries.mjs     # the queries name skills that exist
node scripts/skill-trigger.mjs --plugin plugins/<your plugin> --queries plugins/<your plugin>/trigger-queries/<skill>.json --auth-home "$HOME"
```

`skill-trigger.mjs` runs each query a few times in Claude Code, or in pi with `--client pi`, with the plugin installed, stops each run at the first skill it loads or the first file it writes, and reports which skill loaded. It runs agents and costs what they cost, so run it for the skill whose description you changed. Pickup varies from run to run: compare the old description and the new one on the same queries before you call a change better. CI doesn't run it. Like `skill-eval.mjs`, it lets the agent do whatever you may do on that machine.

## Plugins

`plugins/<plugin>/`, or `plugins/<product>/<plugin>/` for AEM, Commerce and Creative Cloud, is one installable plugin. Its manifest is the root `plugin.json` of [Agent Plugins](https://agent-plugins.org), with `mcp.json` next to it for MCP servers. [x927](https://github.com/ai-ecoverse/x927) generates `.claude-plugin/plugin.json`, `.tessl-plugin/plugin.json`, `.cursor-plugin/plugin.json` and `.mcp.json` from those two. A plugin may also have `hooks/` and `evals/`. `.claude-plugin/marketplace.json` lists the plugins people can install; `README.md` has one row per plugin, and does not list skills.

- A new plugin needs a root `plugin.json`, an entry in `.claude-plugin/marketplace.json`, an entry in `.github/CODEOWNERS` and a row in the plugin table of `README.md`. CI fails without the `plugin.json` or the CODEOWNERS entry.
- A plugin that needs an MCP server says in its row what the server asks of the client, and gets a row in the README's table of MCP servers: which clients it works with, and which not.
- The version of a plugin is the same in every manifest that carries it and in its marketplace entry.
- Edit `plugin.json` and `mcp.json`, not the manifests generated from them, and not the description or version of a marketplace entry. Leave the generated files out of your pull request: after the merge, CI builds them on `main` and pushes them. A pull request that changes a generated file to anything but what the build writes fails. What one client needs beyond the portable fields goes under `extensions["io.github.ai-ecoverse.x927"]` in `plugin.json`: `targets.<client>` for that client's manifest, `marketplace` for the catalog entry.
- A marketplace file is hand-written apart from those two fields. A new plugin gets its entry there by hand, with `name`, `source` and `category`; the build fills in the rest.
- Every plugin is published to the Tessl registry as `adobe/<plugin name>`, so every `plugin.json` has `"tessl": { "name": "adobe/<plugin name>", "private": false }` under `extensions["io.github.ai-ecoverse.x927"].targets`. CI fails without it.
- GitHub Copilot CLI reads the root `plugin.json` in place of the Claude Code manifest, and then loads skills only from the folders directly under `skills/`, and hooks only from `com.github.copilot/hooks/hooks.json`. Claude Code reads hooks from `hooks/hooks.json`. So a plugin with hooks has both files, with the same content, and none inline in a manifest. CI checks that: without its copy, the hook of `adobe-for-developers` that asks before a deletion does not run in Copilot CLI.
- Google Antigravity reads the root `plugin.json` as well (checked with its CLI 1.5.9). It takes hooks only from `hooks.json` at the plugin root and MCP servers only from `mcp_config.json`. The plugins here have neither, so in Antigravity a plugin is its skills, and a hook that guards an action does not run there. It loads the first 24,000 bytes of a `SKILL.md` body and drops the rest.
- A plugin's skills are the folders directly under `skills/`. No client looks below them, so a `SKILL.md` deeper down is a skill nobody can load. Move it up, or make it a reference that its parent skill links.
- Some plugins are brought in from another repository, and these rules are not met there. See the next section.

## Brought in from another repository

Three things here are copies of what their code owners write elsewhere, listed in [`scripts/lib/imported.mjs`](scripts/lib/imported.mjs):

| What | Comes from | Code owners |
|---|---|---|
| The Commerce plugins (`plugins/commerce/`) | [`adobe/aio-commerce-sdk`](https://github.com/adobe/aio-commerce-sdk) | in [CODEOWNERS](.github/CODEOWNERS) |
| `adobe-for-creativity` (`plugins/creative-cloud/adobe-for-creativity/`) | a repository of its owners; the plugin directory of the Claude apps installs it from here | in [CODEOWNERS](.github/CODEOWNERS) |
| The skill of `run-workflow` (`plugins/creative-cloud/run-workflow/skills/`); the plugin around it is ours | a repository of its owners | in [CODEOWNERS](.github/CODEOWNERS) |

They do not meet the rules of this repository, and that is deliberate: their owners decide what is in them, and they coordinate their releases with others. So the rules are pointed out, not enforced:

- **They come as they are.** Each keeps the files its owners bring: a hand-written `.claude-plugin/plugin.json` with its own version, and a Tessl manifest only if they bring one. CI does not build their manifests, set their versions, write their changelogs or publish them to the Tessl registry.
- **The checks of the whole tree leave them out.** A rule they break does not fail anyone else's pull request: the root `plugin.json`, the Tessl target, hooks, `license`, the token and line limits, names and the Tessl lint warnings.
- **The pull request that brings them in fails.** The `imported` check of Validate Skills lists every rule they break, file by file, and fails. A maintainer merges the pull request with that check red. The list is what their owners would have to change where the copy comes from. The checks that say whether a client can use them still apply: the specification (`npm run validate`), `claude plugin validate`, the Plugin Test Drive, which installs them into every client from their Claude Code manifest, and the security rules of [AGENTS.md](AGENTS.md).
- **Only their code owners change them here.** A change made here is overwritten by the next import. A pull request that changes them, opened by anyone else, is closed at once, with a pointer to their owners; so is an issue whose form names one of these plugins. Each is closed once: a maintainer who reopens it has decided to keep it. A pull request that their code owners open is not closed for an unanswered AI review either. When the members of an owning team can't be read, nothing is closed as an import, and the AI review rule applies as to any other pull request.

## Quality Checks

Run the local checks before you open a pull request:

```bash
npm ci
npm run validate                       # every SKILL.md against the agentskills.io specification
node scripts/check-release-configs.mjs # release configs point at files that exist
npm test                               # when you touch scripts/: the workflows run these scripts
node scripts/check-facts.mjs           # when you touch facts.yaml or a file it names
node scripts/check-trigger-queries.mjs # when you touch trigger-queries/ or rename a skill
node scripts/check-pins.mjs            # when a skill installs a package of this repository from git
npm run plugins:check                  # when you touch a plugin.json, mcp.json or a manifest
npm run plugins:build                  # to see what CI will build from them; no need to commit it
npm run lint:stardust                  # when you touch plugins/stardust; after a change to its
                                       # plugin.json, run plugins:build first, as CI does
(cd plugins/web/cli && npm ci && npm run lint && npm test)  # when you touch plugins/web/cli
```

When you add a plugin, a hook or an MCP server, test-drive it as well (below).

CI runs these on every pull request:

| Check | What it does |
|---|---|
| Validate Skills | `npm run validate` checks every `SKILL.md` against the specification. The same workflow checks that every skill has a `license` field, that every plugin has a CODEOWNERS entry, that facts name files that exist (`scripts/check-facts.mjs`), that trigger queries name skills that exist (`scripts/check-trigger-queries.mjs`), that a skill installs this repository's packages only from a release commit on `main` (`scripts/check-pins.mjs`), and runs the tests of the `web` CLI and the lints of `stardust`. |
| Tessl Plugin Lint | `tessl plugin lint` for every plugin. |
| Validate Skills | `imported`: a pull request that changes what is [brought in from another repository](#brought-in-from-another-repository) fails with the list of rules it breaks. A maintainer merges it anyway. |
| Validate Skills | `npm run plugins:check`: the pull request leaves alone the files that `x927` generates from each plugin's root `plugin.json` and `mcp.json` (the Claude Code, Tessl and Cursor manifests, `.mcp.json`, and the description and version of marketplace entries). Change `plugin.json`; after the merge, the Release workflow builds the generated files on `main` and pushes them. |
| Tessl Skill Review | An LLM review of each changed skill's content, activation and security. A skill must score at least 80%. |
| Plugin Test Drive | Installs each changed plugin into Claude Code, Codex, Grok and Google Antigravity, each with an empty home directory, and reports the skills, MCP servers and hooks the client then lists. It fails when a client can't install the plugin or loads fewer skills than the plugin has. No sign-in and no model is involved. |
| AI Review | Claude and Codex review the pull request against [AGENTS.md](AGENTS.md) and this file, and leave a verdict, a summary and line comments. They get the result of the test drive, and can run a task in an agent with the plugin and without it to see what a changed skill does. Drafts are not reviewed. |
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
- It evaluates the plugins the pull request changes, a new plugin included. A change under `plugins/` that belongs to no plugin, or to `scripts/tessl-eval.mjs` or its workflow, evaluates every plugin with scenarios.
- A commit fixture from another repository names it in `repoUrl`. The Tessl CLI packs commit fixtures from the local repository, so the job fetches that commit first.

## How to Contribute

1. Fork the repository. Maintainers can push a branch to this repository instead.
2. Make your changes on a branch.
3. Open a pull request and fill in the template.

The title of the pull request is a conventional commit with the plugin as its scope, for example `fix(stardust): …` or `feat(aem-cloud-service): …`. Pull requests are squash-merged, so the title becomes the commit message, and the commit message decides what is released.

Keep a pull request to one plugin where you can. It is reviewed by the owners of that plugin.

### Without scenarios

A plugin without scenarios is still run. The AI reviewers write a task of their own, aimed at what the pull request changes in a skill, and run it in an agent with the plugin and without it. The summary of the review says which task they ran and what the two runs did. You can do the same with the client you are signed in to:

```bash
node scripts/skill-eval.mjs --client claude --plugin plugins/<your plugin> \
  --prompt "<a task, as a user would put it>" --auth-home "$HOME"
```

It prints both answers and the files each run wrote or removed. `--scenario plugins/<your plugin>/evals/<name>` takes the task of a scenario and adds its criteria to the result. With [pi](https://pi.dev) signed in, `--client pi --auth-home "$HOME"` runs the same with the providers you have there (default model `github-copilot/claude-opus-5.5`; pick another with `--model`). For `claude` and `pi`, the result also names the skills each run loaded. The agent of such a run may do whatever you may do on that machine: run it for plugins you trust.

## Merge Policy

This project uses a **commit then review** process: the code owners of a plugin can merge changes to it once the checks pass, and others review afterwards. For other contributors, a code owner of the plugin has to approve the pull request. The code owners of each path are in [CODEOWNERS](.github/CODEOWNERS); the maintainers are the owners of `/.github/` there.

- **Drafts are not merged.** Not by a code owner, not by a maintainer. A draft is yours to work on, and the AI review skips it: mark it ready for review when it is.
- **Contributions are written by agents, unless they say otherwise.** A pull request is taken to be an agent's unless it has the `human` label. Set it when a person wrote the change. If you can't set labels, say so in the description and a maintainer will add it.
- **An agent answers its review within 24 hours.** The AI review leaves a verdict for each reviewer and comments on lines. On an agent's pull request, each denial and each line comment is answered within 24 hours of the review: push a fix, or reply where you disagree, on the line for a line comment and on the pull request for a denial. After that the pull request is closed. Push the fix and reopen it, or open a new one: that runs the review again, and starts the 24 hours again. Marking a draft ready for review starts them again too.
- **Code owners act within a week.** Within a week of a pull request being opened, reopened or marked ready for review, one of its code owners reviews it, comments on it, pushes to it, merges it or closes it, and again within a week of the last time one did. Otherwise the pull request gets the `takeover` label.
- **Then maintainers take over.** A maintainer may close, merge or change a pull request with the `takeover` label, without waiting for its code owners. The label goes when a code owner acts on it again.

The [Merge Policy workflow](.github/workflows/merge-policy.yml) applies the last three rules every hour: it closes overdue pull requests and sets the `takeover` label, each with a comment that says why, and removes the label when an owner acts. It also closes pull requests and issues about what is [brought in from another repository](#brought-in-from-another-repository) that are not its code owners'. It leaves drafts and the pull requests of bots (Renovate, the release) alone. For pull requests that were open when the policy started, the 24 hours and the week count from 17 November 2026. To see what it would do:

```bash
GH_TOKEN=… node scripts/pr-policy.mjs    # --pr <number> for one pull request, --now <date> for later, --apply to act
```

A line comment counts as answered when it is resolved, when a change to its line made it outdated, or when a person replied to it. An owner's push counts when GitHub saw it, a force push included. Feedback is given in writing, on GitHub.

## Releases

There is nothing to publish by hand. People install plugins from `main`, so a merged pull request is what they get next.

On every push to `main`, [semantic-release](https://semantic-release.gitbook.io) computes versions from the commit messages. `feat` is a minor release; `fix`, `perf`, `docs`, `refactor` and `style` are patch releases; a breaking change is a major release. Nobody sets a version by hand, and a pull request that changes one fails.

- **Skills.** Each changed skill is released: its version goes into `metadata.version` of its `SKILL.md`, its `CHANGELOG.md` is written, and a GitHub release with the packaged skill is created, tagged `<skill>-v<version>`. A skill needs no release files of its own.
- **Plugins.** Each changed plugin that has a root `plugin.json` is released as well, also when only one of its skills changed: its version goes into `plugin.json`, the manifests and the marketplace entry are built from that, and the release is tagged `plugin/<name>/v<version>`. Claude Code keeps an installed plugin at its version until the version changes, so this is what brings a merged change to the people who installed it. Its `CHANGELOG.md` is written as well, with one line for each pull request since the last release: the title, linked. Don't edit a `CHANGELOG.md` in a pull request; the check that guards the versions fails that too.
- **Not released here:** what is [brought in from another repository](#brought-in-from-another-repository), which keeps the versions it has there; and a skill whose folder name another skill has.

Every plugin of ours is published to the Tessl registry, as `adobe/<plugin name>`, when the `version` in its Tessl manifest changes: with every release of the plugin. That is why every `plugin.json` has a Tessl target; CI fails without it. A plugin brought in from another repository is published only when it brings a Tessl manifest of its own, when that manifest's version changes. A publish that times out is tried again, and a version that is already on the registry is not an error, so a failed Release job can be run again. When the Tessl organization has run out of credits, the publish is skipped with a warning, not failed: the release on GitHub stands, and running the job again once there are credits publishes what was skipped. Tessl accepts an upload first and runs its own publication checks afterwards: a version is on the registry only when those pass. The job prints what the registry says about each version at its end.

The Release workflow pushes to `main` with its own token: the rebuilt manifests, and the release commits. A ruleset or a branch protection on `main` has to let GitHub Actions bypass it. Without that, the workflow fails at its first push and says so, and nothing is released or published.
