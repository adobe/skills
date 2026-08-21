#!/usr/bin/env node
/**
 * skills/deploy/scripts/sanitise.js
 *
 * Encodes all non-ASCII characters in an HTML file to named or numeric HTML
 * entities before uploading to Document Authoring (DA).
 *
 * DA strips <head> on ingestion and parses the document without a charset
 * declaration. Any multibyte UTF-8 sequence it can't decode becomes U+FFFD
 * (the replacement character &#xFFFD;). HTML entities survive the round-trip
 * unchanged.
 *
 * Usage:
 *   node skills/deploy/scripts/sanitise.js content/page.html          # in-place
 *   node skills/deploy/scripts/sanitise.js content/page.html out.html # explicit output file
 *   node skills/deploy/scripts/sanitise.js < input.html               # stdin -> stdout
 *   npm run da:sanitise -- content/page.html
 *
 * Exit codes: 0 success, 1 error.
 */

import { readFileSync, writeFileSync } from 'fs';

// Named HTML entities for common non-ASCII characters.
// Anything not listed here falls back to a decimal numeric reference (&#NNN;).
const NAMED = new Map([
  [0x00A0, '&nbsp;'], [0x00A1, '&iexcl;'], [0x00A3, '&pound;'],
  [0x00A5, '&yen;'], [0x00A9, '&copy;'], [0x00AB, '&laquo;'],
  [0x00AE, '&reg;'], [0x00B0, '&deg;'], [0x00B1, '&plusmn;'],
  [0x00B5, '&micro;'], [0x00B7, '&middot;'], [0x00BB, '&raquo;'],
  [0x00BC, '&frac14;'], [0x00BD, '&frac12;'], [0x00BE, '&frac34;'],
  [0x00BF, '&iquest;'], [0x00C0, '&Agrave;'], [0x00C1, '&Aacute;'],
  [0x00C2, '&Acirc;'], [0x00C4, '&Auml;'], [0x00C7, '&Ccedil;'],
  [0x00C9, '&Eacute;'], [0x00CE, '&Icirc;'], [0x00D1, '&Ntilde;'],
  [0x00D6, '&Ouml;'], [0x00D7, '&times;'], [0x00DA, '&Uacute;'],
  [0x00DC, '&Uuml;'], [0x00E0, '&agrave;'], [0x00E1, '&aacute;'],
  [0x00E2, '&acirc;'], [0x00E3, '&atilde;'], [0x00E4, '&auml;'],
  [0x00E5, '&aring;'], [0x00E6, '&aelig;'], [0x00E7, '&ccedil;'],
  [0x00E8, '&egrave;'], [0x00E9, '&eacute;'], [0x00EA, '&ecirc;'],
  [0x00EB, '&euml;'], [0x00EC, '&igrave;'], [0x00ED, '&iacute;'],
  [0x00EE, '&icirc;'], [0x00EF, '&iuml;'], [0x00F0, '&eth;'],
  [0x00F1, '&ntilde;'], [0x00F2, '&ograve;'], [0x00F3, '&oacute;'],
  [0x00F4, '&ocirc;'], [0x00F5, '&otilde;'], [0x00F6, '&ouml;'],
  [0x00F7, '&divide;'], [0x00F8, '&oslash;'], [0x00F9, '&ugrave;'],
  [0x00FA, '&uacute;'], [0x00FB, '&ucirc;'], [0x00FC, '&uuml;'],
  [0x00FD, '&yacute;'], [0x00FF, '&yuml;'], [0x2013, '&ndash;'],
  [0x2014, '&mdash;'], [0x2018, '&lsquo;'], [0x2019, '&rsquo;'],
  [0x201C, '&ldquo;'], [0x201D, '&rdquo;'], [0x2022, '&bull;'],
  [0x2026, '&hellip;'], [0x2122, '&trade;'], [0x2190, '&larr;'],
  [0x2191, '&uarr;'], [0x2192, '&rarr;'], [0x2193, '&darr;'],
  [0x20AC, '&euro;'],
]);

/**
 * Encode all non-ASCII code points in a string to HTML entities.
 * Handles surrogate pairs (emoji, supplementary CJK) correctly via codePointAt.
 * @param {string} input
 * @returns {{ output: string, count: number }}
 */
function encode(input) {
  const parts = [];
  let count = 0;
  for (let i = 0; i < input.length; i += 1) {
    const cp = input.codePointAt(i);
    if (cp <= 0x7F) {
      parts.push(input[i]);
      // eslint-disable-next-line no-continue
      continue;
    }
    // Consume the surrogate pair as one logical character.
    if (cp > 0xFFFF) i += 1;
    parts.push(NAMED.has(cp) ? NAMED.get(cp) : `&#${cp};`);
    count += 1;
  }
  return { output: parts.join(''), count };
}

const args = process.argv.slice(2);
const fromStdin = args.length === 0 || args[0] === '-';

let input;
if (fromStdin) {
  input = readFileSync(process.stdin.fd, 'utf8');
} else {
  const inputPath = args[0];
  try {
    input = readFileSync(inputPath, 'utf8');
  } catch (err) {
    process.stderr.write(`da-sanitise: cannot read '${inputPath}': ${err.message}\n`);
    process.exit(1);
  }
}

const { output, count } = encode(input);

if (fromStdin) {
  process.stdout.write(output);
} else {
  const outputPath = args[1] || args[0]; // explicit output or in-place
  try {
    writeFileSync(outputPath, output, 'utf8');
  } catch (err) {
    process.stderr.write(`da-sanitise: cannot write '${outputPath}': ${err.message}\n`);
    process.exit(1);
  }
  const msg = count
    ? `da-sanitise: encoded ${count} non-ASCII character(s) -> ${outputPath}\n`
    : `da-sanitise: no non-ASCII characters found -- ${outputPath} unchanged\n`;
  process.stderr.write(msg);
}
