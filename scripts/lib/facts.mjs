// The facts a plugin may keep next to its skills, to show what they tell an agent that a
// model doesn't know:
//
//   <plugin>/facts.yaml                 a list of facts, each with
//     id        unique in the file
//     claim     the fact: something that can be checked, not advice
//     question  how a user who never saw the skill would ask for it, without the answer
//     source    where it can be checked: a page of the product's documentation, its code
//     used_by   the files, relative to the plugin, that state or test it: a SKILL.md, a
//               reference, an eval
//
// The file is YAML, read with js-yaml; what it holds is checked here, so a key or a value
// of the wrong kind is an error, not a guess.
import { CORE_SCHEMA, loadAll } from 'js-yaml';

export const FACT_KEYS = ['id', 'claim', 'question', 'source', 'used_by'];
const REQUIRED = ['id', 'claim', 'question'];

export function parseFacts(text, name = 'facts.yaml') {
  let data;
  try {
    // loadAll, not load: since js-yaml 5, load throws on a file with no document, such as
    // one that is empty or only comments, and that file has no facts.
    const documents = loadAll(text, { filename: name, schema: CORE_SCHEMA });
    if (documents.length > 1) throw new Error('one document, not several');
    [data] = documents;
  } catch (error) {
    throw new Error(`${name}: ${error.message}`);
  }
  if (data === undefined || data === null) return [];
  if (!Array.isArray(data)) throw new Error(`${name}: a list of facts, each starting with "- id:"`);
  const ids = new Set();
  return data.map((entry, index) => {
    const at = `${name}: fact ${index + 1} (${entry?.id ?? 'no id'})`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`${at}: not a mapping of keys`);
    for (const key of Object.keys(entry)) if (!FACT_KEYS.includes(key)) throw new Error(`${at}: unknown key ${key}; a fact has ${FACT_KEYS.join(', ')}`);
    for (const key of REQUIRED) if (typeof entry[key] !== 'string' || !entry[key].trim()) throw new Error(`${at}: has no ${key}`);
    if (entry.source !== undefined && entry.source !== null && typeof entry.source !== 'string') throw new Error(`${at}: source is text`);
    const usedBy = entry.used_by ?? [];
    if (!Array.isArray(usedBy) || usedBy.some((path) => typeof path !== 'string')) throw new Error(`${at}: used_by is a list of paths`);
    if (ids.has(entry.id)) throw new Error(`${name}: the id ${entry.id} twice`);
    ids.add(entry.id);
    return {
      id: entry.id,
      claim: entry.claim,
      question: entry.question,
      ...(typeof entry.source === 'string' ? { source: entry.source } : {}),
      used_by: usedBy,
    };
  });
}
