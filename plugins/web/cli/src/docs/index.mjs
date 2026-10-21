import { FILES } from '#src/docs/files.mjs';

/** Topic names: every `.md` file in this directory, without the extension. */
export const listDocs = () => Object.keys(FILES).map((f) => f.replace(/\.md$/, ''));

/**
 * Read a documentation topic; null when unknown.
 * @param {string} topic
 * @returns {string | null}
 */
export const loadDoc = (topic) => FILES[`${topic}.md`] ?? null;
