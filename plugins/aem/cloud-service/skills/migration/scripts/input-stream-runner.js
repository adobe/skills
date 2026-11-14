/**
 * InputStream Runner
 *
 * The `java-scan` detection tier for the migration **inputStream** pattern:
 * Best Practices Analyzer (BPA) code `DG`, subtype `java.io.inputstream`
 * (ADVISORY). Companion to `references/input-stream.md`.
 *
 * Adobe documents the risk behind this finding as binary data streamed through
 * the JVM, which uses the limited memory of AEM as a Cloud Service containers;
 * the documented fixes are direct binary upload and delivering binaries through
 * the CDN. BPA reports every use of the stream types, so this scanner separates
 * the sites that carry that risk (and related AEM as a Cloud Service problems)
 * from harmless uses.
 *
 * Precedence, as for the other migration patterns: BPA findings first (CAM via
 * the MCP tool, then a BPA CSV); local detection only when BPA has none.
 *   - With BPA rows, they define the scope. BPA names a class, never a line, so
 *     each flagged class is resolved to its workspace file and only those files
 *     are scanned, for line-level sites. Classes outside the workspace collapse
 *     to one row per bundle (customer code kept elsewhere, platform-provided,
 *     or third-party); rows without a bundle name group by package.
 *   - Without BPA rows, every `src/main/java` file is scanned.
 *
 * What it does (pure Node, no JDK, no `rg`):
 *   1. Indexes `src/main/java` sources (FQCN → file).
 *   2. Finds every stream acquisition site in the files in scope; comments and
 *      string literals are blanked first so they can't produce matches.
 *   3. Pre-classifies each site (A–F, see CATEGORY) and assigns a fix kind:
 *      `decision` (needs the user), `review` (confirm a read limit), `auto`
 *      (apply the recipe) or `none` (benign).
 *   4. Emits ONE finding per file — the unit an agent edits — ordered by risk.
 *
 * Classification is heuristic (regex over code, not a compiler): the agent
 * re-confirms each site against the reference before editing, and re-runs with
 * `--files` after editing to verify the fix.
 *
 * Usage (CLI):
 *   node input-stream-runner.js <workspaceRoot> [--bpa-json <cam-targets.json>] [--csv <bpa.csv>]
 *                               [--collections <dir>] [--files <a.java,b.java>] [--json]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set(['node_modules', '.git', 'target', 'dist', 'build', 'out', '.idea', '.vscode']);
const MAIN_JAVA_SEGMENT = `${path.sep}src${path.sep}main${path.sep}java${path.sep}`;

// java.io stream types this finding covers. BPA reports name the type in the
// `other` column, for example java.io.FileInputStream or java.io.InputStreamReader.
const JAVA_IO_STREAM_TYPES = [
  'InputStream', 'FileInputStream', 'ByteArrayInputStream', 'ObjectInputStream',
  'BufferedInputStream', 'DataInputStream', 'FilterInputStream', 'PipedInputStream',
  'PushbackInputStream', 'SequenceInputStream', 'StringBufferInputStream', 'InputStreamReader',
];
const TYPE_ALT = JAVA_IO_STREAM_TYPES.join('|');

const CATEGORY = {
  F: { rank: 0, label: 'deserialization', fix: 'decision', severity: 'high' },
  E: { rank: 1, label: 'binary-in-jvm', fix: 'decision', severity: 'high' },
  D: { rank: 2, label: 'local-filesystem', fix: 'decision', severity: 'high' },
  C: { rank: 3, label: 'unbounded-buffering', fix: 'review', severity: 'medium' },
  B: { rank: 4, label: 'unclosed-resource', fix: 'auto', severity: 'medium' },
  A: { rank: 5, label: 'benign', fix: 'none', severity: 'info' },
};
const FIX_RANK = { decision: 0, review: 1, auto: 2, none: 3 };
const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

// Source kinds, most specific first — a statement with several acquisitions
// (e.g. `new BufferedInputStream(rendition.getStream())`) takes the first.
const SOURCE_PRIORITY = [
  'request-upload', 'request-body', 'dam-binary', 'repo-binary', 'file', 'archive', 'remote', 'other',
  'bundle-resource', 'byte-array', 'pipe', 'declared', 'wrapper',
];
// Sources of unknown size — reading them whole is the C risk.
const UNBOUNDED_SOURCES = new Set(['request-upload', 'request-body', 'dam-binary', 'repo-binary', 'file', 'archive', 'remote', 'other', 'declared']);
// Sources whose size is known before reading, so a size check is a real bound.
const KNOWN_SIZE_SOURCES = new Set(['dam-binary', 'repo-binary', 'request-upload', 'file']);
// Sources this statement doesn't own or whose close() is a no-op — never B.
const NOT_OWNED_SOURCES = new Set(['request-body', 'byte-array', 'wrapper']);

const BUFFER_CALL_RE = /\b(?:IOUtils|ByteStreams|StreamUtils|CharStreams|FileCopyUtils)\s*\.\s*(?:toByteArray|toString|readLines|copyToByteArray|copyToString|readFully|toCharArray)\s*\(|\.\s*readAllBytes\s*\(/;
// Read limits. Only a limit applied to the stream being read counts: wrapping it
// (in the same statement, or wrapping its variable), `readNBytes` on it, or the
// upload parser's size limits for uploaded parts. Content-Length is
// client-supplied and is -1 for chunked requests, so checking it does not bound
// the read; neither does a limit on some other stream in the same method.
const STATEMENT_LIMIT_RE = /\bBoundedInputStream\b|\breadNBytes\s*\(|\bByteStreams\s*\.\s*limit\s*\(/;
const UPLOAD_LIMIT_RE = /\bsetSizeMax\s*\(|\bsetFileSizeMax\s*\(/;
const RESPONSE_OUT_RE = /\b\w*(?:resp|response)\w*\s*\.\s*getOutputStream\s*\(/i;
const REPO_WRITE_RE = /\bcreateAsset\w*\s*\(|\bcreateRendition\s*\(|\baddRendition\s*\(|\bcreateBinary\s*\(|\bputFile\s*\(|\bsetBinary\s*\(/;
const UNTRUSTED_RE = /\.\s*getInputStream\s*\(|getParameter|getRequestParameter|getCookie|getHeader|Base64|\bdecode\s*\(/;
const DESER_FILTER_RE = /\bsetObjectInputFilter\s*\(|\bObjectInputFilter\b|\bValidatingObjectInputStream\b/;
// DAM asset binaries (originals and renditions).
const DAM_CHAIN_RE = /\w*(?:asset|rendition|original)\w*/i;
const DAM_TYPE_RE = /^(?:Asset|Rendition)$/;
// Per-request scratch files are allowed (temp files, a working directory, the
// file deleted after use). API markers are matched with comments removed but
// strings kept (for "java.io.tmpdir"); identifier markers with strings removed.
const TEMP_API_RE = /\bcreateTempFile\s*\(|\bcreateTempDirectory\s*\(|java\.io\.tmpdir|\bgetTempDirectory\w*\s*\(|\bdeleteOnExit\s*\(|\bdeleteQuietly\s*\(|\bFiles\s*\.\s*delete(?:IfExists)?\s*\(|\.\s*delete\s*\(\s*\)/;
const TEMP_IDENT_RE = /\b(?:temp|tmp)(?:File|Dir|Directory|Folder|Path)?\b|\bworking(?:Dir|Directory)\b/i;
// A hard-coded path names state that outlives the request — never scratch use.
const FIXED_PATH_RE = /(?:\bnew\s+(?:java\s*\.\s*io\s*\.\s*)?(?:FileInputStream|File|RandomAccessFile)\s*\(|\bPaths\s*\.\s*get\s*\(|\bPath\s*\.\s*of\s*\()\s*"/;
const FS_WRITE_RE = /\bnew\s+(?:java\s*\.\s*io\s*\.\s*)?(?:FileOutputStream|FileWriter)\s*\(|\bFiles\s*\.\s*(?:write|writeString|newOutputStream|newBufferedWriter|copy|move|createFile)\s*\(|\bFileUtils\s*\.\s*(?:write\w*|copy\w*|openOutputStream|moveFile)\s*\(/g;
const WORKFLOW_RE = /\bimplements\b[^{;]*\bWorkflowProcess\b|\bWorkItem\b/;
// External processes, including AEM's FFmpeg helpers, which run a native ffmpeg binary.
const NATIVE_RE = /\bnew\s+ProcessBuilder\s*\(|\bRuntime\s*\.\s*getRuntime\s*\(\s*\)\s*\.\s*exec\s*\(|\bFFMpegWrapper\b|\bExecutableLocator\b/;
// Callees that keep the stream (setters, maps, builders) or, per the JCR spec,
// consume and close it (createBinary): passing a fresh stream to them isn't a leak.
const HANDOFF_CALL_RE = /^(?:set[A-Z]\w*|setProperty|put|putAll|writeField|with[A-Z]\w*|createBinary)$/;
const STREAM_WRAPPER_CTOR_RE = /(?:InputStream|Reader)$/;
const CONTROL_WORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'synchronized', 'try']);
const NOT_A_TYPE = '(?!(?:return|throw|new|case|else|instanceof|assert|yield|final|static)\\b)';

// AEM Forms add-on bundles: on AEM as a Cloud Service, Adobe provides them when
// the Forms add-on is enabled in Cloud Manager, so customers don't deploy them.
const PLATFORM_PROVIDED_BUNDLES = [/^adobe-aemfd-/, /^adobe-aemds-/, /^forms-foundation-/, /^xfa4j$/];
// The same add-on's own packages, for rows that carry no bundle name. Libraries
// embedded in those bundles can't be recognised by package and are grouped as such.
const PLATFORM_PROVIDED_PACKAGES = /^com\.adobe\.(?:fd|aemfd|aemds|xfa|pdfg|forms)\./;
// Package roots too generic to identify a customer namespace on their own.
const SHARED_ROOTS = new Set([
  'java', 'javax', 'com.adobe', 'com.day', 'org.apache', 'com.google', 'org.osgi', 'org.eclipse',
  'com.fasterxml', 'org.slf4j', 'io.wcm', 'org.json', 'com.sun', 'org.w3c', 'org.xml', 'net.sf',
]);

// ── Source preparation ──────────────────────────────────────────────────────

/**
 * Blank comments and (unless `keepStrings`) string/char/text-block contents,
 * quotes kept, while preserving every offset and newline, so line numbers
 * computed on the result match the original file.
 */
function stripCommentsAndStrings(src, { keepStrings = false } = {}) {
  const out = src.split('');
  const n = src.length;
  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
  };
  let i = 0;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      const end = src.indexOf('\n', i);
      const e = end === -1 ? n : end;
      blank(i, e);
      i = e;
    } else if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      const e = end === -1 ? n : end + 2;
      blank(i, e);
      i = e;
    } else if (c === '"' && src.startsWith('"""', i)) {
      const end = src.indexOf('"""', i + 3);
      const e = end === -1 ? n : end + 3;
      if (!keepStrings) blank(i + 3, Math.max(i + 3, e - 3));
      i = e;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') {
        if (src[j] === '\\') j++;
        j++;
      }
      if (!keepStrings) blank(i + 1, j);
      i = j + 1;
    } else {
      i++;
    }
  }
  return out.join('');
}

function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}

function lineOf(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
  }
  return lo + 1;
}

/** `{…}` blocks, each with its nesting depth and enclosing block. */
function braceBlocks(code) {
  const stack = [];
  const blocks = [];
  for (let i = 0; i < code.length; i++) {
    if (code[i] === '{') stack.push({ open: i, parent: stack.length ? stack[stack.length - 1] : null });
    else if (code[i] === '}' && stack.length) {
      const b = stack.pop();
      b.close = i;
      b.depth = stack.length + 1;
      blocks.push(b);
    }
  }
  return blocks;
}

/** Offset of the `(` matching the `)` at `close`, or -1. */
function matchingOpenParen(code, close) {
  let depth = 0;
  for (let i = close; i >= 0; i--) {
    if (code[i] === ')') depth++;
    else if (code[i] === '(' && --depth === 0) return i;
  }
  return -1;
}

/**
 * Label each block: 'method' (method or constructor body; `params` holds its
 * parameter list), 'init' (static or instance initializer), 'class' (type or
 * anonymous-class body) or 'other' (control flow, lambdas, array initializers).
 */
function classifyBlocks(code, blocks) {
  const ordered = blocks.slice().sort((a, b) => a.open - b.open);
  for (const b of ordered) {
    b.kind = 'other';
    let i = b.open - 1;
    while (i >= 0 && /\s/.test(code[i])) i--;
    const tail = code.slice(Math.max(0, i - 400), i + 1);
    if (/->$/.test(tail) || /[=\]]$/.test(tail) || /\b(?:else|try|finally|do)$/.test(tail)) continue;
    if (/\b(?:class|interface|enum|record)\s+[A-Za-z_$][\w$]*[^;{}()]*$/.test(tail)) { b.kind = 'class'; continue; }
    if (/\bstatic$/.test(tail)) { b.kind = 'init'; continue; }
    const header = tail.match(/\)\s*(?:throws\s+[\w$.,\s<>]+)?$/);
    if (header) {
      const close = i - (header[0].length - 1);
      const open = matchingOpenParen(code, close);
      const name = open > 0 ? code.slice(Math.max(0, open - 120), open).match(/(\bnew\s+)?([A-Za-z_$][\w$.]*)\s*(?:<[^<>]*>)?\s*$/) : null;
      if (!name) continue;
      if (name[1]) b.kind = 'class';
      else if (!CONTROL_WORDS.has(name[2])) { b.kind = 'method'; b.params = code.slice(open + 1, close); }
      continue;
    }
    if (b.parent && b.parent.kind === 'class') b.kind = 'init';
  }
}

/** Innermost method or initializer containing `offset`; else innermost block; else the file. */
function scopeOf(blocks, offset, length) {
  let method = null;
  let any = null;
  for (const b of blocks) {
    if (!(b.open < offset && offset < b.close)) continue;
    if ((b.kind === 'method' || b.kind === 'init') && (!method || b.open > method.open)) method = b;
    if (!any || b.open > any.open) any = b;
  }
  return method || any || { open: 0, close: length, kind: 'file' };
}

/** `try ( … )` resource-header regions. */
function twrRegions(code) {
  const regions = [];
  const re = /\btry\s*\(/g;
  let m;
  while ((m = re.exec(code))) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    for (let i = open; i < code.length; i++) {
      if (code[i] === '(') depth++;
      else if (code[i] === ')' && --depth === 0) { regions.push({ open, close: i }); break; }
    }
  }
  return regions;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Declared type (simple name) of variable `name` in `text`, or null. */
function declaredType(name, text) {
  const re = new RegExp(`\\b${NOT_A_TYPE}([A-Za-z_$][\\w$.]*)(?:<[^;{}()]*>)?(?:\\[\\])*\\s+${escapeRe(name)}\\s*(?:[=;,):]|$)`, 'g');
  let m;
  let type = null;
  while ((m = re.exec(text))) type = m[1];
  return type ? type.split('.').pop() : null;
}

// ── Java source index ───────────────────────────────────────────────────────

/**
 * Recursively collect `src/main/java/**.java` files. Build and vendor directories
 * are skipped only outside source roots: inside `src/main/java` a package may well
 * be named `build`, `out`, `dist` or `target`.
 */
function collectJavaFiles(dir, acc = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  const inSourceRoot = `${dir}${path.sep}`.includes(MAIN_JAVA_SEGMENT);
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!inSourceRoot && SKIP_DIRS.has(e.name)) continue;
      collectJavaFiles(full, acc);
    } else if (e.isFile() && e.name.endsWith('.java') && full.includes(MAIN_JAVA_SEGMENT)) {
      acc.push(full);
    }
  }
  return acc;
}

/** Package name and top-level (depth-0) type names declared in a file. */
function declaredTypes(code) {
  const pkg = (code.match(/^\s*package\s+([\w.]+)\s*;/m) || [])[1] || '';
  const blocks = braceBlocks(code);
  const types = [];
  const re = /\b(?:class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = re.exec(code))) {
    const idx = m.index;
    if (!blocks.some(b => b.open < idx && idx < b.close)) types.push(m[1]);
  }
  return { pkg, types };
}

// ── Site detection ──────────────────────────────────────────────────────────

/** java.io stream simple names that resolve to java.io in this file. */
function visibleJavaIoNames(code) {
  const visible = new Set();
  const re = /^\s*import\s+java\.io\.(\*|[A-Za-z_$][\w$]*)\s*;/gm;
  let m;
  while ((m = re.exec(code))) {
    if (m[1] === '*') JAVA_IO_STREAM_TYPES.forEach(t => visible.add(t));
    else if (JAVA_IO_STREAM_TYPES.includes(m[1])) visible.add(m[1]);
  }
  return visible;
}

function receiverInfo(code, dotIndex) {
  const pre = code.slice(Math.max(0, dotIndex - 240), dotIndex);
  const tail = pre.match(/([A-Za-z_$][\w$]*)\s*(\((?:[^()]|\([^()]*\))*\))?\s*$/);
  const chain = pre.split(/[;{}=,]/).pop() || '';
  return { name: tail ? tail[1] : '', chain };
}

/**
 * The member-access expression a call is made on, whitespace removed: for the
 * `.` before `getStream()` in `IOUtils.toByteArray(asset.getOriginal().getStream())`
 * it is `asset.getOriginal()`. Walks back over identifiers, dots and argument
 * lists; returns '' when the receiver isn't a plain chain.
 */
function receiverExpression(code, dotIndex) {
  let i = dotIndex - 1;
  const skipWs = () => { while (i >= 0 && /\s/.test(code[i])) i--; };
  skipWs();
  const end = i + 1;
  let start = end;
  for (;;) {
    if (code[i] === ')') {
      const open = matchingOpenParen(code, i);
      if (open < 0) break;
      i = open - 1;
      skipWs();
    }
    const idEnd = i;
    while (i >= 0 && /[\w$]/.test(code[i])) i--;
    if (i === idEnd) break;
    start = i + 1;
    skipWs();
    if (code[i] !== '.') break;
    i--;
    skipWs();
  }
  return code.slice(start, end).replace(/\s+/g, '');
}

function classifyGetInputStream({ name, chain }, hasArgs) {
  if (hasArgs) return 'archive'; // ZipFile/JarFile.getInputStream(entry)
  if (/getRequestParameter|RequestParameter|getPart\b|multipart|upload|attachment/i.test(chain) || /param|part|upload|file|attachment/i.test(name)) return 'request-upload';
  if (/^(?:req|request|getRequest)$/i.test(name) || /Request$/.test(name)) return 'request-body';
  if (/conn|connection|socket|process|entity|response|resp|client|url|http/i.test(name)) return 'remote';
  return 'other';
}

/**
 * Find stream acquisition expressions in stripped code. Each hit:
 * `{ index, api, kind, deser?, recv?, inlineBinary? }` — `index` is the
 * offset used to group hits into statements.
 */
function findAcquisitions(code, visible) {
  const hits = [];
  const isVisible = (fq, name) => !!fq || visible.has(name);
  const push = (index, api, kind, extra = {}) => hits.push({ index, api, kind, ...extra });
  // What the stream reads from — a receiver (`bin`, `asset.getOriginal()`) or a
  // constructor/factory argument (`file`) — so size checks and read limits can
  // be matched to this stream rather than to anything else in the method.
  const fromReceiver = (dotIndex) => ({ source: receiverExpression(code, dotIndex) });
  const fromArgument = (openParenEnd) => ({ source: expressionAt(code, openParenEnd).trim() });
  let m;

  const newRe = new RegExp(`\\bnew\\s+(java\\.io\\.)?(${TYPE_ALT})\\s*\\(`, 'g');
  while ((m = newRe.exec(code))) {
    if (!isVisible(m[1], m[2])) continue;
    const type = m[2];
    const kind = type === 'FileInputStream' ? 'file'
      : (type === 'ByteArrayInputStream' || type === 'StringBufferInputStream') ? 'byte-array'
        : type === 'PipedInputStream' ? 'pipe'
          : 'wrapper';
    push(m.index, type, kind, { ...fromArgument(m.index + m[0].length), ...(type === 'ObjectInputStream' ? { deser: true } : {}) });
  }

  // ObjectInputStream subclasses (DynamicObjectInputStream, ClassLoaderObjectInputStream,
  // ValidatingObjectInputStream, …) deserialize too — matched by name, any package.
  const deserRe = /\bnew\s+(?:[\w$]+\s*\.\s*)*([A-Za-z_$][\w$]*ObjectInputStream)\s*\(/g;
  while ((m = deserRe.exec(code))) {
    if (m[1] !== 'ObjectInputStream') push(m.index, m[1], 'wrapper', { deser: true });
  }

  const simple = [
    [/\bFiles\s*\.\s*newInputStream\s*\(/g, 'Files.newInputStream', 'file'],
    [/\bFileUtils\s*\.\s*openInputStream\s*\(/g, 'FileUtils.openInputStream', 'file'],
    [/\bgetResourceAsStream\s*\(/g, 'getResourceAsStream', 'bundle-resource'],
  ];
  for (const [re, api, kind] of simple) {
    while ((m = re.exec(code))) push(m.index, api, kind, fromArgument(m.index + m[0].length));
  }

  const adaptTo = /\.\s*adaptTo\s*\(\s*(?:java\s*\.\s*io\s*\.\s*)?InputStream\s*\.\s*class\s*\)/g;
  while ((m = adaptTo.exec(code))) {
    const r = receiverInfo(code, m.index);
    push(m.index, 'adaptTo(InputStream.class)', DAM_CHAIN_RE.test(r.chain) ? 'dam-binary' : 'repo-binary', { recv: r.name, ...fromReceiver(m.index) });
  }

  const getIs = /\.\s*getInputStream\s*\(/g;
  while ((m = getIs.exec(code))) {
    const next = code.slice(m.index + m[0].length).match(/^\s*(\S)/);
    const r = receiverInfo(code, m.index);
    push(m.index, 'getInputStream()', classifyGetInputStream(r, !!(next && next[1] !== ')')), fromReceiver(m.index));
  }

  const getStream = /\.\s*getStream\s*\(\s*\)/g;
  while ((m = getStream.exec(code))) {
    const r = receiverInfo(code, m.index);
    if (visible.size > 0 || /rendition|original|asset|binary|blob|property|value|content/i.test(r.chain)) {
      push(m.index, 'getStream()', DAM_CHAIN_RE.test(r.chain) ? 'dam-binary' : 'repo-binary', {
        recv: r.name,
        inlineBinary: /\bgetBinary\s*\(\s*\)\s*$/.test(r.chain),
        ...fromReceiver(m.index),
      });
    }
  }

  const openStream = /\.\s*openStream\s*\(\s*\)/g;
  while ((m = openStream.exec(code))) {
    const r = receiverInfo(code, m.index);
    push(m.index, 'openStream()', /getEntry|getResource|bundle|classLoader/i.test(r.chain) ? 'bundle-resource' : 'remote', fromReceiver(m.index));
  }

  // Remote responses whose stream is often consumed inline, with no stream
  // type named in the source. The entity's stream belongs to the response, so
  // an inline read doesn't own it.
  const entityContent = /\.\s*getContent\s*\(\s*\)/g;
  while ((m = entityContent.exec(code))) {
    const r = receiverInfo(code, m.index);
    if (/entity|getEntity\s*\(/i.test(r.chain)) push(m.index, 'HttpEntity.getContent()', 'remote', { owned: false, ...fromReceiver(m.index) });
  }
  const errorStream = /\.\s*getErrorStream\s*\(\s*\)/g;
  while ((m = errorStream.exec(code))) push(m.index, 'getErrorStream()', 'remote', fromReceiver(m.index));

  // Declared stream locals/fields with an initializer from an arbitrary call
  // (`InputStream in = service.load();`) — owned here, so closable. Indexed at
  // the RHS so the statement prefix keeps the `Type var =` binding.
  const declRe = new RegExp(`\\b(java\\.io\\.)?(${TYPE_ALT})\\s+([A-Za-z_$][\\w$]*)\\s*=(?!=)\\s*`, 'g');
  while ((m = declRe.exec(code))) {
    if (!isVisible(m[1], m[2])) continue;
    const rhsIndex = m.index + m[0].length;
    const rhs = code.slice(rhsIndex, rhsIndex + 80);
    if (/^null\b/.test(rhs)) continue;
    if (/^[A-Za-z_$][\w$]*\s*[;)]/.test(rhs)) {
      push(rhsIndex, m[2], 'alias');
      continue;
    }
    // A helper named for a rendition or original (`getXmlRenditionInputStream(asset)`) reads a DAM binary.
    push(rhsIndex, m[2], /rendition|original/i.test(expressionAt(code, rhsIndex)) ? 'dam-binary' : 'declared');
  }

  return hits.sort((a, b) => a.index - b.index);
}

/** The expression starting at `start`: up to a top-level `;` or `,`, or an unmatched `)`. */
function expressionAt(code, start) {
  let depth = 0;
  for (let i = start; i < code.length; i++) {
    const c = code[i];
    if (c === '(') depth++;
    else if (c === ')') { if (depth === 0) return code.slice(start, i); depth--; }
    else if ((c === ';' || c === ',') && depth === 0) return code.slice(start, i);
  }
  return code.slice(start);
}

/**
 * The read limit that applies to this stream, or null: a limit in the same
 * statement (`new BoundedInputStream(req.getInputStream(), n)`,
 * `in.readNBytes(n)`), a limit wrapping or reading its variable elsewhere in
 * the method, or — for uploaded parts — the upload parser's size limits.
 * Returns the kind of limit (`BoundedInputStream` or `limit`).
 */
function readLimitOf(hits, stmt, bound, scopeCode, source) {
  if (STATEMENT_LIMIT_RE.test(stmt)) return /\bBoundedInputStream\b/.test(stmt) ? 'BoundedInputStream' : 'limit';
  if (bound) {
    const v = escapeRe(bound.name);
    if (new RegExp(`\\bBoundedInputStream\\s*\\(\\s*${v}\\b|\\bsetInputStream\\s*\\(\\s*${v}\\b`).test(scopeCode)) return 'BoundedInputStream';
    if (new RegExp(`\\bByteStreams\\s*\\.\\s*limit\\s*\\(\\s*${v}\\b|\\b${v}\\s*\\.\\s*readNBytes\\s*\\(|\\btoByteArray\\s*\\(\\s*${v}\\s*,`).test(scopeCode)) return 'limit';
  }
  if (source === 'request-upload' && UPLOAD_LIMIT_RE.test(scopeCode)) return 'limit';
  return null;
}

/**
 * True when the method checks the size of this stream's own source before
 * reading: `<source>.getSize()` (a JCR Binary, rendition or uploaded part),
 * `Files.size(<source>)`, or `<source>.length()` on a `File`. A size check on
 * some other object doesn't count.
 */
function sizeKnownFor(hits, scopeCode, declText) {
  const compact = s => s.replace(/\s+/g, '');
  const body = compact(scopeCode);
  return hits.some(h => {
    if (!h.source) return false;
    const src = compact(h.source);
    if (!src) return false;
    const s = escapeRe(src);
    const isFile = /^[A-Za-z_$][\w$]*$/.test(src) && declaredType(src, declText) === 'File';
    return new RegExp(`(?<![\\w$.])${s}\\.getSize\\(\\)|\\bFiles\\.size\\(${s}\\)${isFile ? `|(?<![\\w$.])${s}\\.length\\(\\)` : ''}`).test(body);
  });
}

/** Identifier assigned by the statement prefix (`Type var =` / `var =`), else null. */
function boundVariable(prefix) {
  const re = /(this\s*\.\s*)?([A-Za-z_$][\w$]*)\s*=(?!=)/g;
  let m;
  let found = null;
  while ((m = re.exec(prefix))) {
    const before = prefix[m.index + m[0].length - 2] || '';
    if (/[!<>=+\-*/&|^%]/.test(before)) continue;
    found = { name: m[2], field: !!m[1], rhsStart: m.index + m[0].length };
  }
  return found;
}

/**
 * Calls still open at the end of `text`, outermost first:
 * `{ name, isNew, argIndex }` (argIndex = top-level commas seen inside it).
 */
function openCalls(text) {
  const stack = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(') {
      const before = text.slice(0, i).match(/(\bnew\s+)?([A-Za-z_$][\w$.]*)\s*$/);
      stack.push({ name: before ? before[2].split('.').pop() : '', isNew: !!(before && before[1]), argIndex: 0 });
    } else if (c === ')') {
      stack.pop();
    } else if (c === ',' && stack.length) {
      stack[stack.length - 1].argIndex++;
    }
  }
  return stack;
}

/** True when a call is a stream/reader wrapper constructor (passes ownership through). */
function isWrapperCall(call) {
  return call.isNew && STREAM_WRAPPER_CTOR_RE.test(call.name);
}

/**
 * Does a method/constructor declared in this file take a stream at `argIndex`
 * and take ownership of it — close it (try-with-resources / close / wrapper
 * closed) or keep it on a field? Then passing a fresh stream to it is not a
 * leak at the call site. `this(…)` resolves to the file's constructors.
 */
function helperTakesOwnership(code, blocks, regions, methodName, argIndex, classNames) {
  const names = methodName === 'this' ? classNames : [methodName];
  for (const name of names) {
    const re = new RegExp(`\\b${escapeRe(name)}\\s*\\(([^()]*)\\)\\s*(?:throws\\s+[\\w.,\\s]+)?\\{`, 'g');
    let m;
    while ((m = re.exec(code))) {
      const params = m[1].split(',').map(p => p.trim()).filter(Boolean);
      const param = params[argIndex];
      if (!param) continue;
      const pm = param.match(new RegExp(`\\b(?:java\\.io\\.)?(?:${TYPE_ALT})\\s+([A-Za-z_$][\\w$]*)$`));
      if (!pm) continue;
      const open = m.index + m[0].length - 1;
      const body = blocks.find(b => b.open === open);
      if (!body) continue;
      const bodyCode = code.slice(body.open, body.close);
      const p = escapeRe(pm[1]);
      const storedOnField = new RegExp(`\\bthis\\s*\\.\\s*[\\w$]+\\s*=\\s*${p}\\s*;`).test(bodyCode)
        || new RegExp(`(?:^|[;{]\\s*)([A-Za-z_$][\\w$]*)\\s*=\\s*${p}\\s*;`).test(bodyCode);
      if (storedOnField || closedLater(bodyCode, regions, body, pm[1])) return true;
    }
  }
  return false;
}

function closedLater(scopeCode, regions, scope, name, hops = 1) {
  const v = escapeRe(name);
  if (new RegExp(`\\b${v}\\s*\\.\\s*close\\s*\\(`).test(scopeCode)) return true;
  if (new RegExp(`\\bclose\\w*\\s*\\([^;]*\\b${v}\\b`).test(scopeCode)) return true;
  if (regions.some(r => r.open > scope.open && r.close < scope.close && new RegExp(`\\b${v}\\b`).test(scopeCode.slice(r.open - scope.open, r.close - scope.open)))) return true;
  // Closing a wrapper closes the wrapped stream: `b = new BufferedInputStream(in)` … `b.close()`.
  if (hops > 0) {
    const wrapRe = new RegExp(`([A-Za-z_$][\\w$]*)\\s*=\\s*new\\s+[\\w.$]+\\s*\\(\\s*${v}\\b`, 'g');
    let m;
    while ((m = wrapRe.exec(scopeCode))) {
      if (m[1] !== name && closedLater(scopeCode, regions, scope, m[1], hops - 1)) return true;
    }
  }
  return false;
}

/**
 * The statement segment holding `index`: from the previous `;`, `{` or `}` (or
 * the try-with-resources header start) to the next `;` (or header end), narrowed
 * to one declarator by top-level commas — commas outside parentheses, brackets
 * and generic type arguments, which in a statement only separate declarators
 * (`InputStream a = x(), b = y();`). Returns `{ start, end, stmtStart }`;
 * `stmtStart` is where the whole statement begins.
 */
function declaratorSegment(code, index, region) {
  let stmtStart = Math.max(code.lastIndexOf(';', index - 1), code.lastIndexOf('{', index - 1), code.lastIndexOf('}', index - 1));
  if (region && region.open > stmtStart) stmtStart = region.open;
  let stmtEnd = code.indexOf(';', index);
  if (stmtEnd === -1) stmtEnd = code.length;
  if (region && region.close < stmtEnd) stmtEnd = region.close;

  let start = stmtStart;
  let end = stmtEnd;
  let depth = 0;
  let angle = 0;
  for (let i = stmtStart + 1; i < stmtEnd; i++) {
    const c = code[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === '<' && /[\w$]/.test(code[i - 1] || '') && /[A-Z?]/.test(code[i + 1] || '')) angle++;
    else if (c === '>' && angle > 0) angle--;
    else if (c === ',' && depth === 0 && angle === 0) {
      if (i < index) start = i;
      else { end = i; break; }
    }
  }
  return { start, end, stmtStart };
}

/**
 * Scan one Java source. Returns `{ sites, typeRefLine }` where each site is a
 * statement that acquires a stream, pre-classified (categories A–F + fix kind).
 */
function scanJavaSource(src) {
  const code = stripCommentsAndStrings(src);
  const codeWithStrings = stripCommentsAndStrings(src, { keepStrings: true });
  const starts = lineStarts(src);
  const srcLines = src.split('\n');
  const visible = visibleJavaIoNames(code);
  const blocks = braceBlocks(code);
  classifyBlocks(code, blocks);
  const regions = twrRegions(code);
  const classNames = [...code.matchAll(/\b(?:class|enum|record)\s+([A-Za-z_$][\w$]*)/g)].map(m => m[1]);
  const fileCtx = {
    workflow: WORKFLOW_RE.test(code),
    // Lines that start a native process, reported at file level; a site only
    // gets category E when the process is started in its own method. Import
    // lines are blanked so naming a type in an import doesn't count as a use.
    nativeLines: [...new Set([...code.replace(/^\s*import\b[^;]*;/gm, m => m.replace(/[^\n]/g, ' ')).matchAll(new RegExp(NATIVE_RE.source, 'g'))].map(m => lineOf(starts, m.index)))],
    writeLines: [...new Set([...code.matchAll(FS_WRITE_RE)].map(m => lineOf(starts, m.index)))],
  };

  // Group acquisitions into statements — one per declarator, so `T a = …, b = …`
  // gives `a` and `b` their own sites.
  const statements = new Map();
  for (const hit of findAcquisitions(code, visible)) {
    const region = regions.find(r => r.open < hit.index && hit.index < r.close) || null;
    const seg = declaratorSegment(code, hit.index, region);
    if (!statements.has(seg.start)) {
      statements.set(seg.start, { segStart: seg.start, segEnd: seg.end, stmtStart: seg.stmtStart, region, hits: [] });
    }
    statements.get(seg.start).hits.push(hit);
  }

  const sites = [];
  for (const st of statements.values()) {
    const first = st.hits[0];
    const scope = scopeOf(blocks, first.index, code.length);
    const scopeCode = code.slice(scope.open, scope.close);
    // Declarations visible at this statement: the method's parameters plus the
    // method body up to the acquisition.
    const declText = `${scope.params || ''};${code.slice(scope.open, first.index)}`;
    for (const h of st.hits) {
      if (h.kind === 'repo-binary' && h.recv && DAM_TYPE_RE.test(declaredType(h.recv, declText) || '')) h.kind = 'dam-binary';
    }
    const kinds = st.hits.map(h => h.kind);
    if (kinds.every(k => k === 'alias')) continue;
    // `declared` (a typed local with an unrecognised initializer) is only the
    // source when nothing more specific — including a wrapper — is present.
    const specific = kinds.filter(k => k !== 'declared' && k !== 'alias');
    const source = specific.length
      ? (SOURCE_PRIORITY.find(k => specific.includes(k)) || 'other')
      : 'declared';
    const deser = st.hits.some(h => h.deser);
    const stmt = code.slice(st.segStart + 1, st.segEnd);
    const prefix = code.slice(st.segStart + 1, first.index);
    let bound = boundVariable(prefix);
    // `x = IOUtils.readLines(r.getStream())` binds the RESULT, not the stream:
    // if a non-wrapper call is still open between `=` and the acquisition, the
    // stream is an argument (inline). Wrapper constructors pass ownership through.
    const enclosing = openCalls(bound ? prefix.slice(bound.rhsStart) : prefix);
    if (bound && enclosing.some(c => !isWrapperCall(c))) bound = null;
    // A bare `name = …` with no declaration in the method assigns a field — but a
    // later declarator of `T a = …, b = …` is a local declared by the statement head.
    const laterDeclarator = st.segStart !== st.stmtStart
      && new RegExp(`^\\s*(?:final\\s+)?${NOT_A_TYPE}[A-Za-z_$][\\w$.]*(?:<[^;{}()]*>)?(?:\\[\\])*\\s+[A-Za-z_$][\\w$]*\\s*=`).test(code.slice(st.stmtStart + 1, st.segStart));
    const fieldOwned = !!bound && !laterDeclarator && (bound.field || !declaredType(bound.name, declText));
    // Returned directly (only wrapper constructors between `return` and the
    // acquisition), or as a lambda's expression body (`rm -> rm.adaptTo(…)`).
    // `return IOUtils.toString(r.getStream())` returns data — still a leak.
    let lastReturn = -1;
    for (const rm of prefix.matchAll(/\breturn\b/g)) lastReturn = rm.index;
    const returned = (lastReturn !== -1 && openCalls(prefix.slice(lastReturn + 6)).every(isWrapperCall))
      || /->\s*[\w$.]*(?:\([^()]*\)[\w$.]*)*$/.test(prefix);
    const inTwr = !!st.region;

    // B — opened here, never closed. Not applicable to the container-owned
    // request body, no-op ByteArrayInputStream, or wrappers over a stream this
    // statement didn't open (closing those belongs to whoever opened it).
    let leak = false;
    let consumer = null;
    // An inline read of a stream the statement doesn't own (an HTTP entity's content).
    const notOwnedInline = !bound && st.hits.every(h => h.owned === false || h.kind === 'declared' || h.kind === 'alias');
    if (!inTwr && !returned && !NOT_OWNED_SOURCES.has(source) && !notOwnedInline) {
      if (bound) {
        const v = escapeRe(bound.name);
        // Ownership leaves the method only when the stream itself is returned
        // (`return in;` / `return new Wrapper(in…)`) or stored on a field —
        // `return IOUtils.toString(in)` returns data, not the stream.
        const handedOff = fieldOwned
          || new RegExp(`\\breturn\\s+(?:\\(\\s*[\\w.$<>]+\\s*\\)\\s*)?${v}\\s*;`).test(scopeCode)
          || new RegExp(`\\breturn\\s+new\\s+[\\w.$]+\\s*\\([^;]*\\b${v}\\b`).test(scopeCode)
          || new RegExp(`\\bthis\\s*\\.\\s*[\\w$]+\\s*=\\s*${v}\\b`).test(scopeCode);
        leak = !handedOff && !closedLater(scopeCode, regions, scope, bound.name);
      } else {
        // Inline: leaked unless handed to a callee that keeps or closes it, or to
        // a same-file helper that takes ownership.
        consumer = [...enclosing].reverse().find(c => !isWrapperCall(c)) || null;
        leak = !(consumer && consumer.name && (HANDOFF_CALL_RE.test(consumer.name)
          || helperTakesOwnership(code, blocks, regions, consumer.name, consumer.argIndex, classNames)));
      }
    }
    // A JCR Binary from getBinary() must be disposed (JCR 2.0) — inline, it can't be.
    const undisposedBinary = st.hits.some(h => h.inlineBinary
      || (h.recv && declaredType(h.recv, declText) === 'Binary'
        && !new RegExp(`\\b${escapeRe(h.recv)}\\s*\\.\\s*dispose\\s*\\(`).test(scopeCode)));

    // C — whole stream read into memory, unknown size, no read limit on this stream.
    let buffered = false;
    const limitedBy = readLimitOf(st.hits, stmt, bound, scopeCode, source);
    const bounded = !!limitedBy || (KNOWN_SIZE_SOURCES.has(source) && sizeKnownFor(st.hits, scopeCode, declText));
    if (UNBOUNDED_SOURCES.has(source) && !bounded) {
      if (BUFFER_CALL_RE.test(stmt)) buffered = true;
      else if (bound) {
        const v = escapeRe(bound.name);
        buffered = new RegExp(`(?:toByteArray|toString|readLines|copyToByteArray|copyToString|readFully|toCharArray)\\s*\\(\\s*${v}\\b`).test(scopeCode)
          || new RegExp(`\\b${v}\\s*\\.\\s*(?:readAllBytes|lines)\\s*\\(`).test(scopeCode)
          || (/new\s+ByteArrayOutputStream/.test(scopeCode) && new RegExp(`\\b${v}\\s*\\.\\s*read\\s*\\(|\\bcopy\\w*\\s*\\(\\s*${v}\\b`).test(scopeCode))
          || (/^request-/.test(source) && new RegExp(`\\b(?:readValue|readTree|fromJson|parse)\\s*\\(\\s*${v}\\b|JSONTokener\\s*\\(\\s*${v}\\b`).test(scopeCode));
      }
    }

    const categories = [];
    const notes = [];
    let handoff = null;
    let critical = false;
    if (deser) {
      categories.push('F');
      critical = UNTRUSTED_RE.test(scopeCode);
      const deserApi = st.hits.find(h => h.deser).api;
      notes.push(critical ? `${deserApi} deserialization over request or untrusted input — security-critical` : `${deserApi} deserialization`);
      notes.push(DESER_FILTER_RE.test(scopeCode)
        ? 'a deserialization filter or allow-list is present — confirm it is restrictive'
        : 'replace the format if you own it; otherwise add an ObjectInputFilter allow-list');
    }
    const toResponse = RESPONSE_OUT_RE.test(scopeCode);
    if (source === 'dam-binary') {
      categories.push('E');
      notes.push(toResponse
        ? 'DAM binary streamed to the response — serve it through the CDN instead (redirect to the asset path)'
        : 'DAM binary read in the JVM, which downloads it onto the instance (Adobe: access binaries through the CDN; don\'t use asset.getOriginal().getStream())');
      if (fileCtx.workflow) notes.push('asset processing in a workflow step belongs in Asset Compute (processing profiles)');
    } else if (source === 'repo-binary' && toResponse) {
      categories.push('E');
      notes.push('repository binary streamed to the response — serve it through the CDN, or a direct download URI on author');
    } else if (/^request-/.test(source) && REPO_WRITE_RE.test(scopeCode)) {
      categories.push('E');
      handoff = /\bcreateAsset/.test(scopeCode) ? 'asset-manager' : null;
      notes.push(`client upload written into the repository${handoff ? ' via AssetManager.createAsset' : ''} — use direct binary upload on author; on publish, send it to an external store`);
    }
    // A native process started in the same method as this stream (the process's own
    // output, or a file it produced) — not every stream elsewhere in the class.
    if (NATIVE_RE.test(scopeCode)) {
      if (!categories.includes('E')) categories.push('E');
      notes.push('this method runs a native process (ProcessBuilder / Runtime.exec / FFmpeg helpers): native binaries can\'t be deployed to AEM as a Cloud Service, so confirm the command exists there or move the processing out of AEM (for assets, asset microservices)');
    }
    const fixedPath = source === 'file' && FIXED_PATH_RE.test(codeWithStrings.slice(st.segStart + 1, st.segEnd));
    const scratch = TEMP_API_RE.test(codeWithStrings.slice(scope.open, scope.close)) || TEMP_IDENT_RE.test(scopeCode);
    if (source === 'file' && (fixedPath || !scratch)) {
      categories.push('D');
      notes.push('reads the local filesystem, which isn\'t persistent or shared on AEM as a Cloud Service — move the data to a bundle resource, OSGi config, the repository (author) or an external store (publish)');
      notes.push(fileCtx.writeLines.length
        ? `local-filesystem writes in this file: ${fileCtx.writeLines.slice(0, 5).map(l => `L${l}`).join(', ')} — move them too`
        : 'find the code that writes this file and move it too');
    }
    if (buffered && categories.length === 0) {
      // C only stands alone: the F/E/D remedies already replace the read.
      categories.push('C');
      const contentLength = /^request-/.test(source) && /getContentLength/.test(scopeCode)
        ? ' (a Content-Length check doesn\'t limit the read: it is -1 for chunked requests)'
        : '';
      notes.push(`whole ${source} stream read into memory with no read limit${contentLength}`);
    }
    if (leak) {
      categories.push('B');
      notes.push(consumer && consumer.name && !CONTROL_WORDS.has(consumer.name)
        ? `stream passed to ${consumer.isNew ? 'new ' : ''}${consumer.name}(…) is never closed — confirm the callee doesn't close or keep it`
        : 'stream is never closed (no try-with-resources / close)');
    }
    if (undisposedBinary) {
      if (!categories.includes('B')) categories.push('B');
      notes.push('JCR Binary from getBinary() is never disposed — keep a reference and call dispose() in a finally block');
    }
    if (categories.length === 0) {
      categories.push('A');
      notes.push(inTwr ? `${source} stream, closed via try-with-resources`
        : fieldOwned ? 'stream kept on a field — the owning object closes it'
          : returned ? `${source} stream returned to the caller`
            : `${source} stream — no change needed`);
    }
    if (limitedBy === 'BoundedInputStream') {
      notes.push('BoundedInputStream stops at the limit without an error — make sure oversized input is rejected, not silently truncated');
    }
    categories.sort((a, b) => CATEGORY[a].rank - CATEGORY[b].rank);
    const primary = categories[0];
    const fix = categories.map(c => CATEGORY[c].fix).sort((a, b) => FIX_RANK[a] - FIX_RANK[b])[0];
    const line = lineOf(starts, first.index);
    sites.push({
      line,
      snippet: (srcLines[line - 1] || '').trim().slice(0, 160),
      api: [...new Set(st.hits.map(h => h.api))].join(' + '),
      source,
      categories,
      primary,
      fix,
      severity: critical ? 'critical' : CATEGORY[primary].severity,
      variable: bound ? bound.name : null,
      note: notes.join('; '),
      ...(handoff ? { handoff } : {}),
    });
  }
  sites.sort((a, b) => a.line - b.line);

  // First non-import reference to a visible java.io stream type (type-only usage).
  let typeRefLine = null;
  const refRe = new RegExp(`\\b(java\\.io\\.)?(${TYPE_ALT})\\b`, 'g');
  let m;
  while ((m = refRe.exec(code))) {
    if (!m[1] && !visible.has(m[2])) continue;
    const line = lineOf(starts, m.index);
    if (/^\s*import\b/.test(srcLines[line - 1] || '')) continue;
    typeRefLine = line;
    break;
  }

  return { sites, typeRefLine, nativeLines: fileCtx.nativeLines };
}

// ── Workspace scan + BPA merge ──────────────────────────────────────────────

function packageRoot(fqcn) {
  const segs = fqcn.split('.').slice(0, -1);
  return segs.length ? segs.slice(0, 3).join('.') : '(default package)';
}

/** Namespace a class belongs to: two package segments, three under a shared root. */
function namespaceRoot(fqcn) {
  const segs = fqcn.split('.').slice(0, -1);
  if (segs.length === 0) return null;
  const two = segs.slice(0, 2).join('.');
  if (!SHARED_ROOTS.has(two) && !SHARED_ROOTS.has(segs[0])) return two;
  return segs.length >= 3 ? segs.slice(0, 3).join('.') : null;
}

function maxSeverity(list) {
  return list.reduce((best, s) => (SEVERITY_RANK[s] < SEVERITY_RANK[best] ? s : best), 'info');
}

function summarizeSites(sites) {
  const counts = {};
  const fix = { auto: 0, review: 0, decision: 0 };
  for (const s of sites) {
    for (const c of s.categories) if (c !== 'A') counts[c] = (counts[c] || 0) + 1;
    if (fix[s.fix] !== undefined) fix[s.fix]++;
  }
  return { counts, fix };
}

const GROUP_ORDER = { 'missing-source': 0, 'not-in-workspace': 1, 'platform-provided': 2 };

/**
 * Scan the workspace's `src/main/java` sources for java.io.InputStream usage.
 *
 * Precedence matches the other migration patterns: BPA first, local detection
 * only when BPA has nothing.
 *   - `bpa` mode (BPA targets given): the BPA rows define the scope. Each
 *     flagged class is resolved to its workspace file and only those files are
 *     scanned, for line-level sites; classes outside the workspace collapse to
 *     one row per bundle (or package, when the rows carry no bundle name).
 *   - `local` mode (no BPA targets): every `src/main/java` file is scanned.
 *
 * @param {string} workspaceRoot
 * @param {{ bpaTargets?: Array<{className: string, identifier?: string, bundle?: string}>, files?: string[] }} [options]
 *   `files` restricts the scan to the given files (apply-time verification);
 *   BPA rows are ignored in that mode.
 * @returns {{ ok: boolean, findings: object[], rawFindings: object[], warnings: string[], stats: object, error?: string }}
 */
function runInputStreamScan(workspaceRoot, options = {}) {
  const { bpaTargets = [], files: onlyFiles = null } = options;
  if (!workspaceRoot) {
    return { ok: false, findings: [], rawFindings: [], warnings: [], stats: {}, error: 'no workspaceRoot' };
  }
  const mode = !onlyFiles && bpaTargets.length > 0 ? 'bpa' : 'local';

  const files = onlyFiles
    ? onlyFiles.map(f => (path.isAbsolute(f) ? f : path.join(workspaceRoot, f)))
    : collectJavaFiles(workspaceRoot);

  // Index every file (FQCN → file) so BPA classes can be resolved. A file that
  // can't be read is recorded, never silently dropped.
  const index = new Map();
  const sources = new Map();
  const skippedFiles = [];
  for (const file of files) {
    let src;
    try {
      src = fs.readFileSync(file, 'utf8');
    } catch (err) {
      skippedFiles.push({ file, reason: err.code === 'ENOENT' ? 'not found' : `unreadable (${err.code || err.message})` });
      continue;
    }
    sources.set(file, src);
    const { pkg, types } = declaredTypes(stripCommentsAndStrings(src));
    for (const t of types) index.set(pkg ? `${pkg}.${t}` : t, file);
  }

  const scanCache = new Map();
  const nativeLinesByFile = new Map();
  const sitesOfFile = (file) => {
    if (scanCache.has(file)) return scanCache.get(file);
    const src = sources.get(file);
    const scan = src === undefined ? { sites: [], typeRefLine: null, nativeLines: [] } : scanJavaSource(src);
    if (scan.nativeLines.length > 0) nativeLinesByFile.set(file, scan.nativeLines);
    if (scan.sites.length === 0 && scan.typeRefLine) {
      scan.sites.push({
        line: scan.typeRefLine,
        snippet: (src.split('\n')[scan.typeRefLine - 1] || '').trim().slice(0, 160),
        api: 'type reference', source: 'type-only', categories: ['A'], primary: 'A', fix: 'none',
        severity: 'info', variable: null, note: 'java.io stream type used only as a parameter/return/field type',
      });
    }
    scanCache.set(file, scan.sites);
    return scan.sites;
  };

  // Resolve BPA rows.
  const bpaByFile = new Map();
  const groups = new Map();
  if (mode === 'bpa') {
    const workspaceBundles = new Set();
    const unresolved = [];
    for (const t of bpaTargets) {
      const cls = String(t.className || '').trim();
      if (!cls) continue;
      const outer = cls.split('$')[0];
      const file = index.get(outer);
      if (file) {
        const e = bpaByFile.get(file) || { classes: new Set(), apis: new Set() };
        e.classes.add(cls);
        if (t.identifier) e.apis.add(t.identifier);
        bpaByFile.set(file, e);
        if (t.bundle) workspaceBundles.add(t.bundle);
      } else {
        unresolved.push({ t, outer });
      }
    }
    for (const { t, outer } of unresolved) {
      const key = t.bundle ? `bundle ${t.bundle}` : `package ${packageRoot(outer)}`;
      const g = groups.get(key) || { key, bundle: t.bundle || null, classes: new Set(), rows: 0, apis: {} };
      g.classes.add(outer);
      g.rows++;
      if (t.identifier) g.apis[t.identifier] = (g.apis[t.identifier] || 0) + 1;
      groups.set(key, g);
    }
    // Customer code kept elsewhere: the bundle has classes in this workspace,
    // or most of its classes share the workspace's package namespace.
    const workspaceRoots = new Set([...index.keys()].map(namespaceRoot).filter(Boolean));
    for (const g of groups.values()) {
      const shared = [...g.classes].filter(c => workspaceRoots.has(namespaceRoot(c))).length;
      const platform = g.bundle
        ? PLATFORM_PROVIDED_BUNDLES.some(re => re.test(g.bundle))
        : [...g.classes].every(c => PLATFORM_PROVIDED_PACKAGES.test(c));
      if (g.bundle && workspaceBundles.has(g.bundle)) g.kind = 'missing-source';
      else if (platform) g.kind = 'platform-provided';
      else if (shared * 2 >= g.classes.size) g.kind = 'missing-source';
      else g.kind = 'not-in-workspace';
    }
  }

  // In bpa mode only the BPA-reported files are in scope; local mode scans everything.
  const perFile = new Map();
  for (const file of mode === 'bpa' ? [...bpaByFile.keys()] : [...sources.keys()]) {
    const sites = sitesOfFile(file);
    if (sites.length > 0) perFile.set(file, sites);
  }

  const findings = [];
  const rawFindings = [];
  const add = (finding, raw) => { findings.push(finding); rawFindings.push(raw); };

  const fileEntries = [...perFile.entries()].map(([file, sites]) => {
    const actionable = sites.filter(s => s.primary !== 'A');
    const { counts, fix } = summarizeSites(sites);
    const top = actionable.slice().sort((a, b) =>
      (SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]) || (CATEGORY[a.primary].rank - CATEGORY[b.primary].rank) || (a.line - b.line))[0];
    return { file, sites, actionable, counts, fix, top, severity: maxSeverity(actionable.map(s => s.severity)) };
  });
  fileEntries.sort((a, b) =>
    (b.actionable.length > 0) - (a.actionable.length > 0)
    || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    || (a.top && b.top ? CATEGORY[a.top.primary].rank - CATEGORY[b.top.primary].rank : 0)
    || a.file.localeCompare(b.file));

  for (const e of fileEntries) {
    const bpa = bpaByFile.get(e.file);
    const anchor = e.top || e.sites[0];
    const countStr = Object.keys(e.counts).sort((a, b) => CATEGORY[a].rank - CATEGORY[b].rank).map(c => `${c}×${e.counts[c]}`).join(' ');
    const fixStr = ['decision', 'review', 'auto'].filter(k => e.fix[k]).map(k => `${k} ${e.fix[k]}`).join(', ');
    const nativeLines = nativeLinesByFile.get(e.file) || [];
    // Reported at file level: a class that starts native processes is a migration
    // concern of its own, separate from any one stream site in it.
    const nativeNote = nativeLines.length > 0
      ? ` · starts a native process (${nativeLines.slice(0, 3).map(l => `L${l}`).join(', ')}): native binaries can't be deployed to AEM as a Cloud Service`
      : '';
    const detail = (e.top
      ? `${countStr} · ${fixStr} · L${e.top.line} ${e.top.primary}: ${e.top.note.split('; ')[0]}${bpa ? ' · BPA ✓' : ''}`
      : `benign (${e.sites.length} site${e.sites.length > 1 ? 's' : ''}): ${e.sites[0].note.split('; ')[0]}${bpa ? ' · BPA ✓' : ''}`) + nativeNote;
    const informational = e.actionable.length === 0;
    add(
      { location: `${e.file}:${anchor.line}`, detail, severity: informational ? 'info' : e.severity, ...(informational ? { informational: true } : {}) },
      {
        pattern: 'inputStream', file: e.file, line: anchor.line, snippet: anchor.snippet, kind: 'source',
        severity: informational ? 'info' : e.severity, fix: e.fix, sites: e.sites,
        ...(nativeLines.length > 0 ? { nativeProcessLines: nativeLines } : {}),
        ...(bpa ? { bpa: { classes: [...bpa.classes].sort(), apis: [...bpa.apis].sort() } } : {}),
        ...(informational ? { informational: true } : {}),
      }
    );
  }

  // BPA classes that resolve to a file with no detectable stream usage. The
  // hint names same-directory files that do use streams (scanned on demand).
  const siblingsWithStreams = (file) => {
    const dir = path.dirname(file);
    return [...sources.keys()]
      .filter(f => f !== file && path.dirname(f) === dir && sitesOfFile(f).some(s => s.primary !== 'A'))
      .map(f => path.basename(f))
      .sort()
      .slice(0, 3);
  };
  for (const [file, bpa] of [...bpaByFile.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (perFile.has(file)) continue;
    const siblings = siblingsWithStreams(file);
    const hint = 'BPA analyses compiled classes, so a use may not be visible in source (for example a stream passed straight from one library call to another)'
      + (siblings.length ? `; also check same-package files that use streams: ${siblings.join(', ')}` : '; if the file no longer uses streams, the report predates the change');
    add(
      { location: file, detail: `BPA flags ${[...bpa.apis].join(', ') || 'java.io stream use'}; no stream usage found in source — ${hint}`, severity: 'info', informational: true },
      { pattern: 'inputStream', file, line: null, snippet: null, kind: 'bpa-unmatched', informational: true, bpa: { classes: [...bpa.classes].sort(), apis: [...bpa.apis].sort() }, hint }
    );
  }

  // BPA rows outside the workspace — one row per bundle. Customer code kept
  // elsewhere comes first: it hides real work the scan couldn't see.
  const ordered = [...groups.values()].sort((a, b) => GROUP_ORDER[a.kind] - GROUP_ORDER[b.kind] || b.rows - a.rows || a.key.localeCompare(b.key));
  for (const g of ordered) {
    const apis = Object.entries(g.apis).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([api, n]) => `${api.replace(/^java\.io\./, '')}×${n}`).join(', ');
    const size = `${g.classes.size} ${g.classes.size === 1 ? 'class' : 'classes'} / ${g.rows} BPA ${g.rows === 1 ? 'row' : 'rows'} (${apis})`;
    const detail = {
      'missing-source': `customer code not in this workspace — ${size} · fix it in the repository that builds it: open that repository and re-scan`,
      'platform-provided': `AEM Forms add-on bundle — ${size} · provided by Adobe on AEM as a Cloud Service when the Forms add-on is enabled in Cloud Manager; don't deploy or edit it`,
      'not-in-workspace': `third-party code — ${size} · upgrade to a version that supports AEM as a Cloud Service or replace it; don't edit vendored code`,
    }[g.kind];
    add(
      { location: g.key, detail, severity: 'info', informational: true },
      {
        pattern: 'inputStream', file: null, line: null, snippet: null, kind: g.kind, informational: true,
        bundle: g.bundle, group: g.key, classCount: g.classes.size, rowCount: g.rows, sampleClasses: [...g.classes].sort().slice(0, 5),
      }
    );
  }

  const allSites = fileEntries.flatMap(e => e.sites);
  const byCategory = {};
  allSites.forEach(s => s.categories.forEach(c => { byCategory[c] = (byCategory[c] || 0) + 1; }));
  const fixTotals = { auto: 0, review: 0, decision: 0 };
  allSites.forEach(s => { if (fixTotals[s.fix] !== undefined) fixTotals[s.fix]++; });
  const rowsOf = kind => ordered.filter(g => g.kind === kind).reduce((n, g) => n + g.rows, 0);
  const missingSourceGroups = ordered.filter(g => g.kind === 'missing-source');
  const stats = {
    mode,
    filesRequested: files.length,
    filesScanned: scanCache.size,
    filesIndexed: sources.size,
    skippedFiles: skippedFiles.map(f => ({ file: f.file, reason: f.reason })),
    filesWithStreams: fileEntries.length,
    actionableFiles: fileEntries.filter(e => e.actionable.length > 0).length,
    sites: allSites.length,
    byCategory,
    fix: fixTotals,
    bpa: {
      rows: mode === 'bpa' ? bpaTargets.length : 0,
      resolvedFiles: bpaByFile.size,
      unmatchedFiles: [...bpaByFile.keys()].filter(f => !perFile.has(f)).length,
      missingSourceRows: rowsOf('missing-source'),
      thirdPartyRows: rowsOf('not-in-workspace'),
      platformProvidedRows: rowsOf('platform-provided'),
      bundleGroups: ordered.length,
    },
  };

  const warnings = [];
  for (const f of skippedFiles) {
    warnings.push(`inputStream: ${path.relative(workspaceRoot, f.file) || f.file} was not scanned — ${f.reason}.`);
  }
  if (mode === 'bpa' && files.length === 0) {
    warnings.push(`inputStream: BPA reports ${bpaTargets.length} java.io.inputstream rows but the workspace has no src/main/java sources — open the AEM project root so they can be resolved.`);
  } else if (mode === 'bpa' && bpaByFile.size === 0) {
    warnings.push(`inputStream: none of the ${bpaTargets.length} BPA rows resolve to workspace source — they belong to bundles outside this workspace (or the report is for a different project).`);
  }
  for (const g of missingSourceGroups) {
    const label = g.bundle ? `bundle ${g.bundle}` : g.key;
    const one = g.classes.size === 1;
    warnings.push(`inputStream: ${g.classes.size} BPA-flagged ${one ? 'class' : 'classes'} from ${label} ${one ? 'looks' : 'look'} like customer code but ${one ? 'has' : 'have'} no source in this workspace (e.g. ${[...g.classes].sort()[0]}) — open the repository that builds ${one ? 'it' : 'them'} and re-scan.`);
  }

  // A verification re-scan (--files) that couldn't read every requested file is
  // incomplete, so it must not pass as clean.
  if (onlyFiles && skippedFiles.length > 0) {
    return {
      ok: false, findings, rawFindings, warnings, stats,
      error: `${skippedFiles.length} of ${files.length} requested file(s) could not be scanned: `
        + skippedFiles.map(f => `${path.relative(workspaceRoot, f.file) || f.file} (${f.reason})`).join(', '),
    };
  }
  return { ok: true, findings, rawFindings, warnings, stats };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function parseCliArgs(argv) {
  const args = { workspaceRoot: null, csv: null, bpaJson: null, collections: './unified-collections', files: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--csv') args.csv = argv[++i];
    else if (a === '--bpa-json') args.bpaJson = argv[++i];
    else if (a === '--collections') args.collections = argv[++i];
    else if (a === '--files') args.files = String(argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--json') args.json = true;
    else if (!args.workspaceRoot) args.workspaceRoot = a;
  }
  return args;
}

/** inputStream targets from a `--bpa-json` file: `[targets]` or `{ "inputStream": [targets], … }`. */
function readBpaJson(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const targets = Array.isArray(data) ? data : data && data.inputStream;
  return Array.isArray(targets) ? targets : [];
}

/**
 * BPA targets in the migration skill's precedence: CAM targets (`--bpa-json`)
 * first, then the BPA CSV. Returns `{ targets, source }`; no targets means the
 * caller falls back to the local scan.
 */
async function loadBpaTargets(args) {
  if (args.bpaJson) {
    const targets = readBpaJson(args.bpaJson);
    if (targets.length > 0) return { targets, source: 'cam' };
  }
  if (args.csv) {
    const { getBpaFindings } = require('./bpa-findings-helper.js');
    const log = console.log;
    console.log = () => {};
    let res;
    try {
      res = await getBpaFindings('inputStream', { bpaFilePath: args.csv, collectionsDir: args.collections, limit: null, offset: 0 });
    } finally {
      console.log = log;
    }
    if (res.success && res.targets.length > 0) return { targets: res.targets, source: 'csv' };
    if (!res.success && !res.availablePatterns) console.error(`BPA read failed: ${res.error || res.message}`);
  }
  return { targets: [], source: null };
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (!args.workspaceRoot) {
    console.error('Usage: node input-stream-runner.js <workspaceRoot> [--bpa-json <cam-targets.json>] [--csv <bpa.csv>] [--collections <dir>] [--files <a.java,b.java>] [--json]');
    process.exit(1);
  }
  const root = path.resolve(args.workspaceRoot);
  const bpa = args.files ? { targets: [], source: null } : await loadBpaTargets(args);
  const bpaTargets = bpa.targets;

  const result = runInputStreamScan(root, { bpaTargets, files: args.files });
  const rel = f => (f ? path.relative(root, f) : f);
  if (args.json) {
    const findings = result.rawFindings.map(r => ({ ...r, file: rel(r.file) }));
    process.stdout.write(`${JSON.stringify({ ok: result.ok, ...(result.error ? { error: result.error } : {}), workspaceRoot: root, source: bpa.source || 'local-scan', stats: result.stats, warnings: result.warnings, findings }, null, 2)}\n`);
    if (!result.ok) process.exitCode = 2;
    return;
  }
  const s = result.stats;
  console.log(`inputStream scan (${bpa.source ? `BPA ${bpa.source === 'cam' ? 'from CAM' : 'CSV'} first` : 'local — no BPA findings'}) — ${s.filesScanned}${s.filesRequested !== s.filesScanned && args.files ? ` of ${s.filesRequested} requested` : ''} Java files scanned, ${s.actionableFiles} actionable file(s), ${s.sites} stream site(s)`);
  console.log(`  fix kinds: decision ${s.fix.decision}, review ${s.fix.review}, auto ${s.fix.auto}`);
  if (s.bpa.rows) {
    console.log(`  BPA: ${s.bpa.rows} rows → ${s.bpa.resolvedFiles} workspace file(s); outside the workspace: `
      + `${s.bpa.missingSourceRows} customer, ${s.bpa.thirdPartyRows} third-party, ${s.bpa.platformProvidedRows} platform-provided (${s.bpa.bundleGroups} bundle group(s)); ${s.bpa.unmatchedFiles} unmatched`);
  }
  for (const r of result.rawFindings) {
    if (r.kind === 'source' && !r.informational) {
      console.log(`\n${rel(r.file)}  [${r.severity}]`);
      for (const site of r.sites) console.log(`  L${site.line} ${site.categories.join('+')} (${site.fix}) ${site.note}\n      ${site.snippet}`);
    }
  }
  result.warnings.forEach(w => console.log(`\n⚠️  ${w}`));
  if (!result.ok) {
    console.error(`\n❌ Incomplete scan — ${result.error}`);
    process.exitCode = 2;
  }
}

if (require.main === module) {
  main().catch(err => { console.error(err.message); process.exit(1); });
}

module.exports = {
  runInputStreamScan, scanJavaSource, stripCommentsAndStrings, collectJavaFiles, declaredTypes, readBpaJson,
  CATEGORY, JAVA_IO_STREAM_TYPES, PLATFORM_PROVIDED_BUNDLES, PLATFORM_PROVIDED_PACKAGES,
};
