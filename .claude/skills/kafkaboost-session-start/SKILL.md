---
name: kafkaboost-session-start
description: Start a KafkaBoost (ThrottleStop/Legion) work session cheaply. Use when the user says to read AGENTS.md or all files first, or at the start of any task in this repo.
---
Do NOT read every file. Steps:
1. Read AGENTS.md (state + rules 1-13) once. Read docs/TROUBLESHOOTING.md only if the task touches tuning, throttling or WHEA.
2. Locate code with graph tools (search_graph, get_code_snippet), or delegate searches to the `scout` agent; read only the files the task names (offset/limit).
3. For tuning state run `powershell -File scripts\Steps.ps1 -Step health -InstallDir "<dir>"` (read-only) instead of reading INI/log files.
4. Reply with the 5-line state you will work from, then proceed. Never open local/ or logs/ unless asked.
