'use strict';

const { execFileSync } = require('child_process');

function jarDsDescriptors(jarPath) {
  // read all OSGI-INF/*.xml entries via `unzip -p`
  const listing = execFileSync('unzip', ['-l', jarPath], { encoding: 'utf8' });
  const files = [];
  for (const line of listing.split('\n')) {
    const m = line.match(/(OSGI-INF\/[^ ]+\.xml)$/);
    if (m) files.push(m[1]);
  }
  return files.map(f => [f, execFileSync('unzip', ['-p', jarPath, f], { encoding: 'utf8' })]);
}

// Read META-INF/MANIFEST.MF from a jar, unfolding continuation lines.
function readJarManifest(jarPath) {
  try {
    const mf = execFileSync('unzip', ['-p', jarPath, 'META-INF/MANIFEST.MF'], { encoding: 'utf8' });
    return mf.replace(/\r?\n /g, '');
  } catch { return ''; }
}

// True when a jar's compiled classes reference `fqcn`. OSGi Import-Package is
// package-granular (it lists `com.day.cq.dam.api`, not the class), so class
// usage is detected from the constant-pool internal name in the bytecode.
function jarReferencesClass(jarPath, fqcn) {
  try {
    const buf = execFileSync('unzip', ['-p', jarPath, '*.class'], { maxBuffer: 128 * 1024 * 1024 });
    return referencesClassName(buf, fqcn);
  } catch { return false; }
}

// Names from `methodNames` present in the bytecode of a jar whose classes
// reference `ownerFqcn`; method names live in the constant pool as UTF-8.
function jarReferencedMethods(jarPath, ownerFqcn, methodNames) {
  try {
    const buf = execFileSync('unzip', ['-p', jarPath, '*.class'], { maxBuffer: 128 * 1024 * 1024 });
    return referencesClassName(buf, ownerFqcn) ? methodNames.filter((name) => buf.includes(name)) : [];
  } catch { return []; }
}

function referencesClassName(buf, fqcn) {
  const needle = fqcn.replace(/\./g, '/');
  return Buffer.isBuffer(buf) ? buf.includes(needle) : String(buf).includes(needle);
}

// True when `pkg` (or a sub-package of it) appears in the manifest's
// Import-Package header only — never bleeding into Export-Package or other
// headers, and never matching a sibling package by prefix.
function manifestImportsPackage(manifest, pkg) {
  const header = (manifest.match(/^Import-Package:[ \t]*(.*)$/m) || [])[1] || '';
  const escaped = pkg.replace(/[.]/g, '\\.');
  return new RegExp(`(^|,)\\s*${escaped}(\\.[A-Za-z0-9_$.]+)?\\s*(;|,|$)`).test(header);
}

module.exports = { jarDsDescriptors, readJarManifest, jarReferencesClass, jarReferencedMethods, referencesClassName, manifestImportsPackage };
