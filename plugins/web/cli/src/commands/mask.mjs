import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { createServer as createHttpsServer, request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CliError } from '#src/errors.mjs';
import { emit } from '#src/output.mjs';

const SUDO_LINE = 'sudo env CAROOT="$(mkcert -CAROOT)" web mask <display-domain> <target-url>';
const DOMAIN_RE = /^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$/;

/** @param {string} s */
export function validateDisplayDomain(s) {
  return DOMAIN_RE.test(s);
}

export function requireRoot({ getuid = process.getuid } = {}) {
  if (getuid() !== 0) {
    throw new CliError('USAGE', 'web mask must run as root (sudo)', { hint: SUDO_LINE });
  }
}

export function requireMkcert({ exec = execSync } = {}) {
  try {
    exec('which mkcert', { stdio: 'ignore' });
  } catch {
    throw new CliError('USAGE', 'mkcert is not installed', {
      hint: 'brew install mkcert && mkcert -install',
    });
  }
}

function addHostsEntry(hostsFile, entry, log) {
  const hosts = readFileSync(hostsFile, 'utf8');
  if (hosts.includes(entry)) {
    log(`Hosts entry already exists: ${entry}`);
    return;
  }
  writeFileSync(hostsFile, `${hosts.trimEnd()}\n${entry}\n`);
  log(`Added to ${hostsFile}: ${entry}`);
}

function removeHostsEntry(hostsFile, entry, log) {
  try {
    const kept = readFileSync(hostsFile, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== entry)
      .join('\n');
    writeFileSync(hostsFile, kept);
    log(`Removed from ${hostsFile}: ${entry}`);
  } catch (err) {
    log(`Warning: could not clean ${hostsFile}: ${err.message}`);
  }
}

function makeProxy({ target, displayDomain, log }) {
  const doRequest = target.protocol === 'https:' ? httpsRequest : httpRequest;
  return (req, res) => {
    const headers = { ...req.headers, host: target.host };
    delete headers['accept-encoding'];
    const proxyReq = doRequest(
      new URL(req.url, target.origin),
      { method: req.method, headers },
      (proxyRes) => {
        const out = { ...proxyRes.headers };
        if (out.location) {
          out.location = out.location.replace(target.origin, `https://${displayDomain}`);
        }
        delete out['strict-transport-security'];
        res.writeHead(proxyRes.statusCode, out);
        proxyRes.pipe(res);
      },
    );
    proxyReq.on('error', (err) => {
      log(`Proxy error: ${err.message}`);
      res.writeHead(502);
      res.end('Bad Gateway');
    });
    req.pipe(proxyReq);
  };
}

/**
 * Add hosts entry, mint a cert, and serve an HTTPS reverse proxy.
 * @returns {Promise<{ url: string, certDir: string, stop: () => Promise<void> }>}
 */
export async function startMask({
  displayDomain,
  targetUrl,
  hostsFile = '/etc/hosts',
  port = 443,
  log = (s) => process.stderr.write(`${s}\n`),
}) {
  const target = new URL(targetUrl);
  const entry = `127.0.0.1 ${displayDomain}`;
  const certDir = mkdtempSync(join(tmpdir(), 'domain-mask-'));
  const keyFile = join(certDir, 'key.pem');
  const certFile = join(certDir, 'cert.pem');
  let server;
  try {
    execFileSync('mkcert', ['-key-file', keyFile, '-cert-file', certFile, displayDomain], {
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    log('Generated trusted certificate via mkcert');
    addHostsEntry(hostsFile, entry, log);
    server = createHttpsServer(
      { key: readFileSync(keyFile), cert: readFileSync(certFile) },
      makeProxy({ target, displayDomain, log }),
    );
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, resolve);
    });
  } catch (err) {
    removeHostsEntry(hostsFile, entry, log);
    rmSync(certDir, { recursive: true, force: true });
    throw err;
  }
  const actual = server.address().port;
  const url = `https://${displayDomain}${actual === 443 ? '' : `:${actual}`}`;
  log(`${url} -> ${target.origin}`);
  const stop = async () => {
    log('Shutting down...');
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
    removeHostsEntry(hostsFile, entry, log);
    try {
      rmSync(certDir, { recursive: true });
    } catch (err) {
      log(`Warning: could not remove ${certDir}: ${err.message}`);
    }
  };
  return { url, certDir, stop };
}

function waitForSignal(stop) {
  return new Promise((resolve) => {
    const handler = async () => {
      process.off('SIGINT', handler);
      process.off('SIGTERM', handler);
      await stop();
      resolve();
    };
    process.on('SIGINT', handler);
    process.on('SIGTERM', handler);
  });
}

/** @param {import('commander').Command} program */
export function registerMask(program, deps = {}) {
  const { stdout = process.stdout } = deps;
  program
    .command('mask')
    .description('serve a target URL under a fake local HTTPS domain')
    .argument('<display-domain>', 'domain to show, e.g. wknd.adventures')
    .argument('<target-url>', 'upstream URL to proxy, e.g. https://example.com')
    .addHelpText(
      'after',
      `
Example:
  ${SUDO_LINE}
Output:
  { url, displayDomain, targetUrl }
Notes:
  Runs in the foreground until Ctrl-C, then restores /etc/hosts and removes certs.
  Needs sudo (hosts file, port 443) and mkcert. Without root it exits 2 (USAGE).`,
    )
    .action(async (displayDomain, targetUrl, _opts, command) => {
      if (!validateDisplayDomain(displayDomain)) {
        throw new CliError('USAGE', 'invalid domain name', {
          hint: 'use letters, digits, dots and hyphens, e.g. wknd.adventures',
        });
      }
      try {
        new URL(targetUrl);
      } catch {
        throw new CliError('USAGE', `invalid target URL: ${targetUrl}`, {
          hint: 'pass an absolute URL such as https://example.com',
        });
      }
      requireRoot({ getuid: deps.getuid });
      requireMkcert();
      const { url, stop } = await startMask({ displayDomain, targetUrl });
      const { format } = command.optsWithGlobals();
      emit({ url, displayDomain, targetUrl }, { format, stdout });
      await waitForSignal(stop);
    });
}
