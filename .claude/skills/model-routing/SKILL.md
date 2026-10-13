---
name: model-routing
description: Decide which Claude model, effort level and subagent to use for a task so quota lasts longer without losing quality. Use when planning work, delegating to subagents, or when the user asks about Haiku/Sonnet/Opus choice or effort.
---

# Model routing (compare cost per COMPLETED task, not per token)

| Work | Use |
|---|---|
| Main session, normal coding/editing | Sonnet 5.5, effort `medium` (set once at session start) |
| Hard design, root-cause debugging, risky changes (e.g. ThrottleStop/FIVR rules) | Opus at `high`, in its own fresh session |
| Mechanical, checkable work: read logs/CSV, grep sweeps, rename, format, run tests and summarize, boilerplate | Haiku subagent (`log-digester`, `scout`) |
| Planning | plan in the main session (Sonnet medium); delegate only the mechanical execution steps to Haiku |

Rules:
- Escalate on failure: run cheap first, re-run only the failures at a higher tier/effort (needs a reliable check: tests pass, verify step OK).
- Haiku only when the output can be verified. Never for safety-critical edits (undervolt values, registry, deletes).
- Subagents return a short summary (<= 15 lines) so the main context stays small; give them a precise question and file paths.
- Do not stack multi-model patterns (advisor/orchestrator) unless a baseline shows a gain: Anthropic's own tests found Haiku/Sonnet executors rarely consulted the advisor and the tool definition alone added 12-25% cost.
- Switch model/effort only at task boundaries (after /clear), never mid-session.

## Triage procedure (do this at the start of every non-trivial request)
1. Effort check: trivial / small / large. Trivial -> just do it. Do not delegate when briefing costs more than the step.
2. Break into steps; tag each M (mechanical + verifiable), J (judgment/design), R (risky: rules, undervolt, registry, deletes, git history).
3. M steps -> Haiku subagent (`scout` read-only search, `log-digester` big text, `worker` edits/commands). Independent M steps in parallel in one message. Brief with exact paths, the exact change/question, and "reply in <= 10-15 lines".
4. J and R steps stay in the main session; R steps also get an explicit verification (tests, health step) before reporting done.
5. Check each delegated result (diff/test); if wrong, redo that step yourself, do not re-delegate in a loop.
