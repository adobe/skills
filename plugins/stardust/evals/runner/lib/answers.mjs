import { query } from "@anthropic-ai/claude-agent-sdk";

// Persona-driven user simulation: answer AskUserQuestion calls and decide
// turn-by-turn follow-ups, using a cheap one-shot session. Failures fall back
// to safe defaults but are flagged so they never silently skew a run.

const RESPONDER_MODEL = "haiku";

async function oneShot(prompt) {
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
  return JSON.parse(text.replace(/^```(json)?|```$/gm, "").trim());
}

export async function answerQuestions(questions, personaMd) {
  const fallback = Object.fromEntries(
    questions.map((q) => [q.question, q.options?.[0]?.label ?? "skip"])
  );
  if (!personaMd) return { answers: fallback, fallback: true };

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
    const parsed = await oneShot(prompt);
    const answers = {};
    for (const q of questions) {
      answers[q.question] =
        typeof parsed[q.question] === "string"
          ? parsed[q.question]
          : fallback[q.question];
    }
    return { answers, fallback: false };
  } catch (err) {
    return { answers: fallback, fallback: true, error: String(err) };
  }
}

// After each completed assistant turn, decide the simulated user's next move:
// confirm a gate, answer in persona, or end the session.
export async function decideFollowUp(personaMd, assistantText, userTurns) {
  const gate = assistantText.match(/repl(?:y|ies)\s+(?:with\s+)?[*"'`]*go[*"'`]*/i);
  const prompt = `You are simulating the user described below in a test
scenario. The assistant just finished a turn with the message quoted below.
Decide the user's next move.

<persona>
${personaMd}
</persona>

<assistant-message>
${assistantText.slice(-4000)}
</assistant-message>

Rules:
- If the assistant presented a plan or summary and awaits explicit
  confirmation to proceed (e.g. 'Reply "go" to execute'), confirm with
  exactly the requested token.
- If the assistant asked a question the persona can answer, answer briefly
  in persona (one sentence).
- If the assistant reports the work as complete, hands off, or merely
  recommends a future command, the conversation is over.
- The user has already sent ${userTurns} follow-up(s); prefer ending over
  chatting.

Reply with ONLY one JSON object, no prose, no code fences:
{"done": true}  or  {"done": false, "reply": "<the user's message>"}`;

  try {
    const parsed = await oneShot(prompt);
    if (parsed.done === false && typeof parsed.reply === "string" && parsed.reply.trim()) {
      return { done: false, reply: parsed.reply.trim(), fallback: false };
    }
    return { done: true, fallback: false };
  } catch (err) {
    // Degraded mode: honor an obvious confirmation gate, otherwise end.
    if (gate && userTurns === 0) {
      return { done: false, reply: "go", fallback: true, error: String(err) };
    }
    return { done: true, fallback: true, error: String(err) };
  }
}
