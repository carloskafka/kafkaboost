# Architecture

Three layers, one source of truth for the logic:

```
app/ (Electron UI)  ──spawn──▶  scripts/Steps.ps1  ──dot-source──▶  scripts/lib/Tuning.ps1 + Health.ps1 + Tweaks.ps1 + Cleanup.ps1 + Restore.ps1 + Sensors.ps1 + Hwinfo.ps1
install.cmd ─────────────────▶  scripts/Install-Tuning.ps1 ───────────────────▲
                                         config/{ThrottleStop.settings.ini, HWiNFO64.INI, defaults.json}
```

## PowerShell library (`scripts/lib/`)
| File | Responsibility |
|---|---|
| `Tuning.ps1` | Hardware info, unpack ThrottleStop, VBS on/off, **merge** settings into `ThrottleStop.ini` (stops only its own process), register the logon task + 5-minute watchdog, read-only `Test-Tuning`, `Invoke-Rollback`, FIVR/V-F encoders, `Get-Defaults`. |
| `Health.ps1` | The health check: `Compare-IniSettings` (drift), `Get-TurboCapMHz`, `Get-Verdict` (fail > warn > ok, `info` never counts), baseline of the Windows build (`%ProgramData%\LegionTuning\baseline.json`), optional live telemetry from HWiNFO shared memory, `Get-HealthReport`, `Invoke-Fix` (re-applies only what drifted; VBS only with consent). |
| `Sensors.ps1` | The Sensors screen. Pinned release from `config/sensors.json` (LibreHardwareMonitor, MPL-2.0): `Save-SensorDownload` (fresh temp folder, **SHA-256 must match** or the file is deleted, zip checked for the library and for `../` paths), `Expand-SensorZip` (only the library DLLs, by name), `Set-SensorsAcl` (administrators write, others read: an elevated process loads these DLLs), `Install-SensorSupport` (zip deleted at the end). `Read-SensorsLive` loads `LibreHardwareMonitorLib.dll` in Windows PowerShell 5.1 (the net472 build; `Assembly.LoadFrom` resolves its dependencies in the same folder), reads CPU, GPU, memory, board and storage twice (a second pass gives the load and power counters a delta) and `ConvertTo-SensorGroups` returns `hardware -> sensors` (name, type, value, min, max, unit code). Sensors without a value are dropped, CPU power is dropped when the PawnIO driver is missing (the library would show 0 W), and `Get-SensorSnapshot` picks the code (`msg.sensors.ok`, `needsAdmin`, `noCpuTemp`, `empty`, `loadFailed`, `missing`). Tests set `$script:SensorProvider` and `$script:SensorDownloader`. |
| `Hwinfo.ps1` | HWiNFO on demand (Dashboard card). Official page from `config/hwinfo.json`: `ConvertFrom-HwinfoPage` reads the "Portable for Windows 95 and later" block (version + stable zip link under `https://www.hwinfo.com/files/`, version and file name must agree; anything else returns nothing and the step answers `msg.hwinfo.pageChanged`). `Install-Hwinfo`: fresh temp folder, the zip must be a zip (an HTML protection page gives `msg.hwinfo.blocked`) with `HWiNFO64.exe` and no `../` entries, only that exe is extracted, **`Get-AuthenticodeSignature` must say Valid and the signer must contain REALiX** or everything is deleted, then it moves to `%ProgramData%\LegionTuning\hwinfo\<version>` (admin-only ACL) and `Initialize-HwinfoIni` places `config/HWiNFO64.INI`. `Get-HwinfoState` prefers an HWiNFO the user already has, then the app's own copy. `Start-HwinfoApp` re-checks the signature, never passes arguments and starts nothing when an HWiNFO64 is running; `Stop-HwinfoApp` ends only processes whose `Path` is that exe. Download is by `curl.exe` (Invoke-WebRequest is served a bot-challenge page by the site's CDN; a challenge is never solved). Test seams: `$script:HwinfoFetcher`, `HwinfoSignature`, `HwinfoProcesses`, `HwinfoSharedMemory`, `HwinfoStarter`, `HwinfoStopper`, `HwinfoRoot`. |
| `Tweaks.ps1` | The tweak engine, driven by `config/tweaks.json` (30 tweaks, 7 categories, risk `safe`/`advanced`/`risky`). A tweak is a list of declarative actions (`registry`, `regkey`, `service`, `powerplan`, `dns`, `defender`, `vbs`). `Set-Tweak` is all-or-nothing: it records the previous value in `%ProgramData%\LegionTuning\state.json`, applies, and rolls back if an action fails; turning a tweak off restores the recorded value. Risky tweaks need `-AllowRisky`; `minBuild` hides tweaks the Windows build does not support. `Set-RecommendedTweaks` applies only the safe ones marked `recommended`. |
| `Cleanup.ps1` | Disk cleanup: a fixed allow-list of targets (user temp, Windows temp, Prefetch `*.pf`, Windows Update downloads, thumbnail cache, Recycle Bin). `Get-CleanupSizes` is a dry run; `Invoke-Cleanup` deletes only the contents of the chosen ids, never follows junctions or symlinks, skips locked files and counts them, and leaves the target folder itself. The Recycle Bin is the one irreversible target. |
| `Restore.ps1` | System Restore points: `Get-KbRestorePoints` (newest first, needs admin), `New-KbRestorePoint` (checks that Windows really made one, because `Checkpoint-Computer` only warns when it declines; reports `created` / `skipped` / `failed`), `Test-FirstTweak`. `tweak-set` (on) and `tweaks-recommended` make a safety point first unless `-NoSafetyPoint`; a declined or failed point never blocks the tweak. Windows' 24-hour limit and System Protection are never changed, and there is no single-point delete (the app opens `rstrui.exe` instead). Tests use `$script:RestoreProvider`. |

The files are pure functions plus side effects behind clearly named functions, so the logic can be unit-tested with a sandbox
(`tests/`): `Tweaks.ps1` reads a `$script:RegMap` / `$script:TweakStatePath` override, `Cleanup.ps1` a `$script:CleanupMap`, so
tests never touch real registry keys or folders.

## Step runner (`scripts/Steps.ps1`)
Runs **one** step (`detect`, `backup`, `get`, `vbs`, `apply`, `task`, `verify`, `health`, `fix`, `autostart`, `rollback`, `paths`,
`cleanbackups`, `tweaks-list`, `tweak-set`, `tweaks-recommended`, `cleanup-scan`, `cleanup-run`, `restore-list`, `restore-create`, `restore-open`, `sensors-state`, `sensors-get`, `sensors-read`, `hwinfo-state`, `hwinfo-check`, `hwinfo-get`, `hwinfo-start`, `hwinfo-stop`) and prints a protocol the
app parses: `LOG: <text>` lines and one final `RESULT: {"ok":…,"message":…,"code":…,"args":…,"data":…}`. `code` + `args` are a
language-neutral message key (`msg.*`, `tweak.*`, `check.*`) the UI translates; `message` is the English fallback. Steps that
change the system refuse to run without administrator rights; the read-only ones (`detect`, `verify`, `health`, `paths`,
`cleanbackups`, `tweaks-list`, `tweaks-recommended`, `cleanup-scan`, `autostart` status, `sensors-state`, `sensors-read`, `hwinfo-state`, `hwinfo-check`) do not (`hwinfo-get`, `hwinfo-start` and `hwinfo-stop` check for administrator rights themselves and answer `msg.hwinfo.needsAdmin`; `sensors-get` checks for administrator rights itself and answers with a `msg.sensors.getNeedsAdmin` code), and `tweak-set` checks per tweak
(registry tweaks under HKCU need no admin). `get -Download` fetches ThrottleStop from TechPowerUp only when the user agreed in the
app: version list page, then the download form, validated as a zip containing `ThrottleStop.exe`, unpacked, zip deleted.

## Electron app (`app/`)
- `src/main.js`: window, IPC (`app:info`, `step:run`, `apps:*` (Apps manager), `settings:get|set`, `app:whatsNew`, `app:installUpdate`, `dialog:zip`,
  `app:relaunchAdmin`), spawns `Steps.ps1`, reads `config/defaults.json`. Context isolation on, no Node in the renderer, strict CSP.
- `src/preload.js`: the small `window.kb` API (`runStep`, settings, `whatsNew`, `installUpdate`, `onUpdate`).
- `src/settings.js`: validated settings store in `userData/settings.json` (theme, language, tray options, check interval,
  ThrottleStop folder, `checkForUpdates`, `lastSeenVersion`, `lastCleanup`); unknown or invalid values are rejected.
- `src/i18n.js` + `renderer/i18n/{en,pt-BR}.json`: English and Brazilian Portuguese; a test fails if the key sets differ. The tray
  and notifications use the same files.
- `src/updates.js`: update logic on the GitHub Releases API (`newerReleases`, `releaseFor`, `parseNotes`, `canSelfUpdate`). `main.js`
  looks for a newer release after start and every few hours, shows the changelog (rendered with `textContent` only) and, for the
  installed (non-portable, packaged) Windows build, installs through `electron-updater`. Other builds get a link to the release.
  The lookup sends no personal data; nothing downloads without a click. It needs a published release with an installer and
  `latest.yml`, which the release workflow publishes (see Releasing below).
- `src/packages/` (the Apps manager, no Electron code, unit-tested with a fake runner): `ids.js` (strict id/query patterns), `runner.js` (the only place that starts a process: `execFile` with an args array, never a shell), `base.js` (shared provider shape and result codes), `winget.js` (parses the localized table by header position), `brew.js` (casks + formulae; tries `/opt/homebrew/bin` and `/usr/local/bin` because apps started from the Finder get no shell PATH), `linux.js` (`flatpak` per user, `apt`/`dnf`/`pacman` through `pkexec`), `catalog.js` (loads and validates `config/apps.json`), `bloat.js` (Windows inbox Store apps: allow-list only, current user, via PowerShell), `index.js` (`createService`: picks the provider for the OS, flags what is installed, builds the export file and the import plan). Every provider has the same interface: `available, list, search, install, uninstall, exportList, importList`. IPC `apps:*` in `main.js` re-validates every argument; import is two calls (pick and validate, then run only the validated plan). The macOS and Linux providers were never run on real systems.
- Sensors screen: `renderer/js/sensors.js` (view) and `renderer/js/sensorlogic.js` (pure logic shared with the main process and the tests: thresholds, formatting, `sanitizeSnapshot`). The page runs `sensors-state`, shows the consent box when the library is missing, then repeats `sensors-read` about every 2 s (the next read is scheduled only after the previous one ends) **only while it is the visible screen and the window is visible** (`onHide` in `core.js`, `visibilitychange`). Each read starts a short Windows PowerShell and opens the library, so the interval is "2 s after the previous read". Min/max are tracked by the page over what it has seen, because the library is reopened for every read. IPC `sensors:copy` / `sensors:save` rebuild the snapshot with `sanitizeSnapshot` before it reaches the clipboard or a file. A step is spawned per read (no long-running process), which keeps the "thin UI" rule.
- Dashboard HWiNFO card: `renderer/js/hwinfo.js` (view) and `renderer/js/hwinfologic.js` (pure model: which message and buttons for a state, shared with the tests). It sits under the live tiles because those tiles read HWiNFO shared memory. Flow: `hwinfo-state` on every Dashboard visit; *Check what will be downloaded* runs `hwinfo-check` (reads only the official page) and shows version, source and signer; the consent box enables `hwinfo-get -Download -HwinfoVersion <shown>` (refused with `msg.hwinfo.versionChanged` if the page moved on); *Start* / *Stop* run `hwinfo-start` / `hwinfo-stop`; after a start the card refreshes and re-runs the health check after about 4 s. `main.js` forwards `hwinfoVersion` only when it is `digits.digits` and `updateIni` only when it is exactly `true`; the card's link to the download page is in the `EXTERNAL_OK` allow-list.
- `src/demo.js` and `src/demo-apps.js`: canned results for **demo mode** (`WIZARD_DEMO=1`): used for the docs screenshots, never touches the PC. The tweak
  list comes from the real `config/tweaks.json`.
- `renderer/`: plain scripts on one `window.KB` object (`js/core.js` plus one file per screen). Sections: Dashboard, System
  analysis, Optimizations (the tweak catalog with search, category chips, risk badges and toggles, plus *CPU thermal tuning*, the
  step-by-step wizard), Cleanup, Restore, Sensors, Apps (all OSes), Settings, Help. Advanced and risky tweaks ask for confirmation (risky: two, with a strong
  warning); *Apply recommended* never includes them. Text is set with `textContent`, never `innerHTML`.
- OS detection: Windows gets everything; the Windows-only sections (`WINDOWS_ONLY` in `core.js`) are hidden elsewhere.

## Background (system tray)
`src/tray.js` creates the tray icon (`build/tray-{ok,warn,fail,unknown}.png`: the app icon with a status dot), its menu and the
toast notifications. `src/main.js` keeps the app alive when the window is closed (hide instead of quit, single instance lock),
runs `Steps.ps1 -Step health` 20 seconds after start and then every 30 minutes, feeds every `health`/`fix` result (also those
requested by the UI) into the tray, and notifies when the state gets worse. *Start with Windows* is the `autostart` step: a
scheduled task `LegionTuning_App` (name in `config/defaults.json`) that starts the app with `--hidden` at logon, elevated.
`Resolve-InstallDir` finds the real ThrottleStop folder from the watchdog task when it is not in the default folder.
## Always running
Task `ThrottleStop_Autostart`: logon trigger with a 5-minute repetition, highest privileges, no time or battery limits. Its action
starts ThrottleStop only if no process of that name exists, so there is never a second copy.

## Config (`config/`)
`ThrottleStop.settings.ini` is merged key by key into the INI (see `CONFIGURATION.md`); `defaults.json` holds the install dir and
task name for PowerShell and Node alike; `HWiNFO64.INI` enables shared-memory logging; `tweaks.json` is the tweak catalog; `sensors.json` pins the sensor library release (version, official url, SHA-256); `hwinfo.json` names the official HWiNFO download page, the file prefix a download must start with and the expected signer (no hash: the build changes every few weeks, so the signature is the check).

## Tools (`tools/`)
`make-icons.js` renders every icon size from `app/renderer/icon.svg`; `make-shots.ps1` regenerates `docs/assets/*.png` from
demo mode.

## Releasing
1. Raise `version` in `app/package.json` (and merge it); the tag must be exactly `v<version>`.
2. Push the tag `vX.Y.Z`. `.github/workflows/release.yml` then runs on `windows-latest`: it fails if the tag and the version differ, runs the Node tests, the Pester tests and the site check, and builds with `npm run dist` (electron-builder: NSIS installer and portable exe).
3. A second job, the only one with `contents: write`, creates the GitHub Release with `KafkaBoost-Setup-X.Y.Z.exe`, its `.blockmap`, `KafkaBoost-Portable-X.Y.Z.exe`, `SHA256SUMS.txt` and `latest.yml`. A tag with a dash (`v0.2.0-rc1`) becomes a pre-release, which the app ignores.
4. Installed copies find the release through `app/src/updates.js` and update through `electron-updater` (it reads `latest.yml`); the portable exe and source checkouts only get a link. The Download page reads the same release.

Release notes are generated from the commit subjects since the previous tag, in the only format `parseNotes` renders: `#` headings, `- ` bullets and plain paragraphs (no links, bold or code, because the app shows them as text). Conventional-commit subjects therefore double as the changelog.

The build uses the `build` section of `app/package.json`: `scripts/**/*.ps1` and `config/` are copied to `resources/` (`extraResources`), where `main.js` and the `..\..\config` paths inside the scripts find them. **The files are not code-signed** (no certificate), so Windows SmartScreen warns on first run. `npm run dist` was run locally once; the workflow itself has not run on GitHub yet.

## The site
`docs/` is a static site (no framework): `index.html` landing, `about-app.html` docs hub, secondary pages, an English root and a `pt-br/` mirror sharing `site.css` and `site.js`. `pages.yml` publishes the folder; `tools/check-site.js` (run in CI) checks links, anchors, language twins, hreflang and that the numbers still match the repository. The Download page reads the GitHub Releases API in the browser and falls back to plain links.
