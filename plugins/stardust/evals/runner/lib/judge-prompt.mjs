// The judge gets binary calls only; weights and scoring live in score.mjs.

export function buildJudgePrompt({ evalName, taskMd, criteria, runPath }) {
  const criteriaList = criteria.criteria
    .map((c) => `- id: ${c.id}\n  description: ${c.description}`)
    .join("\n");

  return `You are grading one run of the agent eval "${evalName}".

Everything you need is under this run directory (your working directory):
- session.md — condensed session log (assistant text, tool calls, Q&A)
- transcript.jsonl — the raw message stream; consult it only when session.md
  is ambiguous or truncated (grep for the relevant part, do not read it whole)
- workspace/ — the project state the session left behind; inspect files
  directly to verify artifact criteria

The eval's scenario specification (task.md), for context:

<task>
${taskMd}
</task>

Grade each criterion below as a BINARY pass/fail against what actually
happened in this run. Rules:
- Judge only what the criterion states. Do not award partial credit, do not
  penalize behavior a criterion doesn't mention.
- "pass" requires positive evidence in the session log or workspace. If you
  cannot find evidence either way, that is a fail — note "no evidence found".
- For artifact criteria (files, schemas, sections), open the actual files in
  workspace/ rather than trusting the transcript's claims about them.
- Evidence must be concrete and verifiable: a short quote from session.md, or
  a file path (plus line/section) in workspace/.

Criteria:
${criteriaList}

When you are done, write your verdicts to verdicts.json in the current
directory (use the Write tool) with exactly this shape, one entry per
criterion id above, then stop:

{
  "verdicts": [
    { "id": "<criterion id>", "pass": true|false, "evidence": "<one or two sentences>" }
  ]
}`;
}
