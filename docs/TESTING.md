# Testing

## Unit tests (Pester)
```powershell
Invoke-Pester tests        # Pester 3.4 (ships with Windows) or Pester 5 (CI)
```
They cover the FIVR/V-F encoding table, the INI merge (replace, append, idempotent, no duplicates, only its own process), the
drift check, the turbo-cap parser, the verdict rules and the config template. They run in a temporary sandbox and never touch your
ThrottleStop. Tests use plain `throw` assertions and a shared `tests/Setup.ps1`, so the same file runs on both Pester versions.

## Syntax checks
```powershell
Get-ChildItem -Recurse -Filter *.ps1 | ForEach-Object { [void][Management.Automation.Language.Parser]::ParseFile($_.FullName,[ref]$null,[ref]$e) }
cd app; node --check src/main.js; node --check src/demo.js; node --check renderer/app.js
```
The CI workflow (`.github/workflows/ci.yml`) runs the same on a Windows runner.

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
`WIZARD_FAKE_PLATFORM=linux` shows the unsupported-OS screen.

## Testing a tuning change on the laptop
Follow the protocol in `TROUBLESHOOTING.md` (matched runs, one variable at a time, stop conditions). In short: log
`scripts\monitoring\hwinfo_logger.ps1` for 15-20 minutes of the same CS2 route before and after, compare peak temperature,
package power, throttle flags and the WHEA counter, and keep the change only if there is no new error and frame times hold.

## Not covered yet
- The installer on a fresh Windows install; the changing wizard steps through the UI (they are covered through
  `Install-Tuning.ps1` and the library tests); FPS (never measured, only judged by feel).
