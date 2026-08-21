// Weighted scoring is done in code so the judge only ever makes binary calls.

export function computeScore(criteria, verdicts) {
  const byId = new Map(verdicts.map((v) => [v.id, v]));
  const perCriterion = criteria.criteria.map((c) => {
    const v = byId.get(c.id);
    return {
      id: c.id,
      weight: c.weight,
      pass: v ? Boolean(v.pass) : null, // null = judge failed to rule
      evidence: v?.evidence ?? "(no verdict returned)",
    };
  });
  const missing = perCriterion.filter((c) => c.pass === null).map((c) => c.id);
  const score = perCriterion.reduce((s, c) => s + (c.pass ? c.weight : 0), 0);
  const extraneous = verdicts
    .filter((v) => !criteria.criteria.some((c) => c.id === v.id))
    .map((v) => v.id);
  return { score, total: criteria.total, perCriterion, missing, extraneous };
}
