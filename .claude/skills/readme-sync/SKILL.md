---
name: readme-sync
description: Update the README/portfolio text after code changes. Use when the user asks to update the README with recent changes.
---
1. `git log --oneline -n 20` and `git diff --stat <last-readme-commit>..HEAD` to see what changed (no whole-file reads).
2. Edit only affected README sections; keep numbers consistent with config/docs (README table, AGENTS.md). Do not claim unmeasured results.
3. Separate `docs:` commit; follow the repo's commit flow.
