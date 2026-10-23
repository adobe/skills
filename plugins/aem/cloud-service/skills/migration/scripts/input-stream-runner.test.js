'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { runInputStreamScan, scanJavaSource, stripCommentsAndStrings } = require('./input-stream-runner.js');

function mkworkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'input-stream-test-'));
}
function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  return full;
}

/** Wrap method bodies in a class with the given imports; returns the site list. */
function sitesOf(body, imports = ['java.io.*', 'org.apache.commons.io.IOUtils']) {
  const src = [
    'package com.acme;',
    ...imports.map(i => `import ${i};`),
    'public class T {',
    body,
    '}',
  ].join('\n');
  return scanJavaSource(src).sites;
}
const only = (sites) => {
  assert.strictEqual(sites.length, 1, `expected one site, got ${JSON.stringify(sites, null, 1)}`);
  return sites[0];
};
const cats = sites => sites.map(s => s.categories.join('+'));

// ── Preparation ──────────────────────────────────────────────────────────────

test('stripCommentsAndStrings blanks comments/strings/text blocks but keeps offsets and newlines', () => {
  const src = 'a // new FileInputStream(x)\nb = "getStream()"; /* x\n y */ c = \'"\'; d = """\n new FileInputStream(\n""";';
  const out = stripCommentsAndStrings(src);
  assert.strictEqual(out.length, src.length);
  assert.strictEqual(out.split('\n').length, src.split('\n').length);
  assert.ok(!/FileInputStream|getStream/.test(out));
});

test('stripCommentsAndStrings can keep string contents while dropping comments', () => {
  const out = stripCommentsAndStrings('x("java.io.tmpdir"); // temp\n', { keepStrings: true });
  assert.ok(out.includes('"java.io.tmpdir"'));
  assert.ok(!out.includes('temp\n') && !/\/\/ temp/.test(out));
});

// ── F: deserialization ───────────────────────────────────────────────────────

test('F: ObjectInputStream; over request input it is security-critical', () => {
  const sites = sitesOf([
    'Object a(SlingHttpServletRequest request) throws Exception { ObjectInputStream ois = new ObjectInputStream(request.getInputStream()); return ois.readObject(); }',
    'Object b(InputStream in) throws Exception { try (ObjectInputStream ois = new ObjectInputStream(in)) { return ois.readObject(); } }',
  ].join('\n'));
  assert.deepStrictEqual(sites.map(s => s.primary), ['F', 'F']);
  assert.strictEqual(sites[0].severity, 'critical');
  assert.strictEqual(sites[1].severity, 'high');
  assert.ok(/ObjectInputFilter allow-list/.test(sites[1].note), 'suggests an allow-list when the format can\'t change');
});

test('F: an existing ObjectInputFilter allow-list is recognised', () => {
  const s = only(sitesOf('Object a(InputStream in) throws Exception { try (ObjectInputStream o = new ObjectInputStream(in)) { o.setObjectInputFilter(ObjectInputFilter.Config.createFilter("java.util.HashSet;java.lang.String;!*")); return o.readObject(); } }'));
  assert.deepStrictEqual(s.categories, ['F']);
  assert.ok(/filter or allow-list is present/.test(s.note));
});

test('F: ObjectInputStream subclasses (any package) are F; an inline getBinary() stream is B', () => {
  const sites = sitesOf([
    'Object a(Property p, ClassLoader cl) throws Exception { try (InputStream in = p.getBinary().getStream(); DynamicObjectInputStream o = new DynamicObjectInputStream(in, cl)) { return o.readObject(); } }',
    'Object b(InputStream in) throws Exception { try (ValidatingObjectInputStream v = new ValidatingObjectInputStream(in)) { return v.readObject(); } }',
  ].join('\n'));
  assert.deepStrictEqual(sites.map(s => `${s.variable}:${s.categories}`), ['in:B', 'o:F', 'v:F']);
  assert.ok(/DynamicObjectInputStream deserialization/.test(sites[1].note));
  assert.ok(/allow-list is present/.test(sites[2].note), 'ValidatingObjectInputStream counts as an allow-list');
});

// ── E: binary streamed or processed in the JVM ───────────────────────────────

test('E: DAM binaries read in the JVM (getOriginal().getStream(), a typed Rendition, an asset resource)', () => {
  const sites = sitesOf([
    'void a(Asset asset) throws Exception { try (InputStream in = asset.getOriginal().getStream()) { use(in); } }',
    'void b(Rendition r) throws Exception { try (InputStream in = r.getStream()) { use(in); } }',
    'void c(Resource assetResource) throws Exception { try (InputStream in = assetResource.adaptTo(InputStream.class)) { use(in); } }',
    'void use(InputStream in) {}',
  ].join('\n'));
  assert.deepStrictEqual(cats(sites), ['E', 'E', 'E']);
  assert.ok(sites.every(s => s.source === 'dam-binary' && s.fix === 'decision'));
  assert.ok(/asset\.getOriginal\(\)\.getStream\(\)/.test(sites[0].note), 'cites Adobe\'s guideline');
});

test('E: binaries streamed to the response — DAM and other repository binaries', () => {
  const sites = sitesOf([
    'void a(Asset asset, SlingHttpServletResponse response) throws Exception { try (InputStream in = asset.getOriginal().getStream()) { IOUtils.copy(in, response.getOutputStream()); } }',
    'void b(Resource file, SlingHttpServletResponse response) throws Exception { try (InputStream in = file.adaptTo(InputStream.class)) { IOUtils.copy(in, response.getOutputStream()); } }',
  ].join('\n'));
  assert.deepStrictEqual(cats(sites), ['E', 'E']);
  assert.ok(sites.every(s => /CDN/.test(s.note)));
});

test('E: client upload written into DAM hands off to asset-manager and names both tiers', () => {
  const s = only(sitesOf('void b(SlingHttpServletRequest request, AssetManager am) throws Exception { InputStream in = request.getRequestParameter("file").getInputStream(); am.createAsset("/content/dam/x", in, "image/png", true); }'));
  assert.deepStrictEqual(s.categories, ['E', 'B']);
  assert.strictEqual(s.source, 'request-upload');
  assert.strictEqual(s.handoff, 'asset-manager');
  assert.ok(/direct binary upload on author/.test(s.note) && /external store/.test(s.note));
});

test('E: asset processing in a workflow step points to Asset Compute', () => {
  const s = only(sitesOf('class P implements WorkflowProcess { public void execute(WorkItem item, WorkflowSession s, MetaDataMap m) throws Exception { Rendition r = pick(); try (InputStream in = r.getStream()) { use(in); } } void use(InputStream i) {} Rendition pick() { return null; } }'));
  assert.deepStrictEqual(s.categories, ['E']);
  assert.ok(/Asset Compute/.test(s.note));
});

test('E: a class that runs a native process needs redesign, not stream fixes', () => {
  const s = only(sitesOf('void a(File workingDir) throws Exception { new ProcessBuilder("ffmpeg").start(); File out = new File(workingDir, "o.mp3"); FileInputStream fis = new FileInputStream(out); use(fis); } void use(InputStream i) {}'));
  assert.deepStrictEqual(s.categories, ['E', 'B']);
  assert.strictEqual(s.fix, 'decision', 'no auto-fix for code that cannot run on AEM as a Cloud Service');
  assert.ok(/native process/.test(s.note));
});

test('E: AEM\'s FFmpeg helpers count as a native process', () => {
  const s = only(sitesOf('void a(File workingDir, ExecutableLocator locator) throws Exception { FFMpegWrapper w = FFMpegWrapper.fromProfile(null, null, workingDir); w.setExecutableLocator(locator); File out = w.transcode(); FileInputStream fis = new FileInputStream(out); use(fis); } void use(InputStream i) {}'));
  assert.ok(s.categories.includes('E'));
  assert.strictEqual(s.fix, 'decision');
});

test('E: a stream from a rendition helper (getXmlRenditionInputStream) is a DAM read', () => {
  const s = only(sitesOf('void a(Resource assetResource) throws Exception { InputStream xml = DeckUtils.getXmlRenditionInputStream(assetResource); parse(xml); } void parse(InputStream i) {}'));
  assert.strictEqual(s.source, 'dam-binary');
  assert.ok(s.categories.includes('E'));
});

test('a try-with-resources initializer ends at its own expression (a later addRendition is not part of it)', () => {
  const s = only(sitesOf('void a(Asset asset, Executor executor, String url) throws Exception { try (InputStream in = executor.execute(url).asStream()) { asset.addRendition("r", in, "image/png"); } }'));
  assert.strictEqual(s.source, 'declared');
  assert.deepStrictEqual(s.categories, ['A']);
});

// ── D: local filesystem ──────────────────────────────────────────────────────

test('D: fixed paths are D even under /tmp or next to a "temp" comment; scratch files are not', () => {
  const sites = sitesOf([
    'void a() throws Exception { try (InputStream in = new FileInputStream("/opt/data.json")) { use(in); } }',
    'void b() throws Exception { try (InputStream in = java.nio.file.Files.newInputStream(java.nio.file.Paths.get("/x"))) { use(in); } }',
    'void c() throws Exception { // temp workaround until the config moves',
    '  try (InputStream in = new FileInputStream("/opt/acme/config.json")) { use(in); } }',
    'void d() throws Exception { try (InputStream in = new FileInputStream("/tmp/acme/shared-cache.json")) { use(in); } }',
    'void e() throws Exception { File t = File.createTempFile("x", ".bin"); try (InputStream in = new FileInputStream(t)) { use(in); } }',
    'void f(Asset asset, File workingDir) throws Exception { File out = transcode(workingDir); try (InputStream in = new FileInputStream(out)) { use(in); } finally { java.nio.file.Files.delete(out.toPath()); } }',
    'void use(InputStream in) {}',
  ].join('\n'));
  assert.deepStrictEqual(cats(sites), ['D', 'D', 'D', 'D', 'A', 'A']);
  assert.strictEqual(sites[0].fix, 'decision');
  assert.ok(/repository \(author\) or an external store \(publish\)/.test(sites[0].note));
});

test('D: the note points at local-filesystem writes in the same file', () => {
  const sites = sitesOf([
    'void w(byte[] b) throws Exception {',
    '  java.nio.file.Files.write(java.nio.file.Paths.get("/opt/acme/cache.bin"), b); }',
    'String r() throws Exception { try (InputStream in = new FileInputStream("/opt/acme/cache.bin")) { return IOUtils.toString(in, "UTF-8"); } }',
  ].join('\n'));
  const s = only(sites);
  assert.deepStrictEqual(s.categories, ['D']);
  assert.ok(/writes in this file: L6/.test(s.note), s.note);
});

// ── C: unbounded in-memory reads ─────────────────────────────────────────────

test('C: unbounded reads of repository binaries, readers and request bodies; real read limits are not C', () => {
  const sites = sitesOf([
    'byte[] a(Resource res) throws Exception { try (InputStream in = res.adaptTo(InputStream.class)) { return IOUtils.toByteArray(in); } }',
    'String b(Resource res) throws Exception { try (BufferedReader br = new BufferedReader(new InputStreamReader(res.adaptTo(InputStream.class)))) { return br.lines().reduce("", String::concat); } }',
    'String c(SlingHttpServletRequest request) throws Exception { return IOUtils.toString(request.getInputStream(), "UTF-8"); }',
    'String d() throws Exception { try (InputStream in = getClass().getResourceAsStream("/small.json")) { return IOUtils.toString(in, "UTF-8"); } }',
    'byte[] e(SlingHttpServletRequest request) throws Exception { byte[] b = request.getInputStream().readNBytes(1025); return b; }',
    'byte[] f(Property p) throws Exception { Binary bin = p.getBinary(); try (InputStream in = bin.getStream()) { if (bin.getSize() > 1024) throw new IOException(); return IOUtils.toByteArray(in); } finally { bin.dispose(); } }',
  ].join('\n'));
  assert.deepStrictEqual(cats(sites), ['C', 'C', 'C', 'A', 'A', 'A']);
});

test('C: a Content-Length check is not a read limit (it is -1 for chunked requests)', () => {
  const s = only(sitesOf('String a(SlingHttpServletRequest request) throws Exception { if (request.getContentLength() > 1024) throw new IllegalArgumentException(); return IOUtils.toString(request.getInputStream(), "UTF-8"); }'));
  assert.deepStrictEqual(s.categories, ['C']);
  assert.ok(/-1 for chunked requests/.test(s.note));
});

test('C: BoundedInputStream limits the read, but the note warns that it truncates silently', () => {
  const s = only(sitesOf('byte[] a(SlingHttpServletRequest request) throws Exception { try (InputStream in = new org.apache.commons.io.input.BoundedInputStream(request.getInputStream(), 1024)) { return IOUtils.toByteArray(in); } }'));
  assert.deepStrictEqual(s.categories, ['A']);
  assert.ok(/silently truncated/.test(s.note));
});

test('C: a read limit or size check on another stream does not bound this one', () => {
  const sites = sitesOf([
    'String a(SlingHttpServletRequest request, InputStream other) throws Exception { try (InputStream lim = new org.apache.commons.io.input.BoundedInputStream(other, 10)) { use(lim); } return IOUtils.toString(request.getInputStream(), "UTF-8"); }',
    'byte[] b(Resource res, Rendition other) throws Exception { long n = other.getSize(); try (InputStream in = res.adaptTo(InputStream.class)) { return IOUtils.toByteArray(in); } }',
    'void use(InputStream i) {}',
  ].join('\n'));
  assert.deepStrictEqual(sites.map(s => `${s.variable || '-'}:${s.categories}`), ['lim:A', '-:C', 'in:C']);
  assert.ok(!/silently truncated/.test(sites[1].note), 'the BoundedInputStream note belongs to the bounded stream only');
});

test('C: a size check or limit on the stream\'s own source counts', () => {
  const sites = sitesOf([
    'byte[] a(Property p) throws Exception { Binary bin = p.getBinary(); try (InputStream in = bin.getStream()) { if (bin.getSize() > 1024) throw new IOException(); return IOUtils.toByteArray(in); } finally { bin.dispose(); } }',
    'byte[] b(Resource res) throws Exception { try (InputStream in = res.adaptTo(InputStream.class)) { return in.readNBytes(1025); } }',
    'String c(File f) throws Exception { File t = File.createTempFile("x", "y"); if (f.length() > 10) throw new IOException(); try (InputStream in = new FileInputStream(f)) { return IOUtils.toString(in, "UTF-8"); } }',
    'String d(String path) throws Exception { File t = File.createTempFile("x", "y"); if (path.length() > 10) throw new IOException(); try (InputStream in = new FileInputStream(path)) { return IOUtils.toString(in, "UTF-8"); } }',
  ].join('\n'));
  assert.deepStrictEqual(cats(sites), ['A', 'A', 'A', 'C'], 'String.length() is not a size check');
});

test('C: an inline HttpEntity.getContent() read is detected (no stream type named in source); the response owns the stream', () => {
  const s = only(sitesOf('String a(org.apache.http.HttpResponse response) throws Exception { return IOUtils.toString(response.getEntity().getContent(), "UTF-8"); }', ['org.apache.commons.io.IOUtils']));
  assert.deepStrictEqual(s.categories, ['C']);
  assert.strictEqual(s.source, 'remote');
});

test('closing an HTTP entity\'s content inline is not flagged as a leak', () => {
  const sites = sitesOf('void close(org.apache.http.HttpResponse connection) throws Exception { if (connection.getEntity().getContent() != null) { connection.getEntity().getContent().close(); } }', ['org.apache.commons.io.IOUtils']);
  assert.ok(sites.every(s => !s.categories.includes('B')), JSON.stringify(sites));
});

// ── B: unclosed streams and undisposed binaries ──────────────────────────────

test('B: a stream that is opened and never closed', () => {
  const s = only(sitesOf('Properties p(){ InputStream in = getClass().getResourceAsStream("/x"); Properties p = new Properties(); p.load(in); return p; }'));
  assert.deepStrictEqual(s.categories, ['B']);
  assert.strictEqual(s.fix, 'auto');
  assert.strictEqual(s.variable, 'in');
});

test('A: try-with-resources, manual close in finally, returned stream, ByteArrayInputStream', () => {
  const sites = sitesOf([
    'void a(Resource res) throws Exception { try (InputStream in = res.adaptTo(InputStream.class)) { use(in); } }',
    'void b(Resource res) throws Exception { InputStream in = null; try { in = res.adaptTo(InputStream.class); use(in); } finally { IOUtils.closeQuietly(in); } }',
    'InputStream c(Resource res) { return res.adaptTo(InputStream.class); }',
    'InputStream d(Resource res) { InputStream in = res.adaptTo(InputStream.class); return in; }',
    'InputStream e(byte[] b) { return new ByteArrayInputStream(b); }',
    'void use(InputStream in) {}',
  ].join('\n'));
  assert.strictEqual(sites.length, 5);
  for (const s of sites) assert.deepStrictEqual(s.categories, ['A'], `L${s.line}: ${s.note}`);
});

test('B is still flagged when only data derived from the stream is returned', () => {
  const s = only(sitesOf('String a(Resource res) throws Exception { InputStream is = res.adaptTo(InputStream.class); return IOUtils.toString(is, "UTF-8"); }'));
  assert.deepStrictEqual(s.categories, ['C', 'B']);
  assert.strictEqual(s.fix, 'review', 'most demanding fix kind wins');
});

test('a stream assigned to a field without this. is owned by the object, not B', () => {
  const s = only(sitesOf('InputStream held;\nvoid open(Resource res) { held = res.adaptTo(InputStream.class); }\nvoid close() throws IOException { held.close(); }'));
  assert.deepStrictEqual(s.categories, ['A']);
  assert.ok(/kept on a field/.test(s.note));
});

test('methods of a nested class are separate scopes (a close elsewhere does not hide a leak)', () => {
  const s = only(sitesOf('static class Inner { void leak(Resource res) throws Exception { InputStream in = res.adaptTo(InputStream.class); use(in); } void other(InputStream in) throws Exception { in.close(); } void use(InputStream i) {} }'));
  assert.deepStrictEqual(s.categories, ['B']);
});

test('JCR Binary from getBinary() must be disposed; disposing it in finally is enough', () => {
  const sites = sitesOf([
    'void a(Property p) throws Exception { try (InputStream in = p.getBinary().getStream()) { use(in); } }',
    'void b(Property p) throws Exception { Binary bin = p.getBinary(); try (InputStream in = bin.getStream()) { use(in); } finally { bin.dispose(); } }',
    'void c(Property p) throws Exception { Binary bin = p.getBinary(); try (InputStream in = bin.getStream()) { use(in); } }',
    'void use(InputStream in) {}',
  ].join('\n'));
  assert.deepStrictEqual(cats(sites), ['B', 'A', 'B']);
  assert.ok(/dispose\(\)/.test(sites[0].note));
});

test('archive entries (ZipFile.getInputStream(entry)) are not client uploads', () => {
  const s = only(sitesOf('void a(java.util.zip.ZipFile zipFile, java.util.zip.ZipEntry e, AssetManager am) throws Exception { try (InputStream in = zipFile.getInputStream(e)) { am.createAsset("/content/dam/x", in, "image/png", true); } }'));
  assert.strictEqual(s.source, 'archive');
  assert.ok(!s.categories.includes('E'));
});

test('wrappers over a caller-owned stream are not B (closing belongs to the opener)', () => {
  const s = only(sitesOf('int a(InputStream in) throws Exception { BufferedInputStream b = new BufferedInputStream(in); return b.read(); }'));
  assert.deepStrictEqual(s.categories, ['A']);
});

test('closing a wrapper counts as closing the stream it wraps', () => {
  const sites = sitesOf('int a(Resource res) throws Exception { InputStream raw = res.adaptTo(InputStream.class); BufferedInputStream b = new BufferedInputStream(raw); try { return b.read(); } finally { b.close(); } }');
  assert.deepStrictEqual(sites.map(s => `${s.variable}:${s.categories}`), ['raw:A', 'b:A']);
});

test('multiple try-with-resources resources are separate sites, each closed', () => {
  const sites = sitesOf('void a(Resource x, Resource y) throws Exception { try (InputStream a = x.adaptTo(InputStream.class); InputStream b = y.adaptTo(InputStream.class)) { use(a); } }\nvoid use(InputStream in) {}');
  assert.deepStrictEqual(sites.map(s => `${s.variable}:${s.categories}`), ['a:A', 'b:A']);
});

test('each declarator in `T a = …, b = …` is its own site: a leak of b is not hidden by closing a', () => {
  const sites = sitesOf([
    'void a(Resource x, Resource y) throws Exception { InputStream a = x.adaptTo(InputStream.class), b = y.adaptTo(InputStream.class); use(a, b); a.close(); }',
    'void use(InputStream i, InputStream j) {}',
  ].join('\n'));
  assert.deepStrictEqual(sites.map(s => `${s.variable}:${s.categories}`), ['a:A', 'b:B']);
});

test('commas inside generics, calls and constructors do not split a statement', () => {
  const sites = sitesOf([
    'void a(Resource x) { Map<String, InputStream> m = Collections.singletonMap("k", x.adaptTo(InputStream.class)); }',
    'int b(Resource x) throws Exception { try (InputStream s = new BufferedInputStream(x.adaptTo(InputStream.class), 8192)) { return s.read(); } }',
  ].join('\n'), ['java.io.*', 'java.util.*']);
  assert.strictEqual(sites.length, 2, JSON.stringify(sites.map(s => s.snippet)));
  assert.strictEqual(sites[1].variable, 's');
});

test('a stream passed straight into a consumer is inline: the result variable is not the stream', () => {
  const s = only(sitesOf('List<String> a(Resource map) throws Exception { List<String> lines = new ArrayList<>(); lines = IOUtils.readLines(map.adaptTo(InputStream.class), "UTF-8"); return lines; }'));
  assert.deepStrictEqual(s.categories, ['C', 'B']);
  assert.strictEqual(s.variable, null);
});

test('returning data derived from an inline stream is still a leak; returning the (wrapped) stream is not', () => {
  const sites = sitesOf([
    'String a(Resource res) throws Exception { return IOUtils.toString(res.adaptTo(InputStream.class), "UTF-8"); }',
    'InputStream b(Resource res) { return new BufferedInputStream(res.adaptTo(InputStream.class)); }',
  ].join('\n'));
  assert.deepStrictEqual(cats(sites), ['C+B', 'A']);
});

test('handing a fresh stream to a same-file helper that closes it is not B; a throwaway null-check call is', () => {
  const sites = sitesOf([
    'Set<String> a(RequestParameter data) throws Exception {',
    '  Set<String> paths = new HashSet<>();',
    '  if (data != null && data.getInputStream() != null) {',
    '    paths.addAll(read(data.getInputStream(), "UTF-8"));',
    '  }',
    '  return paths;',
    '}',
    'private static Set<String> read(InputStream is, String enc) throws IOException {',
    '  try (BufferedReader br = new BufferedReader(new InputStreamReader(is, enc))) { return null; }',
    '}',
  ].join('\n'));
  assert.deepStrictEqual(sites.map(s => `${s.line}:${s.categories}`), ['7:B', '8:A', '13:A']);
});

test('a lambda that produces the stream hands it off (no B at the lambda)', () => {
  const s = only(sitesOf('void a(Resource m) { Optional<InputStream> op = Optional.ofNullable(m).map(rm -> rm.adaptTo(InputStream.class)); }'));
  assert.deepStrictEqual(s.categories, ['A']);
});

test('this(…) delegating to a constructor that keeps the stream on a field is not B', () => {
  const src = [
    'package com.acme;',
    'import java.io.InputStream;',
    'public class Sheet {',
    '  private InputStream inputStream;',
    '  public Sheet(InputStream file) { inputStream = file; }',
    '  public Sheet(RequestParameter file) throws Exception { this(file.getInputStream()); }',
    '}',
  ].join('\n');
  const sites = scanJavaSource(src).sites;
  assert.deepStrictEqual(sites.map(s => `${s.line}:${s.categories}`), ['6:A']);
});

test('an inline stream handed to an unknown callee is B, and the note names the callee to confirm', () => {
  const s = only(sitesOf('void a(Resource res) throws Exception { Layer layer = new Layer(res.adaptTo(InputStream.class)); }'));
  assert.deepStrictEqual(s.categories, ['B']);
  assert.ok(/new Layer\(…\)/.test(s.note), s.note);
});

test('an inline stream handed to a setter, map or JCR createBinary is not B', () => {
  const sites = sitesOf([
    'void a(Object target, java.lang.reflect.Field field, RequestParameter val) throws Exception { FieldUtils.writeField(field, target, val.getInputStream(), true); }',
    'void b(Upload upload, Resource res) { upload.setInputStream(res.adaptTo(InputStream.class)); }',
    'void c(Session session, Resource res) throws Exception { Binary bin = session.getValueFactory().createBinary(res.adaptTo(InputStream.class)); bin.dispose(); }',
  ].join('\n'));
  assert.deepStrictEqual(cats(sites), ['A', 'A', 'A']);
});

test('aliases, comments and strings produce no sites', () => {
  const sites = sitesOf([
    'void a(InputStream in) { InputStream copy = in; }',
    'void b() { // InputStream x = new FileInputStream("y");',
    ' String s = "rendition.getStream()"; /* new FileInputStream("z") */ }',
  ].join('\n'));
  assert.deepStrictEqual(sites, []);
});

test('only java.io stream types count — another package\'s InputStream is ignored', () => {
  const r = scanJavaSource('package a;\nimport org.omg.CORBA.portable.InputStream;\nclass C { void r(InputStream in) {} InputStream x = make(); }');
  assert.deepStrictEqual(r.sites, []);
  assert.strictEqual(r.typeRefLine, null);
});

// ── Workspace scan + BPA merge ───────────────────────────────────────────────

function fixtureWorkspace() {
  const root = mkworkspace();
  write(root, 'core/src/main/java/com/acme/core/Leaky.java', [
    'package com.acme.core;',
    'import java.io.InputStream;',
    'public class Leaky {',
    '    void run(Resource res) { InputStream in = res.adaptTo(InputStream.class); use(in); }',
    '    void use(InputStream in) {}',
    '    static class Inner { }',
    '}',
  ].join('\n'));
  write(root, 'core/src/main/java/com/acme/core/Danger.java', [
    'package com.acme.core;',
    'import java.io.*;',
    'public class Danger {',
    '    Object run(SlingHttpServletRequest request) throws Exception {',
    '        ObjectInputStream ois = new ObjectInputStream(request.getInputStream());',
    '        return ois.readObject();',
    '    }',
    '}',
  ].join('\n'));
  write(root, 'core/src/main/java/com/acme/core/PassThrough.java', 'package com.acme.core;\nimport java.io.InputStream;\npublic class PassThrough { int size(InputStream in) { return 0; } }\n');
  write(root, 'core/src/main/java/com/acme/core/Clean.java', 'package com.acme.core;\npublic class Clean { }\n');
  write(root, 'core/src/test/java/com/acme/core/LeakyTest.java', 'package com.acme.core;\nimport java.io.*;\nclass LeakyTest { void t() throws Exception { new FileInputStream("x"); } }\n');
  write(root, 'core/target/classes/Gen.java', 'package g;\nimport java.io.*;\nclass Gen { void t() throws Exception { new FileInputStream("x"); } }\n');
  return root;
}

test('one finding per file, ordered by risk; benign files are informational; tests and target/ are skipped', () => {
  const root = fixtureWorkspace();
  const r = runInputStreamScan(root);
  assert.ok(r.ok);
  const files = r.rawFindings.map(f => `${path.basename(f.file)}:${f.severity}${f.informational ? ':info' : ''}`);
  assert.deepStrictEqual(files, ['Danger.java:critical', 'Leaky.java:medium', 'PassThrough.java:info:info']);
  assert.strictEqual(r.stats.actionableFiles, 2);
  assert.deepStrictEqual(r.stats.fix, { auto: 1, review: 0, decision: 1 });
  assert.ok(r.findings[0].location.endsWith('Danger.java:5'));
});

test('BPA merge: nested classes resolve to their file, unmatched classes get a neutral hint, third-party rows collapse per bundle', () => {
  const root = fixtureWorkspace();
  const r = runInputStreamScan(root, {
    bpaTargets: [
      { className: 'com.acme.core.Leaky$Inner', identifier: 'java.io.InputStream', bundle: 'com.acme.core' },
      { className: 'com.acme.core.Clean', identifier: 'java.io.FileInputStream', bundle: 'com.acme.core' },
      { className: 'acscommons.com.google.common.io.ByteSource', identifier: 'java.io.InputStream', bundle: 'com.adobe.acs.acs-aem-commons-bundle' },
      { className: 'acscommons.com.google.common.io.ByteSource$1', identifier: 'java.io.InputStream', bundle: 'com.adobe.acs.acs-aem-commons-bundle' },
      { className: 'acscommons.com.google.common.io.Files', identifier: 'java.io.FileInputStream', bundle: 'com.adobe.acs.acs-aem-commons-bundle' },
      { className: 'org.apache.xml.Thing', identifier: 'java.io.InputStream' },
    ],
  });
  const leaky = r.rawFindings.find(f => f.file && f.file.endsWith('Leaky.java'));
  assert.deepStrictEqual(leaky.bpa.classes, ['com.acme.core.Leaky$Inner']);

  const unmatched = r.rawFindings.find(f => f.kind === 'bpa-unmatched');
  assert.ok(unmatched.file.endsWith('Clean.java'));
  assert.ok(/compiled classes/.test(unmatched.hint));
  assert.ok(/Danger\.java|Leaky\.java/.test(unmatched.hint), 'points at same-package files with stream usage');

  const groups = r.rawFindings.filter(f => f.file === null);
  assert.deepStrictEqual(groups.map(g => `${g.kind}:${g.group}:${g.classCount}/${g.rowCount}`), [
    'not-in-workspace:bundle com.adobe.acs.acs-aem-commons-bundle:2/3',
    'not-in-workspace:package org.apache.xml:1/1',
  ]);
  assert.ok(groups.every(g => g.informational));
  assert.deepStrictEqual(r.stats.bpa, {
    rows: 6, resolvedFiles: 2, unmatchedFiles: 1,
    missingSourceRows: 0, thirdPartyRows: 4, platformProvidedRows: 0, bundleGroups: 2,
  });
});

test('BPA merge: three buckets — customer code elsewhere, third-party, platform-provided (AEM Forms add-on)', () => {
  const root = fixtureWorkspace();
  const r = runInputStreamScan(root, {
    bpaTargets: [
      { className: 'com.acme.core.Leaky', identifier: 'java.io.InputStream', bundle: 'com.acme.core' },
      // Same bundle as a workspace class, but its source isn't here.
      { className: 'com.acme.core.other.Gone', identifier: 'java.io.FileInputStream', bundle: 'com.acme.core' },
      // A different bundle in the customer's namespace (another repository).
      { className: 'com.acme.shared.util.Csv', identifier: 'java.io.InputStreamReader', bundle: 'com.acme.shared.core' },
      { className: 'com.adobe.acs.commons.util.Thing', identifier: 'java.io.InputStream', bundle: 'com.adobe.acs.acs-aem-commons-bundle' },
      { className: 'com.adobe.fd.signatures.Sig', identifier: 'java.io.InputStream', bundle: 'adobe-aemfd-signatures' },
      { className: 'com.adobe.xfa.Doc', identifier: 'java.io.ObjectInputStream', bundle: 'xfa4j' },
    ],
  });
  const groups = r.rawFindings.filter(f => f.file === null);
  assert.deepStrictEqual(groups.map(g => `${g.kind}:${g.bundle}`), [
    'missing-source:com.acme.core',
    'missing-source:com.acme.shared.core',
    'not-in-workspace:com.adobe.acs.acs-aem-commons-bundle',
    'platform-provided:adobe-aemfd-signatures',
    'platform-provided:xfa4j',
  ]);
  const detail = bundle => r.findings.find(f => f.location === `bundle ${bundle}`).detail;
  assert.ok(/Forms add-on/.test(detail('adobe-aemfd-signatures')));
  assert.ok(/upgrade/.test(detail('com.adobe.acs.acs-aem-commons-bundle')));
  assert.ok(/repository that builds it/.test(detail('com.acme.shared.core')));
  assert.ok(r.warnings.some(w => /bundle com\.acme\.shared\.core looks like customer code but has no source/.test(w)));
  assert.ok(r.warnings.some(w => /com\.acme\.core\.other\.Gone/.test(w)));
  assert.deepStrictEqual(
    [r.stats.bpa.missingSourceRows, r.stats.bpa.thirdPartyRows, r.stats.bpa.platformProvidedRows, r.stats.bpa.bundleGroups],
    [2, 1, 2, 5]
  );
});

test('a BPA report with no workspace matches warns instead of silently reporting clean', () => {
  const root = fixtureWorkspace();
  const r = runInputStreamScan(root, { bpaTargets: [{ className: 'x.y.Z', identifier: 'java.io.InputStream', bundle: 'vendor' }] });
  assert.ok(r.warnings.some(w => /none of the 1 BPA rows resolve/.test(w)));
});

test('precedence: with BPA rows only the reported files are in scope; without them every file is scanned', () => {
  const root = fixtureWorkspace();
  const bpa = runInputStreamScan(root, { bpaTargets: [{ className: 'com.acme.core.Leaky', identifier: 'java.io.InputStream' }] });
  assert.strictEqual(bpa.stats.mode, 'bpa');
  assert.deepStrictEqual(bpa.rawFindings.map(f => path.basename(f.file)), ['Leaky.java'], 'Danger.java uses streams but is not in the BPA report');
  assert.ok(bpa.stats.filesScanned < bpa.stats.filesIndexed, 'only the reported files are scanned');

  const local = runInputStreamScan(root);
  assert.strictEqual(local.stats.mode, 'local');
  assert.deepStrictEqual(local.rawFindings.map(f => path.basename(f.file)), ['Danger.java', 'Leaky.java', 'PassThrough.java']);
});

test('rows without a bundle name (CAM data) group by package; AEM Forms packages are platform-provided', () => {
  const root = fixtureWorkspace();
  const r = runInputStreamScan(root, {
    bpaTargets: [
      { className: 'com.adobe.fd.signatures.SigUtil', identifier: 'java.io.InputStream' },
      { className: 'com.adobe.xfa.Document', identifier: 'java.io.InputStream' },
      { className: 'com.google.common.io.ByteSource', identifier: 'java.io.InputStream' },
      { className: 'com.acme.shared.Csv', identifier: 'java.io.InputStream' },
    ],
  });
  assert.deepStrictEqual(r.rawFindings.filter(f => f.file === null).map(g => `${g.kind}:${g.group}`), [
    'missing-source:package com.acme.shared',
    'not-in-workspace:package com.google.common',
    'platform-provided:package com.adobe.fd',
    'platform-provided:package com.adobe.xfa',
  ]);
});

test('CLI: CAM targets (--bpa-json) come before the CSV, the CSV before the local scan', () => {
  const root = fixtureWorkspace();
  const runner = path.join(__dirname, 'input-stream-runner.js');
  const csv = write(root, 'bpa.csv', [
    'code,type,subtype,importance,identifier,other,message,moreInfo,context',
    'DG,development.guideline,java.io.inputstream,ADVISORY,com.acme.core.Danger,java.io.ObjectInputStream,The com.acme.core.Danger class in the com.acme.core bundle uses java.io.ObjectInputStream.,x,ctx',
  ].join('\n') + '\n');
  const cam = write(root, 'cam.json', JSON.stringify({ inputStream: [{ pattern: 'inputStream', className: 'com.acme.core.Leaky', identifier: 'java.io.InputStream' }] }));
  const empty = write(root, 'empty.json', JSON.stringify({ inputStream: [] }));
  const run = (...extra) => JSON.parse(execFileSync(process.execPath,
    [runner, root, '--json', '--collections', path.join(root, `uc-${extra.length}-${Math.random()}`), ...extra], { encoding: 'utf8' }));
  const files = out => out.findings.filter(f => f.kind === 'source').map(f => path.basename(f.file));

  const camFirst = run('--bpa-json', cam, '--csv', csv);
  assert.strictEqual(camFirst.source, 'cam');
  assert.deepStrictEqual(files(camFirst), ['Leaky.java']);

  const csvNext = run('--bpa-json', empty, '--csv', csv);
  assert.strictEqual(csvNext.source, 'csv');
  assert.deepStrictEqual(files(csvNext), ['Danger.java']);

  const local = run();
  assert.strictEqual(local.source, 'local-scan');
  assert.deepStrictEqual(files(local), ['Danger.java', 'Leaky.java', 'PassThrough.java']);
});

test('--files mode re-scans only the given files (apply-time verification)', () => {
  const root = fixtureWorkspace();
  const leaky = path.join(root, 'core/src/main/java/com/acme/core/Leaky.java');
  const before = runInputStreamScan(root, { files: ['core/src/main/java/com/acme/core/Leaky.java'] });
  assert.deepStrictEqual(before.rawFindings.map(f => path.basename(f.file)), ['Leaky.java']);
  assert.strictEqual(before.stats.fix.auto, 1);

  fs.writeFileSync(leaky, fs.readFileSync(leaky, 'utf8').replace(
    'InputStream in = res.adaptTo(InputStream.class); use(in);',
    'try (InputStream in = res.adaptTo(InputStream.class)) { use(in); }'
  ));
  const after = runInputStreamScan(root, { files: [leaky] });
  assert.strictEqual(after.stats.fix.auto, 0, 'the B site is gone once try-with-resources is applied');
  assert.strictEqual(after.stats.actionableFiles, 0);
});

test('CLI --json emits workspace-relative findings and stats', () => {
  const root = fixtureWorkspace();
  const out = execFileSync(process.execPath, [path.join(__dirname, 'input-stream-runner.js'), root, '--json'], { encoding: 'utf8' });
  const json = JSON.parse(out);
  assert.strictEqual(json.stats.actionableFiles, 2);
  assert.ok(json.findings.every(f => !f.file || !path.isAbsolute(f.file)));
});

test('packages named build, target, out or dist inside src/main/java are scanned; module-level target/ is not', () => {
  const root = fixtureWorkspace();
  for (const pkg of ['build', 'target', 'out', 'dist']) {
    write(root, `core/src/main/java/com/acme/${pkg}/Tool.java`, `package com.acme.${pkg};\nimport java.io.InputStream;\npublic class Tool { void a(Resource r) { InputStream in = r.adaptTo(InputStream.class); use(in); } void use(InputStream i) {} }\n`);
  }
  const local = runInputStreamScan(root);
  const files = local.rawFindings.filter(f => f.kind === 'source').map(f => path.relative(root, f.file));
  for (const pkg of ['build', 'target', 'out', 'dist']) {
    assert.ok(files.includes(`core/src/main/java/com/acme/${pkg}/Tool.java`), `${pkg} package scanned`);
  }
  assert.ok(!files.some(f => f.startsWith('core/target/')), 'core/target/ is still skipped');

  const bpa = runInputStreamScan(root, { bpaTargets: [{ className: 'com.acme.build.Tool', identifier: 'java.io.InputStream' }] });
  assert.deepStrictEqual(bpa.rawFindings.map(f => f.kind), ['source'], 'the BPA class resolves to its file, not to "outside the workspace"');
});

test('CLI: --csv rebuilds a cached collection that predates inputStream instead of falling back to the local scan', () => {
  const root = fixtureWorkspace();
  const runner = path.join(__dirname, 'input-stream-runner.js');
  const csv = write(root, 'bpa.csv', [
    'code,type,subtype,importance,identifier,other,message,moreInfo,context',
    'DG,development.guideline,java.io.inputstream,ADVISORY,com.acme.core.Leaky,java.io.InputStream,The com.acme.core.Leaky class in the com.acme.core bundle uses java.io.InputStream.,x,ctx',
    'DG,development.guideline,sling.commons.scheduler,MAJOR,com.acme.core.Job,\\N,The com.acme.core.Job class uses the scheduler.,x,ctx',
  ].join('\n') + '\n');
  const collections = path.join(root, 'uc');
  // A cache written by a parser from before inputStream support: no inputStream data, no parsedSubtypes.
  write(root, 'uc/unified-collection.json', JSON.stringify({
    subtypes: { sling_commons_scheduler: { org_apache_sling_commons_scheduler: ['com.acme.core.Job'] } },
    meta: { timestamp: '2026-01-01T00:00:00.000Z', source: 'local-bpa-parser', totalFindings: 1, subtypeCount: 1 },
  }));
  const out = JSON.parse(execFileSync(process.execPath, [runner, root, '--csv', csv, '--collections', collections, '--json'], { encoding: 'utf8' }));
  assert.strictEqual(out.source, 'csv');
  assert.deepStrictEqual(out.findings.filter(f => f.kind === 'source').map(f => path.basename(f.file)), ['Leaky.java']);
});

// ── Review follow-ups: incomplete --files scans and file-wide native context ─

test('--files: a missing or unreadable path fails verification, is named, and is not counted as scanned', () => {
  const root = fixtureWorkspace();
  const good = 'core/src/main/java/com/acme/core/Leaky.java';
  const r = runInputStreamScan(root, {
    files: [good, 'core/src/main/java/com/acme/core/Typo.java', 'core/src/main/java'],
  });
  assert.strictEqual(r.ok, false, 'a rescan that skipped a requested file must not pass as clean');
  assert.match(r.error, /2 of 3 requested file\(s\) could not be scanned/);
  assert.match(r.error, /Typo\.java \(not found\)/);
  assert.match(r.error, /core\/src\/main\/java \(unreadable \(EISDIR\)\)/);
  assert.strictEqual(r.stats.filesRequested, 3);
  assert.strictEqual(r.stats.filesScanned, 1, 'only the file that was read counts as scanned');
  assert.deepStrictEqual(r.stats.skippedFiles.map(f => path.basename(f.file)), ['Typo.java', 'java']);
  assert.ok(r.warnings.some(w => /Typo\.java was not scanned — not found/.test(w)));
  assert.deepStrictEqual(r.rawFindings.map(f => path.basename(f.file)), ['Leaky.java'], 'the readable file is still reported');
});

test('--files: every requested file readable keeps verification ok', () => {
  const root = fixtureWorkspace();
  const r = runInputStreamScan(root, { files: ['core/src/main/java/com/acme/core/Leaky.java'] });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.stats.filesRequested, 1);
  assert.deepStrictEqual(r.stats.skippedFiles, []);
});

test('CLI --files with a mistyped path exits non-zero and reports ok:false in the JSON', () => {
  const root = fixtureWorkspace();
  const runner = path.join(__dirname, 'input-stream-runner.js');
  const run = (args) => {
    try {
      return { code: 0, out: execFileSync(process.execPath, [runner, root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
    } catch (err) {
      return { code: err.status, out: err.stdout.toString(), err: err.stderr.toString() };
    }
  };
  const bad = run(['--files', 'core/src/main/java/com/acme/core/Leaky.java,core/src/main/java/com/acme/core/Typo.java', '--json']);
  assert.strictEqual(bad.code, 2);
  const json = JSON.parse(bad.out);
  assert.strictEqual(json.ok, false);
  assert.match(json.error, /Typo\.java \(not found\)/);
  assert.deepStrictEqual(json.stats.skippedFiles.map(f => path.basename(f.file)), ['Typo.java']);

  const text = run(['--files', 'core/src/main/java/com/acme/core/Typo.java']);
  assert.strictEqual(text.code, 2);
  assert.match(text.err, /Incomplete scan/);

  assert.strictEqual(run(['--files', 'core/src/main/java/com/acme/core/Leaky.java', '--json']).code, 0);
});

test('a native process marks only the streams in its own method as E; elsewhere in the file it is a file-level note', () => {
  const sites = sitesOf([
    'void run(File workingDir) throws Exception { new ProcessBuilder("ffmpeg").start(); File out = new File(workingDir, "o.mp3"); FileInputStream fis = new FileInputStream(out); use(fis); }',
    'InputStream mem(byte[] b) { return new ByteArrayInputStream(b); }',
    'void cfg(Resource r) throws Exception { try (InputStream in = r.adaptTo(InputStream.class)) { use(in); } }',
    'void use(InputStream i) {}',
  ].join('\n'));
  assert.deepStrictEqual(sites.map(s => `${s.source}:${s.categories.join('+')}`), ['file:E+B', 'byte-array:A', 'repo-binary:A']);
  assert.ok(/this method runs a native process/.test(sites[0].note));
  assert.ok(sites.slice(1).every(s => s.fix === 'none' && s.severity === 'info'), 'unrelated sites keep their own severity and fix kind');
});

test('native process lines are reported at file level and do not inflate the decision counts', () => {
  const root = mkworkspace();
  write(root, 'core/src/main/java/com/acme/Mixed.java', [
    'package com.acme;',
    'import java.io.*;',
    'public class Mixed {',
    '    void transcode() throws Exception { new ProcessBuilder("ffmpeg").start(); }',
    '    InputStream mem(byte[] b) { return new ByteArrayInputStream(b); }',
    '    void load(Resource res) throws Exception { InputStream in = res.adaptTo(InputStream.class); use(in); }',
    '    void use(InputStream i) {}',
    '}',
  ].join('\n'));
  const r = runInputStreamScan(root);
  const f = r.rawFindings.find(x => x.kind === 'source');
  assert.deepStrictEqual(f.nativeProcessLines, [4]);
  assert.ok(/starts a native process \(L4\)/.test(r.findings[0].detail));
  assert.deepStrictEqual(f.sites.map(s => s.categories.join('+')), ['A', 'B'], 'the ByteArrayInputStream is not E, and the unclosed stream is only B');
  assert.deepStrictEqual(r.stats.fix, { auto: 1, review: 0, decision: 0 });
  assert.strictEqual(f.severity, 'medium');
});

test('importing an FFmpeg helper type is not a native process; its uses are', () => {
  const r = scanJavaSource([
    'package com.acme;',
    'import java.io.*;',
    'import com.day.cq.dam.handler.ffmpeg.FFMpegWrapper;',
    'import com.day.cq.dam.handler.ffmpeg.ExecutableLocator;',
    'public class T {',
    '  InputStream mem(byte[] b) { return new ByteArrayInputStream(b); }',
    '  void run(ExecutableLocator locator) { FFMpegWrapper w = FFMpegWrapper.fromProfile(null, null, null); }',
    '}',
  ].join('\n'));
  assert.deepStrictEqual(r.nativeLines, [7], 'only the use on L7, not the imports on L3 and L4');
});
