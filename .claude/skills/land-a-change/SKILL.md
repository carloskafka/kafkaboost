---
name: land-a-change
description: Commit and ship a change in KafkaBoost following AGENTS.md (branch, slice, conventional commit, checks). Use when committing, pushing or opening a PR in this repo.
---
1. One slice per change; refactor, feature and docs are separate commits. Branch `feat|fix|docs|refactor|test|chore/<topic>`; never commit from `local/` or `logs/`.
2. Before opening: `Invoke-Pester tests` passes; every .ps1 parses; `node --check` passes; `cd app; node --test "test/*.test.js"`; if UI changed run `powershell -File tools\run-uitest.ps1` and regenerate screenshots (`tools\make-shots.ps1`); if docs/ changed run `node tools/check-site.js`.
3. If a tuning value changed: update config/, docs/CONFIGURATION.md, docs/RESULTS.md, AGENTS.md and the README table together and re-run the health step.
4. Commit `type(scope): subject`, body says why, English. Push the branch; push to main only if the user says so for this change. Use `gh` (logged in via `gh auth login`); never paste tokens in chat.
5. Test installer changes only with `-InstallDir <temp> -NoTask -NoStart`.
