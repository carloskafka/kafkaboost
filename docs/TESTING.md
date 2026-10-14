# Testing

## Unit tests (Pester)
```powershell
Invoke-Pester tests        # Pester 3.4 (ships with Windows) or Pester 5 (CI)
```
178 tests. `Session.Tests.ps1` and `Advice.Tests.ps1` cover the Insights play session recorder and the boost clock advice (fake readers and sandbox files; no hardware is read). `Cs2.Tests.ps1` (27) runs the Counter-Strike 2 preset on **sandbox folders** (a fake Steam with two libraries, a fake game tree under `%TEMP%`) and a **sandbox registry key** (`$script:RegMap`) with a temp state file: `libraryfolders.vdf` in the new and the old format, `SteamPath` with forward slashes, first library wins, the `appmanifest_730.acf` folder name and its rejection when it holds path characters; path validation (empty, relative, `..`, UNC, wildcard characters, wrong file name, missing file); the GPU preference (no previous value then removed on revert, other fields of the data kept and restored exactly, `GpuPreference=1` replaced and brought back, a second apply keeps the original previous value, a preference somebody else set is neither changed nor reverted, other apps untouched, tweak records in the shared state file kept, revert still works after an uninstall); the autoexec text (marker first, only chosen lines, unknown ids and bad numbers rejected), writing with and without an original (no BOM, only `autoexec.cfg` added, other cfg files untouched), the timestamped backup and a byte-for-byte restore, writing twice then restoring still gives the original, removal only while the marker is there, a user-edited file never overwritten, `..` and wrong names writing nothing, and a junction in place of the cfg folder refused. `Hwinfo.Tests.ps1` (20) uses a fake page fetcher, a fake signature check, fake processes and sandbox folders: page parsing (stable link only, layout change, foreign host, version/file mismatch), zip validation (HTML protection page, missing exe, `../`), the signature rule (Valid + REALiX only), INI copy / keep / patch with a timestamped backup and untouched accents, install and refusal paths (bad signature, changed version, blocked reply, own zip), state (own copy vs a copy the user already has), start (not installed, bad signature, already running, other copy, INI consent, no arguments) and stop (own path only). `Tuning.Tests.ps1` covers the FIVR/V-F encoding table, the INI merge (replace, append, idempotent, no duplicates, only its
own process), the drift check, the turbo-cap parser, the verdict rules, the config template and the ThrottleStop download helpers
(form parsing, zip validation). `Tweaks.Tests.ps1` runs the tweak engine against a **sandbox registry map and state file**
(apply, revert to the recorded value, all-or-nothing rollback, risk gate, `minBuild`, catalog validation: unique ids, valid
categories and risks). `Cleanup.Tests.ps1` works in temporary folders (dry run deletes nothing, only the asked ids, file filter,
locked file skipped, junction not followed, only the Recycle Bin is dangerous). `Restore.Tests.ps1` uses a fake provider (date conversion, ordering, created vs skipped vs failed, first-tweak detection); no real restore point is made. `Sensors.Tests.ps1` uses a fake sensor provider and a fake downloader (parsing and grouping, rounding, dropped CPU power without the driver, the `needsAdmin` / `noCpuTemp` / `empty` / `loadFailed` / `missing` paths, the pinned release in `config/sensors.json`, a sandbox zip with the right hash unpacked as DLLs only, a zip with a **wrong hash** deleted and nothing installed, an address outside the official release prefix, a zip with `../` or without the library); nothing is downloaded and no hardware is read. Nothing touches your ThrottleStop, real registry
keys or real temp folders. Tests use plain `throw` assertions and a shared `tests/Setup.ps1`, so the same file runs on Pester 3.4 and 5.

## Node tests
```powershell
cd app; node --test "test/*.test.js"      # 162 tests: settings store, i18n key parity, autostart, update logic, Apps manager, Sensors logic, HWiNFO card, Dashboard logic, Counter-Strike 2 page, Insights (session, sessionlogic, loadwatch, advicelogic)
```
`session.test.js`, `sessionlogic.test.js`, `loadwatch.test.js` and `advicelogic.test.js` cover the Insights play session recorder, its logic, the automatic recording trigger and the boost clock advice rules (`app/src/session.js`, `app/src/loadwatch.js`, `renderer/js/session.js`, `renderer/js/sessionlogic.js`, `renderer/js/advice.js`, `renderer/js/advicelogic.js`).
`sensors.test.js` covers `renderer/js/sensorlogic.js`: the generic temperature thresholds, value formatting, snapshot sanitizing (unknown fields, groups and units dropped, sizes bounded), grouping order and that every group, sensor type and message is translated.
`dashboard.test.js` (10) covers `renderer/js/dashlogic.js` (the optimization level on real and edge cases, which message the tiles show: administrator, HWiNFO missing, stopped (with or without the INI consent), running without shared memory, or failure), the demo telemetry step and the translated keys. `tests/Dashboard.Tests.ps1` (Pester) covers the telemetry snapshot with a fake reader and the disk and RAM summaries with fake CIM rows, including that no serial number leaks.
`hwinfo.test.js` (8) covers `renderer/js/hwinfologic.js` (which message and buttons per state, consent and administrator gates, `autoStartDecision`: start only when installed, elevated, not running and the INI already shares memory), the demo walk-through (missing, installed, running, stopped), the `EXTERNAL_OK` allow-list for the download page and the IPC guards in `main.js`.
`cs2.test.js` (14) covers `renderer/js/cs2logic.js` (the launch string holds only catalog text in catalog order and ignores unknown ids; only the harmless option is ticked by default; the number option accepts a whole number inside the catalog bounds only; which status and buttons for each GPU and autoexec state, including that a file that is not ours is never restored over), the catalog (small, unique ids, known tiers, every id explained in both languages, no FPS or anti-cheat promise in any `cs2.*` text, the "we did not test VAC" sentence present), the demo walk-through (apply and revert, write with a backup, restore, bad options refused, not found, a picked exe), that every `msg.cs2.*` code is translated, that `Steps.ps1` declares the steps as no-admin and `main.js` validates every argument, the `cs2Exe` setting rule, that every id the page script uses exists in `index.html` and nothing uses `innerHTML` or inline styles, that the clipboard call is guarded and has the textarea fallback, and that no CS2 code mentions `localconfig` or writes any file except the fixed autoexec names.
`updates.test.js` covers release comparison, picking the right asset per OS, changelog parsing and the self-update gate, with no network.
`updatedl.test.js` covers the download-and-install path for copies that cannot self-update with a **fake fetch, a real temp folder and a fake spawn** (no network, no real installer): the release-asset URL and redirect-host checks, asset choice (Setup exe of that version, never the Portable exe), `SHA256SUMS.txt` parsing and verification (ok / mismatch / missing), the size cap, cancel, the private-folder guard and the cleanup filter (our file names only, never links or folders), and how the installer is started (`shell: false`, detached, only a file from that folder). `updatelogic.test.js` covers the update panel model (which buttons and messages per state and per kind of build). `tweakpreview.test.js` covers the Apply recommended confirmation text (registry lines, non-registry actions, every catalog tweak translated in both languages).
`packages.test.js` (27 tests) covers the Apps manager with a **fake command runner**: the exact command line built for winget, brew (cask/formula), flatpak, apt, dnf and pacman (privileged ones through `pkexec`, plain when root), parsing of each manager's list/search output (including a localized winget table), provider choice by platform and availability, id and query validation (shell metacharacters, leading dashes and non-ASCII are rejected and never reach the runner), catalog validity (unique ids, every shown id valid, text in both languages), export/import (cross-OS mapping by catalog id, invalid entries dropped, forged item lists re-validated), the bloatware allow-list, and that the real runner passes arguments without a shell. Nothing is installed or removed. **The macOS and Linux managers were never run on real systems.**

## Syntax checks
```powershell
Get-ChildItem -Recurse -Filter *.ps1 | ForEach-Object { [void][Management.Automation.Language.Parser]::ParseFile($_.FullName,[ref]$null,[ref]$e) }
cd app; Get-ChildItem -Recurse src,renderer -Filter *.js | ForEach-Object { node --check $_.FullName }
```
The CI workflow (`.github/workflows/ci.yml`) runs the PowerShell parse and Pester tests on a Windows runner (the scripts use Windows-only APIs), the Node tests and the JavaScript syntax check on Windows, Linux and macOS (the Linux and macOS legs have never run), and the site check once on Linux.

## UI checks
```powershell
powershell -File tools\run-uitest.ps1     # drives the real window in demo mode: 198 checks on Windows, 14 on a faked Linux
```
It covers navigation, settings, the changelog dialog, the tweak catalog (search, filters, toggles, the double confirmation for risky
tweaks), Cleanup, the restore points, the Dashboard (live tiles that refresh by themselves and stop when the screen is left, the administrator notice versus the HWiNFO notice, the hardware cards without serials, the optimization level and the confirmed Apply recommended), the Dashboard HWiNFO card (check, consent box gating the download, install, start, stop) and the Sensors screen (consent before any download, the license and fingerprint text, the five groups, demo label, values refreshing by themselves, Pause/Resume, polling stopping when the screen is left, copy and save) the Counter-Strike 2 page (the card in Optimizations, the honesty text, location, GPU apply and revert, the autoexec flow with the confirmation, the backup note and the restore, the launch string, the copy button with the real clipboard, the not-found state and picking a file) and the Apps view (install, confirmed removal, search, import and export on a fake package manager, the Store-app removal list; on the faked Linux it checks the Flatpak catalog and that the bloatware card is hidden). `tools\run-traytest.ps1` covers the tray.

## Read-only checks on the real machine
```powershell
powershell -File scripts\Steps.ps1 -Step health -InstallDir "<ThrottleStop dir>"   # verdict + live telemetry
powershell -File scripts\Steps.ps1 -Step verify -InstallDir "<ThrottleStop dir>"
```

## The UI without touching the PC (demo mode)
```powershell
cd app; $env:WIZARD_DEMO='1'; npx electron .             # canned results; add WIZARD_DEMO_SCENARIO=updated for the red state
powershell -File tools\make-shots.ps1                    # regenerates docs\assets\*.png
```
`WIZARD_SCREENSHOT=<file.png>` saves the window after load and quits (a safe way to look at the UI from automation);
`WIZARD_FAKE_PLATFORM=linux` shows the unsupported-OS screen. `WIZARD_TRAYTEST=<file.json>` closes the window, then records that the process and the tray survive it and that the window can be reopened from the tray.

## Testing a tuning change on the laptop
Follow the protocol in `TROUBLESHOOTING.md` (matched runs, one variable at a time, stop conditions). In short: log
`scripts\monitoring\hwinfo_logger.ps1` for 15-20 minutes of the same CS2 route before and after, compare peak temperature,
package power, throttle flags and the WHEA counter, and keep the change only if there is no new error and frame times hold.

## Counter-Strike 2 on the real machine
```powershell
powershell -File scripts\Steps.ps1 -Step cs2-state        # read-only: where is cs2.exe, what is the GPU preference, is there an autoexec.cfg
```
On 2026-10-12 this found the game in the second Steam library (`D:\SteamLibrary\steamapps\common\Counter-Strike Global Offensive\game\bin\win64\cs2.exe`, two library folders checked); the Graphics-settings entry for it existed with `AppStatus=0;AutoHDREnable=2097;` and no `GpuPreference` field (so applying would keep those two fields); there was no `autoexec.cfg`. **`cs2-gpu` and `cs2-autoexec` were not run against the real registry or game folder** (only against sandboxes), and nothing was checked in game.

## Sensors on the real machine
```powershell
powershell -File scriptsSteps.ps1 -Step sensors-state      # installed or not, pinned version
powershell -File scriptsSteps.ps1 -Step sensors-read       # needs the library; non-elevated it returns msg.sensors.needsAdmin plus what is readable
```
`sensors-get` needs an elevated shell (it writes to `%ProgramData%LegionTuningsensors`). On 2026-10-12 the real download and SHA-256 check were run once into a scratch folder (hash matched the pinned value, 23 DLLs unpacked) and a **non-elevated** read returned 78 sensors (CPU load, GPU, memory) with `msg.sensors.needsAdmin`. **An elevated read was not run**, so disk, board and fan sensors were not seen on real hardware, and no CPU temperature was ever read because the PawnIO driver is not installed on that PC (we do not install drivers).

## HWiNFO on demand on the real machine
```powershell
powershell -File scripts\Steps.ps1 -Step hwinfo-state      # installed? own copy or one you already have, running? shared memory readable?
powershell -File scripts\Steps.ps1 -Step hwinfo-check      # reads only the official page: version and zip address
```
`hwinfo-get`, `hwinfo-start` and `hwinfo-stop` need an elevated shell (`hwinfo-get` writes to `%ProgramData%\LegionTuning\hwinfo`). On 2026-10-12 the discovery ran against the live page (version 8.54, `hwi_854.zip`) and **one real install was run into a scratch folder in `%TEMP%` from a non-elevated session** (zip downloaded with `curl.exe`, only `HWiNFO64.exe` extracted, Authenticode status Valid, signer REALiX, S.R.O., INI template copied, the refusal of a version that was not the one shown worked, the staging folder was deleted); the scratch folder was deleted afterwards. `Invoke-WebRequest` was answered with a bot-challenge page for the zip; `curl.exe` was not. `hwinfo-state` on this PC reports an HWiNFO 8.30 from Downloads as "found" (its INI already has shared memory on).

## Not covered yet
- Counter-Strike 2: the real GPU preference write and revert (a registry diff on this PC), the real `autoexec.cfg` write, backup and restore, whether CS2 runs `autoexec.cfg` by itself, whether `cl_showfps` and `fps_max` behave as described in the current build, whether the Windows Graphics settings page shows the entry afterwards, and any effect on stutter or FPS (never measured). Anti-cheat behaviour was not tested.
- HWiNFO from the app in an elevated session: the install under `%ProgramData%` with the admin-only ACL, *Start* (including HWiNFO's own first-start dialog with the template INI), *Stop*, and the live tiles filling in afterwards; the "I downloaded the zip myself" path from the UI; what the site does if it starts challenging `curl.exe` too.
- An elevated Sensors read, and a read with the PawnIO driver installed (CPU temperature, clocks and power); anti-cheat behaviour with that driver was never tested.
- The installer on a fresh Windows install; the changing wizard steps through the UI (they are covered through
  `Install-Tuning.ps1` and the library tests); FPS (never measured, only judged by feel).
- An elevated apply and revert of the safe tweaks on a real PC with a registry diff, and real (non-sandbox) cleanup deletion.
- A real self-update: it needs a published GitHub release with an installer and `latest.yml` (no release workflow yet).
- macOS and Linux: the code paths exist but were never run (this includes the Apps providers for brew, flatpak, apt, dnf and pacman).
- Apps on Windows: `winget list`, `winget search` and the Store-app listing were checked read-only on a real PC; a real `winget install` / `uninstall` and a real Store-app removal were not run.
