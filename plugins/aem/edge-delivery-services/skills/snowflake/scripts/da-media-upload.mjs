#!/usr/bin/env node
/* eslint-disable no-await-in-loop, no-console, no-restricted-syntax, no-continue --
   CLI batch tool: sequential async uploads are intentional (polite rate-
   limiting + readable progress); console is the output channel; for-of
   loops are clearer than .reduce/.forEach for ordered side effects;
   continue is clearer than nested ternaries for the skip-existing path. */
/**
 * da-media-upload.mjs
 *
 * Upload a tree of binaries to DA's /media/ folder via the Source API and
 * emit a mapping JSON of local-path → content.da.live URL.
 *
 * Contract — fully documented in the da-content skill:
 * - PUT https://admin.da.live/source/{org}/{repo}/<path>
 * - Authorization: Bearer <IMS token>
 * - multipart/form-data, field name MUST be `data` (other names silently
 *   succeed but write no file — da-content silent-failure rule #7)
 * - Size caps: SVG 40KB, PNG/JPG/AVIF/WEBP 20MB, MP4 36MB
 *   (da-content silent-failure rule #8 / media.md §5)
 *
 * Usage:
 *   node tools/da-media-upload.mjs \
 *     --src-dir <local-asset-root> \
 *     --org <github-org> \
 *     --repo <github-repo> \
 *     --scope /media/<scope-path> \
 *     --token-file <~/.aem/da-token.json> \
 *     --out <mapping.json> \
 *     [--dry-run] [--skip-existing]
 *
 * --skip-existing performs a HEAD on content.da.live first; skips upload if
 * the path already exists. Useful for re-runs after partial failures.
 */

import { readFile, stat, readdir } from 'node:fs/promises';
import { writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

const SIZE_CAPS = {
  'image/svg+xml': 40 * 1024,
  'image/png': 20 * 1024 * 1024,
  'image/jpeg': 20 * 1024 * 1024,
  'image/webp': 20 * 1024 * 1024,
  'image/avif': 20 * 1024 * 1024,
  'image/gif': 20 * 1024 * 1024,
  'video/mp4': 36 * 1024 * 1024,
  'video/webm': 36 * 1024 * 1024,
};

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === '--dry-run' || k === '--skip-existing') {
      args[k.slice(2).replace(/-/g, '_')] = true;
    } else if (k.startsWith('--')) {
      args[k.slice(2).replace(/-/g, '_')] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      files.push(...await walk(p));
    } else if (e.isFile()) {
      files.push(p);
    }
  }
  return files;
}

function mimeOf(path) {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

async function checkSizeCap(path, mime) {
  const s = await stat(path);
  const cap = SIZE_CAPS[mime];
  if (cap && s.size > cap) {
    return {
      ok: false, size: s.size, cap, mime,
    };
  }
  return { ok: true, size: s.size };
}

async function headExists(contentUrl) {
  try {
    const r = await fetch(contentUrl, { method: 'HEAD' });
    return r.status === 200;
  } catch {
    return false;
  }
}

async function uploadOne({
  token, org, repo, scope, localPath, srcDir,
}) {
  const rel = relative(srcDir, localPath);
  const remotePath = `${scope.replace(/^\//, '')}/${rel}`;
  const mime = mimeOf(localPath);

  // Pre-flight size cap
  const sizeCheck = await checkSizeCap(localPath, mime);
  if (!sizeCheck.ok) {
    return {
      localPath,
      remotePath,
      ok: false,
      reason: `size ${sizeCheck.size} > cap ${sizeCheck.cap} (${mime})`,
    };
  }

  const bytes = await readFile(localPath);
  const form = new FormData();
  form.append('data', new Blob([bytes], { type: mime }), rel.split('/').pop());

  const url = `https://admin.da.live/source/${org}/${repo}/${remotePath}`;
  const r = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  if (r.status !== 200 && r.status !== 201) {
    const body = await r.text();
    return {
      localPath,
      remotePath,
      ok: false,
      reason: `HTTP ${r.status}: ${body.slice(0, 200)}`,
    };
  }

  const contentUrl = `https://content.da.live/${org}/${repo}/${remotePath}`;
  return {
    localPath,
    remotePath,
    contentUrl,
    size: sizeCheck.size,
    mime,
    ok: true,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const required = ['src_dir', 'org', 'repo', 'scope', 'token_file', 'out'];
  for (const k of required) {
    if (!args[k]) {
      console.error(`[da-media-upload] missing --${k.replace(/_/g, '-')}`);
      process.exit(1);
    }
  }

  // Load and validate token
  if (!existsSync(args.token_file)) {
    console.error(`[da-media-upload] token file not found: ${args.token_file}`);
    process.exit(1);
  }
  const tokenJson = JSON.parse(await readFile(args.token_file, 'utf8'));
  const token = tokenJson.access_token;
  if (!token) {
    console.error('[da-media-upload] access_token missing in token file');
    process.exit(1);
  }
  if (tokenJson.expires_at && tokenJson.expires_at < Date.now()) {
    console.error(
      `[da-media-upload] token expired at ${new Date(tokenJson.expires_at).toISOString()}`,
    );
    process.exit(1);
  }

  // Walk src dir
  const files = await walk(args.src_dir);
  console.log(`[da-media-upload] found ${files.length} file(s) under ${args.src_dir}`);

  const results = [];
  let okCount = 0;
  let skipCount = 0;
  let failCount = 0;

  for (const localPath of files) {
    const rel = relative(args.src_dir, localPath);
    const remotePath = `${args.scope.replace(/^\//, '')}/${rel}`;
    const contentUrl = `https://content.da.live/${args.org}/${args.repo}/${remotePath}`;

    if (args.skip_existing) {
      const exists = await headExists(contentUrl);
      if (exists) {
        console.log(`[da-media-upload] SKIP ${rel} (already at ${contentUrl})`);
        results.push({
          localPath, remotePath, contentUrl, ok: true, skipped: true,
        });
        skipCount += 1;
        continue;
      }
    }

    if (args.dry_run) {
      console.log(`[da-media-upload] DRY ${rel} → ${remotePath}`);
      results.push({
        localPath, remotePath, contentUrl, ok: true, dryRun: true,
      });
      okCount += 1;
      continue;
    }

    const r = await uploadOne({
      token,
      org: args.org,
      repo: args.repo,
      scope: args.scope,
      localPath,
      srcDir: args.src_dir,
    });
    results.push(r);
    if (r.ok) {
      console.log(`[da-media-upload] OK   ${rel} → ${r.contentUrl} (${r.size}B ${r.mime})`);
      okCount += 1;
    } else {
      console.error(`[da-media-upload] FAIL ${rel}: ${r.reason}`);
      failCount += 1;
    }
  }

  // Build mapping: rel-source-path → content.da.live URL (only successes)
  const mapping = {};
  for (const r of results) {
    if (r.ok) {
      const rel = relative(args.src_dir, r.localPath);
      mapping[rel] = r.contentUrl;
    }
  }

  writeFileSync(args.out, JSON.stringify({ mapping, results }, null, 2));
  console.log(
    `[da-media-upload] wrote ${args.out} — ${okCount} ok, ${skipCount} skipped, ${failCount} failed`,
  );

  if (failCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error('[da-media-upload] fatal:', err.message);
  process.exit(1);
});
