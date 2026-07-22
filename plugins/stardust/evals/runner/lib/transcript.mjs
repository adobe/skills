// Condense the raw SDK message stream into a session.md the judge (and a
// human) can read without loading the full JSONL. Raw transcript stays on
// disk for drill-down.

const TRUNCATE_INPUT = 600;
const TRUNCATE_RESULT = 400;

function clip(s, n) {
  if (typeof s !== "string") s = JSON.stringify(s);
  return s.length > n ? s.slice(0, n) + ` …[+${s.length - n} chars]` : s;
}

export function condense(messages) {
  const lines = ["# Session log", ""];
  for (const m of messages) {
    if (m.type === "system" && m.subtype === "init") {
      lines.push(`_Session init: model ${m.model}, cwd ${m.cwd}_`, "");
    } else if (m.type === "assistant") {
      for (const block of m.message?.content ?? []) {
        if (block.type === "text" && block.text?.trim()) {
          lines.push("## assistant", "", block.text.trim(), "");
        } else if (block.type === "tool_use") {
          lines.push(
            `> **tool: ${block.name}** ${clip(block.input, TRUNCATE_INPUT)}`,
            ""
          );
        }
      }
    } else if (m.type === "user") {
      const content = m.message?.content;
      if (typeof content === "string") {
        lines.push("## user", "", content, "");
        continue;
      }
      for (const block of content ?? []) {
        if (block.type === "tool_result") {
          const body = Array.isArray(block.content)
            ? block.content
                .filter((c) => c.type === "text")
                .map((c) => c.text)
                .join("\n")
            : block.content;
          lines.push(`> result: ${clip(body ?? "", TRUNCATE_RESULT)}`, "");
        } else if (block.type === "text") {
          lines.push("## user", "", block.text, "");
        }
      }
    } else if (m.type === "result") {
      lines.push(
        "## session result",
        "",
        `subtype: ${m.subtype}, turns: ${m.num_turns}, duration: ${Math.round(
          (m.duration_ms ?? 0) / 1000
        )}s`,
        ""
      );
    }
  }
  return lines.join("\n");
}

export function extractUsage(messages) {
  const result = messages.find((m) => m.type === "result");
  return {
    subtype: result?.subtype ?? "missing",
    num_turns: result?.num_turns ?? null,
    duration_ms: result?.duration_ms ?? null,
    total_cost_usd: result?.total_cost_usd ?? null,
    usage: result?.usage ?? null,
    modelUsage: result?.modelUsage ?? null,
  };
}
