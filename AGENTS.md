# AGENTS.md — KafkaBoost (CPU thermal tuning with ThrottleStop for the Lenovo Legion 83DE)

Read this first, then `docs/TROUBLESHOOTING.md` before you change anything. This file is the current state and the rules; the
reasoning and history live in `docs/` and in git (the old plan files were folded into the docs).

The product is called **KafkaBoost**. The GitHub repository (`legion-14900hx-throttlestop`), the app id, the scheduled task names, the `%ProgramData%\LegionTuning` folder and the package name keep their historical names on purpose: renaming them would break existing installs and auto-update.

## What this repository is
A guided, reversible ThrottleStop tuning for a Lenovo Legion 83DE (i9-14900HX, RTX 4090 Laptop, Windows 11), the scripts that apply
and verify it, and an Electron app on top (called **KafkaBoost** in the UI; side menu: **Dashboard** health check, **System analysis**, **Optimizations** = 31-tweak catalog + CPU thermal tuning wizard, **Cleanup**, **Restore**, **Insights** (play session recorder + boost clock advice, Windows only), **Apps** (install/remove curated apps with winget / Homebrew / Flatpak, apt, dnf, pacman), **Settings**, **Help**; English + pt-BR, light/dark theme, update check with changelog). **Done and verified (2026-10-10):** peak 90 C,
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
11. **Sensors:** library only from the release pinned in `config/sensors.json` (other SHA-256 = delete and refuse), user agrees before download, never install a driver, missing sensors are *missing* (never 0), never claim DPC/ISR latency, claim only what we measured.
12. **HWiNFO on demand:** proprietary freeware: never commit or bundle; download only after consent with version/source/signer shown, zip must hold `HWiNFO64.exe` with a Valid REALiX signature; start/stop only our own path and never with arguments; never overwrite a user's INI (`-UpdateIni` only when ticked per start); state no session-time limit.
13. **Counter-Strike 2 preset:** no FPS or anti-cheat claim; only ids from `config/cs2.json`; GPU preference restored exactly (never revert one we did not write); the two game files written are `autoexec.cfg` and `cs2_video.txt` (resolution, refresh rate — backup first, restore only with our marker, and for `cs2_video.txt` only the specific keys the user chose, never a full rewrite); never edit Steam's `localconfig.vdf`.
14. **Updates and "Apply recommended":** read the full rule 14 in `docs/AGENT-DETAILS.md` before touching update or Apply-recommended code.
15. **RAMMap (Optimizations > Memory cleanup):** Microsoft Sysinternals freeware: never commit or bundle; download only after the consent box from the address in `config/rammap.json`, zip must hold `RAMMap64.exe` with a Valid signature from exactly `Microsoft Corporation`; started only from our own folder, with `-accepteula` plus one switch from the config allow-list (the page sends an action id, never a switch), never a second copy; a counter Windows does not report is *missing*, never 0; no FPS or "fixes the memory leak" claim, only the before/after counters we measured.
Full text of rules 11-15, the Layout table and the Roadmap/open items: `docs/AGENT-DETAILS.md` (read only the section you need).

## Layout (short)
Root launchers and `install.cmd`; `app/` Electron UI (thin: logic in `scripts/lib/`, behind `scripts/Steps.ps1`, with a unit test); `config/` data files; `scripts/lib/*.ps1` engines; `tests/` Pester; `tools/` checks; `docs/` site + notes; `local/` git-ignored. Full table: `docs/AGENT-DETAILS.md#layout`.

## Commands
```powershell
Invoke-Pester tests                                                   # unit tests (176)
cd app; node --test "test/*.test.js"                                  # node tests (152)
powershell -File tools\run-uitest.ps1                                 # UI checks in demo mode (188 + 13)
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


## Roadmap and open items (short)
Not built or never run: guided before/after test session, presets per CPU family, fresh-Windows release test, Linux/macOS runs, real winget installs, CS2 GPU/autoexec writes in game, elevated sensor and HWiNFO installs. FPS was never measured. Details: `docs/AGENT-DETAILS.md#roadmap-and-open-items`.

## Delegation (saves quota)
Size each request first. Trivial: do it. Otherwise split into steps: mechanical + verifiable (searches, log reading, test runs, renames) go to the Haiku agents (`scout`, `log-digester`, `test-runner`, `worker`, from the private repo `carloskafka/ai-toolkit`) with exact paths and a short reply; design, judgment and risky steps (rules 1-14, undervolt, registry, deletes) stay in the main session, and `diff-verifier` checks delegated edits. Keep one model and effort per session. Generic skills (`model-routing`, `token-hygiene`, `subagent-brief`, `/orchestrate`) live in `ai-toolkit`; install them with `toolsInstall-ClaudeSetup.ps1`. Repo-specific skills and `diff-verifier` are in `.claude/`.
