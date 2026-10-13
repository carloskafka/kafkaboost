---
name: play-session-check
description: Check thermals and stability after a gaming session (e.g. CS2) on the Legion 14900HX. Use when the user asks if they played enough, how the stats are, or to verify temps/throttling/WHEA.
---
1. Run read-only: `powershell -File scripts\Steps.ps1 -Step health -InstallDir "<dir>"` and `-Step telemetry`. Report verdict, peak temp, throttle flags, power limits.
2. Big logs (HWiNFO/HWMonitor CSV in logs/) go to the `log-digester` agent: ask for peak CPU/GPU temp, throttling flags, PL1/PL2 hits, session length, <= 15 lines.
3. WHEA: check the event log for WHEA 19 (rule 1: if present use -80/-80/-70 mV, never deepen). Compare against docs/RESULTS.md (peak 90 C, 0 WHEA).
4. Matched-run method from docs/TROUBLESHOOTING.md for any before/after claim. Never claim FPS gains; never raise PROCHOT offset.
