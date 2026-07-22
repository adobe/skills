import { query } from "@anthropic-ai/claude-agent-sdk";

// Answer AskUserQuestion calls in persona, using a cheap one-shot session.
// Falls back to each question's first option so a responder failure never
// wedges the eval run.

const RESPONDER_MODEL = "claude-haiku-4-5-20251001";

export async function answerQuestions(questions, personaMd) {
  const fallback = Object.fromEntries(
    questions.map((q) => [
      q.question,
      q.options?.[0]?.label ?? "skip",
    ])
  );
  if (!personaMd) return fallback;

  const prompt = `You are simulating the user described below, answering an
assistant's clarifying questions during a test scenario. Stay in persona.

<persona>
${personaMd}
</persona>

Questions (JSON):
${JSON.stringify(questions, null, 2)}

For each question pick the option label that best matches the persona (for
multiSelect questions, join labels with ", "). If the persona says to skip a
question and a skip/other option exists, pick it. Reply with ONLY a JSON
object mapping each question's exact "question" text to the chosen label
string. No prose, no code fences.`;

  try {
    let text = "";
    for await (const m of query({
      prompt,
      options: {
        model: RESPONDER_MODEL,
        tools: [],
        permissionMode: "bypassPermissions",
        maxTurns: 1,
      },
    })) {
      if (m.type === "result" && m.subtype === "success") text = m.result;
    }
    const parsed = JSON.parse(text.replace(/^```(json)?|```$/gm, "").trim());
    const answers = {};
    for (const q of questions) {
      answers[q.question] =
        typeof parsed[q.question] === "string"
          ? parsed[q.question]
          : fallback[q.question];
    }
    return answers;
  } catch {
    return fallback;
  }
}
