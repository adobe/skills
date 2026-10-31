import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cloud = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const roots = [cloud, resolve(cloud, '../../../6.5-lts/skills/dispatcher')];
const specialists = ['config-authoring', 'technical-advisory', 'incident-response', 'performance-tuning', 'security-hardening', 'workflow-orchestrator'];
const read = (path) => readFileSync(path, 'utf8');
const preflight = (text) => {
  const section = text.match(/## Runtime and Availability Preflight\n([\s\S]*?)(?=\n## |$)/);
  assert.ok(section, 'missing inline preflight');
  return section[1];
};

for (const root of roots) {
  const runtime = root === cloud ? 'Cloud' : 'AMS';
  const skills = [root, ...specialists.map((name) => resolve(root, name))];
  test(`${runtime}: every standalone entry guards project runtime and missing tools inline`, () => {
    for (const skill of skills) {
      const guard = preflight(read(resolve(skill, 'SKILL.md')));
      assert.match(guard, /aem-sdk-api.*USE_SOURCES_DIRECTLY/s);
      assert.match(guard, /uber-jar.*ams_default\.vars/s);
      assert.match(guard, /(?:not|never).*AEM_DEPLOYMENT_MODE/);
      assert.match(guard, /(?:wrong-runtime|mismatch).*STOP.*route.*no.*commands/s);
      assert.match(guard, /(?:missing|conflicting).*confirm.*no.*edits/s);
      assert.match(guard, /conceptual.*static.*BLOCKED.*NOT VERIFIED/s);
      assert.match(guard, /(?:each|every).*check.*missing prerequisite/s);
      assert.match(guard, /all.*checklists/is);
      assert.match(guard, /(?:Never|Do not).*fabricat.*substitut/s);
      assert.doesNotMatch(guard, /runtime-and-evidence-guard\.md/);
    }
  });

  test(`${runtime}: core-7 gates remain aligned and distinguish evidence classes`, () => {
    const references = specialists.map((name) => read(resolve(root, name, 'references/dispatcher-foundation/core-7-tools-reference.md')));
    for (const text of references) {
      assert.match(text, /BLOCKED.*NOT VERIFIED/s);
      assert.match(text, /Static.*SDK.*live/s);
      assert.match(text, /repository MCP contract.*not Adobe.*public SDK/s);
      assert.equal(text, references[0]);
    }
  });

  test(`${runtime}: maintained links respect standalone installation boundaries`, () => {
    for (const skill of skills) {
      const files = [resolve(skill, 'SKILL.md')];
      if (skill !== root) {
        files.push(resolve(skill, 'references/dispatcher-foundation/core-7-tools-reference.md'));
        if (root === cloud) files.push(resolve(skill, 'references/dispatcher-foundation/local-sdk-execution.md'));
      }
      for (const file of files) {
        for (const [, href] of read(file).matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
          if (/^(?:https?:|#)/.test(href)) continue;
          const target = resolve(dirname(file), href.split('#')[0]);
          // Preserve only the previously declared cross-skill handoffs.
          const handoff = file === resolve(root, 'workflow-orchestrator/SKILL.md')
            && specialists.some((name) => href === `../${name}/SKILL.md`)
            || file === resolve(root, 'incident-response/SKILL.md')
            && href === '../config-authoring/references/config-authoring/mcp-tool-orchestration.md';
          assert.ok(handoff || !relative(skill, target).startsWith('..'), `${file}: dependency escapes standalone skill: ${href}`);
          assert.ok(existsSync(target), `${file}: missing packaged link ${href}`);
        }
      }
    }
    assert.ok(!existsSync(resolve(root, 'references/runtime-and-evidence-guard.md')), 'unnecessary parent guard retained');
  });
}

test('Cloud SDK startup evidence is not static-only or live proof; copies remain aligned', () => {
  const references = specialists.map((name) => read(resolve(cloud, name, 'references/dispatcher-foundation/local-sdk-execution.md')));
  for (const text of references) {
    assert.doesNotMatch(text, /### 1\. Static Config Test/);
    assert.match(text, /not static-only.*not live request/s);
    assert.equal(text, references[0]);
  }
});
