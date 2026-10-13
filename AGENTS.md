# AGENTS.md — Legion Tuning (ThrottleStop tuning for the Lenovo Legion 83DE)

Read this first, then `docs/TROUBLESHOOTING.md` before you change anything. This file is the current state and the rules; the
reasoning and history live in `docs/` and in git (the old plan files were folded into the docs).

## What this repository is
A guided, reversible ThrottleStop tuning for a Lenovo Legion 83DE (i9-14900HX, RTX 4090 Laptop, Windows 11), the scripts that apply
and verify it, and an Electron app on top (called **KafkaBoost** in the UI; side menu: **Dashboard** health check, **System analysis**, **Optimizations** = 30-tweak catalog + CPU thermal tuning wizard, **Cleanup**, **Restore**, **Apps** (install/remove curated apps with winget / Homebrew / Flatpak, apt, dnf, pacman), **Settings**, **Help**; English + pt-BR, light/dark theme, update check with changelog). **Done and verified (2026-10-10):** peak 90 C,
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
5. Never raise the PROCHOT offset to hide throttle flags. Never start HWiNFO with command-line arguments (the app starts it with none).
6. Installer and library code must stop only its **own** ThrottleStop copy (filter by `Path`), never every `ThrottleStop.exe`.
7. Do not commit anything from `local/` (backups, screenshots, raw reports, `HWMonitor.txt` with disk serials) or `logs/`.
8. Closing the window hides it to the tray; only the tray menu "Quit" exits. The app is a thin UI: logic belongs in `scripts/lib/`, behind `scripts/Steps.ps1`, with a unit test.
9. Tweaks: the previous value is recorded before every change and restored on revert; all-or-nothing; risky tweaks need `-AllowRisky` plus two confirmations and are never "recommended". Cleanup deletes only the fixed allow-list, never follows reparse points, and the Recycle Bin asks twice. Never claim an FPS gain.
10. UI text lives in `app/renderer/i18n/{en,pt-BR}.json` (keys must match; a test checks). PowerShell results carry `code` + `args`, not translated text. Render remote text (release notes) with `textContent` only.
11. **Sensors:** the library comes only from the release pinned in `config/sensors.json` (a different SHA-256 means delete and refuse); nothing from it is committed; the user must agree in the app before the download; we never install a driver (CPU temperature/clock/power need the third-party PawnIO driver; without it they are *missing*, never shown as 0); never claim DPC/ISR latency (that is LatencyMon's job); the 80/90 C colors are generic, not chip-specific; any new sensor claim must be something we measured.
12. **HWiNFO on demand (Dashboard card):** proprietary freeware (non-commercial use only): never commit or bundle it. It is downloaded from the official page (https://www.hwinfo.com/download/, the "Portable for Windows 95 and later" zip, address read at run time, no pinned hash) only after the consent box, after the user was shown version, source and signer; the zip must contain `HWiNFO64.exe` and the extracted exe must have a Valid Authenticode signature from REALiX, otherwise delete and refuse. Fetch with `curl.exe` and an honest user agent (Invoke-WebRequest gets a bot-challenge page); never try to solve a challenge: a non-zip reply is `msg.hwinfo.blocked` and the user picks a zip they downloaded. Install only to `%ProgramData%LegionTuninghwinfo<version>` (admin-only ACL). `configHWiNFO64.INI` goes next to the exe before the first start; a user's own INI is never overwritten (turning `SensorsSM=1` on needs `-UpdateIni`, with a timestamped `.bak`). Start only if no HWiNFO64 from that path runs, stop only by `Path`, never with arguments. We could not confirm any session-time limit of the free edition on the official pages, so the app and docs do not state one.

## Layout
| Path | What |
|---|---|
| `install.cmd` | one-click installer (self-elevates) -> `scripts/Install-Tuning.ps1` |
| `KafkaBoost.cmd/.command/.lnk` | root launchers (the `.lnk` is generated per machine and git-ignored) |
| `app/` | Electron app. `src/main.js` (IPC, spawns `Steps.ps1`, update check), `src/preload.js`, `src/settings.js` (validated store), `src/i18n.js`, `src/updates.js` (GitHub Releases logic), `src/autostart.js`, `src/tray.js`, `src/demo.js` + `src/demo-apps.js` (demo mode, incl. canned labelled sensors), `src/packages/` (Apps manager: one provider per package manager behind one interface, injectable command runner, curated catalog, bloatware allow-list), `renderer/` (`js/` one file per screen on `window.KB`; `sensorlogic.js` is the pure Sensors logic shared with `main.js` and the tests; `hwinfo.js` + `hwinfologic.js` are the Dashboard HWiNFO card and its pure model; `dashboard.js` + `dashlogic.js` are the Dashboard (live tiles polled every 2 s via the `telemetry` step, hardware cards from `detect`, optimization level, Apply recommended) and its pure logic; `i18n/`, the CPU-thermal-tuning wizard, `icon.svg`), `build/` (generated icons), `test/` (node tests), `Launch-Wizard.cmd` |
| `config/` | `ThrottleStop.settings.ini` (the tuning), `HWiNFO64.INI` (shared memory on), `hwinfo.json` (official HWiNFO page + file prefix + expected signer; no hash), `defaults.json` (install dir + task name, read by PowerShell **and** Node), `tweaks.json` (tweak catalog, 30 entries), `apps.json` (Apps catalog: 21 apps with per-OS ids + the Windows bloatware allow-list), `sensors.json` (the pinned LibreHardwareMonitor release: version, official url, SHA-256) |
| `scripts/lib/Tuning.ps1` | merge INI, register task, unpack ThrottleStop, VBS, verify, rollback, FIVR/V-F encoders, `Get-Defaults` |
| `scripts/lib/Health.ps1` | health check (`Get-HealthReport`, `Compare-IniSettings`, `Get-Verdict`), Windows-build baseline, live telemetry, `Invoke-Fix` |
| `scripts/lib/Tweaks.ps1`, `Cleanup.ps1`, `Restore.ps1` | tweak engine (declarative actions, state in `%ProgramData%\LegionTuning\state.json`, sandboxable in tests) disk cleanup (allow-list, dry run first) and System Restore points (list/create via an injectable provider; safety point before the first tweak, never blocks it) |
| `scripts/lib/Sensors.ps1` | live sensors: pinned download + SHA-256 check + DLL-only unpack (`Install-SensorSupport`), reader (`Read-SensorsLive`, injectable `$script:SensorProvider` / `$script:SensorDownloader` in tests), grouping and result codes (`Get-SensorSnapshot`) |
| `scripts/lib/Hwinfo.ps1` | HWiNFO on demand: page discovery (`ConvertFrom-HwinfoPage`, `Get-HwinfoRelease`), zip + signature checks, `Install-Hwinfo`, INI placement/backup (`Initialize-HwinfoIni`), state (`Get-HwinfoState`), `Start-HwinfoApp` / `Stop-HwinfoApp` (own path only); seams `$script:HwinfoFetcher`, `HwinfoSignature`, `HwinfoProcesses`, `HwinfoSharedMemory`, `HwinfoStarter`, `HwinfoStopper`, `HwinfoRoot` |
| `scripts/Steps.ps1` | runs ONE step (detect, backup, get [-Download], vbs, apply, task, verify, health, fix, autostart, rollback, paths, cleanbackups, tweaks-list, tweak-set, tweaks-recommended, cleanup-scan, cleanup-run, restore-list, restore-create, restore-open, sensors-state, sensors-get, sensors-read, hwinfo-state, hwinfo-check, hwinfo-get [-Download -HwinfoVersion | -ZipPath], hwinfo-start [-UpdateIni], hwinfo-stop, telemetry), prints `LOG:` / `RESULT:` lines |
| `scripts/Create-Shortcut.ps1` | desktop + Start Menu shortcut with the icon and the run-as-administrator flag |
| `scripts/monitoring/`, `scripts/maintenance/` | loggers (output to `logs/`), `restore_vbs.ps1` |
| `tests/` | Pester tests (101; `Setup.ps1` shared, plain `throw` assertions: runs on Pester 3.4 and 5) |
| `tools/` | `check-site.js` (+ test: links, anchors, EN/PT parity, facts), `make-icons.js` (all icon sizes from `app/renderer/icon.svg`), `make-shots.ps1` (docs screenshots from demo mode; not yet regenerated for the new screens), `run-uitest.ps1` + `uitest.js` (UI checks in demo mode), `run-traytest.ps1` |
| `docs/` | GitHub Pages site: `index.html` landing, `about-app.html` docs hub (hash routes), `compare/download/faq/privacy/terms.html`, `pt-br/` mirror, `site.css`, `site.js`, `assets/`, favicons; checked by `node tools/check-site.js`. Plus `getting-started`, `ARCHITECTURE`, `CONFIGURATION`, `TESTING`, `TROUBLESHOOTING`, `RESULTS` |
| `.github/workflows/` | `ci.yml` (Pester + syntax on Windows, Node tests on Windows/Linux/macOS, site check), `pages.yml` (publishes `docs/`), `release.yml` (tag `v*` -> installer + `latest.yml` GitHub Release) |
| `local/` | git-ignored: backups, evidence, experiments |

## Commands
```powershell
Invoke-Pester tests                                                   # unit tests (101)
cd app; node --test "test/*.test.js"                                  # node tests (59)
powershell -File tools\run-uitest.ps1                                 # UI checks in demo mode (80 + 10)
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
- **Built since the first version:** Settings + theme + pt-BR, tweak engine and catalog UI, Cleanup, Restore points, the Apps manager, update check with changelog, ThrottleStop on-click download, root launchers.
  **Apps manager rules:** commands are always an args array through `src/packages/runner.js` (never a shell string) and every id/query is checked against a strict per-manager regex first (`src/packages/ids.js`); only catalog ids or ids from the manager's own search can be installed; bloatware removal takes only ids from the `bloatware` allow-list of `config/apps.json` (current user only, never `-AllUsers`); import installs only ids that pass the regex and only after the user confirms the shown list; IPC `apps:*` in `main.js`/`preload.js`, UI in `renderer/js/apps.js`. **Not verified:** winget install/uninstall was never run for real, and the macOS (brew) and Linux (flatpak/apt/dnf/pacman, pkexec) code was never run; only command construction and parsing are unit-tested with a fake runner. Native Linux ids (apt/dnf/pacman) are given only where the package is in the distro's main repos; a missing id means "not offered", never a guess.
  **Planned, not built** (approved plan in `~/.claude/plans/`): CS2 preset, the full rename to KafkaBoost (repo, package ids and task names stay), a landing site on GitHub Pages (today's docs hub moves to `about-app.html`), The `docs/` screenshots predate the new screens.
- **Menu names are provisional.** The sections follow the flow the TogsBoost site describes for a typical optimizer (system analysis,
  preparation, optimizations, restore). The reference video could not be analyzed (YouTube blocks automated access), so adjust the
  labels in `app/renderer/index.html` once the exact tab names are known. The old disabled placeholder cards were replaced by the tweak catalog.- **Presets with a recommendation score** (not built): named tunings per CPU family; each with requirements (CPU generation, hybrid
  or not, VBS, laptop vs desktop), risk and source, scored against the detected system. Only the current profile is validated;
  anything from forums must be labelled unverified. The current ini is the "Default preset" for the 83DE only.
- **Live sensors** (built): the Sensors screen reads CPU/GPU/board/disk/memory sensors with LibreHardwareMonitor 0.9.6 (MPL-2.0, downloaded on demand, see rule 11 and `docs/CONFIGURATION.md`). Verified on the real PC: the download + hash check and a **non-elevated** read (78 sensors: CPU load, GPU, memory). **Not verified:** an elevated read (disk/board/fan sensors), any CPU temperature (PawnIO is not installed there), anti-cheat behaviour with that driver, and a long session (the library is reopened by a new PowerShell for every read, about 1 s each).
- **HWiNFO on demand** (built, Dashboard card): see rule 12 and `docs/CONFIGURATION.md`. Verified on the real PC: reading the official page, the portable zip download into a scratch folder (via `curl.exe`) and the Authenticode check (Valid, REALiX, version 8.54). **Not verified:** the elevated install under `%ProgramData%`, starting and stopping HWiNFO from the app, the first-start dialog of HWiNFO with the template INI, and a protection page from the site (Invoke-WebRequest was served one; `curl.exe` was not).
- **Guided test session** (not built): the app starts a sensor logger while the user plays and reports before/after. The sensor source would now be the Sensors library above (HWiNFO stays optional and proprietary; the Dashboard card can now fetch and start it, see rule 12); no logging, comparison or report exists yet.
- Not tested on a fresh Windows install; `npm run dist` builds locally (unsigned) but `release.yml` and the Linux/macOS CI legs have never run on GitHub; the macOS/Linux code (launchers, autostart) was never run.
- FPS was never measured, only judged by feel.
- **Landing site** (built, not yet published): `docs/index.html` + pages in EN and `pt-br/`; every number on it comes from `config/tweaks.json`, `docs/TESTING.md` or `docs/RESULTS.md` (checker enforces the first two). No FPS claims, testimonials or user counts. The repo has no LICENSE file yet, so the site says "public source", not "open source".
