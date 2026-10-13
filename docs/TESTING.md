# Testing

## Unit tests (Pester)
```powershell
Invoke-Pester tests        # Pester 3.4 (ships with Windows) or Pester 5 (CI)
```
57 tests. `Tuning.Tests.ps1` covers the FIVR/V-F encoding table, the INI merge (replace, append, idempotent, no duplicates, only its
own process), the drift check, the turbo-cap parser, the verdict rules, the config template and the ThrottleStop download helpers
(form parsing, zip validation). `Tweaks.Tests.ps1` runs the tweak engine against a **sandbox registry map and state file**
(apply, revert to the recorded value, all-or-nothing rollback, risk gate, `minBuild`, catalog validation: unique ids, valid
categories and risks). `Cleanup.Tests.ps1` works in temporary folders (dry run deletes nothing, only the asked ids, file filter,
locked file skipped, junction not followed, only the Recycle Bin is dangerous). `Restore.Tests.ps1` uses a fake provider (date conversion, ordering, created vs skipped vs failed, first-tweak detection); no real restore point is made. Nothing touches your ThrottleStop, real registry
keys or real temp folders. Tests use plain `throw` assertions and a shared `tests/Setup.ps1`, so the same file runs on Pester 3.4 and 5.

## Node tests
```powershell
cd app; node --test "test/*.test.js"      # 25 tests: settings store, i18n key parity, autostart, update logic
```
`updates.test.js` covers release comparison, picking the right asset per OS, changelog parsing and the self-update gate, with no network.

## Syntax checks
```powershell
Get-ChildItem -Recurse -Filter *.ps1 | ForEach-Object { [void][Management.Automation.Language.Parser]::ParseFile($_.FullName,[ref]$null,[ref]$e) }
cd app; Get-ChildItem -Recurse src,renderer -Filter *.js | ForEach-Object { node --check $_.FullName }
```
The CI workflow (`.github/workflows/ci.yml`) runs the same on a Windows runner.

## UI checks
```powershell
powershell -File tools\run-uitest.ps1     # drives the real window in demo mode: 48 checks on Windows, 5 on a faked Linux
```
It covers navigation, settings, the changelog dialog, the tweak catalog (search, filters, toggles, the double confirmation for risky
tweaks), Cleanup and the restore points. `tools\run-traytest.ps1` covers the tray.

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

## Not covered yet
- The installer on a fresh Windows install; the changing wizard steps through the UI (they are covered through
  `Install-Tuning.ps1` and the library tests); FPS (never measured, only judged by feel).
- An elevated apply and revert of the safe tweaks on a real PC with a registry diff, and real (non-sandbox) cleanup deletion.
- A real self-update: it needs a published GitHub release with an installer and `latest.yml` (no release workflow yet).
- macOS and Linux: the code paths exist but were never run.
