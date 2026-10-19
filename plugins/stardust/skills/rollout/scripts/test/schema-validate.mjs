// skills/rollout/scripts/test/schema-validate.mjs — test helper over lib.mjs's structural JSON Schema check
// (validateSchema / schemaUnsupported: the keyword subset the rollout schemas use; done-check.mjs runs the same
// check at the end of a run as the export_quality:schema lines).
//
//   validate(schema, value, { root } = {}) -> string[]   '<json path>: <problem>' lines, empty when valid; pass
//     `{ root }` to validate against a sub-schema such as `{ $ref: '#/$defs/row' }` or `schema.$defs.gate`.
//   unsupported(schema) -> string[]   keywords outside that subset ('<pointer>: <keyword>'); a schema using one
//     would be silently under-checked.
//   loadSchema(name) -> object        parses ../../schemas/<name>, e.g. 'rollout-pages.schema.json'.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSchema, schemaUnsupported } from '../lib.mjs';

const SCHEMAS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'schemas');

export const validate = validateSchema;
export const unsupported = schemaUnsupported;

export function loadSchema(name) {
  return JSON.parse(readFileSync(join(SCHEMAS, name), 'utf8'));
}
