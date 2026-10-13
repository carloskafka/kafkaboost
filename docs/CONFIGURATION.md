# ThrottleStop.ini reference (i9-14900HX, ThrottleStop 9.7.3)

ThrottleStop has no official ini documentation. This mapping was derived from the file itself, the
linux-intel-undervolt reverse-engineering notes and unclewebb's forum posts, and verified on this machine.
The template that the installer applies is [`config/ThrottleStop.settings.ini`](../config/ThrottleStop.settings.ini).

## 1. FIVR voltage encoding

`ThrottleStop.ini` stores FIVR offsets as a 32-bit hex. The offset lives in bits [30:21] (an 11-bit
two's-complement field): `value = (field & 0x7FF) << 21`.

**Offset planes** (`FIVRVoltage{plane}{profile}`): `field = 2048 - round(|mV| x 1.024)` for negative offsets.

| mV | hex | | mV | hex |
|---|---|---|---|---|
| 0 | `0x00000000` | | -90 | `0xF4800000` |
| -50 | `0xF9A00000` | | -100 | `0xF3400000` |
| -75 | `0xF6600000` | | -115 | `0xF1400000` |
| -125 | `0xF0000000` | | -140.6 | `0xEE000000` (your original core value; exactly -140 mV is `0xEE200000`) |

- **Plane index** (first digit): `0` CPU Core, `1` Intel GPU, `2` CPU P-cache, `3` System Agent,
  `4` analog I/O / iGPU unslice, `5` CPU E-cache.
- **Profile index** (second digit): `0`..`3` (UI shows 1..4). Only profile 0 ("Performance") is tuned.
- `UnlockVoltage{plane}{profile}=1` is the per-plane "unlock / variable" flag.
- **V/F point offsets** (`UseVFCore`, `UseVFCache`, `VFPoint{pt}{profile}{0=core,1=cache}`):
  `field = round(mV x 1.024)` (signed, no 2048 base), `value = field << 21`. V/F point 1 (800 MHz) at
  **+100 mV** is `0x0CC00000`.
- Core and P-cache must move together on this CPU (if Core < Cache the CPU uses the lower for both).
  Intel GPU and System Agent are linked: touch both or neither.

The two encodings are implemented as `ConvertTo-FivrHex` / `ConvertTo-VfHex` in
[`scripts/lib/Tuning.ps1`](../scripts/lib/Tuning.ps1) and covered by `tests/`.

## 2. Applied settings (profile 0)

```
FIVRVoltage00=0xF3400000   ; CPU Core   -100 mV
UnlockVoltage00=1
FIVRVoltage20=0xF3400000   ; P-cache    -100 mV
UnlockVoltage20=1
FIVRVoltage50=0xF4800000   ; E-cache     -90 mV
UnlockVoltage50=1
UseVFCore=1                ; "Use Core V/F Offsets"
UseVFCache=0
VFPoint110=0x0CC00000      ; V/F point 1 (800 MHz) core = +100 mV ("mV Boost")
IccMaxNew00=0x000007FF     ; core current limit = max (511.75 A); cache planes already max
PowerLimitEAX0=0x00DF8208  ; PL1 = 65 W  (bits[14:0] = W x 8)
PowerLimitEDX0=0x004282A8  ; PL2 = 85 W
OneAD_EAX0=0x2F2F2F2F      ; P-core turbo groups 1-4 = 47x
OneAD_EDX0=0x2F2F2F2F      ; P-core turbo groups 5-8 = 47x
Six50_EAX0=0x00000024      ; E-core turbo = 36x
NoSetPL=0xE                ; TPL controls enabled for profile 0 (see docs/TROUBLESHOOTING.md: "Disable Controls")
SaveOnExit=2
```

Not ours, read-only findings: `PROCHOT_Offset0=0x3` (about 97 C). Legacy and ignored: `POWERLIMITEAX=0x00DD8230`
(70 W), `POWERLIMITEDX=0x00428320` (100 W), `LockPowerLimits=1`; these were the first, never-applied attempt.
Profiles 1-3 keep ThrottleStop defaults (`PowerLimitEAX1..3=0x00DF8460` = 140 W, `PowerLimitEDX1..3=0x004285F0` = 190 W).

Previous turbo values (stock): `OneAD_EAX0=0x34343636`, `OneAD_EDX0=0x31313232` (P groups 54/54/52/52/50/50/49/49),
`Six50_EAX0=0x29` (E 41x).

## 3. Key reference

**Identity / profiles:** `StartFailed` (sanity flag), `Profile` (active 0-3), `ProfileName1..4`, `LogFileDirectory`.
`DTSAlarm`, `GPUAlarm`, `LowBattPercent` alarms.

**Options bitsets:** `Options1..4` (per profile checkbox bitmask: start minimized, minimize on close, PROCHOT offset...),
`EIST`, `DutyCycle1..4`, `TimePeriodAC`, `PSMinimum`. UI cosmetics: `ColorXX`, `*Color`, `*Icon`, `GridLines`, `LogoMin`,
`TaskBar`, `NoTitleBar`, `HotKey0..4`.

**Behaviour:** `SaveOnExit` (2 = save on exit), `DisableSafeStart`, `WDBoost`, `SleepZeroVoltage`, `DefaultCache`.

**Speed Shift:** `EnPerfPref0..3` (EPP per profile, 128 = default), `SSTEPP` (EPP enable).

**Legacy / old-CPU (mostly inert on 14th gen):** `Payload1..4`, `NewCStateLimit`, `HaswellOverclock`, `OneAD_*` (turbo
ratio MSR 0x1AD, *used* here), `OneAE_*` (core counts per group), `Six50_*` (E-core ratio, *used* here), `Six51_*`, `ZeroChipset`.

**Ratios:** `NonTurboRatio1..4` (+ lock), `CacheMinMax*` (cache ratio min/max, `0x832` = 8..50).

**FIVR:** `FIVRVoltage*` / `UnlockVoltage*` (section 1), `IccMaxNew{plane}{profile}` = A x 4 (`0x7FF` = 511.75 A),
`TVBoost`, `RingDownBin`, `VMaxStress`, `AVXOffset`, `AVX512Offset`, `OffsetRange`, `VCCOffsetRange`.

**Power limits (TPL window):** `PowerLimitEAX/EDX{profile}` (PL1/PL2 + time window), `PowerLimit4`, `PP0POWERLIMITEAX`,
`MSRLock`, `SyncMMIO`, `PROCHOT_Offset{profile}`, `PROCHOT_Lock`, `NoSetPL` (bit per profile = "Disable Controls").

## 4. Community comparison (14900HX), status after tuning

| Setting | Community recommendation | Ours | Status |
|---|---|---|---|
| Core / P-cache offset | start -100, push -125/-150 | -100 / -100 | matched; **do not go deeper** (WHEA 19 seen) |
| E-cache offset | about -90 | -90 | matched |
| V/F point 1 (mV Boost) | 100, >= 115 before raising P-cache | 100 | unchanged |
| Intel GPU / System Agent | leave at 0 | 0 | matched |
| IccMax (core + cache) | max | max | matched |
| Turbo cap | cap P (4.0-5.4 G), E (2.4-3.6 G) | P 4.7 G, E 3.6 G | **done** (main heat lever) |
| PL1 / PL2 | e.g. 70 / 100 W | 65 / 85 W | **done** |
| PROCHOT offset | Lenovo often 7 (93 C) | 3 (97 C) | read only, unchanged |
| Speed Shift EPP / cache ratio | optional | 128 / 8-50 | untouched |

Sources: TechPowerUp (unclewebb) "Undervolting i9-14900HX" and "Throttlestop Settings Guide for 13th/14th Gen Intel",
Legion 5/7 14900HX threads, Intel Community, Lenovo Gaming and MSI forums. Data points: Legion 7i -137 mV core/P-cache
with boost caps ran 85-92 C; another Legion at -140 mV still hit 100 C; at -160 mV some chips crash in long tests;
MSI calls -80 mV a safe daily value; lowering boost clocks lets you go lower on volts.


## Tweak catalog (`config/tweaks.json`)
30 tweaks in seven categories (performance, gpu, gaming, network, privacy, appearance, general). Each entry:

| Field | Meaning |
|---|---|
| `id`, `category` | unique id (also the i18n key `tweak.<id>.title/desc`) and its category |
| `risk` | `safe` (one click), `advanced` (explanation + confirm), `risky` (two confirmations, never in "Apply recommended") |
| `recommended` | part of *Apply recommended* (only meaningful for `safe`; no risky tweak is recommended) |
| `needsReboot` | the UI says a restart is needed |
| `minBuild` | optional minimum Windows build; hidden below it |
| `actions[]` | declarative actions: `registry`, `regkey`, `service`, `powerplan`, `dns`, `defender`, `vbs` |

Before changing anything the engine stores the previous value in `%ProgramData%\LegionTuning\state.json`; turning the tweak off
writes it back (a value that did not exist is deleted again). A tweak is applied all-or-nothing. Risky ones: `defender-realtime-off`
(uses `Set-MpPreference`; if Tamper Protection blocks it the app says so and does not work around it) and `core-isolation-off`.
No tweak promises an FPS gain: they change settings, and nothing here was benchmarked.

## Apps catalog (`config/apps.json`)
| Field | Meaning |
|---|---|
| `version` | file format (1) |
| `categories[]` | filter chips of the Apps view; each needs an `apps.cat.<name>` text in both languages |
| `apps[].id` | unique lowercase id (`[a-z0-9-]`); the UI text comes from `apps.app.<id>.desc` in `renderer/i18n/*.json` |
| `apps[].name` | product name shown on the card (not translated) |
| `apps[].desc` | short English description (the English text of the i18n key) |
| `apps[].category` | one of `categories` |
| `apps[].ids.win32` | winget id (`Publisher.Package`) |
| `apps[].ids.darwin` | `{ "cask": "<name>" }` or `{ "formula": "<name>" }` for Homebrew |
| `apps[].ids.linux` | any of `flatpak` (reverse-DNS app id), `apt`, `dnf`, `pacman` package names |
| `bloatware[]` | Windows only. `id` (UI text `apps.bloat.<id>.name/desc`) and `appx` (the inbox package name). Only these can ever be removed, for the current user |

A missing OS or manager means the app is not offered there; ids are never guessed. The ids were checked against winget (`winget show`),
formulae.brew.sh, flathub.org, archlinux.org and the Debian and Fedora package pages; none of them was installed. Every id must match
the strict pattern of its manager (`app/src/packages/ids.js`) and a unit test enforces it. On Linux the first available manager of
flatpak, apt, dnf, pacman is used (Flatpak installs per user without root; the others ask for the password through `pkexec`).

The exported list (`kafkaboost-apps.json`) is `{ "app": "KafkaBoost", "format": 1, "exportedAt", "platform", "manager", "packages": [{ "id", "kind"?, "catalogId"? }] }`.
`catalogId` lets a list made on one OS be imported on another through the catalog.

## Sensor library (`config/sensors.json`)
| Field | Meaning |
|---|---|
| `name`, `version` | the library and the exact release the app downloads (LibreHardwareMonitor 0.9.6) |
| `url` | the official GitHub release zip (`LibreHardwareMonitor.zip`, the .NET Framework 4.7.2 build that Windows PowerShell 5.1 can load); must start with `urlPrefix` |
| `urlPrefix` | `https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases/download/`: any other address is refused |
| `sha256` | the SHA-256 of that zip (`086d9f1b...c001`, the same value GitHub shows for the release asset). A different file is deleted and nothing is installed |
| `sizeBytes` | about 6.3 MB, shown in the consent text |
| `library` | the DLL the zip must contain and the reader loads |
| `license`, `homepage` | MPL-2.0 and the project page |

**What is downloaded and where.** Nothing is in this repository. After the user ticks the consent box and clicks *Get sensor support* (as administrator) the zip goes to a fresh folder in `%TEMP%`, is hash-checked, only the library DLLs are unpacked (23 files, no GUI exe) into `%ProgramData%\LegionTuning\sensors\<version>\` (ACL: administrators and SYSTEM write, users read), and the zip is deleted. To update the library, change `version`, `url` and `sha256` together and re-run the sensor tests. The library DLLs are **not Authenticode-signed**; the pinned hash is the only proof of origin.

**Drivers.** LibreHardwareMonitor 0.9.6 reads Intel/AMD CPU registers (temperature, clocks, power) through the **PawnIO** driver, which is installed separately and which KafkaBoost never installs (the older WinRing0 driver is not referenced by this version). On the reference PC PawnIO was not installed: the CPU load, GPU (temperature, clocks, power, memory) and memory readings worked without it, and CPU temperature, clocks and power were absent. The app shows them as missing, never as 0. Without administrator rights the library also returned no disk or board sensors. Some anti-cheat systems dislike kernel drivers from monitoring tools; this was not tested.

**Scope.** Temperatures, clocks, voltages, power, fans and load, like HWMonitor. It does **not** measure DPC/ISR latency (use LatencyMon for that). The warm (80 C) and hot (90 C) temperature colors are generic and not specific to any chip or disk.

## HWiNFO on demand (`config/hwinfo.json`)
| Field | Meaning |
|---|---|
| `downloadPage` | `https://www.hwinfo.com/download/`: the only page read to find the current build |
| `filePrefix` | `https://www.hwinfo.com/files/`: the portable zip link must start with it and be named `hwi_<version without the dot>.zip` (8.54 is `hwi_854.zip`); anything else is refused |
| `exe`, `ini` | `HWiNFO64.exe` (the only file unpacked) and `HWiNFO64.INI` (the template is `config/HWiNFO64.INI`: `SensorsOnly=1`, `SensorsSM=1`) |
| `signer` | `REALiX`: the signer name the Authenticode signature of `HWiNFO64.exe` must contain (and the status must be Valid) |
| `license` | text shown in the consent box |

There is **no pinned hash**: HWiNFO ships a new build every few weeks, so a hash would go stale. The checks are the official address, a real zip that holds `HWiNFO64.exe`, and the vendor signature. If the page layout changes the app says so (`msg.hwinfo.pageChanged`) instead of guessing.

**What is downloaded and where.** Nothing is in this repository. The *Live telemetry source (HWiNFO)* card on the Dashboard first reads the download page (button *Check what will be downloaded*) and shows version, source address and signer. After the user ticks the consent box and clicks *Download and install* (as administrator) the zip goes to a fresh folder in `%TEMP%`, is checked, only `HWiNFO64.exe` is extracted and signature-checked, then moved to `%ProgramData%\LegionTuning\hwinfo\<version>\` (ACL: administrators and SYSTEM write, users read) with the INI template next to it, and the temp folder is deleted. The page is fetched with `curl.exe` and an honest user agent; if the site answers with a protection page the app does not try to get around it: the reply is not a zip, so it says `msg.hwinfo.blocked` and offers *I downloaded the zip myself...* (the zip you pick goes through the same checks).

**An HWiNFO you already have** (found in Downloads, Desktop, Documents, `C:\Tools`, `C:\HWiNFO` or Program Files, two levels deep) is used instead of downloading. Its `HWiNFO64.INI` is never overwritten: if there is none, the template is copied; if it lacks `SensorsSM=1` the card asks, and only then sets that one key after making `HWiNFO64.INI.bak_<timestamp>`.

**Starting it for you.** When the Dashboard tiles have no readings and the app is elevated, the notice names the cause (not installed, not running, running with Shared Memory Support off) and offers *Start HWiNFO*; if the INI lacks `SensorsSM=1` the start needs the notice's own checkbox, which maps to `-UpdateIni` (a timestamped `.bak` first). The setting `startHwinfoWithApp` does the same start automatically after the app starts but never passes `-UpdateIni`: with the INI off it does nothing and the notice explains. **Start and stop.** The exe is started with no arguments (the free version shows an error otherwise), its signature is checked again first, and nothing is started when an HWiNFO64 is already running. Stop ends only processes whose `Path` is exactly the resolved `HWiNFO64.exe` (it asks the window to close, then ends it after 4 s).

**Third-party note.** HWiNFO is proprietary freeware by REALiX ("FREEWARE for Non-Commercial use only" on its download page). KafkaBoost neither bundles nor redistributes it: the file comes from hwinfo.com on your click, and the only network request before that is the one page read when you press *Check*. We could not confirm on the official pages any limit on how long the free edition may share sensors in one session, so none is stated here; if HWiNFO stops sharing, the card shows it and *Start* restarts it.

## Counter-Strike 2 preset (`config/cs2.json`): what is written where
| Field | Meaning |
|---|---|
| `exeName`, `steamAppId`, `defaultFolder` | `cs2.exe`, 730 and `Counter-Strike Global Offensive`: used to find `steamapps\common\<folder>\game\bin\win64\cs2.exe` in every Steam library (the folder comes from `appmanifest_730.acf` when it is there) |
| `autoexecMarker` | `// Written by KafkaBoost`: the first line of every file we write; restore acts only while it is present |
| `autoexec` | the console lines the user can tick: `id`, `line`, a one-line `comment` that is written above it, and for `fps_max` a `param` with its bounds (30 to 1000). The page explains each in both languages (`cs2.cfg.opt.<id>`) |
| `launch` | the launch options the page can show: `id`, `text`, `tier` (`suggested`, `disputed`, `placebo`) and whether it is ticked by default (only `+exec autoexec`) |

**Everything the preset writes.** Nothing else is created, changed or deleted.
| Where | What | Undo |
|---|---|---|
| `HKCU\Software\Microsoft\DirectX\UserGpuPreferences`, value named after the full path of `cs2.exe` | `GpuPreference=2;` (High performance) added to the existing data, other fields kept | *Put the previous setting back*: the recorded previous data is written back, or the value is removed if there was none. A value we did not write is never touched on revert |
| `%ProgramData%\LegionTuning\state.json`, section `cs2` | the previous registry data, so the revert is exact | removed on revert |
| `<game>\csgo\cfg\autoexec.cfg` | the chosen lines, UTF-8 without BOM, first line the marker | *Restore previous*: the newest backup that is not ours is copied back, or our file is deleted when there was none |
| `<game>\csgo\cfg\autoexec.cfg.bak_<yyyyMMdd_HHmmss>` | a copy of the file that was there, made before every write | kept (nothing deletes backups) |
| `userData/settings.json` `cs2Exe` | a `cs2.exe` the user picked when Steam did not reveal the game | *Use the location from Steam* |

Steam is only read (`HKCU\Software\Valve\Steam`, `libraryfolders.vdf`, `appmanifest_730.acf`). Launch options are never written anywhere: the page builds a string and copies it, and the user pastes it into Steam; Steam's `localconfig.vdf` is not touched. Which lines were included, and why: `cl_showfps 1` (a frame counter, useful to see stutter next to the Sensors page) and `fps_max <n>` (the same limit as the Video menu; a limit the PC can hold steadily lowers CPU and GPU load and heat). Console variables we were not sure exist in CS2 were left out on purpose. Launch options: `+exec autoexec` and `-console` are harmless and suggested; `-high` and `-vulkan` are disputed (no reliable gain shown; try and compare yourself); `-novid` and `-nojoy` are listed as placebo (reported to do nothing in CS2, or a negligible saving). None of this is a performance promise, and we did not test any anti-cheat with it.

## App settings (`userData/settings.json`)
`theme` (system|dark|light), `language` (auto|en|pt-BR), `closeToTray`, `startHidden`, `startHwinfoWithApp` (default off: start an installed HWiNFO once after the app starts, only if it is not running, the app is elevated and its INI already has `SensorsSM=1`; never edits the INI, no arguments), `notifications`, `checkIntervalMin` (5-1440),
`installDir` (ThrottleStop folder, empty = automatic), `checkForUpdates` (default on), `lastSeenVersion`, `lastCleanup`, `cs2Exe` (a cs2.exe the user picked: a drive path ending in `cs2.exe`, empty = detect through Steam). Invalid values are rejected.
