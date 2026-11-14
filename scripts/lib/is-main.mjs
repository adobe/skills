// Whether a module is the script node was started with, and not imported by another one.
// Node resolves symbolic links for import.meta.url but not for process.argv[1], so the two
// are compared as real paths: a script started through a linked directory is still main.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function isMain(moduleUrl) {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}
