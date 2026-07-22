#!/usr/bin/env node
// Run an eval N times under a label.
// Usage: node run.mjs --eval direct-from-phrase --label baseline [--n 3]
//        [--model <model>] [--plugin-dir <path>] [--impeccable-dir <path>]
//        [--timeout-min 30]

import { query } from "@anthropic-ai/claude-agent-sdk";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { parseArgs } from "node:util";
import {
  PLUGIN_DIR,
  loadEval,
  runDir,
  materializeWorkspace,
} from "./lib/workspace.mjs";
import { condense, extractUsage } from "./lib/transcript.mjs";
import { answerQuestions } from "./lib/answers.mjs";

const { values: args } = parseArgs({
  options: {
    eval: { type: "string" },
    label: { type: "string" },
    n: { type: "string", default: "1" },
    model: { type: "string" },
    "plugin-dir": { type: "string", default: PLUGIN_DIR },
    "impeccable-dir": {
      type: "string",
      default: join(homedir(), ".claude/plugins/marketplaces/impeccable"),
    },
    "timeout-min": { type: "string", default: "30" },
  },
});

if (!args.eval || !args.label) {
  console.error("usage: node run.mjs --eval <name> --label <label> [--n N]");
  process.exit(1);
}

const evalDef = await loadEval(args.eval);
const n = parseInt(args.n, 10);
const timeoutMs = parseFloat(args["timeout-min"]) * 60_000;

console.log(`eval: ${evalDef.name}`);
console.log(`prompt: ${evalDef.prompt}`);
if (evalDef.steps.length > 1) {
  console.log(
    `note: eval defines ${evalDef.steps.length} user-prompt steps; only step 1 is automated for now`
  );
}
console.log(`label: ${args.label}, runs: ${n}`);
console.log(`stardust plugin: ${args["plugin-dir"]}`);

for (let i = 1; i <= n; i++) {
  const dest = runDir(args.label, evalDef.name, i);
  await mkdir(dest, { recursive: true });
  const workspace = await materializeWorkspace(evalDef.name, dest);
  console.log(`\n--- run ${i}/${n} → ${dest}`);

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  const messages = [];
  const qa = [];

  try {
    const session = query({
      prompt: evalDef.prompt,
      options: {
        cwd: workspace,
        model: args.model,
        abortController: abort,
        maxTurns: 300,
        // NOT bypassPermissions: that mode auto-approves before canUseTool is
        // consulted (CLAUDE_SDK_CAN_USE_TOOL_SHADOWED), which would skip the
        // persona auto-answers for AskUserQuestion. Instead we run "default"
        // and allow everything through the callback.
        permissionMode: "default",
        // Hermetic: no user/project CLAUDE.md or settings; both plugins are
        // loaded explicitly so runs don't depend on the local install.
        settingSources: [],
        // Headless sessions read as unattended, which makes skills take
        // hands-off branches and skip clarifying questions. When the eval
        // ships a persona (answers.md), present the session as interactive
        // so the interactive contract is exercised.
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          ...(evalDef.answers && {
            append:
              "This is an interactive session: a real user is present, " +
              "watching, and will promptly answer any AskUserQuestion you " +
              "raise. Do not treat this session as unattended or hands-off.",
          }),
        },
        plugins: [
          { type: "local", path: args["plugin-dir"] },
          { type: "local", path: args["impeccable-dir"] },
        ],
        canUseTool: async (toolName, input) => {
          if (toolName === "AskUserQuestion") {
            const answers = await answerQuestions(
              input.questions ?? [],
              evalDef.answers
            );
            qa.push({ questions: input.questions, answers });
            console.log(`    answered ${input.questions?.length ?? 0} question(s)`);
            return {
              behavior: "allow",
              updatedInput: { questions: input.questions, answers },
            };
          }
          return { behavior: "allow", updatedInput: input };
        },
      },
    });

    for await (const m of session) {
      messages.push(m);
      if (m.type === "assistant") {
        for (const b of m.message?.content ?? []) {
          if (b.type === "tool_use") console.log(`    tool: ${b.name}`);
        }
      }
    }
  } catch (err) {
    console.error(`    run failed: ${err.message}`);
    messages.push({ type: "runner_error", error: String(err) });
  } finally {
    clearTimeout(timer);
  }

  await writeFile(
    join(dest, "transcript.jsonl"),
    messages.map((m) => JSON.stringify(m)).join("\n")
  );
  await writeFile(join(dest, "session.md"), condense(messages));
  const usage = extractUsage(messages);
  usage.eval = evalDef.name;
  usage.label = args.label;
  usage.qa = qa;
  await writeFile(join(dest, "usage.json"), JSON.stringify(usage, null, 2));
  console.log(
    `    done: ${usage.subtype}, turns=${usage.num_turns}, cost=$${
      usage.total_cost_usd?.toFixed(2) ?? "?"
    }`
  );
}

console.log(`\nAll runs complete. Next: node judge.mjs --label ${args.label}`);
