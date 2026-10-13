---
name: pr-review-merge
description: Analyze a pull request and handle merge conflicts with gh. Use when asked to review, analyze, fix conflicts or merge a PR.
---
1. `gh pr view <n> --json title,body,files,mergeable,statusCheckRollup` and `gh pr diff <n>`; delegate a large diff to `log-digester` for a <= 15-line summary.
2. Conflicts: update the branch from base (in an app-made worktree use sync_with_base_branch), resolve minimally, run the project's tests, then commit.
3. Merge only after the user says so for this PR. Auth is `gh auth login`; if the user pastes a token, tell them to revoke it and do not use it.
