#!/usr/bin/env node
// Judge unjudged runs under a label: a fresh session grades the run against
// criteria.json and writes verdicts.json; we compute the weighted score and
// persist judgment.json. Usage:
//   node judge.mjs --label baseline [--eval direct-from-phrase] [--model m]
//   [--force]

import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFile, writeFile, readdir, access, rm } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { RUNNER_DIR, loadEval } from "./lib/workspace.mjs";
import { buildJudgePrompt } from "./lib/judge-prompt.mjs";
import { computeScore } from "./lib/score.mjs";

const { values: args } = parseArgs({
  options: {
    label: { type: "string" },
    eval: { type: "string" },
    model: { type: "string" },
    force: { type: "boolean", default: false },
  },
});

if (!args.label) {
  console.error("usage: node judge.mjs --label <label> [--eval <name>] [--force]");
  process.exit(1);
}

const labelRoot = join(RUNNER_DIR, "results", args.label);
const evalNames = args.eval ? [args.eval] : await readdir(labelRoot);

for (const evalName of evalNames) {
  const evalDef = await loadEval(evalName);
  const evalRoot = join(labelRoot, evalName);
  const runs = (await readdir(evalRoot)).filter((d) => d.startsWith("run-"));

  for (const run of runs.sort()) {
    const dir = join(evalRoot, run);
    if (!args.force) {
      try {
        await access(join(dir, "judgment.json"));
        console.log(`${evalName}/${run}: already judged, skipping`);
        continue;
      } catch {}
    }
    await rm(join(dir, "verdicts.json"), { force: true });
    console.log(`${evalName}/${run}: judging…`);

    const prompt = buildJudgePrompt({
      evalName,
      taskMd: evalDef.taskMd,
      criteria: evalDef.criteria,
      runPath: dir,
    });

    try {
      for await (const m of query({
        prompt,
        options: {
          cwd: dir,
          model: args.model,
          permissionMode: "bypassPermissions",
          settingSources: [],
          systemPrompt: { type: "preset", preset: "claude_code" },
          tools: ["Read", "Grep", "Glob", "Write"],
          maxTurns: 80,
        },
      })) {
        // drain; the judge's deliverable is verdicts.json
      }
    } catch (err) {
      console.error(`  judge session failed: ${err.message}`);
      continue;
    }

    let verdicts;
    try {
      verdicts = JSON.parse(await readFile(join(dir, "verdicts.json"), "utf8")).verdicts;
    } catch (err) {
      console.error(`  no usable verdicts.json (${err.message}); rerun with --force`);
      continue;
    }

    const judgment = computeScore(evalDef.criteria, verdicts);
    judgment.eval = evalName;
    judgment.label = args.label;
    judgment.judgeModel = args.model ?? "(sdk default)";
    await writeFile(join(dir, "judgment.json"), JSON.stringify(judgment, null, 2));
    const flags = [
      judgment.missing.length ? `missing: ${judgment.missing.join(",")}` : "",
      judgment.extraneous.length ? `extraneous: ${judgment.extraneous.join(",")}` : "",
    ]
      .filter(Boolean)
      .join("; ");
    console.log(`  score ${judgment.score}/${judgment.total}${flags ? ` (${flags})` : ""}`);
  }
}
