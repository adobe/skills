#!/usr/bin/env node
// Compare two labeled result sets: per-criterion pass rates, mean scores,
// token usage. Usage: node compare.mjs <label-a> <label-b>

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { RUNNER_DIR } from "./lib/workspace.mjs";

const [labelA, labelB] = process.argv.slice(2);
if (!labelA || !labelB) {
  console.error("usage: node compare.mjs <label-a> <label-b>");
  process.exit(1);
}

async function loadLabel(label) {
  const root = join(RUNNER_DIR, "results", label);
  const evals = {};
  let evalNames;
  try {
    evalNames = await readdir(root);
  } catch {
    throw new Error(`no results for label "${label}" at ${root}`);
  }
  for (const evalName of evalNames) {
    const runs = [];
    const runNames = (await readdir(join(root, evalName))).filter((d) =>
      d.startsWith("run-")
    );
    for (const runName of runNames.sort()) {
      const dir = join(root, evalName, runName);
      const run = { name: runName };
      try {
        run.judgment = JSON.parse(await readFile(join(dir, "judgment.json"), "utf8"));
      } catch {}
      try {
        run.usage = JSON.parse(await readFile(join(dir, "usage.json"), "utf8"));
      } catch {}
      runs.push(run);
    }
    if (runs.length) evals[evalName] = runs;
  }
  return evals;
}

function passRates(runs) {
  const rates = new Map(); // id -> {pass, judged}
  for (const run of runs) {
    for (const c of run.judgment?.perCriterion ?? []) {
      const r = rates.get(c.id) ?? { pass: 0, judged: 0, weight: c.weight };
      if (c.pass !== null) {
        r.judged++;
        if (c.pass) r.pass++;
      }
      rates.set(c.id, r);
    }
  }
  return rates;
}

function mean(xs) {
  const v = xs.filter((x) => typeof x === "number");
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function fmtRate(r) {
  return r ? `${r.pass}/${r.judged}` : "—";
}

// Buckets reported separately: abrasion's headline metric is fresh input
// (skill text billed as input or cache-creation); cache reads dominate raw
// totals and would mask the effect.
function tokensOf(run) {
  const u = run.usage?.usage;
  if (!u) return null;
  return {
    input: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
    cacheRead: u.cache_read_input_tokens ?? 0,
    output: u.output_tokens ?? 0,
  };
}

const [a, b] = await Promise.all([loadLabel(labelA), loadLabel(labelB)]);
const evalNames = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();

for (const evalName of evalNames) {
  const runsA = a[evalName] ?? [];
  const runsB = b[evalName] ?? [];
  console.log(`\n## ${evalName}\n`);
  console.log(
    `runs: ${labelA}=${runsA.length}, ${labelB}=${runsB.length}`
  );

  const scoreA = mean(runsA.map((r) => r.judgment?.score));
  const scoreB = mean(runsB.map((r) => r.judgment?.score));
  if (scoreA !== null || scoreB !== null) {
    console.log(
      `mean score: ${labelA}=${scoreA?.toFixed(1) ?? "—"}  ${labelB}=${
        scoreB?.toFixed(1) ?? "—"
      }  Δ=${scoreA !== null && scoreB !== null ? (scoreB - scoreA).toFixed(1) : "—"}`
    );
  }

  for (const bucket of ["input", "cacheRead", "output"]) {
    const tokA = mean(runsA.map((r) => tokensOf(r)?.[bucket]));
    const tokB = mean(runsB.map((r) => tokensOf(r)?.[bucket]));
    if (tokA !== null && tokB !== null && tokA > 0) {
      console.log(
        `mean ${bucket} tokens: ${labelA}=${Math.round(tokA)}  ${labelB}=${Math.round(
          tokB
        )}  Δ=${(((tokB - tokA) / tokA) * 100).toFixed(1)}%`
      );
    }
  }

  const ratesA = passRates(runsA);
  const ratesB = passRates(runsB);
  const ids = [...new Set([...ratesA.keys(), ...ratesB.keys()])];
  console.log(`\n| criterion | w | ${labelA} | ${labelB} | flag |`);
  console.log("|---|---|---|---|---|");
  for (const id of ids) {
    const rA = ratesA.get(id);
    const rB = ratesB.get(id);
    let flag = "";
    if (rA && rB && rA.judged && rB.judged) {
      const pA = rA.pass / rA.judged;
      const pB = rB.pass / rB.judged;
      if (pB < pA) flag = "⚠ regressed";
      else if (pB > pA) flag = "improved";
    }
    console.log(
      `| ${id} | ${rA?.weight ?? rB?.weight ?? "?"} | ${fmtRate(rA)} | ${fmtRate(
        rB
      )} | ${flag} |`
    );
  }
}
