---
name: orchestrate
description: Run a task as orchestrator - size it, show a plan table (steps, agent, model, files) for approval, then delegate mechanical steps to Haiku agents, verify, report quota. Invoke as /orchestrate <task>.
disable-model-invocation: true
argument-hint: <task description>
---
Task: $ARGUMENTS

You are the orchestrator in the CURRENT session (do not switch model or effort). Procedure:
1. Quota before: call get_usage (ToolSearch select it if needed); note 5-hour %.
2. Discover (read-only, cheap): use `scout` or `log-digester` to learn what the task touches, so the plan has real file names.
3. Size: trivial (answer or 1-2 edits) -> say so and just do it. Otherwise write the PLAN as a table, max 8 rows, and show it to the user:
   | # | Step | Tag | Agent | Model | Files / commands | Verification |
   Tags: M = mechanical + verifiable -> Haiku agent (`scout` search, `log-digester` big text, `test-runner` checks, `worker` one precise edit); J = judgment -> main session (Sonnet, current effort); R = risky (AGENTS.md rules, undervolt, registry, deletes, git history) -> main session plus explicit verification. Group rows by agent so the user sees each agent's task group. Add one line: expected parallel steps and why any step is not delegated.
4. APPROVAL BUTTONS: after showing the table, call AskUserQuestion (never ask in plain text) with one question and options: `Approve and run` / `Edit the plan` / `Cancel`. Run nothing that is not read-only until `Approve and run` is chosen; on `Edit the plan` ask what to change (AskUserQuestion, free text via Other), redraw the table and ask again. Skip only if the arguments contain `--yes`.
5. Execute: brief agents per the `subagent-brief` skill; independent steps in parallel in one message. Do J/R steps yourself.
6. Verify: `diff-verifier` (Sonnet, read-only) on every delegated edit, `test-runner` on checks. If a result is wrong, redo that step yourself once; never loop.
7. Report in <= 12 lines: steps done vs plan (and any deviation), files changed, verification result, quota after (get_usage) with the 5-hour % delta and which agents ran. Nothing is committed or pushed unless the task said so.
