---
name: orchestrate
description: Run a task as orchestrator - size it, plan in small steps, delegate mechanical steps to Haiku agents, verify, report with quota used. Invoke as /orchestrate <task>.
disable-model-invocation: true
argument-hint: <task description>
---
Task: $ARGUMENTS

You are the orchestrator in the CURRENT session (do not switch model or effort). Procedure:
1. Quota before: call get_usage (ToolSearch select it if needed); note 5-hour %.
2. Size: trivial -> just do it and skip to step 6. Otherwise write the plan as a numbered list, each step tagged M (mechanical + verifiable), J (judgment) or R (risky: AGENTS.md rules, undervolt, registry, deletes, git history). Max 8 steps. Show it in <= 10 lines.
3. Delegate every M step to the cheapest fitting agent: `scout` (searches), `log-digester` (big text), `test-runner` (tests/checks), `worker` (one precise edit). Brief per the `subagent-brief` skill; independent steps in parallel in one message.
4. Do J steps yourself; do R steps yourself and verify explicitly (tests, health step).
5. Verify: run `diff-verifier` on any delegated edit and `test-runner` on the checks. If a result is wrong, redo that step yourself once; never loop.
6. Report in <= 12 lines: what was done, files changed, verification result, which steps went to Haiku, and quota after (get_usage again) with the 5-hour % delta. Nothing is committed or pushed unless the task said so.
