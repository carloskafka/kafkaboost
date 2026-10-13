> **Live docs → <https://carloskafka.github.io/legion-14900hx-throttlestop/#/overview>**
> The same content with the app walkthrough, screenshot by screenshot, from the hardware check to the last step.

<p align="center"><img src="docs/apple-touch-icon.png" alt="Legion Tuning icon: a CPU chip with a gauge needle in the green zone" width="96"></p>

# Legion Tuning — keep a gaming laptop under 100 °C

A guided, reversible [ThrottleStop](https://www.techpowerup.com/download/techpowerup-throttlestop/) tuning for the **Lenovo Legion 83DE
(Intel Core i9-14900HX)**: undervolt, boost-clock caps and power limits, a one-click installer, an always-on watchdog, and an
Electron app whose **Dashboard** screen tells you whether the optimization is still in place after a Windows update.

## What This Project Does

It lowers the CPU's heat (voltage, boost ratios, power limits) and makes sure the tuning is applied at every logon and stays applied.

| Result on the reference laptop (19-min CS2 sessions) | Before | After |
|---|---|---|
| Peak CPU temperature | 99–100 °C | **90 °C**, no thermal throttling |
| Average CPU temperature | 91 °C (owner's figure, see note) | about 79 °C (flat for the whole session) |
| Peak package power | 139 W | 73 W |
| Peak P-core clock | 5.39 GHz | 4.69 GHz (47x) |

Measured with HWiNFO shared memory. The "before" figures are maxima from screenshots, not a controlled A/B test: **the 91 °C before-average is the owner's own figure and is not backed by a recorded log** (the old screenshots cut the average column off), so treat the average improvement as indicative; the 10 °C lower peak and the end of thermal throttling are what was measured). To measure it, roll everything back, log a 19-minute session with `scripts\monitoring\hwinfo_logger.ps1`, then re-apply. FPS was not
measured (the game felt as smooth). See [`docs/RESULTS.md`](docs/RESULTS.md).

## The problem it solves

- **Stutter that grows with session length:** the CPU hits 100 °C, throttles, frame times spike — in CS2 and every other game.
- **The fix is scattered and easy to get wrong:** undervolt values, boost-ratio bytes, power-limit encodings and hidden checkboxes
  are copied between forum threads and are specific to a chip. One hidden checkbox ("Disable Controls") silently blocked every
  power limit we set.
- **It does not survive:** ThrottleStop is not a service. Close it, reboot without it, or take a Windows update (which can switch
  VBS back on and lock the voltage controls) and the laptop quietly returns to stock heat.
- **It is easy to go too far:** aggressive undervolts on 13th/14th-gen chips cause silent errors or degradation; without backups
  and a baseline you cannot tell.

This project gives you a **guided and reversible** setup, an **always-on** watchdog, and a **health check** with a one-click *Fix it*.

## Quick Start

### 1. Prerequisites
- Windows 11 on a Lenovo Legion 83DE with an i9-14900HX (other systems are refused), administrator rights, laptop plugged in.
- ThrottleStop (tested with **9.7.3**). The app can download it from [TechPowerUp](https://www.techpowerup.com/download/techpowerup-throttlestop/) for you, only after you tick the box in the wizard. An existing copy is found and used as is: the zip in `Downloads`, an extracted folder in `Downloads`, `Desktop` or `Documents`, or the folder your startup task already uses.
- Optional: Node.js 20+ to run the app from a clone.

### 2. Install
Double-click **`install.cmd`** (asks for administrator rights), answer **y** to the VBS question (needed for the undervolt; breaks
WSL2/Docker until restored), then **reboot**. Or open the app with **`KafkaBoost.lnk`** / **`KafkaBoost.cmd`** (repo root) and open **Optimizations**, then **CPU thermal tuning**, and follow the steps.

```
install.cmd -DisableVBS                      # no prompt
install.cmd -InstallDir "D:\ThrottleStop" -SkipVBS
```
Options: `-InstallDir`, `-ZipPath <zip>`, `-SkipVBS`, `-NoStart`, `-HWiNFODir <dir>`, `-TaskOnly`.

### 3. Check it and make a shortcut
Open the app: **Dashboard** should say *Your PC is optimized*. Create a desktop and Start Menu shortcut with the app icon (the
"run as administrator" flag is set):

```powershell
powershell -File scripts\Create-Shortcut.ps1
```
The repo root already has `KafkaBoost.cmd` (all systems with Node.js), `KafkaBoost.command` (macOS) and a generated `KafkaBoost.lnk`
(icon, runs as administrator). macOS and Linux were never run.

Run from a terminal: `cd app; npm install; npm start` (administrator needed to apply anything). Look around without changing the PC:
`cd app; $env:WIZARD_DEMO='1'; npx electron .`.

## The app (`app/`)

| Dashboard — health check | After a Windows update |
|---|---|
| <img src="docs/assets/health-ok.png" alt="Dashboard: your PC is optimized"> | <img src="docs/assets/health-attention.png" alt="Dashboard: settings drifted after a Windows update, Fix it button"> |

| Optimizations — tweak catalog | Cleanup | Settings |
|---|---|---|
| <img src="docs/assets/tweaks.png" alt="Optimizations: 30 tweaks with search, category filters, risk badges and toggles"> | <img src="docs/assets/cleanup.png" alt="Cleanup: sizes measured first, delete only what is ticked"> | <img src="docs/assets/settings.png" alt="Settings: theme, language, tray and update options"> |

The side menu has seven sections: **Dashboard**, **System analysis**, **Optimizations**, **Cleanup**, **Restore**, **Settings** and **Help**.
The app is being renamed **KafkaBoost** (launchers and window already; the repo, package ids and task names keep their old names).
Light and dark theme, English and Brazilian Portuguese.

- **Dashboard** compares the settings, the startup task, VBS and the Windows build with the moment you set it up, shows live
  temperature, clock and power (when HWiNFO sensors are available) and offers **Fix it**, which re-applies only what drifted.
- **System analysis** is a read-only look at the PC (model, CPU, GPU, RAM, Windows, power plan, VBS) and whether the tuning can be applied.
- **Optimizations** is a catalog of 30 tweaks (performance, GPU, gaming, network, privacy, appearance) with search, category
  filters and a risk badge on each (`safe`, `advanced`, `risky`). Toggle one on and the previous value is saved, so toggling it
  off restores exactly what was there. *Apply recommended* applies only the safe ones; advanced ones ask first; the two risky
  ones (Defender real-time protection, core isolation) need two confirmations. No FPS gain is promised: nothing here was
  benchmarked. **CPU thermal tuning** is the ThrottleStop setup: a step-by-step wizard from step 0 (hardware check) to step 6
  (verify).
- **Cleanup** measures first (temp files, Prefetch, Windows Update downloads, thumbnail cache, Recycle Bin) and deletes only what
  you tick; locked files are skipped, junctions are never followed, and the Recycle Bin (permanent) asks twice.
- **Restore** lists your Windows restore points, creates one on demand and opens Windows System Restore. KafkaBoost also creates one before your first tweak or *Apply recommended* (Windows allows one per 24 hours; if it declines, the app says so and still applies the tweak). It also undoes the CPU tuning (startup task, INI backup, optionally VBS). **Settings** has theme, language, tray options,
  start with Windows, check interval, ThrottleStop folder and the update check. **Help** has short answers and the documentation links.
- **Updates:** the app looks at this repo's GitHub Releases and shows the changelog when a newer version exists; the installed
  Windows build can update in place. It needs a published release with an installer (no release workflow yet).

Not built yet: an Apps installer/uninstaller, CS2 preset, the new landing site.

Every screen is in the [live docs](https://carloskafka.github.io/legion-14900hx-throttlestop/#/walkthrough). Screenshots come from
demo mode (`tools\make-shots.ps1`). Linux, macOS and other CPUs get an explanation screen instead.
## Runs in the background (system tray)

Close the window and the app keeps running next to the clock. The tray icon carries the verdict as a coloured dot (green optimized,
amber needs a look, red not fully in place, grey checking). It re-checks every 30 minutes and shows a notification when something
breaks, for example after a Windows update; click the icon to open the app, right-click for *Open*, *Check now*, *Start with Windows*
and *Quit*. *Start with Windows* (also in **Help > Background**) registers a scheduled task that opens the app hidden in the tray at
logon. Only one copy runs at a time.
## What gets applied (`config/ThrottleStop.settings.ini`, profile 0)

| Setting | Value |
|---|---|
| CPU Core / P-cache undervolt | −100 mV / −100 mV |
| E-cache undervolt | −90 mV |
| V/F point 1 (800 MHz) "mV Boost" | +100 mV |
| P-core / E-core turbo cap | 47x (4.7 GHz) / 36x (3.6 GHz) |
| PL1 / PL2 | 65 W / 85 W |
| IccMax (core) | 511.75 A (max) |

**The undervolt is silicon-specific.** This chip logged a corrected WHEA "Internal parity error" at −100 mV, so do not go deeper; on
a different CPU these values are not a recipe. Encoding and every key: [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md).

## Always running

The installer registers the task `ThrottleStop_Autostart`: at logon, highest privileges, no battery or time limits, **plus a
5-minute watchdog** that starts ThrottleStop only if it is not running (never a second copy).

## Monitoring

- `config\HWiNFO64.INI` turns on HWiNFO shared memory (`SensorsSM=1`). Never launch HWiNFO with command-line arguments (the free
  version shows an error).
- `scripts\monitoring\hwinfo_logger.ps1` logs temperatures, clocks, power and throttle flags every 2 s to `logs\hwinfo_log.csv`.
- `scripts\monitoring\perf_logger.ps1` logs CPU frequency / memory counters (UTF-8 BOM, pt-BR counter names).

## Restoring WSL2 / Docker

`scripts\maintenance\restore_vbs.ps1` (as administrator, then reboot) re-enables VBS and the hypervisor. The undervolt stops working
while it is on; the boost and power caps are separate and may still apply.

## Limitations

- **Not tested on a fresh Windows install.** Tested: unpacking from a zip, creating/merging the INI, registering the task, the
  watchdog (no duplicates, restarts when closed), the health check and the demo UI. Not tested: the changing wizard steps through
  the UI, the Windows installer package (`npm run dist` is configured, not built), a real in-app update, an elevated apply/revert of the tweaks on a real PC (they are tested against a sandbox registry), macOS and Linux.
- Tweaks change Windows settings; the risky ones lower security. Use at your own risk.
- ThrottleStop is not redistributed here: the app downloads it from TechPowerUp when you agree. HWiNFO is optional and yours to download.
- Model-specific: Lenovo Legion type 83DE (HWiNFO calls it "Legion Pro 7 16IRX9H"). Other models need their own limits.
- Changing CPU voltages can cause instability. Use at your own risk.

## Documentation

| Document | What |
|---|---|
| [`docs/getting-started.md`](docs/getting-started.md) | step-by-step onboarding |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | how the app, step runner and library fit together |
| [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md) | INI keys, voltage encoding, community comparison |
| [`docs/TESTING.md`](docs/TESTING.md) | unit tests, demo mode, testing a tuning change safely |
| [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) | lessons learned, stop conditions, rollback |
| [`docs/RESULTS.md`](docs/RESULTS.md) | measurements and the reference machine |
| [`AGENTS.md`](AGENTS.md) | current state, rules and repo map for contributors (human or AI) |

### Repository layout

```
install.cmd            one-click installer (self-elevates)
KafkaBoost.cmd/.command/.lnk  launchers for the app
app/                   Electron app: src/ (main, preload, settings, updates, i18n, tray, demo), renderer/, build/ (icons), test/ (node tests)
config/                ThrottleStop.settings.ini, HWiNFO64.INI, defaults.json, tweaks.json (tweak catalog)
scripts/               Install-Tuning.ps1, Steps.ps1, Create-Shortcut.ps1, lib/ (Tuning, Health, Tweaks, Cleanup, Restore), monitoring/, maintenance/
tests/                 Pester tests for the library (57)
tools/                 make-icons.js, make-shots.ps1, run-uitest.ps1 (UI checks)
docs/                  GitHub Pages site (index.html, assets/, favicons) and the reference documents
local/                 git-ignored: backups, evidence, experiments
```

## License

No license has been chosen yet, so all rights are reserved by default. Open an issue if you want to reuse the code.
