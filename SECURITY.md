# Security

## Reporting an Issue

Please don't report a vulnerability in a public issue, pull request or discussion.

Report it to Adobe as described in [Notifying Adobe of Security Issues](https://helpx.adobe.com/security/alertus.html). Name this repository and the plugin and skill the report is about.

For Adobe's disclosure policy, see the [Vulnerability Disclosure Program Policy](https://helpx.adobe.com/security/policy.html).

## What Counts Here

Skills are instructions and scripts that an AI agent follows with the user's credentials, on the user's machine. Beyond the usual (leaked secrets, vulnerable dependencies, unsafe scripts), these are security issues in this repository:

- A skill that tells an agent to run downloaded code, for example an installer piped into a shell.
- A hook or script that guards an action and lets the action through when the guard can't run.
- A skill that tells the user to approve destructive, paid or externally visible actions once and for all.
- A skill that makes an agent follow instructions found in content it fetches (prompt injection).
- A skill that sends data somewhere the user wouldn't expect.

A skill that is wrong but harmless, such as a broken reference or an outdated API, is a bug: [open an issue](https://github.com/adobe/skills/issues/new/choose).
