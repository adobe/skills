/**
 * skills/stardust/scripts/lib/resolve.mjs — find a sibling skill's script from either layout. Library: no I/O at import
 * (the file-system probes run when a function is called). Reached through ../contracts.mjs.
 *
 * Layouts (README.md § Layout): the plugin tree keeps this file at `skills/stardust/scripts/lib/` and a skill's scripts
 * at `skills/<skill>/scripts/`; a project copy keeps the master's scripts at `stardust/scripts/stardust/` (Setup step 7,
 * so this file at `stardust/scripts/stardust/lib/`) and each skill at `stardust/scripts/<skill>/`. The file's own
 * location tells which layout it is in, so a consumer never carries a candidate list for a sibling. Owns the layout
 * knowledge; replaces spec lib.mjs loadSibling's lookup and the replica gate scripts' own lists.
 *
 *   layout()               'plugin' | 'project'
 *   siblingPath(skill, f)  absolute path of skills/<skill>/scripts/<f> (plugin) or stardust/scripts/<skill>/<f> (project); null when absent
 *   sibling(skill, f)      its file: URL for `import()`; throws naming both looked-up places and the copy that fixes it
 *   loadSibling(skill, f)  `import(sibling(skill, f))`
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const LIB_DIR = dirname(fileURLToPath(import.meta.url));
const PLUGIN_SKILLS = resolve(LIB_DIR, '..', '..', '..'); // skills/            (plugin tree)
const PROJECT_SCRIPTS = resolve(LIB_DIR, '..', '..');     // stardust/scripts/  (project copy)

/** Which layout this file sits in: the plugin tree has the master SKILL.md beside its scripts dir. */
export const layout = () => (existsSync(join(PLUGIN_SKILLS, 'stardust', 'SKILL.md')) ? 'plugin' : 'project');

/** The two places a sibling skill's script can be, in lookup order. */
export const siblingCandidates = (skill, file) => [join(PLUGIN_SKILLS, skill, 'scripts', file), join(PROJECT_SCRIPTS, skill, file)];

/** Absolute path of `<skill>/scripts/<file>` in whichever layout holds it; null when neither does. */
export const siblingPath = (skill, file) => siblingCandidates(skill, file).find((p) => existsSync(p)) || null;

/** Import URL of a sibling skill's script; throws a message that names the fix when it is missing. */
export function sibling(skill, file) {
  const p = siblingPath(skill, file);
  if (!p) {
    throw new Error(`${skill}/${file} not found (looked in ${siblingCandidates(skill, file).join(' and ')}): copy the ${skill} skill's scripts dir to stardust/scripts/${skill}/ next to these`);
  }
  return pathToFileURL(p).href;
}

/** `import()` of a sibling skill's script. */
export const loadSibling = (skill, file) => import(sibling(skill, file));
