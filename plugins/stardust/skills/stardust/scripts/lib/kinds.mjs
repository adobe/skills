/**
 * skills/stardust/scripts/lib/kinds.mjs — the kinds of a unit of UI and of a delivered document, as each skill names them.
 * Pure library: no I/O, nothing runs on import. Reached through ../contracts.mjs (README.md § Layout).
 *
 * Owns (and replaces): rollout lib.mjs CHROME_IDS / kindOf / DEFAULT_CONTENT, rollout delivery-lint.mjs inferType
 * (documentKind), spec lib.mjs CODED and genericRules CHROME, deploy ai-readability.mjs isChrome and its --exclude-blocks
 * default (qa's too), deploy davids-model-lint.mjs KEY_VALUE_BLOCKS, qa lib.mjs's default fragments, qa content/templates'
 * metadata pair. The kind enums of spec-map.mjs, spec-knowledge's catalog, the rollout blocks schema and dynamics-plan's
 * target column are recorded here but still literal where they are written (scripts/test/contracts-characterize.test.mjs
 * pins each copy).
 *
 * The vocabulary is NOT unified here (plan § Tier C, out of scope): rollout `chrome` = spec `global` = deploy `fragment`
 * stay three names; the enums are exported as they are so each consumer keeps its contract. The sets that disagree
 * today stay separate constants: CHROME_IDS (rollout, spec: header/nav/footer) vs QA_CHROME_PATHS (qa's default
 * fragment list and delivery-lint's fragment paths: /nav, /footer — no header) vs isChromeName({ menu: true })
 * (ai-readability: any path segment starting with nav/header/footer/menu).
 */

/** Spec: the kinds a component maps to that need code (a block, a dynamic block, a widget). */
export const CODED = new Set(['block', 'dynamic', 'widget']);

/** Chrome ids deliver as site-wide authored documents (/nav, /footer), not per-page blocks (rollout kindOf, spec CHROME). */
export const CHROME_IDS = new Set(['header', 'nav', 'footer']);
/** rollout: a block id's kind — chrome or module (section and widget rows are assigned by blocks.mjs, not by the id). Pure. */
export const kindOf = (id) => (CHROME_IDS.has(String(id).toLowerCase()) ? 'chrome' : 'module');

/**
 * Is this a chrome name? Default: exact CHROME_IDS membership, case-insensitive (rollout kindOf). `menu: true` is deploy
 * ai-readability's wider test on a fragment PATH: any segment that starts with nav, header, footer or menu (`/nav-de/` too). Pure.
 */
export function isChromeName(name, { menu = false } = {}) {
  if (menu) return /(^|\/)(nav|header|footer|menu)[^/]*(\/|$)/i.test(String(name));
  return CHROME_IDS.has(String(name).toLowerCase());
}

/** qa's default fragment documents (buildInventory `fragments`) and delivery-lint's fragment paths: delivered, but not pages. */
export const QA_CHROME_PATHS = ['/nav', '/footer'];

/**
 * rollout delivery-lint inferType: what kind of document a DA path is — 'fragment' (a QA_CHROME_PATHS document or a
 * /fragments/ path; a content page like /about/nav is NOT downgraded out of the page gates), 'index' (a JSON index),
 * else 'page'. Pure.
 */
export function documentKind(path) {
  if (!path) return 'page';
  const s = String(path).toLowerCase();
  if (QA_CHROME_PATHS.includes(s) || /\/fragments?\//.test(s)) return 'fragment';
  if (/query-index(\.json)?$/.test(s) || /\.json$/.test(s)) return 'index';
  return 'page';
}

/** The key-value blocks that are metadata, not content: excluded from block inventories, linted as key/value rows. */
export const META_BLOCKS = new Set(['metadata', 'section-metadata']);
/** deploy davids-model-lint's key/value set: META_BLOCKS plus the block library's own metadata (0.38.1). qa still holds the
 *  pair only — known divergence (characterization `metadata-pair`), converged in a later commit, not here. */
export const KEY_VALUE_BLOCKS = new Set([...META_BLOCKS, 'library-metadata']);
export const isMetaBlock = (name) => META_BLOCKS.has(String(name));

/** The edsBlockName that records a module mapped to EDS default content (title, text, image, button, separator — deploy's D1). */
export const DEFAULT_CONTENT = 'default-content';

/** spec-map: the kinds a judgement's `direct` mapping may give a component. */
export const SPEC_MAP_KINDS = ['block', 'dynamic', 'widget', 'default', 'metadata', 'drop'];
/** spec-knowledge: the kinds of a catalog entry (`global` is the chrome). */
export const SPEC_CATALOG_KINDS = ['block', 'dynamic', 'global', 'widget'];
/** rollout coverage/blocks.json: the kinds of a block row (rollout-blocks.schema.json). */
export const ROLLOUT_KINDS = ['chrome', 'module', 'section', 'widget'];
/** dynamics: the delivery form of a feature (reference/triage.md § Target). */
export const DYNAMICS_TARGETS = ['block', 'widget', 'runtime', 'content', 'embed'];

/** deploy ai-readability `--exclude-blocks` default: app blocks whose rendered side block code owns, never the document. */
export const AI_EXCLUDE_DEFAULT = ['client-app', 'widget'];
