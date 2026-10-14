---
name: land-a-change
description: Commit and ship a change in KafkaBoost following AGENTS.md (branch, slice, conventional commit, checks). Use when committing, pushing or opening a PR in this repo.
---
1. One slice per change; refactor, feature and docs are separate commits. Branch `feat|fix|docs|refactor|test|chore/<topic>`; never commit from `local/` or `logs/`. **One PR per slice, each merged on its own** (AGENTS.md "How to land a change here"): branch every slice from fresh `origin/main` (`git fetch`; `git switch -c <branch> origin/main`; cherry-pick the slice's commit), open its PR with a conventional-commit title, wait for CI (`gh pr checks <n> --watch`, then confirm with `gh pr view <n> --json statusCheckRollup`), **squash-merge** it (`gh pr merge <n> --squash --delete-branch`), then start the next slice from the updated `origin/main`. Never put two slices in one PR; never merge the release-please PR as part of a slice. A squash merge is one commit, so `git revert` of it undoes exactly that slice.
2. Before opening: `Invoke-Pester tests` passes; every .ps1 parses; `node --check` passes; `cd app; node --test "test/*.test.js"`; if UI changed run `powershell -File tools\run-uitest.ps1` and regenerate screenshots (`tools\make-shots.ps1`); if docs/ changed run `node tools/check-site.js`.
3. If a tuning value changed: update config/, docs/CONFIGURATION.md, docs/RESULTS.md, AGENTS.md and the README table together and re-run the health step.
4. Commit `type(scope): subject`, body says why, English. Push the branch; merge into main only through that slice's PR (squash), and only when the user asked for the PR and merge. Use `gh` (logged in via `gh auth login`); never paste tokens in chat.
5. Test installer changes only with `-InstallDir <temp> -NoTask -NoStart`.
