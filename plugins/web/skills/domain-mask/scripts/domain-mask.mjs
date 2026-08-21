#!/usr/bin/env node

import { createServer as createHttpsServer } from "node:https";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const [displayDomain, targetUrl] = process.argv.slice(2);

if (!displayDomain || !targetUrl) {
  console.error(
    "Usage: domain-mask.mjs <display-domain> <target-url>\n" +
      "Example: domain-mask.mjs wknd.adventures https://gabrielwalt.github.io",
  );
  process.exit(1);
}

if (!/^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(displayDomain)) {
  console.error(`Error: invalid domain name: ${displayDomain}`);
  process.exit(1);
}

if (process.getuid() !== 0) {
  console.error("Error: this script must be run with sudo.");
  process.exit(1);
}

const HOSTS_FILE = "/etc/hosts";
const PORT = 443;
const HOSTS_ENTRY = `127.0.0.1 ${displayDomain}`;

// --- Dependency check ---

try {
  execSync("which mkcert", { stdio: "ignore" });
} catch {
  console.error(
    "Error: mkcert is not installed.\n" +
      "Install it with: brew install mkcert && mkcert -install",
  );
  process.exit(1);
}

// --- Parse target ---

let target;
try {
  target = new URL(targetUrl);
} catch {
  console.error(`Error: invalid target URL: ${targetUrl}`);
  process.exit(1);
}
const doRequest = target.protocol === "https:" ? httpsRequest : httpRequest;

// --- Hosts entry ---

function addHostsEntry() {
  const hosts = readFileSync(HOSTS_FILE, "utf8");
  if (hosts.includes(HOSTS_ENTRY)) {
    console.log(`Hosts entry already exists: ${HOSTS_ENTRY}`);
    return;
  }
  writeFileSync(HOSTS_FILE, hosts.trimEnd() + "\n" + HOSTS_ENTRY + "\n");
  console.log(`Added to ${HOSTS_FILE}: ${HOSTS_ENTRY}`);
}

function removeHostsEntry() {
  try {
    const hosts = readFileSync(HOSTS_FILE, "utf8");
    const filtered = hosts
      .split("\n")
      .filter((line) => line.trim() !== HOSTS_ENTRY)
      .join("\n");
    writeFileSync(HOSTS_FILE, filtered);
    console.log(`Removed from ${HOSTS_FILE}: ${HOSTS_ENTRY}`);
  } catch (err) {
    console.error(`Warning: could not clean ${HOSTS_FILE}: ${err.message}`);
  }
}

// --- Certificate ---

const tmpDir = mkdtempSync(join(tmpdir(), "domain-mask-"));
const keyPath = join(tmpDir, "key.pem");
const certPath = join(tmpDir, "cert.pem");

execSync(`mkcert -key-file ${keyPath} -cert-file ${certPath} ${displayDomain}`);
console.log("Generated trusted certificate via mkcert");

// --- Proxy ---

function proxy(req, res) {
  const url = new URL(req.url, target.origin);
  const headers = { ...req.headers, host: target.host };
  delete headers["accept-encoding"];

  const proxyReq = doRequest(
    url,
    { method: req.method, headers },
    (proxyRes) => {
      const responseHeaders = { ...proxyRes.headers };
      if (responseHeaders.location) {
        responseHeaders.location = responseHeaders.location.replace(
          target.origin,
          `https://${displayDomain}`,
        );
      }
      delete responseHeaders["strict-transport-security"];
      res.writeHead(proxyRes.statusCode, responseHeaders);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on("error", (err) => {
    console.error(`Proxy error: ${err.message}`);
    res.writeHead(502);
    res.end("Bad Gateway");
  });

  req.pipe(proxyReq);
}

// --- Lifecycle ---

try {
  addHostsEntry();

  const server = createHttpsServer(
    { key: readFileSync(keyPath), cert: readFileSync(certPath) },
    proxy,
  );

  function cleanup() {
    console.log("\nShutting down...");
    server.close();
    removeHostsEntry();
    try {
      rmSync(tmpDir, { recursive: true });
    } catch {
      // temp dir cleanup is best-effort
    }
    console.log("Done.");
    process.exit(0);
  }

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  server.listen(PORT, () => {
    console.log(`\nhttps://${displayDomain} -> ${target.origin}`);
    console.log("Press Ctrl+C to stop and clean up.\n");
  });
} catch (err) {
  removeHostsEntry();
  console.error(`Startup failed: ${err.message}`);
  process.exit(1);
}
