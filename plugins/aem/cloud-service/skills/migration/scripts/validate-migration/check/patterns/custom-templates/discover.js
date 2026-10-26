'use strict';

const { execFileSync } = require('child_process');

const TEMPLATE_PREFIX = /^\/conf\/[a-zA-Z0-9_-]+\/settings\/wcm\/templates\/[a-zA-Z0-9_-]+$/;

// Lists editable template roots in a built content package, optionally narrowed to one path.
function discoverTemplates(artifactPath, selected) {
  const entries = execFileSync('unzip', ['-Z1', artifactPath], { encoding: 'utf8' });
  const templates = [...new Set([...entries.matchAll(/(?:^|\n)(?:jcr_root\/)?(conf\/[^/\s]+\/settings\/wcm\/templates\/[^/\s]+)\/\.content\.xml(?=\n|$)/g)]
    .map((m) => '/' + m[1]))].sort();
  if (selected && !TEMPLATE_PREFIX.test(selected)) throw new Error('Invalid --template: expected /conf/<site>/settings/wcm/templates/<name>');
  return selected ? templates.filter((p) => p === selected) : templates;
}

module.exports = { discoverTemplates };
