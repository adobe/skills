/**
 * No-skill arm only: the run is valid only if Pi had no skills loaded and the agent never read a
 * skill from disk (skills are installed on this machine under ~/.claude/skills and ~/.agents/skills).
 * Listing a skills directory is fine, it reveals no method; opening anything inside one is a leak,
 * reported as a failure so it can never inflate the arm's results.
 */
export function noSkillAvailable(_output, { providerResponse }) {
  const m = providerResponse.metadata ?? {};
  if ((m.loadedSkills ?? []).length > 0) return { pass: false, score: 0, reason: `skills were loaded: ${m.loadedSkills.map((s) => s.name).join(', ')}` };
  const touched = (m.toolCalls ?? [])
    .map((c) => String(c.input?.command ?? c.input?.path ?? ''))
    // Skill directories only: this repo is itself named `skills`, so a bare `skills/` match
    // would flag every path inside the checkout (fixtures, node_modules).
    .filter((text) => /SKILL\.md|(\.claude|\.agents|\.pi\/agent)\/skills\/[\w.-]+|plugins\/web\/skills\/[\w.-]+/.test(text));
  return touched.length
    ? { pass: false, score: 0, reason: `agent read a skill from disk: ${touched[0].slice(0, 120)}` }
    : { pass: true, score: 1, reason: 'no skills loaded or read' };
}
