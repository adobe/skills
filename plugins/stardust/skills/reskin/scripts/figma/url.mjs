// skills/reskin/scripts/figma/url.mjs — Figma URL → { fileKey, mainFileKey, nodeId }. Accepts the
// design, file and proto URL forms (with or without www), branch URLs (fileKey is the branch, the
// parent kept as mainFileKey) and a bare file key. node-id comes back with ':' (URLs carry '-').
import { UsageError } from './errors.mjs';

const KEY = /^[A-Za-z0-9]{10,64}$/;
const NODE = /^I?\d+:\d+(?:;\d+:\d+)*$/;
const FORMS = [
  'https://www.figma.com/design/<file-key>/<name>?node-id=<a-b>',
  'https://www.figma.com/file/<file-key>/<name>?node-id=<a-b>',
  'https://www.figma.com/proto/<file-key>/<name>',
  'https://www.figma.com/design/<file-key>/branch/<branch-key>/<name>',
  'a bare file key (10-64 letters and digits)',
];
const bad = (why) => new UsageError(`${why}\naccepted forms:\n  ${FORMS.join('\n  ')}`);

export function parseFigmaUrl(input) {
  const raw = String(input ?? '').trim();
  if (KEY.test(raw)) return { fileKey: raw, mainFileKey: raw, nodeId: null };
  let u;
  try { u = new URL(raw); } catch { throw bad(`not a Figma URL: "${raw}"`); }
  if (u.protocol !== 'https:' || !/^(www\.)?figma\.com$/.test(u.hostname)) throw bad(`not a Figma URL: "${raw}"`);
  const [kind, mainFileKey, maybeBranch, branchKey] = u.pathname.split('/').filter(Boolean);
  if (!['design', 'file', 'proto'].includes(kind) || !KEY.test(mainFileKey || '')) throw bad(`no file key in "${raw}"`);
  let fileKey = mainFileKey;
  if (maybeBranch === 'branch') {
    if (!KEY.test(branchKey || '')) throw bad(`no branch key in "${raw}"`);
    fileKey = branchKey;
  }
  const param = u.searchParams.get('node-id');
  let nodeId = null;
  if (param) {
    nodeId = param.replace(/-/g, ':');
    if (!NODE.test(nodeId)) throw bad(`node-id "${param}" is not a Figma node id (expected like 12-34)`);
  }
  return { fileKey, mainFileKey, nodeId };
}

export function canonicalFigmaUrl({ fileKey, nodeId }) {
  const base = `https://www.figma.com/design/${fileKey}`;
  return nodeId ? `${base}?node-id=${encodeURIComponent(nodeId.replace(/:/g, '-'))}` : base;
}
