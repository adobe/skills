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
| Tessl Plugin Lint | `tessl plugin lint` for plugins that have a `.tessl-plugin/plugin.json`. |
| Tessl Skill Review | An LLM review of each changed skill's content, activation and security. A skill must score at least 80%. |
| AI Review | Claude and Codex review the pull request against [AGENTS.md](AGENTS.md) and leave a verdict, a summary and line comments. Drafts are not reviewed. |
| Conventional Commits | At least one commit of the pull request follows [Conventional Commits](https://www.conventionalcommits.org). |
| Adobe CLA | You have signed the CLA. |
| Tessl Skill Eval | Only on request, see below. |

Pull requests from forks: the Tessl review of a pull request whose author is not a member of the Adobe organization or a collaborator of this repository waits for a maintainer to approve the run.

## Requesting Evals

Evals measure whether a skill improves what an agent does: the same task with and without the skill. They run for plugins that have a `.tessl-plugin/plugin.json`, with the scenarios in the plugin's `evals/` directory (`<scenario>/task.md`, `criteria.json`, optional `resources/`).

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

## How Contributions Get Reviewed

This project uses a **commit then review** process: approved maintainers can merge changes to the plugins they own once the checks pass, and others review afterwards. For other contributors, a maintainer of the plugin has to approve the pull request.

A maintainer will look at a pull request within one week. Feedback is given in writing, on GitHub.

## Releases

There is nothing to publish by hand. People install plugins from `main`, so a merged pull request is what they get next.

On every push to `main`, [semantic-release](https://semantic-release.gitbook.io) releases each changed skill that has a `package.json`: it computes the version from the commit messages, writes the skill's `CHANGELOG.md`, and creates a GitHub release with the packaged skill. `feat` is a minor release; `fix`, `perf`, `docs`, `refactor` and `style` are patch releases; a breaking change is a major release.

A plugin with a `.tessl-plugin/plugin.json` is published to the Tessl registry when the `version` in that file changes.
