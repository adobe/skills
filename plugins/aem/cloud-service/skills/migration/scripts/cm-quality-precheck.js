/**
 * Cloud Manager code-quality precheck (Branch J)
 *
 * Predicts, before a pipeline runs, the two Cloud Manager Code Quality results
 * that most often fail a migrated project even though its build and unit tests
 * pass:
 *
 *   - **Reliability rating** — Critical category, fails below D, so a single
 *     Blocker bug fails the pipeline and cannot be overridden.
 *   - **Coverage** — Important category, fails below 50%. Cloud Manager computes
 *     it as `(CT + CF + LC) / (2*B + EL)`, which equals
 *     `(covered branches + covered lines) / (branches + lines)` in JaCoCo terms.
 *
 * Cloud Manager builds with `mvn org.jacoco:jacoco-maven-plugin:prepare-agent
 * package`, so the JaCoCo agent, the Surefire `argLine` and the test-skip flags
 * of the project decide whether any coverage is recorded at all.
 *
 * Two modes:
 *
 *   static (default, no Maven, no network)
 *     - Tooling that silently zeroes coverage: Surefire/Failsafe `<argLine>`
 *       without `@{argLine}`, a JaCoCo version older than the build JDK
 *       supports, `skipTests` / `maven.test.skip` / `jacoco.skip`.
 *     - Blocker bugs of the Cloud Manager rule set that migrations introduce:
 *       java:S2095 (resource not closed), java:S2276 (`Thread.sleep` while
 *       holding a lock), java:S2168 (double-checked locking on a non-volatile
 *       field), and the OakPAL index rules IndexType, IndexAsyncProperty,
 *       IndexTikaNode and IndexDamAssetLucene.
 *     - Critical (not gate-failing) bug BannedPath: content under `/libs`.
 *     - Modules with main Java code but no tests (coverage drag).
 *
 *   --coverage (after `mvn ... prepare-agent package ... report`)
 *     Reads each module's `target/site/jacoco/jacoco.xml`, the Surefire
 *     reports and `target/jacoco.exec`, computes the Cloud Manager coverage
 *     over every module with main Java code (a module without data counts as
 *     fully uncovered, estimated from its sources), and ranks the classes whose
 *     tests would close the gap fastest.
 *
 * The Java checks are heuristics over source text, not SonarQube: every finding
 * is re-confirmed before it is edited. Cloud Manager's own scan stays the
 * authority; the report lists what this precheck does not evaluate.
 *
 * Usage:
 *   node cm-quality-precheck.js <projectRoot> [--coverage] [--target <pct>]
 *                               [--base <git-ref>] [--baseline <migration-runbook.json>]
 *                               [--json] [--out <file.md>]
 *
 * With --baseline (the runbook's `cmReadiness`), findings already in the baseline are
 * marked inherited and the status/exit code cover only what was added since.
 *
 * Exit codes: 0 = no gate failure predicted, 1 = gate failure predicted,
 *             2 = usage error.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { stripCommentsAndStrings, collectJavaFiles } = require('./input-stream-runner.js');
const { collapsible } = require('./md-collapse.js');
const { isHiddenDir } = require('./workspace-ignore.js');

const GATE_COVERAGE = 50;
const DEFAULT_TARGET = 55;
const SKIP_DIRS = new Set(['node_modules', '.git', 'target', 'dist', 'build', 'out', '.idea', '.vscode']);

// Lowest JaCoCo release with official support for each build JDK (JaCoCo change history).
const JACOCO_MIN_FOR_JDK = [[21, '0.8.11'], [17, '0.8.8'], [11, '0.8.3']];

// AutoCloseable types java:S2095 tracks when created with `new` and never closed.
// Openers acquire an OS resource themselves; wrappers only own one when they wrap a local opener.
const OPENER_TYPES = ['FileInputStream', 'FileOutputStream', 'FileReader', 'FileWriter', 'RandomAccessFile', 'ZipFile', 'JarFile', 'Socket', 'ServerSocket'];
const WRAPPER_TYPES = [
  'BufferedReader', 'BufferedWriter', 'BufferedInputStream', 'BufferedOutputStream',
  'InputStreamReader', 'OutputStreamWriter', 'PrintWriter', 'PrintStream',
  'DataInputStream', 'DataOutputStream', 'ObjectInputStream', 'ObjectOutputStream',
  'ZipInputStream', 'ZipOutputStream', 'JarInputStream', 'JarOutputStream',
  'GZIPInputStream', 'GZIPOutputStream', 'Scanner', 'Formatter',
];
const CLOSEABLE_TYPES = [...OPENER_TYPES, ...WRAPPER_TYPES];
const CLOSEABLE_FACTORIES = [
  'Files.newInputStream', 'Files.newOutputStream', 'Files.newBufferedReader', 'Files.newBufferedWriter',
  'Files.lines', 'Files.list', 'Files.walk', 'Files.find', 'Files.newDirectoryStream',
];

const SEVERITY_ORDER = { gate: 0, critical: 1, warn: 2, info: 3 };

// ── Small helpers ────────────────────────────────────────────────────────────

function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
}

function rel(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function compareVersions(a, b) {
  const pa = String(a).split(/[.-]/).map((x) => parseInt(x, 10)).filter((n) => !Number.isNaN(n));
  const pb = String(b).split(/[.-]/).map((x) => parseInt(x, 10)).filter((n) => !Number.isNaN(n));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

function jdkNumber(v) {
  if (v == null) return null;
  const s = String(v).trim();
  const m = s.match(/^1\.(\d+)/) || s.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

/** `[open, close]` index pairs of every `{ … }` block in stripped Java source. */
function braceBlocks(code) {
  const blocks = [];
  const stack = [];
  for (let i = 0; i < code.length; i++) {
    if (code[i] === '{') stack.push(i);
    else if (code[i] === '}' && stack.length) blocks.push({ open: stack.pop(), close: i, depth: stack.length });
  }
  return blocks;
}

function matchingParen(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '(') depth++;
    else if (code[i] === ')' && --depth === 0) return i;
  }
  return -1;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function walkFiles(dir, accept, acc = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!isHiddenDir(e.name) && !SKIP_DIRS.has(e.name)) walkFiles(full, accept, acc);
    } else if (e.isFile() && accept(full)) {
      acc.push(full);
    }
  }
  return acc;
}

// ── POM model (text-level; no Maven needed) ──────────────────────────────────

function stripXmlComments(xml) {
  return xml.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
}

/** `{ start, end, text }` of every `<tag>…</tag>` in `xml` (tags of this kind do not nest in a POM). */
function blocksOf(xml, tag) {
  const out = [];
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g');
  let m;
  while ((m = re.exec(xml))) out.push({ start: m.index, end: m.index + m[0].length, text: m[1] });
  return out;
}

function tagValue(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`));
  return m ? m[1] : null;
}

function readPom(file) {
  const xml = stripXmlComments(fs.readFileSync(file, 'utf8'));
  const profiles = blocksOf(xml, 'profile').map((p) => ({
    ...p,
    id: tagValue(p.text, 'id') || '(unnamed)',
    activeByDefault: /<activeByDefault>\s*true\s*<\/activeByDefault>/.test(p.text),
  }));
  const pluginManagement = blocksOf(xml, 'pluginManagement');
  const pluginBlocks = blocksOf(xml, 'plugin');
  const inRange = (ranges, i) => ranges.find((r) => i >= r.start && i < r.end) || null;
  const mainProps = {};
  for (const b of blocksOf(xml, 'properties')) {
    if (inRange(profiles, b.start) || inRange(pluginBlocks, b.start)) continue;
    const re = /<([\w.-]+)>\s*([^<]*?)\s*<\/\1>/g;
    let m;
    while ((m = re.exec(b.text))) mainProps[m[1]] = m[2];
    const empty = /<([\w.-]+)\s*\/>/g;
    while ((m = empty.exec(b.text))) mainProps[m[1]] = '';
  }
  const plugins = pluginBlocks.map((p) => ({
    ...p,
    artifactId: tagValue(p.text, 'artifactId'),
    version: tagValue(p.text.replace(/<dependencies>[\s\S]*?<\/dependencies>/, ''), 'version'),
    profile: inRange(profiles, p.start),
    managed: Boolean(inRange(pluginManagement, p.start)),
    line: lineAt(xml, p.start),
  }));
  return { file, dir: path.dirname(file), xml, profiles, mainProps, plugins };
}

function collectPoms(root) {
  return walkFiles(root, (f) => path.basename(f) === 'pom.xml').map(readPom);
}

/** Properties visible to `pom`: every ancestor pom inside the project, nearest last (wins). */
function propsFor(pom, poms) {
  const chain = poms
    .filter((p) => pom.dir === p.dir || pom.dir.startsWith(p.dir + path.sep))
    .sort((a, b) => a.dir.length - b.dir.length);
  return Object.assign({}, ...chain.map((p) => p.mainProps));
}

function resolve(value, props, depth = 0) {
  if (value == null || depth > 5) return value;
  const out = String(value).replace(/\$\{([\w.-]+)\}/g, (m, k) => (k in props ? props[k] : m));
  return out === value ? out : resolve(out, props, depth + 1);
}

// ── Static checks: build tooling ─────────────────────────────────────────────

function detectJdk(root, poms) {
  const javaVersionFile = path.join(root, '.cloudmanager', 'java-version');
  const cloudManager = fs.existsSync(javaVersionFile) ? jdkNumber(fs.readFileSync(javaVersionFile, 'utf8')) : null;
  let compiler = null;
  for (const pom of poms) {
    const props = propsFor(pom, poms);
    const candidates = ['maven.compiler.release', 'maven.compiler.target', 'maven.compiler.source', 'java.version']
      .map((k) => props[k]);
    for (const p of pom.plugins.filter((x) => x.artifactId === 'maven-compiler-plugin')) {
      candidates.push(tagValue(p.text, 'release'), tagValue(p.text, 'target'), tagValue(p.text, 'source'));
    }
    for (const c of candidates) {
      const n = jdkNumber(resolve(c, props));
      if (n && (!compiler || n > compiler)) compiler = n;
    }
  }
  return { cloudManager, compiler, effective: cloudManager || compiler };
}

function checkTooling(root, poms, jdk) {
  const findings = [];
  const add = (f) => findings.push(f);

  // JaCoCo version and property names (prepare-agent may set a custom propertyName).
  const jacocoPlugins = [];
  const agentProps = new Set(['argLine']);
  for (const pom of poms) {
    const props = propsFor(pom, poms);
    for (const p of pom.plugins.filter((x) => x.artifactId === 'jacoco-maven-plugin')) {
      jacocoPlugins.push({ pom, plugin: p, version: resolve(p.version, props) });
      const name = tagValue(p.text, 'propertyName');
      if (name) agentProps.add(resolve(name, props));
      if (/<skip>\s*true\s*<\/skip>/.test(p.text) && !p.profile) {
        add({ rule: 'jacoco-skipped', severity: 'gate', file: rel(root, pom.file), line: p.line,
          message: 'jacoco-maven-plugin is configured with `<skip>true</skip>`: no coverage is recorded, so Cloud Manager measures 0%.',
          fix: 'Remove the skip (or move it into a profile Cloud Manager does not activate).' });
      }
    }
  }
  const min = jdk.effective ? (JACOCO_MIN_FOR_JDK.find(([j]) => jdk.effective >= j) || [])[1] : null;
  for (const { pom, plugin, version } of jacocoPlugins) {
    if (min && version && /^\d/.test(version) && compareVersions(version, min) < 0) {
      add({ rule: 'jacoco-too-old', severity: 'gate', file: rel(root, pom.file), line: plugin.line,
        message: `jacoco-maven-plugin ${version} predates JDK ${jdk.effective} support (needs ${min}+). The agent fails to instrument classes, tests still pass, and coverage reads 0%.`,
        fix: `Set the jacoco-maven-plugin version to ${min} or later (the latest release is preferred).` });
    }
  }
  if (jdk.compiler && jdk.compiler > 8 && !jdk.cloudManager) {
    add({ rule: 'cm-java-version-missing', severity: 'info', file: '.cloudmanager/java-version', line: null,
      message: `The project compiles for Java ${jdk.compiler} but has no .cloudmanager/java-version; Cloud Manager then runs Maven on JDK 8.`,
      fix: 'Add .cloudmanager/java-version with 21 (preferred), 17 or 11, matching the local build JDK.' });
  }

  // argLine: a literal <argLine> replaces the JaCoCo agent argument unless it carries @{argLine}.
  for (const pom of poms) {
    const props = propsFor(pom, poms);
    for (const p of pom.plugins.filter((x) => ['maven-surefire-plugin', 'maven-failsafe-plugin'].includes(x.artifactId))) {
      const rawArgLine = tagValue(p.text, 'argLine');
      if (rawArgLine == null) continue;
      const argLine = rawArgLine.replace(/\s+/g, ' ').trim();
      const late = [...agentProps].some((n) => argLine.includes(`@{${n}}`));
      if (late) continue;
      const early = [...agentProps].find((n) => argLine.includes(`\${${n}}`));
      const unit = p.artifactId === 'maven-surefire-plugin';
      const inactiveProfile = p.profile && !p.profile.activeByDefault;
      if (inactiveProfile) {
        add({ rule: 'argline-drops-jacoco-agent', severity: 'info', file: rel(root, pom.file), line: p.line,
          message: `Profile '${p.profile.id}' sets a ${p.artifactId} \`<argLine>\` without \`@{argLine}\`; harmless unless the Cloud Manager build activates that profile.`,
          fix: 'No change needed if the profile stays inactive in Cloud Manager.' });
        continue;
      }
      if (early && !(early in props)) {
        add({ rule: 'argline-early-evaluation', severity: 'warn', file: rel(root, pom.file), line: p.line,
          message: `${p.artifactId} uses \`\${${early}}\`; this works only while no \`<${early}>\` property is declared in any pom.`,
          fix: `Use \`@{${early}}\` (late evaluation), as the JaCoCo documentation recommends.` });
        continue;
      }
      add({ rule: 'argline-drops-jacoco-agent', severity: unit ? 'gate' : 'warn', file: rel(root, pom.file), line: p.line,
        message: `${p.artifactId} sets \`<argLine>${argLine}</argLine>\` without \`@{argLine}\`: it replaces the JaCoCo agent argument, so ${unit ? 'unit tests run uninstrumented and Cloud Manager measures 0% coverage' : 'integration tests run uninstrumented'}.`,
        fix: `Prefix the JaCoCo argument: \`<argLine>@{argLine} ${argLine.replace(/\$\{argLine\}\s*/, '')}</argLine>\`, and declare an empty \`<argLine></argLine>\` property so builds without JaCoCo still start.` });
    }
  }

  // Test and coverage skip switches.
  const switches = { skipTests: 'skips unit tests', 'maven.test.skip': 'skips compiling and running tests', 'jacoco.skip': 'disables the JaCoCo agent' };
  for (const pom of poms) {
    for (const [key, effect] of Object.entries(switches)) {
      if (String(pom.mainProps[key]).trim() === 'true') {
        add({ rule: 'tests-skipped', severity: 'gate', file: rel(root, pom.file), line: lineAt(pom.xml, pom.xml.indexOf(`<${key}>`)),
          message: `\`<${key}>true</${key}>\` in the main \`<properties>\` ${effect} in every Cloud Manager build: coverage reads 0%.`,
          fix: `Remove the property, or move it into a profile developers activate explicitly.` });
      }
      for (const prof of pom.profiles) {
        if (new RegExp(`<${escapeRe(key)}>\\s*true\\s*</${escapeRe(key)}>`).test(prof.text)) {
          add({ rule: 'tests-skipped', severity: prof.activeByDefault ? 'gate' : 'info', file: rel(root, pom.file), line: lineAt(pom.xml, prof.start),
            message: `Profile '${prof.id}' sets ${key}=true${prof.activeByDefault ? ' and is activeByDefault, so Cloud Manager builds with it' : '; harmless unless the Cloud Manager build activates it'}.`,
            fix: prof.activeByDefault ? 'Drop activeByDefault or the skip from that profile.' : 'No change needed if the profile stays inactive in Cloud Manager.' });
        }
      }
    }
    const props = propsFor(pom, poms);
    for (const p of pom.plugins.filter((x) => x.artifactId === 'maven-surefire-plugin' && !x.profile)) {
      for (const tag of ['skip', 'skipTests']) {
        const v = tagValue(p.text, tag);
        // `${skipTests}` resolving to true is already reported on the property itself.
        const viaSwitch = v != null && Object.keys(switches).some((k) => v.includes(`\${${k}}`));
        if (v != null && !viaSwitch && String(resolve(v, props)).trim() === 'true') {
          add({ rule: 'tests-skipped', severity: 'gate', file: rel(root, pom.file), line: p.line,
            message: `maven-surefire-plugin \`<${tag}>\` resolves to true: no unit test runs in Cloud Manager.`,
            fix: `Remove \`<${tag}>\` from the Surefire configuration.` });
        }
      }
      if (/<testFailureIgnore>\s*true\s*<\/testFailureIgnore>/.test(p.text)) {
        add({ rule: 'test-failures-ignored', severity: 'warn', file: rel(root, pom.file), line: p.line,
          message: 'Surefire testFailureIgnore=true hides failing tests; their lines count as uncovered.',
          fix: 'Fix or delete the failing tests, then remove testFailureIgnore.' });
      }
    }
  }
  return findings;
}

// ── Static checks: Java Blocker bugs ─────────────────────────────────────────

/** Estimated executable lines of a Java file (conservative stand-in for Sonar's lines_to_cover). */
function estimateExecutableLines(src) {
  const code = stripCommentsAndStrings(src);
  let n = 0;
  for (const raw of code.split('\n')) {
    const line = raw.trim();
    if (!line || /^(package|import)\b/.test(line) || /^@\w+(\(.*\))?$/.test(line) || /^[{}();,\s]*$/.test(line)) continue;
    if (/^(if|else|for|while|do|switch|case|default|try|catch|finally|return|throw|break|continue)\b/.test(line)) { n++; continue; }
    if (!line.includes(';')) continue;
    // Field or abstract-method declarations without an initializer carry no executable code.
    if (!line.includes('=') && !line.includes('(') && /^[\w\s<>,?.\[\]]+;$/.test(line)) continue;
    n++;
  }
  return n;
}

function enclosingScope(blocks, idx) {
  // The depth-1 block (a top-level type's member body) bounds where a local resource can be closed.
  const containing = blocks.filter((b) => b.open < idx && idx < b.close).sort((a, b) => a.depth - b.depth);
  return containing[1] || containing[0] || null;
}

function inRegion(regions, idx) {
  return regions.some((r) => idx > r.open && idx < r.close);
}

function twrHeaders(code) {
  const out = [];
  const re = /\btry\s*\(/g;
  let m;
  while ((m = re.exec(code))) {
    const open = m.index + m[0].length - 1;
    out.push({ open, close: matchingParen(code, open) });
  }
  return out;
}

const NEW_CLOSEABLE_RE = new RegExp(`\\bnew\\s+(?:java\\.[\\w.]+\\.)?(${CLOSEABLE_TYPES.join('|')})\\s*\\(`, 'g');
const FACTORY_RE = new RegExp(`\\b(${CLOSEABLE_FACTORIES.map(escapeRe).join('|')})\\s*\\(`, 'g');
const OWNER_WRAPPER_RE = new RegExp(`\\bnew\\s+(?:java\\.[\\w.]+\\.)?(?:${CLOSEABLE_TYPES.join('|')})\\s*$`);
// A wrapper argument that opens something locally: an opener, a Files factory, or a File/Path.
const LOCAL_OPEN_RE = new RegExp(`\\bnew\\s+(?:java\\.[\\w.]+\\.)?(?:${OPENER_TYPES.join('|')}|File)\\s*\\(|\\bFiles\\s*\\.\\s*\\w+\\s*\\(|\\bPaths\\s*\\.\\s*get\\s*\\(|\\bPath\\s*\\.\\s*of\\s*\\(`);
const WRAPPER_SET = new Set(WRAPPER_TYPES);

function opensLocally(args) {
  // A leading string literal is a file name: new PrintWriter("out.txt").
  return LOCAL_OPEN_RE.test(args) || args.trim().startsWith('"');
}

/** java:S2095 candidates: closeable resources created with `new`/a Files factory and never closed. */
function findUnclosedResources(code) {
  const sites = [];
  const blocks = braceBlocks(code);
  const twr = twrHeaders(code);
  const candidates = [];
  let m;
  NEW_CLOSEABLE_RE.lastIndex = 0;
  while ((m = NEW_CLOSEABLE_RE.exec(code))) candidates.push({ idx: m.index, type: m[1], paren: m.index + m[0].length - 1 });
  FACTORY_RE.lastIndex = 0;
  while ((m = FACTORY_RE.exec(code))) candidates.push({ idx: m.index, type: m[1], paren: m.index + m[0].length - 1 });

  for (const c of candidates) {
    if (inRegion(twr, c.idx)) continue;
    // A wrapper around a caller-owned stream does not own it; closing it would close the caller's stream.
    if (WRAPPER_SET.has(c.type) && !opensLocally(code.slice(c.paren + 1, matchingParen(code, c.paren)))) continue;
    // Wrapped by another closeable constructor: the wrapper owns (and closes) it.
    let depth = 0;
    let parenOpen = -1;
    for (let i = c.idx - 1; i >= 0; i--) {
      const ch = code[i];
      if (ch === ')') depth++;
      else if (ch === '(') { if (depth === 0) { parenOpen = i; break; } depth--; } else if ((ch === ';' || ch === '{' || ch === '}') && depth === 0) break;
    }
    if (parenOpen > 0 && OWNER_WRAPPER_RE.test(code.slice(Math.max(0, parenOpen - 120), parenOpen))) continue;

    const stmtStart = Math.max(code.lastIndexOf(';', c.idx), code.lastIndexOf('{', c.idx), code.lastIndexOf('}', c.idx)) + 1;
    const before = code.slice(stmtStart, c.idx);
    if (/\breturn\s*$/.test(before)) continue;
    const scope = enclosingScope(blocks, c.idx);
    const body = scope ? code.slice(c.idx, scope.close) : code.slice(c.idx);
    const assign = before.match(/(?:(this)\s*\.\s*)?([A-Za-z_$][\w$]*)\s*=\s*$/);
    if (assign) {
      const v = assign[2];
      const vr = escapeRe(v);
      const declaredLocally = new RegExp(`[\\w>\\]]\\s+${vr}\\s*=\\s*$`).test(before)
        || (scope && new RegExp(`[\\w>\\]]\\s+${vr}\\s*[=;]`).test(code.slice(scope.open, stmtStart)));
      if (assign[1] || !declaredLocally) continue; // field: closed by its owner's lifecycle
      const handled = new RegExp(
        `\\b${vr}\\s*\\.\\s*close\\s*\\(|closeQuietly\\s*\\(\\s*${vr}\\b|\\breturn\\s+${vr}\\b|\\btry\\s*\\([^)]*\\b${vr}\\b|=\\s*${vr}\\s*;|\\bnew\\s+\\w+\\s*\\([^;]*\\b${vr}\\b`,
      ).test(body);
      if (handled) continue;
      sites.push({ idx: c.idx, type: c.type, variable: v });
    } else {
      sites.push({ idx: c.idx, type: c.type, variable: null });
    }
  }
  return sites;
}

/** Bodies of `synchronized` blocks and methods. */
function synchronizedRegions(code) {
  const regions = [];
  const re = /\bsynchronized\b/g;
  let m;
  while ((m = re.exec(code))) {
    let i = m.index + m[0].length;
    while (/\s/.test(code[i] || '')) i++;
    let open;
    if (code[i] === '(') {
      const close = matchingParen(code, i);
      open = close < 0 ? -1 : code.indexOf('{', close);
    } else {
      const brace = code.indexOf('{', i);
      const semi = code.indexOf(';', i);
      open = brace >= 0 && (semi < 0 || brace < semi) ? brace : -1;
    }
    if (open < 0) continue;
    let depth = 0;
    for (let k = open; k < code.length; k++) {
      if (code[k] === '{') depth++;
      else if (code[k] === '}' && --depth === 0) { regions.push({ open, close: k }); break; }
    }
  }
  return regions;
}

function scanJavaBlockers(src) {
  const code = stripCommentsAndStrings(src);
  const out = [];
  for (const s of findUnclosedResources(code)) {
    out.push({ rule: 'java:S2095', line: lineAt(code, s.idx),
      message: s.variable
        ? `${s.type} '${s.variable}' is never closed on this path (Blocker: "Resources should be closed").`
        : `${s.type} is created inline and never closed (Blocker: "Resources should be closed").`,
      fix: 'Open it in a try-with-resources header.' });
  }
  const sync = synchronizedRegions(code);
  const sleepRe = /\bThread\s*\.\s*sleep\s*\(/g;
  let m;
  while ((m = sleepRe.exec(code))) {
    if (inRegion(sync, m.index)) {
      out.push({ rule: 'java:S2276', line: lineAt(code, m.index),
        message: 'Thread.sleep(...) while holding a lock (Blocker).',
        fix: 'Sleep outside the synchronized region, or wait on the monitor (lock.wait(timeout)). In a migrated job, prefer a Sling Job retry over sleeping.' });
    }
  }
  const dcl = /\bif\s*\(\s*(?:this\s*\.\s*)?([A-Za-z_$][\w$]*)\s*==\s*null\s*\)\s*\{?\s*synchronized\s*\([^)]*\)\s*\{\s*if\s*\(\s*(?:this\s*\.\s*)?\1\s*==\s*null\s*\)/g;
  while ((m = dcl.exec(code))) {
    const field = escapeRe(m[1]);
    if (new RegExp(`\\bvolatile\\b[^;=(){}]*\\b${field}\\s*[;=]`).test(code)) continue;
    out.push({ rule: 'java:S2168', line: lineAt(code, m.index),
      message: `Double-checked locking on non-volatile field '${m[1]}' (Blocker).`,
      fix: 'Declare the field volatile, or use a holder class / eager initialization.' });
  }
  return out;
}

// ── Static checks: content packages ──────────────────────────────────────────

/** Minimal FileVault XML tree: `{ name, attrs, children, index }`. */
function parseVaultXml(xml) {
  const root = { name: '#doc', attrs: {}, children: [], index: 0 };
  const stack = [root];
  const re = /<(\/?)([A-Za-z_][\w:.\-]*)((?:\s+[\w:.\-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g;
  let m;
  while ((m = re.exec(xml))) {
    if (m[1]) { if (stack.length > 1) stack.pop(); continue; }
    const attrs = {};
    m[3].replace(/([\w:.\-]+)\s*=\s*"([^"]*)"/g, (_, k, v) => { attrs[k] = v; return ''; });
    const node = { name: m[2], attrs, children: [], index: m.index };
    stack[stack.length - 1].children.push(node);
    if (!m[4]) stack.push(node);
  }
  return root;
}

function vaultValue(v) {
  return v == null ? null : String(v).replace(/^\{[A-Za-z]+\}/, '');
}

function checkOakIndexes(root) {
  const findings = [];
  const sep = path.sep;
  const files = walkFiles(root, (f) => f.includes(`${sep}jcr_root${sep}_oak_index${sep}`) && path.basename(f) === '.content.xml');
  for (const file of files) {
    const xml = fs.readFileSync(file, 'utf8');
    const tree = parseVaultXml(xml);
    const visit = (node, dirName) => {
      for (const child of node.children) {
        if (child.attrs['jcr:primaryType'] === 'oak:QueryIndexDefinition') {
          const name = child.name === 'jcr:root' ? dirName : child.name;
          checkIndex(child, name, file, xml, findings, root);
        }
        visit(child, dirName);
      }
    };
    visit(tree, path.basename(path.dirname(file)));
  }
  return findings;
}

function checkIndex(node, name, file, xml, findings, root) {
  const at = { file: rel(root, file), line: lineAt(xml, node.index) };
  const type = vaultValue(node.attrs.type);
  const asyncV = vaultValue(node.attrs.async);
  const base = name.split('-')[0];
  const add = (rule, message, fix) => findings.push({ rule, severity: 'gate', ...at, message: `${name}: ${message}`, fix });
  if (type !== 'lucene') {
    add('IndexType', `index type is '${type || '(missing)'}'; custom index definitions must be type lucene (Blocker).`,
      'Convert the definition with Branch F (oakIndex) to a Lucene index.');
    return;
  }
  if (!asyncV || !/\basync\b/.test(asyncV)) {
    add('IndexAsyncProperty', 'Lucene index without an async property is synchronous (Blocker).', 'Add async="[async,nrt]" (or "[async]").');
  }
  if (['damAssetLucene', 'lucene', 'graphqlConfig'].includes(base)) {
    const tika = node.children.find((c) => c.name === 'tika');
    const hasTika = (tika && tika.children.some((c) => c.name === 'config.xml'))
      || fs.existsSync(path.join(path.dirname(file), node.name === 'jcr:root' ? '' : name, 'tika', 'config.xml'));
    if (!hasTika) {
      add('IndexTikaNode', `customization of ${base} has no tika/config.xml (Blocker).`,
        'Add the tika node with the Cloud Service config.xml (Branch F ships it in resources/tika/config.xml).');
    }
  }
  if (base === 'damAssetLucene') {
    if (!/visualSimilaritySearch/.test(node.attrs.tags || '')) {
      add('IndexDamAssetLucene', 'damAssetLucene customization lacks tags=[visualSimilaritySearch] (Blocker).', 'Add tags="[visualSimilaritySearch]".');
    }
    if (node.attrs.queryPaths != null) {
      add('IndexDamAssetLucene', 'damAssetLucene customization must not specify queryPaths (Blocker).', 'Remove queryPaths.');
    }
  }
}

function checkBannedPaths(root) {
  const findings = [];
  const filters = walkFiles(root, (f) => f.endsWith(path.join('META-INF', 'vault', 'filter.xml')));
  for (const file of filters) {
    const xml = stripXmlComments(fs.readFileSync(file, 'utf8'));
    const re = /<filter\b[^>]*\broot\s*=\s*"(\/libs(?:\/[^"]*)?)"/g;
    let m;
    while ((m = re.exec(xml))) {
      findings.push({ rule: 'BannedPath', severity: 'critical', file: rel(root, file), line: lineAt(xml, m.index),
        message: `Package filter installs content under ${m[1]} (Critical: customer packages must not modify /libs).`,
        fix: 'Overlay the node under /apps instead, and drop the /libs filter root.' });
    }
  }
  return findings;
}

// ── Modules ──────────────────────────────────────────────────────────────────

function javaModules(root, poms) {
  const modules = [];
  for (const pom of poms) {
    const mainDir = path.join(pom.dir, 'src', 'main', 'java');
    if (!fs.existsSync(mainDir)) continue;
    const mainFiles = collectJavaFiles(mainDir);
    if (!mainFiles.length) continue;
    const testDir = path.join(pom.dir, 'src', 'test', 'java');
    const testFiles = fs.existsSync(testDir) ? walkFiles(testDir, (f) => f.endsWith('.java')) : [];
    const estimatedLines = mainFiles.reduce((n, f) => n + estimateExecutableLines(fs.readFileSync(f, 'utf8')), 0);
    modules.push({ dir: pom.dir, name: rel(root, pom.dir) || '.', mainFiles, testFileCount: testFiles.length, estimatedLines });
  }
  return modules;
}

// ── Coverage mode ────────────────────────────────────────────────────────────

function counters(fragment) {
  const out = {};
  const re = /<counter\s+type="(\w+)"\s+missed="(\d+)"\s+covered="(\d+)"\s*\/>/g;
  let m;
  while ((m = re.exec(fragment))) out[m[1]] = { missed: +m[2], covered: +m[3] };
  return out;
}

/** Report- and class-level LINE/BRANCH counters from a JaCoCo XML report. */
function parseJacocoXml(xml) {
  const lastChild = Math.max(xml.lastIndexOf('</package>'), xml.lastIndexOf('</group>'), xml.lastIndexOf('<sessioninfo'));
  const total = counters(xml.slice(lastChild));
  const classes = [];
  const pkgRe = /<package\s+name="([^"]*)"\s*>([\s\S]*?)<\/package>/g;
  let p;
  while ((p = pkgRe.exec(xml))) {
    const clsRe = /<class\s+name="([^"]*)"(?:\s+sourcefilename="([^"]*)")?[^>]*>([\s\S]*?)<\/class>/g;
    let c;
    while ((c = clsRe.exec(p[2]))) {
      const own = counters(c[3].slice(c[3].lastIndexOf('</method>') + 1));
      classes.push({ name: c[1].replace(/\//g, '.'), pkg: p[1], source: c[2] || null, line: own.LINE || { missed: 0, covered: 0 }, branch: own.BRANCH || { missed: 0, covered: 0 } });
    }
  }
  return { line: total.LINE || { missed: 0, covered: 0 }, branch: total.BRANCH || { missed: 0, covered: 0 }, classes };
}

function surefireStats(moduleDir) {
  const dir = path.join(moduleDir, 'target', 'surefire-reports');
  const stats = { tests: 0, skipped: 0, failures: 0, errors: 0, found: false };
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => /^TEST-.*\.xml$/.test(f)); } catch { return stats; }
  for (const f of files) {
    const head = fs.readFileSync(path.join(dir, f), 'utf8').match(/<testsuite\b[^>]*>/);
    if (!head) continue;
    stats.found = true;
    for (const k of ['tests', 'skipped', 'failures', 'errors']) {
      const m = head[0].match(new RegExp(`\\b${k}="(\\d+)"`));
      if (m) stats[k] += +m[1];
    }
  }
  return stats;
}

function changedFiles(root, base) {
  const run = (args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  const top = fs.realpathSync(run(['rev-parse', '--show-toplevel']).trim());
  // Both lists are repo-relative: diff always is, ls-files only with --full-name.
  const names = `${run(['diff', '--name-only', base])}\n${run(['ls-files', '--others', '--exclude-standard', '--full-name'])}`;
  return new Set(names.split('\n').filter(Boolean).map((f) => path.resolve(top, f)));
}

function measureCoverage(root, modules, target, changed) {
  const findings = [];
  const rows = [];
  let covered = 0;
  let total = 0;
  let estimatedUnits = 0;
  const classes = [];
  const skippedTotal = { skipped: 0 };

  for (const mod of modules) {
    const xmlFile = path.join(mod.dir, 'target', 'site', 'jacoco', 'jacoco.xml');
    const execFile = path.join(mod.dir, 'target', 'jacoco.exec');
    const tests = surefireStats(mod.dir);
    skippedTotal.skipped += tests.skipped;
    const row = { module: mod.name, tests: tests.tests, skipped: tests.skipped, status: '', coverage: null };
    if (fs.existsSync(xmlFile)) {
      const r = parseJacocoXml(fs.readFileSync(xmlFile, 'utf8'));
      const c = r.line.covered + r.branch.covered;
      const t = c + r.line.missed + r.branch.missed;
      covered += c;
      total += t;
      row.coverage = t ? (100 * c) / t : null;
      row.status = 'measured';
      if (tests.tests > 0 && c === 0 && t > 0) {
        row.status = 'agent-not-attached';
        findings.push({ rule: 'jacoco-agent-not-attached', severity: 'gate', file: mod.name, line: null,
          message: `${tests.tests} tests ran in ${mod.name} but JaCoCo recorded no covered line: the agent did not instrument the tests.`,
          fix: 'Check the argLine and jacoco-too-old findings above; then rebuild and rerun --coverage.' });
      }
      for (const k of r.classes) {
        const file = k.source ? path.join(mod.dir, 'src', 'main', 'java', ...k.pkg.split('/'), k.source) : null;
        classes.push({ ...k, module: mod.name, file: file ? rel(root, file) : null, changed: Boolean(file && changed && changed.has(file)) });
      }
    } else {
      // No report: Sonar still counts this module's lines, all uncovered.
      total += mod.estimatedLines;
      estimatedUnits += mod.estimatedLines;
      row.coverage = 0;
      if (tests.tests > 0 && !fs.existsSync(execFile)) {
        row.status = 'agent-not-attached';
        findings.push({ rule: 'jacoco-agent-not-attached', severity: 'gate', file: mod.name, line: null,
          message: `${tests.tests} tests ran in ${mod.name} but no target/jacoco.exec was written: the JaCoCo agent was not attached.`,
          fix: 'Fix the argLine / skip findings above, then rebuild with the Cloud Manager command.' });
      } else if (fs.existsSync(execFile)) {
        row.status = 'report-missing';
        findings.push({ rule: 'jacoco-report-missing', severity: 'warn', file: mod.name, line: null,
          message: `${mod.name} has jacoco.exec but no jacoco.xml; it was counted as uncovered.`,
          fix: 'Rerun the build including org.jacoco:jacoco-maven-plugin:report.' });
      } else {
        row.status = mod.testFileCount ? 'tests-not-run' : 'no-tests';
      }
    }
    rows.push(row);
  }

  if (skippedTotal.skipped > 1) {
    findings.push({ rule: 'skipped-unit-tests', severity: 'info', file: null, line: null,
      message: `${skippedTotal.skipped} skipped unit tests (Cloud Manager reports more than 1 as an Info issue).`,
      fix: 'Re-enable or delete @Disabled/@Ignore tests.' });
  }

  const pct = total ? (100 * covered) / total : null;
  const neededForTarget = pct == null ? 0 : Math.max(0, Math.ceil((target / 100) * total - covered));
  const neededForGate = pct == null ? 0 : Math.max(0, Math.ceil((GATE_COVERAGE / 100) * total - covered));
  if (pct != null && pct < GATE_COVERAGE) {
    findings.push({ rule: 'coverage-below-gate', severity: 'gate', file: null, line: null,
      message: `Estimated coverage ${pct.toFixed(1)}% is below the Cloud Manager gate of ${GATE_COVERAGE}%. About ${neededForGate} more covered lines/branches are needed (${neededForTarget} for the ${target}% target).`,
      fix: 'Follow the coverage step of references/cloud-manager-quality-gate.md, starting with the ranked classes.' });
  } else if (pct != null && pct < target) {
    findings.push({ rule: 'coverage-below-target', severity: 'warn', file: null, line: null,
      message: `Estimated coverage ${pct.toFixed(1)}% passes ${GATE_COVERAGE}% but is under the ${target}% safety margin (Sonar and the local count differ slightly).`,
      fix: `Add tests for about ${neededForTarget} more lines/branches.` });
  }

  const ranked = classes
    .map((k) => ({ ...k, missed: k.line.missed + k.branch.missed }))
    .filter((k) => k.missed > 0)
    .sort((a, b) => (b.changed - a.changed) || (b.missed - a.missed))
    .slice(0, 15);

  return {
    findings,
    coverage: { percent: pct, covered, total, estimatedUnits, target, gate: GATE_COVERAGE, neededForTarget, neededForGate, modules: rows, topUncovered: ranked },
  };
}

// ── Orchestration ────────────────────────────────────────────────────────────

const NOT_CHECKED = [
  'Security rating (fails below B) and Maintainability rating (fails below A)',
  'SonarQube rules other than S2095, S2168 and S2276; the Java checks here are source heuristics',
  'OakPAL rules other than the four index Blocker rules and BannedPath',
  'CloudServiceIncompatibleWorkflowProcess (Blocker): asset workflow models are migrated by Branch H',
];

function runPrecheck(root, { coverage = false, target = DEFAULT_TARGET, base = null } = {}) {
  const absRoot = fs.realpathSync(path.resolve(root));
  const poms = collectPoms(absRoot);
  const warnings = [];
  if (!poms.length) warnings.push('No pom.xml found under the project root: tooling and coverage checks were skipped.');

  const jdk = detectJdk(absRoot, poms);
  const findings = [...checkTooling(absRoot, poms, jdk), ...checkOakIndexes(absRoot), ...checkBannedPaths(absRoot)];

  let changed = null;
  if (base) {
    try { changed = changedFiles(absRoot, base); } catch (e) { warnings.push(`--base ${base}: git diff failed (${e.message.split('\n')[0]}); classes are not marked as changed.`); }
  }

  const modules = javaModules(absRoot, poms);
  for (const mod of modules) {
    for (const f of mod.mainFiles) {
      for (const b of scanJavaBlockers(fs.readFileSync(f, 'utf8'))) {
        findings.push({ ...b, severity: 'gate', file: rel(absRoot, f), changed: Boolean(changed && changed.has(f)) });
      }
    }
    if (!mod.testFileCount) {
      findings.push({ rule: 'module-without-tests', severity: 'info', file: mod.name, line: null,
        message: `${mod.name} has main Java code (~${mod.estimatedLines} executable lines) and no tests: it counts as 0% covered.`,
        fix: 'Covered by the coverage step when the overall figure is short.' });
    }
  }

  let cov = null;
  if (coverage) {
    const r = measureCoverage(absRoot, modules, target, changed);
    findings.push(...r.findings);
    cov = r.coverage;
  }

  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const result = { root: absRoot, status: null, jdk, findings, coverage: cov, warnings, notChecked: NOT_CHECKED, delta: null };
  result.status = computeStatus(result);
  return result;
}

/** Status over the findings that count: all of them, or only the new ones once a baseline is applied. */
function computeStatus(result) {
  const live = result.findings.filter((f) => !f.inherited);
  if (live.some((f) => f.severity === 'gate')) return 'fail';
  if (!result.coverage) return 'unverified';
  return live.some((f) => f.severity === 'critical' || f.rule === 'coverage-below-target') ? 'at-risk' : 'ready';
}

// ── Baseline (runbook) and delta (pattern sessions) ──────────────────────────

const TOOLING_RULES = new Set(['argline-drops-jacoco-agent', 'argline-early-evaluation', 'jacoco-too-old', 'jacoco-skipped', 'tests-skipped', 'test-failures-ignored', 'cm-java-version-missing']);

const baselineKey = (f) => `${f.rule}|${f.file || ''}`;

/** Compact snapshot stored by the runbook as `cmReadiness` (paths are project-relative). */
function readinessBaseline(result, generatedAt = new Date().toISOString()) {
  return {
    generatedAt,
    status: result.status,
    jdk: result.jdk,
    findings: result.findings.map(({ rule, severity, file, line, message }) => ({ rule, severity, file, line, message })),
    warnings: result.warnings,
  };
}

/**
 * Mark findings already present in the baseline as `inherited` (matched by rule and file, with
 * counts, since lines move when code is edited) and recompute the status over the new ones only.
 */
function applyBaseline(result, baseline) {
  const remaining = new Map();
  for (const f of (baseline && baseline.findings) || []) remaining.set(baselineKey(f), (remaining.get(baselineKey(f)) || 0) + 1);
  for (const f of result.findings) {
    const n = remaining.get(baselineKey(f)) || 0;
    f.inherited = n > 0;
    if (n > 0) remaining.set(baselineKey(f), n - 1);
  }
  const resolved = [...remaining.values()].reduce((a, b) => a + b, 0);
  result.delta = {
    baselineAt: baseline ? baseline.generatedAt : null,
    newCount: result.findings.filter((f) => !f.inherited).length,
    inheritedCount: result.findings.filter((f) => f.inherited).length,
    resolvedCount: resolved,
  };
  result.status = computeStatus(result);
  return result;
}

function readBaselineFile(file) {
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!json.cmReadiness || !Array.isArray(json.cmReadiness.findings)) {
    throw new Error(`${file} has no cmReadiness baseline; regenerate the runbook (Step 0).`);
  }
  return json.cmReadiness;
}

/** The runbook's "Cloud Manager readiness" section, from a `readinessBaseline` (or a not-run marker). */
function renderReadinessSection(cm) {
  const out = ['## Cloud Manager readiness', ''];
  if (!cm || cm.status === 'not-run') {
    out.push(`> The readiness check did not run${cm && cm.error ? `: ${cm.error}` : ''}. Run \`node scripts/cm-quality-precheck.js <projectRoot>\` before pushing.`, '');
    return out;
  }
  out.push('> Predicts the Cloud Manager Code Quality step (reliability rating, coverage) from source; no build was run.');
  out.push('> This is the baseline: pattern sessions report only what they add to it. Coverage is measured before you push.', '');
  const row = (f) => `| \`${f.rule}\` | ${f.file ? `\`${f.file}${f.line ? `:${f.line}` : ''}\`` : '—'} | ${String(f.message || '').replace(/\|/g, '\\|')} |`;
  const table = (list) => [...collapsible(['| Rule | Location | Why |', '|------|----------|-----|'], list.map(row), { noun: 'more findings' }), ''];
  const tooling = cm.findings.filter((f) => TOOLING_RULES.has(f.rule) && f.severity !== 'info');
  const blockers = cm.findings.filter((f) => f.severity === 'gate' && !TOOLING_RULES.has(f.rule));
  const critical = cm.findings.filter((f) => f.severity === 'critical');
  const untested = cm.findings.filter((f) => f.rule === 'module-without-tests');

  if (tooling.length) {
    out.push('### Pre-flight — fix before any pattern', '', 'These settings make Cloud Manager measure 0% coverage however many tests pass, so every later coverage figure depends on them.', '');
    out.push(...table(tooling), '```', 'Fix the Cloud Manager pre-flight items from the migration runbook.', '```', '');
  }
  if (blockers.length) {
    out.push('### Reliability Blockers already in the code', '', 'One Blocker bug fails the pipeline and cannot be overridden. These are source heuristics: each is confirmed before it is edited.', '');
    out.push(...table(blockers), '```', 'Fix the reliability Blockers listed in the migration runbook.', '```', '');
  }
  if (critical.length) out.push('### Critical (fix; one step from failing)', '', ...table(critical));
  if (untested.length) {
    out.push('### Coverage debt', '', 'Cloud Manager counts these modules as 0% covered. The full figure is measured before you push.', '');
    out.push(...collapsible([], untested.map((f) => `- ${f.message}`), { noun: 'more modules' }));
    out.push('');
  }
  if (!tooling.length && !blockers.length && !critical.length) out.push('No pre-flight issue or Blocker found.', '');
  out.push('Before you push:', '', '```', 'Am I ready to push to Cloud Manager?', '```', '');
  return out;
}

function renderMarkdown(r) {
  const out = [];
  const label = { fail: 'FAIL — Cloud Manager would fail or pause the Code Quality step', 'at-risk': 'AT RISK', ready: 'READY (local estimate)', unverified: 'NO STATIC BLOCKER — coverage not measured yet (run with --coverage after the Cloud Manager build)' };
  const sessionLabel = { fail: 'NEW GATE ISSUE — introduced since the runbook baseline; fix it before closing this session', unverified: 'NO NEW GATE ISSUE since the runbook baseline', 'at-risk': 'AT RISK — new Critical finding since the runbook baseline', ready: 'READY (local estimate)' };
  out.push('# Cloud Manager code-quality precheck', '', `**Status:** ${(r.delta ? sessionLabel : label)[r.status]}`, '');
  if (r.delta) {
    out.push(`Compared with the runbook baseline${r.delta.baselineAt ? ` of ${r.delta.baselineAt}` : ''}: **${r.delta.newCount} new**, ${r.delta.inheritedCount} inherited (tracked in the runbook), ${r.delta.resolvedCount} resolved.`, '');
  }
  out.push(`JDK: Cloud Manager ${r.jdk.cloudManager || 'not set (.cloudmanager/java-version)'}, compiler target ${r.jdk.compiler || 'unknown'}.`, '');
  const groups = [['gate', 'Gate failures — fix before pushing'], ['critical', 'Critical — fix (one step from failing)'], ['warn', 'Warnings'], ['info', 'Info']];
  const shown = r.findings.filter((f) => !f.inherited);
  for (const [sev, title] of groups) {
    const list = shown.filter((f) => f.severity === sev);
    if (!list.length) continue;
    out.push(`## ${r.delta ? `New: ${title}` : title}`, '');
    for (const f of list) {
      const loc = f.file ? `\`${f.file}${f.line ? `:${f.line}` : ''}\`` : '';
      out.push(`- **${f.rule}** ${loc}${f.changed ? ' *(changed)*' : ''} — ${f.message} Fix: ${f.fix}`);
    }
    out.push('');
  }
  const inherited = r.findings.filter((f) => f.inherited);
  if (inherited.length) {
    const byRule = {};
    for (const f of inherited) byRule[f.rule] = (byRule[f.rule] || 0) + 1;
    out.push('## Inherited (already in the runbook baseline)', '', ...Object.entries(byRule).map(([rule, n]) => `- \`${rule}\` × ${n}`), '',
      'Not caused by this session. They still fail Cloud Manager until fixed; the runbook\'s Cloud Manager readiness section has the prompts.', '');
  }
  if (r.coverage) {
    const c = r.coverage;
    out.push('## Coverage', '');
    out.push(`Estimated Cloud Manager coverage: **${c.percent == null ? 'n/a' : `${c.percent.toFixed(1)}%`}** (gate ${c.gate}%, target ${c.target}%). Covered ${c.covered} of ${c.total} lines+branches${c.estimatedUnits ? `, of which ${c.estimatedUnits} estimated from modules without a JaCoCo report` : ''}.`, '');
    out.push('| Module | Status | Coverage | Tests | Skipped |', '|---|---|---|---|---|');
    for (const m of c.modules) out.push(`| ${m.module} | ${m.status} | ${m.coverage == null ? 'n/a' : `${m.coverage.toFixed(1)}%`} | ${m.tests} | ${m.skipped} |`);
    out.push('');
    if (c.topUncovered.length) {
      out.push('Classes to test first (changed classes first, then most missed lines+branches):', '');
      for (const k of c.topUncovered) out.push(`- \`${k.file || k.name}\` — ${k.missed} missed (lines ${k.line.missed}, branches ${k.branch.missed})${k.changed ? ' *(changed)*' : ''}`);
      out.push('');
    }
  }
  for (const w of r.warnings) out.push(`> ⚠️ ${w}`);
  if (r.warnings.length) out.push('');
  out.push('## Not evaluated locally', '', ...r.notChecked.map((n) => `- ${n}`), '', 'Cloud Manager\'s own scan is authoritative; this is a prediction.');
  return out.join('\n');
}

function parseArgs(argv) {
  const args = { root: null, coverage: false, target: DEFAULT_TARGET, base: null, baseline: null, json: false, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--coverage') args.coverage = true;
    else if (a === '--json') args.json = true;
    else if (a === '--target') args.target = Number(argv[++i]);
    else if (a === '--base') args.base = argv[++i];
    else if (a === '--baseline') args.baseline = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (!a.startsWith('--') && !args.root) args.root = a;
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!args.root) throw new Error('Missing <projectRoot>.');
  if (!(args.target >= GATE_COVERAGE && args.target <= 100)) throw new Error(`--target must be between ${GATE_COVERAGE} and 100.`);
  return args;
}

if (require.main === module) {
  const usage = 'Usage: node cm-quality-precheck.js <projectRoot> [--coverage] [--target <pct>] [--base <git-ref>] [--baseline <migration-runbook.json>] [--json] [--out <file.md>]';
  let args;
  let baseline = null;
  try {
    args = parseArgs(process.argv.slice(2));
    if (args.baseline) baseline = readBaselineFile(args.baseline);
  } catch (e) {
    process.stderr.write(`${e.message}\n${usage}\n`);
    process.exit(2);
  }
  if (!fs.existsSync(args.root)) { process.stderr.write(`No such directory: ${args.root}\n`); process.exit(2); }
  const result = runPrecheck(args.root, args);
  if (baseline) applyBaseline(result, baseline);
  const md = renderMarkdown(result);
  if (args.out) fs.writeFileSync(args.out, `${md}\n`, 'utf8');
  process.stdout.write(args.json ? `${JSON.stringify(result, null, 2)}\n` : `${md}\n`);
  process.exit(result.status === 'fail' ? 1 : 0);
}

module.exports = {
  runPrecheck, renderMarkdown, scanJavaBlockers, estimateExecutableLines, parseJacocoXml, checkTooling,
  readinessBaseline, applyBaseline, renderReadinessSection, TOOLING_RULES,
  detectJdk, collectPoms, GATE_COVERAGE, DEFAULT_TARGET, JACOCO_MIN_FOR_JDK,
};
