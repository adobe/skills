// Weighted scoring is done in code so the judge only ever makes binary calls.

/**
 * Normalise a criteria.json into the runner's internal shape { criteria: [{id, weight, description}], total }.
 * Accepts the tessl `weighted_checklist` schema ({ context, type, checklist: [{name, max_score, description}] }),
 * which is what `tessl plugin publish` validates, and the legacy { criteria, total } shape of older run snapshots.
 */
export function normalizeCriteria(raw) {
  if (raw && Array.isArray(raw.checklist)) {
    const criteria = raw.checklist.map((c) => ({ id: c.name, weight: c.max_score, description: c.description }));
    return { criteria, total: criteria.reduce((n, c) => n + c.weight, 0), context: raw.context };
  }
  const criteria = (raw && raw.criteria) || [];
  return { ...raw, criteria, total: raw && raw.total != null ? raw.total : criteria.reduce((n, c) => n + c.weight, 0) };
}

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
