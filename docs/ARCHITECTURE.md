# Architecture

Three layers, one source of truth for the logic:

```
app/ (Electron UI)  ──spawn──▶  scripts/Steps.ps1  ──dot-source──▶  scripts/lib/Tuning.ps1 + Health.ps1 + Tweaks.ps1 + Cleanup.ps1 + Restore.ps1
install.cmd ─────────────────▶  scripts/Install-Tuning.ps1 ───────────────────▲
                                         config/{ThrottleStop.settings.ini, HWiNFO64.INI, defaults.json}
```

## PowerShell library (`scripts/lib/`)
| File | Responsibility |
|---|---|
| `Tuning.ps1` | Hardware info, unpack ThrottleStop, VBS on/off, **merge** settings into `ThrottleStop.ini` (stops only its own process), register the logon task + 5-minute watchdog, read-only `Test-Tuning`, `Invoke-Rollback`, FIVR/V-F encoders, `Get-Defaults`. |
| `Health.ps1` | The health check: `Compare-IniSettings` (drift), `Get-TurboCapMHz`, `Get-Verdict` (fail > warn > ok, `info` never counts), baseline of the Windows build (`%ProgramData%\LegionTuning\baseline.json`), optional live telemetry from HWiNFO shared memory, `Get-HealthReport`, `Invoke-Fix` (re-applies only what drifted; VBS only with consent). |

| `Tweaks.ps1` | The tweak engine, driven by `config/tweaks.json` (30 tweaks, 7 categories, risk `safe`/`advanced`/`risky`). A tweak is a list of declarative actions (`registry`, `regkey`, `service`, `powerplan`, `dns`, `defender`, `vbs`). `Set-Tweak` is all-or-nothing: it records the previous value in `%ProgramData%\LegionTuning\state.json`, applies, and rolls back if an action fails; turning a tweak off restores the recorded value. Risky tweaks need `-AllowRisky`; `minBuild` hides tweaks the Windows build does not support. `Set-RecommendedTweaks` applies only the safe ones marked `recommended`. |
| `Cleanup.ps1` | Disk cleanup: a fixed allow-list of targets (user temp, Windows temp, Prefetch `*.pf`, Windows Update downloads, thumbnail cache, Recycle Bin). `Get-CleanupSizes` is a dry run; `Invoke-Cleanup` deletes only the contents of the chosen ids, never follows junctions or symlinks, skips locked files and counts them, and leaves the target folder itself. The Recycle Bin is the one irreversible target. |
| `Restore.ps1` | System Restore points: `Get-KbRestorePoints` (newest first, needs admin), `New-KbRestorePoint` (checks that Windows really made one, because `Checkpoint-Computer` only warns when it declines; reports `created` / `skipped` / `failed`), `Test-FirstTweak`. `tweak-set` (on) and `tweaks-recommended` make a safety point first unless `-NoSafetyPoint`; a declined or failed point never blocks the tweak. Windows' 24-hour limit and System Protection are never changed, and there is no single-point delete (the app opens `rstrui.exe` instead). Tests use `$script:RestoreProvider`. |

The files are pure functions plus side effects behind clearly named functions, so the logic can be unit-tested with a sandbox
(`tests/`): `Tweaks.ps1` reads a `$script:RegMap` / `$script:TweakStatePath` override, `Cleanup.ps1` a `$script:CleanupMap`, so
tests never touch real registry keys or folders.

## Step runner (`scripts/Steps.ps1`)
Runs **one** step (`detect`, `backup`, `get`, `vbs`, `apply`, `task`, `verify`, `health`, `fix`, `autostart`, `rollback`, `paths`,
`cleanbackups`, `tweaks-list`, `tweak-set`, `tweaks-recommended`, `cleanup-scan`, `cleanup-run`, `restore-list`, `restore-create`, `restore-open`) and prints a protocol the
app parses: `LOG: <text>` lines and one final `RESULT: {"ok":…,"message":…,"code":…,"args":…,"data":…}`. `code` + `args` are a
language-neutral message key (`msg.*`, `tweak.*`, `check.*`) the UI translates; `message` is the English fallback. Steps that
change the system refuse to run without administrator rights; the read-only ones (`detect`, `verify`, `health`, `paths`,
`cleanbackups`, `tweaks-list`, `tweaks-recommended`, `cleanup-scan`, `autostart` status) do not, and `tweak-set` checks per tweak
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
  `latest.yml`; there is no release workflow yet.
- `src/packages/` (the Apps manager, no Electron code, unit-tested with a fake runner): `ids.js` (strict id/query patterns), `runner.js` (the only place that starts a process: `execFile` with an args array, never a shell), `base.js` (shared provider shape and result codes), `winget.js` (parses the localized table by header position), `brew.js` (casks + formulae; tries `/opt/homebrew/bin` and `/usr/local/bin` because apps started from the Finder get no shell PATH), `linux.js` (`flatpak` per user, `apt`/`dnf`/`pacman` through `pkexec`), `catalog.js` (loads and validates `config/apps.json`), `bloat.js` (Windows inbox Store apps: allow-list only, current user, via PowerShell), `index.js` (`createService`: picks the provider for the OS, flags what is installed, builds the export file and the import plan). Every provider has the same interface: `available, list, search, install, uninstall, exportList, importList`. IPC `apps:*` in `main.js` re-validates every argument; import is two calls (pick and validate, then run only the validated plan). The macOS and Linux providers were never run on real systems.
- `src/demo.js` and `src/demo-apps.js`: canned results for **demo mode** (`WIZARD_DEMO=1`): used for the docs screenshots, never touches the PC. The tweak
  list comes from the real `config/tweaks.json`.
- `renderer/`: plain scripts on one `window.KB` object (`js/core.js` plus one file per screen). Sections: Dashboard, System
  analysis, Optimizations (the tweak catalog with search, category chips, risk badges and toggles, plus *CPU thermal tuning*, the
  step-by-step wizard), Cleanup, Restore, Apps (all OSes), Settings, Help. Advanced and risky tweaks ask for confirmation (risky: two, with a strong
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
task name for PowerShell and Node alike; `HWiNFO64.INI` enables shared-memory logging; `tweaks.json` is the tweak catalog.

## Tools (`tools/`)
`make-icons.js` renders every icon size from `app/renderer/icon.svg`; `make-shots.ps1` regenerates `docs/assets/*.png` from
demo mode.

## The site
`docs/` is a static site (no framework): `index.html` landing, `about-app.html` docs hub, secondary pages, an English root and a `pt-br/` mirror sharing `site.css` and `site.js`. `pages.yml` publishes the folder; `tools/check-site.js` (run in CI) checks links, anchors, language twins, hreflang and that the numbers still match the repository. The Download page reads the GitHub Releases API in the browser and falls back to plain links.
