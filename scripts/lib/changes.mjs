// Change notes: how a plugin with a hand-written CHANGELOG.md takes its entries.
//
// A pull request does not edit CHANGELOG.md. It adds a file, <plugin>/changes/<name>.md:
// the first line is the title, the rest is the entry. The release puts every note under
// the new version at the top of CHANGELOG.md and removes the files
// (scripts/prepare-plugin-release.mjs).
//
// Why: two pull requests that add an entry at the top of one file conflict, every time.
// Of 157 stardust commits in 60 days, 97 changed CHANGELOG.md, and it was the one conflict
// in most pull requests that had any. Two new files never conflict.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CHANGES = 'changes';
// lower-case words with dashes: the name says what changed, an issue number is enough
export const NOTE_NAME = /^[a-z0-9][a-z0-9-]*\.md$/;

// A note's title and body. The title is the first line, with or without a leading "#".
export function parseNote(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const first = lines.findIndex((line) => line.trim() !== '');
  if (first === -1) return { title: '', body: '' };
  return { title: lines[first].replace(/^#+\s*/, '').trim(), body: lines.slice(first + 1).join('\n').trim() };
}

// The notes of a plugin, sorted by file name: [{ file, title, body }]. README.md is the
// folder's own explanation, not a note.
export function readNotes(pluginDir) {
  const dir = join(pluginDir, CHANGES);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith('.md') && name !== 'README.md').sort()
    .map((name) => ({ file: `${CHANGES}/${name}`, ...parseNote(readFileSync(join(dir, name), 'utf8')) }));
}

// What is wrong with a note, or null.
export function noteProblem(name, text) {
  if (!NOTE_NAME.test(name)) return 'the file name has to be lower-case words with dashes and end in .md';
  const { title, body } = parseNote(text);
  if (!title) return 'it is empty: the first line is the title, the rest is the entry';
  if (/^(unreleased|\d+\.\d+\.\d+)\b/i.test(title)) return 'the title starts with a version or "Unreleased": the release adds the version';
  if (!body) return 'it has a title and no entry below it';
  return null;
}

// The changelog with the notes as entries of this version, above every earlier entry.
export function withNotes(changelog, version, notes) {
  if (notes.length === 0) return changelog;
  const entries = notes.map(({ title, body }) => `## ${version} — ${title}\n\n${body}\n`).join('\n');
  const at = changelog.search(/^## /m);
  if (at === -1) return `${changelog.replace(/\n*$/, '\n\n')}${entries}`;
  return `${changelog.slice(0, at)}${entries}\n${changelog.slice(at)}`;
}
