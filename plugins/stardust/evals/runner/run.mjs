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
  stagePlugin,
} from "./lib/workspace.mjs";
import { condense, extractUsage } from "./lib/transcript.mjs";
import { answerQuestions, decideFollowUp } from "./lib/answers.mjs";

const MAX_USER_TURNS = 4;

function userMessage(text) {
  return {
    type: "user",
    message: { role: "user", content: [{ type: "text", text }] },
    parent_tool_use_id: null,
    session_id: "",
  };
}

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

const staged = await stagePlugin(args["plugin-dir"]);

console.log(`eval: ${evalDef.name}`);
console.log(`prompt: ${evalDef.prompt}`);
if (evalDef.steps.length > 1) {
  console.log(
    `note: eval defines ${evalDef.steps.length} user-prompt steps; only step 1 is automated for now`
  );
}
console.log(`label: ${args.label}, runs: ${n}`);
console.log(`stardust plugin: ${args["plugin-dir"]}`);

// Continue numbering after existing runs so repeated invocations accumulate
// into the label instead of clobbering earlier results.
let offset = 0;
try {
  const { readdir } = await import("node:fs/promises");
  const existing = (await readdir(join(runDir(args.label, evalDef.name, 1), "..")))
    .map((d) => parseInt(d.match(/^run-(\d+)$/)?.[1] ?? "0", 10));
  offset = Math.max(0, ...existing);
} catch {}

for (let i = offset + 1; i <= offset + n; i++) {
  const dest = runDir(args.label, evalDef.name, i);
  await mkdir(dest, { recursive: true });
  const workspace = await materializeWorkspace(evalDef.name, dest);
  console.log(`\n--- run ${i - offset}/${n} → ${dest}`);

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  const messages = [];
  const qa = [];
  const userTurns = [];

  // Streaming input keeps the session open so the simulated user can answer
  // confirmation gates ("Reply 'go' to execute") and follow-up questions —
  // one-shot prompts end the session at the first interactive gate.
  let sendNext; // resolves with the next user message text, or null to end
  async function* inputStream() {
    yield userMessage(evalDef.prompt);
    while (true) {
      const next = await new Promise((resolve) => (sendNext = resolve));
      if (next === null) return;
      yield userMessage(next);
    }
  }

  try {
    const session = query({
      prompt: inputStream(),
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
          { type: "local", path: staged.path },
          { type: "local", path: args["impeccable-dir"] },
        ],
        canUseTool: async (toolName, input) => {
          if (toolName === "AskUserQuestion") {
            const res = await answerQuestions(
              input.questions ?? [],
              evalDef.answers
            );
            qa.push({ questions: input.questions, ...res });
            console.log(
              `    answered ${input.questions?.length ?? 0} question(s)` +
                (res.fallback ? " [FALLBACK — responder failed]" : "")
            );
            return {
              behavior: "allow",
              updatedInput: { questions: input.questions, answers: res.answers },
            };
          }
          return { behavior: "allow", updatedInput: input };
        },
      },
    });

    let assistantText = "";
    for await (const m of session) {
      messages.push(m);
      if (m.type === "assistant") {
        for (const b of m.message?.content ?? []) {
          if (b.type === "text" && b.text) assistantText += b.text + "\n";
        }
      }
      if (m.type === "result") {
        // Turn finished: let the simulated user respond or end the session.
        if (!evalDef.answers || userTurns.length >= MAX_USER_TURNS) {
          sendNext?.(null);
        } else {
          const d = await decideFollowUp(
            evalDef.answers,
            assistantText,
            userTurns.length
          );
          if (d.done) {
            sendNext?.(null);
          } else {
            userTurns.push({ reply: d.reply, fallback: d.fallback });
            console.log(
              `    user reply: ${JSON.stringify(d.reply.slice(0, 60))}` +
                (d.fallback ? " [FALLBACK]" : "")
            );
            assistantText = "";
            sendNext?.(d.reply);
          }
        }
      }
      if (m.type === "system" && m.subtype === "init") {
        // A plugin the SDK can't resolve is dropped silently; a run without
        // the skill under test is garbage, so fail loudly instead.
        const loaded = (m.plugins ?? []).map((p) => p.name);
        for (const want of [staged.name, "impeccable"]) {
          if (!loaded.includes(want)) {
            abort.abort();
            throw new Error(
              `plugin "${want}" did not load (loaded: ${loaded.join(", ") || "none"})`
            );
          }
        }
      }
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
  usage.userTurns = userTurns;
  await writeFile(join(dest, "usage.json"), JSON.stringify(usage, null, 2));
  console.log(
    `    done: ${usage.subtype}, turns=${usage.num_turns}, cost=$${
      usage.total_cost_usd?.toFixed(2) ?? "?"
    }`
  );
}

await staged.cleanup();
console.log(`\nAll runs complete. Next: node judge.mjs --label ${args.label}`);
