# Contributing to Adobe Skills for AI Coding Agents

This project is an Open Development/Inner Source project and welcomes contributions from everyone who finds it useful or lacking.

## Code Of Conduct

This project adheres to the Adobe [code of conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to cstaub at adobe dot com.

## Community

Have questions, want feedback on a skill, or need a review? Reach out on [#agentskills](https://adobe.enterprise.slack.com/archives/C0APTKDNPEY) on Slack.

For background on the skills format and specification, see [agentskills.io](https://agentskills.io) and the [agentskills GitHub org](https://github.com/agentskills/agentskills).

## Contributor License Agreement

All third-party contributions to this project must be accompanied by a signed contributor license. This gives Adobe permission to redistribute your contributions as part of the project. [Sign our CLA](http://opensource.adobe.com/cla.html)! You only need to submit an Adobe CLA one time, so if you have submitted one previously, you are good to go!

## Things to Keep in Mind

This project uses a **commit then review** process, which means that for approved maintainers, changes can be merged immediately, but will be reviewed by others.

For other contributors, a maintainer of the project has to approve the pull request.

# Before You Contribute

* Check that there is an existing issue in GitHub issues
* Check if there are other pull requests that might overlap or conflict with your intended contribution

## Writing Skills

To contribute a new skill, follow the format described in the [Agent Skills specification](https://agentskills.io). When your skill is ready, open a pull request and ping [#agentskills](https://adobe.enterprise.slack.com/archives/C0APTKDNPEY) on Slack to get a review.

## Quality Checks

PRs go through three tiers of quality checks:

1. **Validation** (`npm run validate`) — checks skill structure against the [agentskills.io](https://agentskills.io) spec. Runs automatically on every PR.

2. **Tessl Skill Review** (`tessl skill review`) — LLM-based scoring of content quality, activation quality, and security. Runs automatically on every PR for changed skills. Must score at least 50%.

3. **Tessl Evals** (`tessl eval run`) — end-to-end agent evaluation that measures whether the skill actually improves agent behavior. Runs only when explicitly requested and only for skills that include a `tile.json`.

## Requesting Evals

To trigger evals, push an empty commit with an `eval:` prefix:

```bash
git commit --allow-empty -m "eval: describe what you're testing"
git push
```

Things to know:

- Evals only run for skills that have a `tile.json` in their tile directory
- Evals require the `TESSL_TOKEN` GitHub Actions secret
- GitHub Actions secrets are not available to PRs from forks, so external contributors cannot run evals directly
- If you need evals for a fork-based PR, ask a maintainer to run them from a branch in the main repo
- Evals take several minutes per skill — be patient
- Results appear in the GitHub Actions step summary
- Evals measure the "impact score" — the gap between agent performance with vs. without the skill

# How to Contribute

1. Fork the repository
2. Make some changes on a branch on your fork
3. Create a pull request from your branch

In your pull request, outline:

* What the changes intend
* How they change the existing code
* If (and what) they breaks
* Start the pull request with the GitHub issue ID, e.g. #123

Lastly, please follow the [pull request template](.github/pull_request_template.md) when submitting a pull request!

## AI-Generated Contributions

If your pull request contains code that was generated or co-authored by AI tools (such as GitHub Copilot, ChatGPT, Claude, or similar), you must apply the `ai-generated` label to your pull request.

This helps maintainers understand the context of contributions and ensures appropriate review processes.

Each commit message that is not part of a pull request:

* Should contain the issue ID like `#123`
* Can contain the tag `[trivial]` for trivial changes that don't relate to an issue



## Coding Styleguides

We enforce a coding styleguide using `eslint`. As part of your build, run `npm run lint` to check if your code is conforming to the style guide. We do the same for every PR in our CI, so PRs will get rejected if they don't follow the style guide.

You can fix some of the issues automatically by running `npx eslint . --fix`.

## Commit Message Format

This project uses a structured commit changelog format that should be used for every commit. Use `npm run commit` instead of your usual `git commit` to generate commit messages using a wizard.

```bash
# either add all changed files
$ git add -A
# or selectively add files
$ git add package.json
# then commit using the wizard
$ npm run commit
```

# How Contributions get Reviewed

One of the maintainers will look at the pull request within one week. Feedback on the pull request will be given in writing, in GitHub.

# Release Management

The project's committers will release to the [Adobe organization on npmjs.org](https://www.npmjs.com/org/adobe).
Please contact the [Adobe Open Source Advisory Board](https://git.corp.adobe.com/OpenSourceAdvisoryBoard/discuss/issues) to get access to the npmjs organization.

The release process is fully automated using `semantic-release`, increasing the version numbers, etc. based on the contents of the commit messages found.
