---
name: subagent-brief
description: Template for briefing a subagent so repo rules are not pasted repeatedly. Use before spawning any subagent (scout, log-digester, worker, general-purpose).
---
Brief = 5 lines max: (1) repo path and one-line context, "read AGENTS.md rules only if the step touches them"; (2) the exact step or question; (3) exact files/paths allowed to touch (or "read-only, do not modify files"); (4) how to verify (command/expected result); (5) reply format "<= 10-15 lines: result, file:line, anything unexpected". Prefer the Haiku agents (scout/log-digester/worker). Never include secrets. Independent steps go in parallel in one message.
