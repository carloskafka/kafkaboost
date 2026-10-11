# AGENTS.md — Legion 83DE ThrottleStop tuning

Read this first, then `docs/lessons.md` before you change anything. This file is the current state; the history is in
`docs/history/`.

## Goal and state
Stop the i9-14900HX in a Lenovo Legion 83DE (RTX 4090 Laptop, Windows 11) from hitting 100 C in CS2 and other games, with
little FPS cost. **Done and verified (2026-10-10):** peak 90 C, no thermal throttling in a 19-minute CS2 session, game smooth,
0 WHEA errors (see `docs/results.md`).

Live tuning (profile 0, saved in `ThrottleStop.ini`, applied at every logon by the scheduled task `ThrottleStop_Autostart`):

| Setting | Value |
|---|---|
| Undervolt core / P-cache / E-cache | -100 / -100 / -90 mV, V/F point 1 (800 MHz) +100 mV |
| Turbo caps | P-cores 47x (4.7 GHz), E-cores 36x (3.6 GHz) |
| Power limits | PL1 65 W / PL2 85 W |
| Always running | logon trigger + 5-minute watchdog, highest privileges, never a second copy |

## Rules (do not break)
1. **Do not deepen the undervolt.** WHEA 19 "Internal parity error" was logged at -100 mV. If it returns, use -80/-80/-70 mV.
2. VBS/hypervisor stays **off** (required for FIVR). It breaks WSL2/Docker; `scripts/maintenance/restore_vbs.ps1` undoes it.
3. ThrottleStop is elevated: automation needs an elevated PowerShell. Edit `ThrottleStop.ini` only with it stopped.
4. Change one thing at a time and verify with `scripts/monitoring/hwinfo_logger.ps1`; keep the matched-run method in `docs/results.md`.
5. Never raise the PROCHOT offset to hide throttle flags. Never start HWiNFO with command-line arguments.
6. Installer code must stop only its **own** ThrottleStop copy.
7. Do not commit anything from `local/` (backups, screenshots, raw reports, `HWMonitor.txt` with disk serials).

## Repo map
| Path | What |
|---|---|
| `install.cmd` | one-click installer (self-elevates) -> `scripts/Install-Tuning.ps1` |
| `app/` | Electron step-by-step wizard (Windows + i9-14900HX); `app/Launch-Wizard.cmd` |
| `config/` | `ThrottleStop.settings.ini` (the tuning), `HWiNFO64.INI`, `defaults.json` (install dir, task name) |
| `scripts/lib/Tuning.ps1` | shared logic (merge INI, register task, verify, rollback) used by the installer and the app |
| `scripts/Steps.ps1` | runs one wizard step, prints `LOG:` / `RESULT:` lines for the app |
| `scripts/monitoring/` | `hwinfo_logger.ps1`, `perf_logger.ps1` (output goes to `logs/`, git-ignored) |
| `scripts/maintenance/` | `restore_vbs.ps1` |
| `tests/` | Pester tests for the library |
| `docs/` | `ini-reference.md`, `lessons.md`, `results.md`, `machine.md`, `history/` (original plans, historical) |
| `local/` | git-ignored: backups, evidence, experiments (not in the repo) |

## Useful commands
```powershell
# Verify the live setup (read only; works without admin)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\Steps.ps1 -Step verify -InstallDir "<ThrottleStop dir>"
# Log 20 minutes of HWiNFO sensors to logs\hwinfo_log.csv (HWiNFO must run with SensorsSM=1)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\monitoring\hwinfo_logger.ps1 -Minutes 20
# Run the library tests
Invoke-Pester tests
```

## Still open
- Not tested on a fresh Windows install (the installer was tested from a zip into a throwaway folder only).
- The Windows installer package (`npm run dist`) and Linux/macOS support are not built.
- FPS was never measured, only judged by feel.
