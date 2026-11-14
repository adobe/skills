import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CliError } from '#src/errors.mjs';

/**
 * Return the proxy's self-signed key and certificate from `<dir>/.cert/`, creating them with
 * `openssl` when either is missing.
 * @param {string} dir
 * @returns {{ key: Buffer, cert: Buffer }}
 */
export function ensureCert(dir) {
  const certDir = path.join(dir, '.cert');
  const keyPath = path.join(certDir, 'key.pem');
  const certPath = path.join(certDir, 'cert.pem');
  if (!existsSync(keyPath) || !existsSync(certPath)) {
    mkdirSync(certDir, { recursive: true });
    try {
      execFileSync(
        'openssl',
        [
          'req',
          '-x509',
          '-newkey',
          'rsa:2048',
          '-nodes',
          '-subj',
          '/CN=web-cache',
          '-days',
          '3650',
        ].concat(['-keyout', keyPath, '-out', certPath]),
        { stdio: 'ignore' },
      );
    } catch (err) {
      if (err.code === 'ENOENT') {
        throw new CliError('USAGE', 'openssl not found', { hint: 'install openssl' });
      }
      throw err;
    }
  }
  return { key: readFileSync(keyPath), cert: readFileSync(certPath) };
}
