/**
 * Hidden directories hold tooling, not AEM source: `.git`, IDE settings, and
 * agent-skill installs (`.agents/skills`, `.claude/skills`, `.cursor`,
 * `.github`). A skill installed inside the customer's project ships its own
 * eval fixtures (sample legacy projects), which must never be reported as the
 * customer's findings. Every runbook scanner skips these in addition to its
 * own build/vendor list.
 */

'use strict';

function isHiddenDir(name) {
  return name.startsWith('.');
}

module.exports = { isHiddenDir };
