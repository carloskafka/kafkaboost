# AGENTS.md — Legion Tuning (ThrottleStop tuning for the Lenovo Legion 83DE)

Read this first, then `docs/TROUBLESHOOTING.md` before you change anything. This file is the current state and the rules; the
reasoning and history live in `docs/` and in git (the old plan files were folded into the docs).

## What this repository is
A guided, reversible ThrottleStop tuning for a Lenovo Legion 83DE (i9-14900HX, RTX 4090 Laptop, Windows 11), the scripts that apply
and verify it, and an Electron app (**My PC** health check + **Setup wizard**) on top. **Done and verified (2026-10-10):** peak 90 C,
no thermal throttling in a 19-minute CS2 session, game smooth, 0 WHEA errors (`docs/RESULTS.md`).

Live tuning (profile 0, saved in `ThrottleStop.ini`, applied at every logon by the scheduled task `ThrottleStop_Autostart`):

| Setting | Value |
|---|---|
| Undervolt core / P-cache / E-cache | -100 / -100 / -90 mV, V/F point 1 (800 MHz) +100 mV |
| Turbo caps | P-cores 47x (4.7 GHz), E-cores 36x (3.6 GHz) |
| Power limits | PL1 65 W / PL2 85 W |
| Always running | logon trigger + 5-minute watchdog, highest privileges, never a second copy |

The same values are in `config/ThrottleStop.settings.ini` (17 keys, verified identical to the live INI on 2026-10-10). They are
specific to this chip: **do not present them as valid for another CPU** (presets per CPU family are a roadmap item, see below).

## Rules (do not break)
1. **Do not deepen the undervolt.** WHEA 19 "Internal parity error" was logged at -100 mV. If it returns, use -80/-80/-70 mV.
2. VBS/hypervisor stays **off** (required for FIVR). It breaks WSL2/Docker; `scripts/maintenance/restore_vbs.ps1` undoes it.
   Code must never turn VBS off without explicit consent (`-DisableVBS`, the wizard checkbox, or "Allow Fix it to turn VBS off").
3. ThrottleStop is elevated: automation needs an elevated PowerShell. Edit `ThrottleStop.ini` only with it stopped.
4. Change one thing at a time and verify with `scripts/monitoring/hwinfo_logger.ps1`; keep the matched-run method in `docs/TROUBLESHOOTING.md`.
5. Never raise the PROCHOT offset to hide throttle flags. Never start HWiNFO with command-line arguments.
6. Installer and library code must stop only its **own** ThrottleStop copy (filter by `Path`), never every `ThrottleStop.exe`.
7. Do not commit anything from `local/` (backups, screenshots, raw reports, `HWMonitor.txt` with disk serials) or `logs/`.
8. The app is a thin UI: logic belongs in `scripts/lib/`, behind `scripts/Steps.ps1`, with a unit test.

## Layout
| Path | What |
|---|---|
| `install.cmd` | one-click installer (self-elevates) -> `scripts/Install-Tuning.ps1` |
| `app/` | Electron app. `src/main.js` (IPC, spawns `Steps.ps1`), `src/preload.js`, `src/demo.js` (demo mode), `renderer/` (My PC + wizard UI, `icon.svg`), `build/` (generated icons), `Launch-Wizard.cmd` |
| `config/` | `ThrottleStop.settings.ini` (the tuning), `HWiNFO64.INI` (shared memory on), `defaults.json` (install dir + task name, read by PowerShell **and** Node) |
| `scripts/lib/Tuning.ps1` | merge INI, register task, unpack ThrottleStop, VBS, verify, rollback, FIVR/V-F encoders, `Get-Defaults` |
| `scripts/lib/Health.ps1` | health check (`Get-HealthReport`, `Compare-IniSettings`, `Get-Verdict`), Windows-build baseline, live telemetry, `Invoke-Fix` |
| `scripts/Steps.ps1` | runs ONE step (detect, backup, get, vbs, apply, task, verify, health, fix, rollback), prints `LOG:` / `RESULT:` lines |
| `scripts/Create-Shortcut.ps1` | desktop + Start Menu shortcut with the icon and the run-as-administrator flag |
| `scripts/monitoring/`, `scripts/maintenance/` | loggers (output to `logs/`), `restore_vbs.ps1` |
| `tests/` | Pester tests (`Setup.ps1` shared, plain `throw` assertions: runs on Pester 3.4 and 5) |
| `tools/` | `make-icons.js` (all icon sizes from `app/renderer/icon.svg`), `make-shots.ps1` (docs screenshots from demo mode) |
| `docs/` | GitHub Pages site (`index.html`, `assets/`, favicons) + `getting-started`, `ARCHITECTURE`, `CONFIGURATION`, `TESTING`, `TROUBLESHOOTING`, `RESULTS` |
| `.github/workflows/` | `ci.yml` (tests + syntax on Windows), `pages.yml` (publishes `docs/`) |
| `local/` | git-ignored: backups, evidence, experiments |

## Commands
```powershell
Invoke-Pester tests                                                   # unit tests
powershell -File scripts\Steps.ps1 -Step health -InstallDir "<dir>"   # read-only verdict + live telemetry (no admin needed)
powershell -File scripts\Create-Shortcut.ps1                          # shortcut with the app icon
cd app; npm install; npm start                                        # the app (needs admin for changes)
cd app; $env:WIZARD_DEMO='1'; npx electron .                          # demo mode: canned data, touches nothing
powershell -File tools\make-shots.ps1                                 # regenerate docs\assets\*.png
cd app; npx electron ..\tools\make-icons.js                           # regenerate icons
```

## How to land a change here
- **One slice per change.** A refactor, a feature and its docs are separate commits (a docs-only commit when the code did not change).
- **Branch names:** `feat/<topic>`, `fix/<topic>`, `docs/<topic>`, `refactor/<topic>`, `test/<topic>`, `chore/<topic>`.
- **Conventional commits:** `type(scope): subject` (`feat(app): …`, `fix(scripts): …`, `docs: …`, `test: …`, `chore: …`); body says *why*.
- **Before you open it:** `Invoke-Pester tests` passes; every `.ps1` parses and `node --check` passes (CI does both); if you
  touched the UI, regenerate the screenshots; if you changed a tuning value, update `config/`, `docs/CONFIGURATION.md`,
  `docs/RESULTS.md`, this file and the README table **together**, and re-run the health step on the machine.
- Test installer changes in a throwaway directory (`-InstallDir <temp> -NoTask -NoStart`), never against the live ThrottleStop.

## Roadmap and open items
- **Presets with a recommendation score** (not built): named tunings per CPU family; each with requirements (CPU generation, hybrid
  or not, VBS, laptop vs desktop), risk and source, scored against the detected system. Only the current profile is validated;
  anything from forums must be labelled unverified. The current ini is the "Default preset" for the 83DE only.
- **Guided test session** (not built): the app starts a sensor logger while the user plays and reports before/after. HWiNFO is
  proprietary (user downloads it); LibreHardwareMonitor (MPL-2.0) could be bundled.
- Not tested on a fresh Windows install; `npm run dist` (Windows installer) configured but not built; Linux/macOS unsupported.
- FPS was never measured, only judged by feel.
