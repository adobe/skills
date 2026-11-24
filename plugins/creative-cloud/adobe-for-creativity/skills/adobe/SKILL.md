---
name: adobe
description: "Handles only /adobe and Adobe capability-discovery questions by presenting a two-option entry screen. Matches: /adobe; what can I do with Adobe?; what Adobe skills are available?; give me an overview of Adobe capabilities. Does not match: set up the Adobe plugin; finish setting up Adobe in Claude; help me get started with Adobe setup; make a flyer; resize a video. These are action requests rather than capability questions."
license: Apache-2.0
allowed-tools: Skill AskUserQuestion ToolSearch adobe_home
metadata:
  version: 1.2.0
  visibility: public
  surface: [claude]
---

## Purpose

`/adobe` is the short, memorable way into the Adobe plugin. It asks one question, then either hands off to the `configure` skill (guided setup) or opens the Adobe home hub (what Adobe can do). It renders no onboarding content of its own.

## Workflow

### Step 1 — Ask what the user wants

Use the built-in question UI (`AskUserQuestion`) to ask one question with exactly two options:

- **Configure the plugin** — connect Adobe and set tool permissions.
- **Show what Adobe can do** — open the Adobe home hub.

Wait for an explicit selection returned by the question UI or a subsequent user reply before Step 2. Asking the question is not an answer. Do not infer a choice from a capability question such as "What can I do with Adobe?" If no answer is available, end this turn after asking.

Before an answer, show only the question and its two options. Do not preview either path's workflow or tool calls.

If the question UI is unavailable, ask the same question in plain text and wait for the answer.

### Step 2 — Act on the answer

- **Configure the plugin** — invoke the `configure` skill with the Skill tool, with no arguments. This handoff ends the router's work: its entire response to the selection is the skill invocation, or the unavailable-skill fallback below. Do not write introductory or follow-up prose, or describe connection, permission, or authentication steps. The `configure` skill takes over; follow its instructions only once it is loaded.
- **Show what Adobe can do** — call `adobe_home` (no arguments; it renders its own view, so write no HTML). If it is not in your tool list, load it with `ToolSearch` (`select:<tool name>`). If it is still missing or fails, say that Adobe isn't set up yet and tell the user to run `/configure`. Don't retry.

After either path, write nothing more: the `configure` skill or the hub already shows the result.

## Tool Reference

| Step | Tool | Notes |
|------|------|-------|
| Ask | `AskUserQuestion` | Two options; plain-text fallback if unavailable |
| Configure | `Skill` → `configure` | No arguments |
| Show | `adobe_home` | No arguments |

## Ground rules

- Ask the question before doing anything else. Don't call any Adobe tool until the user has answered.
- A direct request to set up Adobe belongs to `configure`, not this choice flow. Capability questions and `/adobe` belong here; do not activate `configure` for them unless the user selects setup.
- Never call `adobe_mandatory_init` from this skill.
- If the user's next message is a real request (not a question about onboarding), hand off to the matching `adobe-for-creativity` skill/tool rather than re-running the flow.
- If the `configure` skill can't be invoked in this environment, tell the user to run `/configure` and stop.
