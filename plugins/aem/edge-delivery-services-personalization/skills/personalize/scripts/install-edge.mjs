#!/usr/bin/env node
/*
 * Generates the Cloudflare edge worker for personalization. Idempotent; never
 * deploys anything.
 *
 * New worker (default): cdn/cloudflare-worker/ = official AEM prod worker,
 * vendored unchanged, wrapped by src/index.mjs.
 * Existing worker (--existing <dir>): only src/personalization/ is added; the
 * wrap instructions are printed and the existing entry point is not touched.
 *
 * Usage: node install-edge.mjs [repoDir] [--dir cdn/cloudflare-worker]
 *          [--existing <workerDir>] [--name <worker>] [--origin <main--repo--owner.aem.live>]
 *          [--route <www.example.com/*>] [--account <id>] [--dry-run]
 */

import { execFileSync } from 'node:child_process';
import {
  copyFileSync, mkdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import {
  basename, dirname, join, resolve,
} from 'node:path';
import {
  EDGE_DIR, RUNTIME_DIR, SHARED_WITH_EDGE, exitOnHelp, isMain, parseArgs, readText,
} from './lib.mjs';

export const USAGE = `Usage: node install-edge.mjs [repoDir] [--dir cdn/cloudflare-worker]
         [--existing <workerDir>] [--name <worker>] [--origin <main--repo--owner.aem.live>]
         [--route <www.example.com/*>] [--account <id>] [--dry-run]
Generates the Cloudflare edge worker for personalization (idempotent). Never
deploys: wrangler deploy / secret put stay with the site owner.`;


/**
 * Guesses the AEM origin from the git remote: main--<repo>--<owner>.aem.live.
 * @param {string} repo
 * @returns {string|null}
 */
export function guessOrigin(repo) {
  try {
    const remote = execFileSync('git', ['-C', repo, 'config', '--get', 'remote.origin.url'], { encoding: 'utf8' }).trim();
    const match = /[/:]([^/:]+)\/([^/]+?)(?:\.git)?$/.exec(remote);
    return match ? `main--${match[2]}--${match[1]}.aem.live`.toLowerCase() : null;
  } catch (e) {
    return null;
  }
}

/**
 * A Worker name from the repo (git remote, else the folder name): lowercase
 * letters, digits and dashes, at most 63 characters.
 * @param {string} repo
 * @returns {string}
 */
export function workerNameFor(repo) {
  let base = '';
  try {
    const remote = execFileSync('git', ['-C', repo, 'config', '--get', 'remote.origin.url'], { encoding: 'utf8' }).trim();
    base = /[/:][^/:]+\/([^/]+?)(?:\.git)?$/.exec(remote)?.[1] || '';
  } catch (e) { /* no git remote */ }
  const name = (base || basename(resolve(repo))).toLowerCase().replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
  return name || 'aem-site';
}

function plan(existing) {
  const personalization = [
    ...SHARED_WITH_EDGE.map((name) => ({
      from: join(RUNTIME_DIR, 'scripts', 'personalization', name), to: `src/personalization/${name}`, owner: 'skill',
    })),
    ...['personalize.js', 'html.js'].map((name) => ({
      from: join(EDGE_DIR, 'src', 'personalization', name), to: `src/personalization/${name}`, owner: 'skill',
    })),
    { from: join(EDGE_DIR, 'src', 'personalization', 'edge-config.js'), to: 'src/personalization/edge-config.js', owner: 'site' },
  ];
  if (existing) return personalization;
  return [
    ...personalization,
    { from: join(EDGE_DIR, 'src', 'index.mjs'), to: 'src/index.mjs', owner: 'skill' },
    { from: join(EDGE_DIR, 'src', 'aem-worker.mjs'), to: 'src/aem-worker.mjs', owner: 'skill' },
    { from: join(EDGE_DIR, 'README.md'), to: 'README.md', owner: 'skill' },
    { from: join(EDGE_DIR, 'LICENSE_APACHE'), to: 'LICENSE_APACHE', owner: 'skill' },
  ];
}

const WRAP_INSTRUCTIONS = `Wrap the existing worker's fetch handler:

  import config from './personalization/edge-config.js';
  import { handleApiRoute, personalizeResponse } from './personalization/personalize.js';

  // inside fetch(request, env, ctx), before the origin fetch:
  const routed = await handleApiRoute(request, env, config);
  if (routed) return routed;
  // after the existing logic produced \`response\`:
  return personalizeResponse(request, response, { config, env, cf: request.cf, ctx });`;

/**
 * @param {string} repo
 * @param {object} options
 * @returns {object} report
 */
export function installEdge(repo, options = {}) {
  const {
    dir = 'cdn/cloudflare-worker', existing, name, origin, route, account, dryRun = false,
  } = options;
  const workerDir = join(repo, existing || dir);
  const workerName = name || workerNameFor(repo);
  const report = {
    workerDir: existing || dir, created: [], updated: [], unchanged: [], kept: [], warnings: [], next: [],
  };
  const write = (target, content) => {
    if (dryRun) return;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  };

  plan(!!existing).forEach(({ from, to, owner }) => {
    const target = join(workerDir, to);
    const current = readText(target);
    const source = readFileSync(from, 'utf8');
    if (current === null) {
      if (!dryRun) {
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(from, target);
      }
      report.created.push(to);
    } else if (current === source) report.unchanged.push(to);
    else if (owner === 'skill') {
      write(target, source);
      report.updated.push(to);
    } else report.kept.push(to);
  });

  if (!existing) {
    const toml = join(workerDir, 'wrangler.toml');
    if (readText(toml) === null) {
      const resolvedOrigin = origin || guessOrigin(repo) || 'main--REPO--OWNER.aem.live';
      if (!origin && !guessOrigin(repo)) report.warnings.push('could not guess ORIGIN_HOSTNAME; edit wrangler.toml');
      const content = readFileSync(join(EDGE_DIR, 'wrangler.toml.tmpl'), 'utf8')
        .replace('{{WORKER_NAME}}', workerName)
        .replace('{{ROUTE_LINE}}', route ? `route = "${route}"` : '# route = "www.example.com/*"')
        .replace('{{ACCOUNT_LINE}}', account ? `account_id = "${account}"` : '# account_id = "<account id>"')
        .replace('{{ORIGIN_HOSTNAME}}', resolvedOrigin);
      write(toml, content);
      report.created.push('wrangler.toml');
      if (!route) report.next.push('uncomment and set `route` in wrangler.toml before deploying');
      if (!account) report.next.push('uncomment and set `account_id` in wrangler.toml (or CLOUDFLARE_ACCOUNT_ID)');
    } else {
      report.kept.push('wrangler.toml');
    }
    const pkgPath = join(workerDir, 'package.json');
    if (readText(pkgPath) === null) {
      write(pkgPath, `${JSON.stringify({
        private: true,
        name: workerName,
        version: '1.0.0',
        type: 'module',
        scripts: { dev: 'wrangler dev', deploy: 'wrangler deploy', log: 'wrangler tail -f pretty' },
        license: 'Apache-2.0',
      }, null, 2)}\n`);
      report.created.push('package.json');
    }
  } else {
    report.next.push(WRAP_INSTRUCTIONS);
  }

  // Keep worker sources off the EDS code bus.
  const ignorePath = join(repo, '.hlxignore');
  const ignore = readText(ignorePath) || '';
  const top = (existing || dir).split('/')[0];
  if (!new RegExp(`^/?${top}/?(\\*\\*)?$`, 'm').test(ignore)) {
    write(ignorePath, `${ignore}${ignore && !ignore.endsWith('\n') ? '\n' : ''}${top}/\n`);
    report.updated.push('.hlxignore');
  }
  report.next.push('client config: set api.endpoint to the edge apiRoute (default /pzn/decide) if placeholders use `source | api`');
  report.next.push('deploy only with the site owner: log in interactively (npx wrangler login) or set CLOUDFLARE_API_TOKEN, then npx wrangler deploy (see reference/edge-cloudflare.md)');
  return report;
}

if (isMain(import.meta.url)) {
  exitOnHelp(USAGE);
  const args = parseArgs(process.argv.slice(2));
  const repo = args._[0] || process.cwd();
  const report = installEdge(repo, {
    dir: typeof args.dir === 'string' ? args.dir : undefined,
    existing: typeof args.existing === 'string' ? args.existing : undefined,
    name: args.name,
    origin: args.origin,
    route: args.route,
    account: args.account,
    dryRun: !!args['dry-run'],
  });
  console.log(JSON.stringify(report, null, 2));
}
