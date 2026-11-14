/** A cell passes when the model meets the skill's floor for that skill or case. */
export function meetsFloor(_output, { providerResponse }) {
  const m = providerResponse.metadata;
  if (!m?.ran) return { pass: false, score: 0, reason: 'model not run on this skill' };
  const rate = Math.round(m.rate * 100);
  return { pass: m.meets, score: m.rate, reason: `${rate}% of runs within the floor (needs ${Math.round(m.floor * 100)}%)` };
}
