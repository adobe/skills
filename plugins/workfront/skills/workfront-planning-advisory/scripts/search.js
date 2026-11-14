#!/usr/bin/env node

/**
 * Search the Adobe Workfront Planning documentation index.
 *
 * Ranks Experience League pages by keyword relevance and returns their URLs so
 * the agent can fetch the live page on demand. Nothing is bundled except the
 * lightweight index (titles, descriptions, headings) — page bodies are always
 * fetched fresh from Experience League, so answers never go stale.
 *
 * Usage:
 *   node scripts/search.js [--all] <keyword1> [keyword2] [...]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INDEX_PATH = path.join(__dirname, 'docs-index.json');

// Stop words to ignore in searches. Includes terms so common in this corpus
// that they carry no signal.
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
  'how', 'what', 'is', 'do', 'i', 'my',
  'adobe', 'workfront', 'planning', 'maestro',
]);

const SCORE_WEIGHTS = {
  TITLE: 10,
  HEADING: 4,
  DESCRIPTION: 5,
  SECTION: 3,
  PATH: 2,
  MULTI_KEYWORD_MULTIPLIER: 1.5,
};

const DEFAULT_LIMIT = 10;

function filterKeywords(keywords) {
  return keywords
    .map((k) => k.toLowerCase().trim())
    .filter((k) => k.length > 0 && !STOP_WORDS.has(k));
}

function countMatches(text, keyword) {
  if (!text) return 0;
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = String(text).match(new RegExp(escaped, 'gi'));
  return matches ? matches.length : 0;
}

function scoreEntry(entry, keywords) {
  let score = 0;
  let matchedKeywords = 0;

  for (const keyword of keywords) {
    let keywordScore = 0;

    keywordScore += countMatches(entry.title, keyword) * SCORE_WEIGHTS.TITLE;
    keywordScore += countMatches(entry.description, keyword) * SCORE_WEIGHTS.DESCRIPTION;
    keywordScore += countMatches(entry.section, keyword) * SCORE_WEIGHTS.SECTION;
    keywordScore += countMatches(entry.path, keyword) * SCORE_WEIGHTS.PATH;

    for (const heading of entry.headings || []) {
      keywordScore += countMatches(heading, keyword) * SCORE_WEIGHTS.HEADING;
    }

    if (keywordScore > 0) matchedKeywords += 1;
    score += keywordScore;
  }

  // Reward pages that match more than one of the supplied keywords.
  if (matchedKeywords > 1) {
    score *= SCORE_WEIGHTS.MULTI_KEYWORD_MULTIPLIER * matchedKeywords;
  }

  return { score, matchedKeywords };
}

function main() {
  const argv = process.argv.slice(2);
  const all = argv.includes('--all');
  const keywords = filterKeywords(argv.filter((a) => a !== '--all'));

  if (keywords.length === 0) {
    console.error('Usage: node scripts/search.js [--all] <keyword1> [keyword2] [...]');
    console.error('At least one keyword is required (stop words are ignored).');
    process.exit(1);
  }

  let index;
  try {
    index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
  } catch (err) {
    console.error(`Could not read the docs index at ${INDEX_PATH}: ${err.message}`);
    process.exit(1);
  }

  const results = index
    .map((entry) => {
      const { score, matchedKeywords } = scoreEntry(entry, keywords);
      return {
        url: entry.url,
        markdownUrl: `${entry.url}.md`,
        title: entry.title,
        section: entry.section,
        description: entry.description,
        matchedKeywords,
        relevanceScore: Math.round(score * 10) / 10,
      };
    })
    .filter((r) => r.relevanceScore > 0)
    .sort((a, b) => b.relevanceScore - a.relevanceScore);

  const output = all ? results : results.slice(0, DEFAULT_LIMIT);
  console.log(JSON.stringify(output, null, 2));
}

main();
