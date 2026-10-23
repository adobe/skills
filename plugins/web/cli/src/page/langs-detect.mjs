import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CliError } from '#src/errors.mjs';

// cld3-asm's findMostFrequentLanguages always returns a single language for
// mixed text, so classify each text block on its own and weight by bytes.
// Blocks CLD3 marks unreliable are ignored, and so are blocks under
// MIN_BLOCK_BYTES: nav labels such as "DE" or "Garantie" get confident but
// wrong codes (pt, nl, ga...) that would show up as undeclared languages.
export const MIN_BLOCK_BYTES = 50;

// CLD3 reads at most MAX_CLD3_BYTES per call. Longer blocks are split at
// spaces so every byte weighted toward a language was actually classified.
const MAX_CLD3_BYTES = 1000;

export function aggregate(results) {
  const bytes = new Map();
  const weighted = new Map();
  let total = 0;
  for (const { language, probability, is_reliable, size } of results) {
    if (!is_reliable || language === 'und' || size < MIN_BLOCK_BYTES) continue;
    bytes.set(language, (bytes.get(language) || 0) + size);
    weighted.set(language, (weighted.get(language) || 0) + probability * size);
    total += size;
  }
  return [...bytes.entries()]
    .map(([language, b]) => ({
      language,
      probability: weighted.get(language) / b,
      is_reliable: true,
      proportion: b / total,
    }))
    .sort((a, b) => b.proportion - a.proportion)
    .slice(0, 5);
}

export function chunks(block) {
  const out = [];
  let current = '';
  for (const word of block.split(' ')) {
    const next = current ? `${current} ${word}` : word;
    if (current && Buffer.byteLength(next) > MAX_CLD3_BYTES) {
      out.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) out.push(current);
  return out;
}

export function primarySubtag(code) {
  if (!code || code.toLowerCase() === 'x-default' || code === 'und') return null;
  return code.toLowerCase().split('-')[0] || null;
}

export function reconcile(declared, detectedList) {
  const detectedCodes = new Set(detectedList.filter((r) => r.is_reliable).map((r) => r.language));
  const declaredCodes = new Set();
  const add = (raw) => {
    const p = primarySubtag(raw);
    if (p) declaredCodes.add(p);
  };

  if (declared.htmlLang) add(declared.htmlLang);
  for (const { lang } of declared.nestedLangs) add(lang);
  for (const { hreflang } of declared.hreflang) add(hreflang);
  if (declared.metaContentLanguage) {
    declared.metaContentLanguage.split(',').forEach((p) => add(p.trim()));
  }

  return {
    agreement: [...declaredCodes].filter((c) => detectedCodes.has(c)),
    declaredNotDetected: [...declaredCodes].filter((c) => !detectedCodes.has(c)),
    detectedNotDeclared: [...detectedCodes].filter((c) => !declaredCodes.has(c)),
  };
}

function detect(text, detector) {
  const identifier = detector.create(0, MAX_CLD3_BYTES);
  try {
    const pieces = text
      .split('\n')
      .filter((b) => b.trim())
      .flatMap(chunks);
    return aggregate(
      pieces.map((piece) => ({
        ...identifier.findLanguage(piece),
        size: Buffer.byteLength(piece),
      })),
    );
  } finally {
    identifier.dispose();
  }
}

/**
 * Detect page languages with CLD3 and reconcile them with the declared signals.
 * @param {object} signals output of the langs-collect bundle
 * @param {{ create: Function }} detector module resolved by cld3-asm `loadModule()`
 * @returns {object} `{ url, wordCount, detected, declared, reconciliation }`
 */
export function detectLanguages(signals, detector) {
  const detected = detect(signals.text || '', detector);
  const declared = {
    htmlLang: signals.htmlLang ?? null,
    nestedLangs: signals.nestedLangs ?? [],
    hreflang: signals.hreflang ?? [],
    metaContentLanguage: signals.metaContentLanguage ?? null,
  };
  return {
    url: signals.url,
    wordCount: signals.wordCount,
    detected,
    declared,
    reconciliation: reconcile(declared, detected),
  };
}

/** @param {string} start directory to begin the upward search */
function findPackageDir(start) {
  let dir = start;
  while (!existsSync(join(dir, 'package.json')) && dirname(dir) !== dir) dir = dirname(dir);
  return dir;
}

/**
 * Load the CLD3 WASM module.
 * @param {(module: string) => Promise<any>} [importer] module loader (injectable for tests)
 * @returns {Promise<{ create: Function }>}
 */
export async function loadDetector(importer = (m) => import(m)) {
  let loadModule;
  try {
    ({ loadModule } = await importer('cld3-asm'));
  } catch {
    const cliDir = findPackageDir(dirname(fileURLToPath(import.meta.url)));
    throw new CliError('UNSUPPORTED', 'cld3-asm is not installed', {
      hint: `cd ${cliDir} && npm install`,
    });
  }
  return loadModule();
}
