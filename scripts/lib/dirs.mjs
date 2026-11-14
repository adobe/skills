// The directories a step works on come from a file, one per line, as changed.mjs prints
// them. Names never pass through a shell or a workflow expression.
import { readFileSync } from 'node:fs';

export function readDirs(file) {
  if (!file) throw new Error('a file with one directory per line is required');
  return readFileSync(file, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean);
}
