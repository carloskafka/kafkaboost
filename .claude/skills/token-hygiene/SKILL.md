---
name: token-hygiene
description: Keep Claude quota usage low without losing quality. Use at session start, when a conversation gets long, when the topic changes, before stepping away, before reading big logs/files, or when the user mentions quota, tokens, usage limit or cost.
---

# Token hygiene (every turn re-reads the whole history; keep it small and stable)

1. **Never change model or effort mid-session** (busts the prompt cache). Pick at start: Sonnet + medium is the default; Opus/high only for hard design or debugging.
2. **Topic changed -> `/clear`** (after a 5-line handoff if needed). Same task, phase done -> `/compact keep: decisions, changed file paths, open TODOs, failing tests; drop: raw logs, dead ends`. Bad turn -> `/rewind`, not compact.
3. **Compact or clear BEFORE stepping away** (cache lives ~5 min to 1 h; a cold resume re-pays the whole history). Do not resume old sessions; start fresh with a handoff.
4. **Read less:** use graph tools (`get_code_snippet`, `search_graph`) or `Read` with `offset/limit`; never re-read a file already in context; ask for the format you will actually read (short answers).
5. **Noisy output stays out of the main thread:** quiet flags (`-q`, `--silent`, `| tail -n 30`, `git log --oneline -n 20`); logs, reports, CSVs and broad searches go to the `log-digester` / `scout` subagents (Haiku) that return <= 15 lines. Do not use subagents for small jobs.
6. **Fewer tools in context:** disable MCP servers/skills the project does not use; check `/context` once per new project.
7. **Do not paste what a file already holds**; reference the path. Do not restate long plans back to the user.
8. **One slice per session** for big work; when `/context` > ~60% or the session is > ~40 turns, suggest compact/clear in one sentence.

For which model/agent to use for a task, see the `model-routing` skill.
