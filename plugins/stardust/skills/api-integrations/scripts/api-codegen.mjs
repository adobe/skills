#!/usr/bin/env node
/**
 * api-codegen.mjs — Generate EDS browser API clients from API contracts.
 *
 * Reads contracts from stardust/api/contracts and writes project-owned browser
 * modules under scripts/api plus scripts/api-config.js when it does not exist.
 *
 *   node scripts/api-codegen.mjs [--contracts stardust/api/contracts] [--out .] [--id id[,id…]] [--force] [--dry-run]
 *
 * Exit 0 when generated or intentionally skipped, 1 when a selected contract
 * cannot be generated, 2 on usage errors.
 */
/* eslint-disable no-await-in-loop */
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';

import { isMain, printHelpIfAsked } from './lib/lib.mjs';
import { emitApiConfig, emitClientModule, generationProblems, hasGeneratedMarker } from './lib/codegen-emit.mjs';

function usage(message) {
  if (message) console.error(message);
  process.exit(2);
}

function valueArg(argv, index, name) {
  const current = argv[index];
  const prefix = `${name}=`;
  if (current.startsWith(prefix)) return { value: current.slice(prefix.length), next: index };
  if (index + 1 >= argv.length || argv[index + 1].startsWith('--')) usage(`${name} requires a value`);
  return { value: argv[index + 1], next: index + 1 };
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    contracts: 'stardust/api/contracts',
    out: process.cwd(),
    ids: null,
    force: false,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--force') options.force = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--contracts' || arg.startsWith('--contracts=')) {
      const parsed = valueArg(argv, i, '--contracts');
      options.contracts = parsed.value;
      i = parsed.next;
    } else if (arg === '--out' || arg.startsWith('--out=')) {
      const parsed = valueArg(argv, i, '--out');
      options.out = parsed.value;
      i = parsed.next;
    } else if (arg === '--id' || arg.startsWith('--id=')) {
      const parsed = valueArg(argv, i, '--id');
      options.ids = parsed.value.split(',').map((id) => id.trim()).filter(Boolean);
      i = parsed.next;
    } else {
      usage(`unknown option ${arg}`);
    }
  }
  return options;
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function validateId(id) {
  return /^[A-Za-z0-9._-]+$/.test(id) && !id.includes('..');
}

function safeScriptPath(outDir, ...parts) {
  const scriptsDir = resolve(outDir, 'scripts');
  const target = resolve(scriptsDir, ...parts);
  if (target !== scriptsDir && !target.startsWith(`${scriptsDir}${sep}`)) {
    usage(`refusing to write outside scripts/: ${target}`);
  }
  return target;
}

async function loadContracts(contractsDir) {
  if (!(await exists(contractsDir))) usage(`contracts directory not found: ${contractsDir}`);
  const files = (await readdir(contractsDir)).filter((file) => file.endsWith('.json')).sort();
  const contracts = [];
  for (const file of files) {
    const path = join(contractsDir, file);
    const contract = JSON.parse(await readFile(path, 'utf8'));
    if (!contract.id) contract.id = basename(file, '.json');
    contracts.push(contract);
  }
  return contracts;
}

function hasRequestShape(contract) {
  return Boolean(contract.requestExample !== null && contract.requestExample !== undefined)
    || Boolean(contract.requestSchema?.type)
    || Boolean(contract.graphql);
}

function skipReason(contract) {
  const status = String(contract.status || '').toLowerCase();
  if (['inspect', 'out-of-scope', 'ignored'].includes(status)) return `status ${contract.status}`;
  if (contract.confirmed === false && !hasRequestShape(contract)) return 'unconfirmed with no observation-backed request shape';
  return null;
}

async function writeModule(contract, outDir, { force, dryRun }) {
  if (!validateId(contract.id)) usage(`invalid contract id ${contract.id}`);
  const modulePath = safeScriptPath(outDir, 'api', `${contract.id}.js`);
  const rel = `scripts/api/${contract.id}.js`;
  const source = emitClientModule(contract);
  if (dryRun) {
    console.log(`${await exists(modulePath) ? 'update' : 'create'} ${rel}`);
    return;
  }
  await mkdir(safeScriptPath(outDir, 'api'), { recursive: true });
  if (await exists(modulePath)) {
    const current = await readFile(modulePath, 'utf8');
    if (!hasGeneratedMarker(current) && !force) {
      console.log(`skipped ${rel}: existing file has no generated marker; use --force to overwrite`);
      return;
    }
  }
  await writeFile(modulePath, source);
  console.log(`${await exists(modulePath) ? 'wrote' : 'created'} ${rel}`);
}

async function writeConfig(contracts, outDir, { dryRun }) {
  const configPath = safeScriptPath(outDir, 'api-config.js');
  const rel = 'scripts/api-config.js';
  if (await exists(configPath)) {
    console.log(`skipped ${rel}: already exists`);
    return;
  }
  if (dryRun) {
    console.log(`create ${rel}`);
    return;
  }
  await mkdir(resolve(outDir, 'scripts'), { recursive: true });
  await writeFile(configPath, emitApiConfig(contracts));
  console.log(`created ${rel}`);
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const contractsDir = resolve(options.contracts);
  const outDir = resolve(options.out);
  const contracts = await loadContracts(contractsDir);
  const byId = new Map(contracts.map((contract) => [contract.id, contract]));
  const selectedIds = options.ids || contracts.map((contract) => contract.id);
  const unknown = selectedIds.filter((id) => !byId.has(id));
  if (unknown.length) usage(`unknown --id: ${unknown.join(', ')}`);

  const selected = selectedIds.map((id) => byId.get(id));
  const toGenerate = [];
  selected.forEach((contract) => {
    const reason = skipReason(contract);
    if (reason) console.log(`skipped ${contract.id}: ${reason}`);
    else toGenerate.push(contract);
  });

  const failures = toGenerate.flatMap((contract) => generationProblems(contract).map((reason) => `${contract.id}: ${reason}`));
  if (failures.length) {
    failures.forEach((failure) => console.error(failure));
    return 1;
  }

  if (toGenerate.length) await writeConfig(toGenerate, outDir, options);
  for (const contract of toGenerate) {
    await writeModule(contract, outDir, options);
  }
  return 0;
}

if (isMain(import.meta.url)) {
  printHelpIfAsked(import.meta.url);
  main().then((code) => {
    process.exit(code);
  }).catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
