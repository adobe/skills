# token-ledger fixture

`project/stardust/status.jsonl` — three migrate windows copied from the shared
post-migrate fixture (plan 15:20→15:24 · per-page render 15:24→15:39 "6/6 pages
rendered" · assets 15:39:25→15:39:50) plus the state-and-report pair.
`transcripts/sess-01.jsonl` — a synthetic Claude-Code-shaped main transcript:
three requests (A and B each written twice with cumulative usage → dedupe by
`requestId`, C once), one human prompt, one bare `continue` ack, one
`tool_result`, one `<system-reminder>`, one `cost-state` line, and a late
request D outside every window (→ `unwindowed`).
`transcripts/sess-01/subagents/agent-a1.jsonl` — one subagent request written
twice (→ 1 sub request). Nothing here is a real session.
