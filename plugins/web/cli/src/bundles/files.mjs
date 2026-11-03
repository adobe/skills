import { readdirSync, readFileSync } from 'node:fs';

/** Every non-module file next to this module, by name. The build inlines this table. */
export const FILES = Object.fromEntries(
  readdirSync(new URL('./', import.meta.url))
    .filter((f) => !f.endsWith('.mjs'))
    .sort()
    .map((f) => [f, readFileSync(new URL(f, import.meta.url), 'utf-8')]),
);
