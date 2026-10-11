# Architecture

Three layers, one source of truth for the logic:

```
app/ (Electron UI)  ──spawn──▶  scripts/Steps.ps1  ──dot-source──▶  scripts/lib/Tuning.ps1 + Health.ps1
install.cmd ─────────────────▶  scripts/Install-Tuning.ps1 ───────────────────▲
                                         config/{ThrottleStop.settings.ini, HWiNFO64.INI, defaults.json}
```

## PowerShell library (`scripts/lib/`)
| File | Responsibility |
|---|---|
| `Tuning.ps1` | Hardware info, unpack ThrottleStop, VBS on/off, **merge** settings into `ThrottleStop.ini` (stops only its own process), register the logon task + 5-minute watchdog, read-only `Test-Tuning`, `Invoke-Rollback`, FIVR/V-F encoders, `Get-Defaults`. |
| `Health.ps1` | The health check: `Compare-IniSettings` (drift), `Get-TurboCapMHz`, `Get-Verdict` (fail > warn > ok, `info` never counts), baseline of the Windows build (`%ProgramData%\LegionTuning\baseline.json`), optional live telemetry from HWiNFO shared memory, `Get-HealthReport`, `Invoke-Fix` (re-applies only what drifted; VBS only with consent). |

The two files are pure functions plus side effects behind clearly named functions, so the logic can be unit-tested with a sandbox
directory (`tests/`).

## Step runner (`scripts/Steps.ps1`)
Runs **one** step (`detect`, `backup`, `get`, `vbs`, `apply`, `task`, `verify`, `health`, `fix`, `rollback`) and prints a protocol the
app parses: `LOG: <text>` lines and one final `RESULT: {"ok":…,"message":…,"data":…}`. Steps that change the system refuse to run
without administrator rights; `detect`, `verify` and `health` do not need them.

## Electron app (`app/`)
- `src/main.js`: window, IPC (`app:info`, `step:run`, `dialog:zip`, `app:relaunchAdmin`), spawns `Steps.ps1`, reads
  `config/defaults.json`. Context isolation on, no Node in the renderer, strict CSP.
- `src/preload.js`: the small `window.wizard` API.
- `src/demo.js`: canned results for **demo mode** (`WIZARD_DEMO=1`): used for the docs screenshots, never touches the PC.
- `renderer/`: five sections (Dashboard, System analysis, Optimizations, Restore, Help). Optimizations lists the available tunings; *CPU thermal tuning* opens the step-by-step wizard. Text is set with `textContent`, never `innerHTML`.
- OS detection: `process.platform`. Windows + i9-14900HX gets the app; Linux, macOS or another CPU get an explanation screen.

## Always running
Task `ThrottleStop_Autostart`: logon trigger with a 5-minute repetition, highest privileges, no time or battery limits. Its action
starts ThrottleStop only if no process of that name exists, so there is never a second copy.

## Config (`config/`)
`ThrottleStop.settings.ini` is merged key by key into the INI (see `CONFIGURATION.md`); `defaults.json` holds the install dir and
task name for PowerShell and Node alike; `HWiNFO64.INI` enables shared-memory logging.

## Tools (`tools/`)
`make-icons.js` renders every icon size from `app/renderer/icon.svg`; `make-shots.ps1` regenerates `docs/assets/*.png` from
demo mode.
