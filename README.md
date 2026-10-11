# Legion 83DE (i9-14900HX) — ThrottleStop tuning, plug and play

Stops the CPU from hitting 100 °C in CS2 and other games, without noticeable FPS loss, and
makes the whole setup reproducible after a Windows reinstall.

| Result on the original machine (19-min CS2 sessions) | Before | After |
|---|---|---|
| Peak CPU temperature | 99–100 °C | **90 °C**, no thermal throttling |
| Peak package power | 139 W | 73 W |
| Peak P-core clock | 5.39 GHz | 4.69 GHz (47x) |

## Quick start (new / freshly formatted Windows)

1. Download ThrottleStop (tested with **9.7.3**) from
   <https://www.techpowerup.com/download/techpowerup-throttlestop/> and leave the `.zip` in `Downloads`.
2. Clone or download this repo, then double-click **`install.cmd`** (it asks for administrator rights).
3. Answer **y** to the VBS question (needed for undervolting; breaks WSL2/Docker-WSL2, see below), or
   run `install.cmd -DisableVBS` to skip the prompt.
4. **Reboot.** ThrottleStop now starts at every logon, with the settings applied.
5. Check the result: ThrottleStop → **FIVR** (offsets −0.0996 / −0.0996 / −0.0898, Turbo Groups 47,
   E-cores 36) and **TPL** (PL1 65 / PL2 85, "Disable Controls" unchecked).

Useful options: `-InstallDir "D:\ThrottleStop"`, `-ZipPath <zip>`, `-SkipVBS`, `-NoStart`,
`-HWiNFODir <dir>` (enables shared-memory logging), `-TaskOnly` (only re-register the autostart task).

## Desktop wizard (Electron, `app/`)

A step-by-step app with a button per step: detect hardware → back up → get ThrottleStop → VBS choice → apply →
always-on startup → verify, plus a **Roll everything back** button. It calls the same PowerShell logic as
`install.cmd` (`scripts\Steps.ps1` + `scripts\lib\Tuning.ps1`), so there is one tested code path.

- **Run it:** double-click `app\Launch-Wizard.cmd` (asks for administrator rights, installs Electron on first run;
  needs Node.js). For a desktop-shortcut installer run `npm run dist` inside `app\` (electron-builder, Windows
  NSIS + portable `.exe`, requests administrator rights) — *packaging is configured but not built/tested yet*.
- **OS detection:** the app checks the OS at startup. Windows + i9-14900HX gets the wizard; Linux/macOS (or another
  CPU) get an explanation screen, because ThrottleStop/FIVR only exist on Windows.
- Tested: UI renders, hardware detection and verify run against the real machine, unsupported-OS screen.
  Not tested: the destructive steps through the UI (they were tested through `Install-Tuning.ps1`).
## What gets applied (`config\ThrottleStop.settings.ini`, profile 0)

| Setting | Value |
|---|---|
| CPU Core / P-cache undervolt | −100 mV / −100 mV |
| E-cache undervolt | −90 mV |
| V/F point 1 (800 MHz) "mV Boost" | +100 mV |
| P-core turbo cap (all groups) | 47x |
| E-core turbo cap | 36x |
| PL1 / PL2 | 65 W / 85 W |
| IccMax (core) | 511.75 A (max) |

Encoding of the values is documented in `AGENTS.md` §2. **The undervolt is silicon-specific.** This
chip logged a corrected WHEA "Internal parity error" at −100 mV, so do not go deeper; on a different
CPU start with −80 mV and check Event Viewer → System → WHEA-Logger (event 19) after a few days.

## "Always running"

The installer registers the task `ThrottleStop_Autostart`: at logon, highest privileges, no battery or
time limits, **plus a 5-minute watchdog** that starts ThrottleStop only if it is not running (no
duplicates). If you exit it from the tray it comes back within 5 minutes. To stop it for real, disable
the task in Task Scheduler.

## Monitoring

- `config\HWiNFO64.INI` turns on HWiNFO shared memory (`SensorsSM=1`). Never launch HWiNFO with
  command-line arguments (the free version shows an error).
- `scripts\monitoring\hwinfo_logger.ps1` logs temps, clocks, power and throttle flags every 2 s to `logs\hwinfo_log.csv` (git-ignored).
- `scripts\monitoring\perf_logger.ps1` logs CPU frequency / memory counters (needs a UTF-8 BOM, pt-BR counters).

## Restoring WSL2 / Docker

`scripts\maintenance\restore_vbs.ps1` (as administrator, then reboot) re-enables VBS/the hypervisor. The undervolt
stops working while it is on; the boost and power caps are separate and may still apply.

## Limitations

- **Not tested on a fresh Windows install.** Tested here: unpacking from a zip, creating/merging the
  INI, registering the task, and the watchdog (no duplicates, restarts when closed).
- ThrottleStop is not redistributed here; download it yourself.
- Model-specific: Lenovo Legion type 83DE (HWiNFO calls it "Legion Pro 7 16IRX9H"). Other models need
  their own limits.
- The reasoning, measurements and every mistake along the way are in `AGENTS.md`,
  `CS2_STUTTER_PLAN.md` and `CS2_STUTTER_FIX_PLAN.md`. Local-only material (screenshots, raw reports,
  experiment scripts, INI snapshots in `cs2_backup\`) is intentionally not committed.


