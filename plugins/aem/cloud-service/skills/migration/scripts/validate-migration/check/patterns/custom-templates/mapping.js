'use strict';

const { execFileSync } = require('child_process');

const LAYOUT_KINDS = new Set(['parsys', 'responsivegrid', 'container']);

function componentKind(resourceType) {
  const segments = resourceType.split('/').filter((segment) => !/^v\d+$/.test(segment));
  return segments[segments.length - 1];
}

// Elements carrying sling:resourceType, in document order.
function resourceNodes(xml) {
  return [...xml.matchAll(/<([\w:.-]+)\s([^>]*?)\/?>/g)].flatMap(([, name, attrs]) => {
    const type = attrs.match(/sling:resourceType="([^"]+)"/);
    return type ? [{ name, resourceType: type[1], editable: /editable="\{Boolean\}true"/.test(attrs) }] : [];
  });
}

function components(nodes) {
  return nodes.filter((node) => node.name !== 'jcr:content' && !LAYOUT_KINDS.has(componentKind(node.resourceType)));
}

/**
 * Compare the pre-migration static template (read from Git, never the working tree)
 * with the packaged editable template's structure and initial content.
 */
function verifyComponentMapping({ artifactPath, template, projectDir, staticTemplate, baselineRef = 'HEAD' }) {
  const staticPath = staticTemplate || template.replace(/^\/conf\/([^/]+)\/settings\/wcm\/templates\//, '/apps/$1/templates/');
  if (!/^\/apps\/[\w.-]+(\/[\w.-]+)*$/.test(staticPath)) return { verified: false, reason: `invalid --static-template ${JSON.stringify(staticPath)}` };
  let staticXml;
  if (typeof baselineRef !== 'string' || !baselineRef || baselineRef.startsWith('-')) {
    return { verified: false, reason: `invalid --baseline-ref ${JSON.stringify(baselineRef)}` };
  }
  try {
    const git = (...args) => execFileSync('git', args, { cwd: projectDir || process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const commit = git('rev-parse', '--verify', `${baselineRef}^{commit}`).trim();
    const suffix = `/jcr_root${staticPath}/.content.xml`;
    const file = git('ls-tree', '-r', '--full-tree', '--name-only', commit).split('\n').find((name) => name.endsWith(suffix));
    if (!file) return { verified: false, reason: `static template ${staticPath} not found at ${baselineRef}` };
    staticXml = git('show', `${commit}:${file}`);
  } catch {
    return { verified: false, reason: `cannot read static template ${staticPath} from Git ref ${baselineRef}` };
  }
  const read = (child) => {
    try {
      return execFileSync('unzip', ['-p', artifactPath, `jcr_root${template}/${child}/.content.xml`], { encoding: 'utf8' });
    } catch {
      return '';
    }
  };
  const staticNodes = resourceNodes(staticXml);
  const structureNodes = resourceNodes(read('structure'));
  const editableTypes = components([...structureNodes, ...resourceNodes(read('initial'))]).map((node) => componentKind(node.resourceType));
  const missing = [];
  for (const node of components(staticNodes)) {
    const index = editableTypes.indexOf(componentKind(node.resourceType));
    if (index >= 0) editableTypes.splice(index, 1);
    else missing.push(`${node.name} (${node.resourceType})`);
  }
  const staticHasParsys = staticNodes.some((node) => ['parsys', 'responsivegrid'].includes(componentKind(node.resourceType)));
  if (staticHasParsys && !structureNodes.some((node) => node.editable)) missing.push('editable container for the static parsys');
  return { verified: true, ok: !missing.length, staticPath, missing };
}

module.exports = { verifyComponentMapping };
