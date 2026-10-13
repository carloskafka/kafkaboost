# Getting started

This walks through the first run on a Lenovo Legion 83DE (Intel Core i9-14900HX, Windows 11). Other laptops and CPUs are not
supported: the app and the scripts refuse to apply the tuning to them.

## 1. What you need
- Windows 11, administrator rights, the laptop **plugged in**.
- ThrottleStop (tested with 9.7.3). Nothing to download by hand: in the wizard's *Get ThrottleStop* step, tick the box and the app
  fetches it from <https://www.techpowerup.com/download/techpowerup-throttlestop/> (only after you agree). If you already have it, the
  zip in `Downloads` or an extracted copy in `Downloads`, `Desktop` or `Documents` is found and used in place.
- Optional: [Node.js](https://nodejs.org) 20+ to run the app from a clone (`npm install` runs once, from `app/`).
- Optional: HWiNFO64 (sensors only) to watch temperatures while you play.

## 2. Install
Pick one way; both call the same code (`scripts/lib/Tuning.ps1`).

| Way | How |
|---|---|
| One click | Double-click `install.cmd`, accept the administrator prompt, answer the VBS question. |
| The app | Double-click `KafkaBoost.lnk` (made by `scripts\Create-Shortcut.ps1`) or `KafkaBoost.cmd` in the repo root (both ask for administrator rights; Electron installs on first run, Node.js needed), then **Optimizations > CPU thermal tuning**, step 0 to 6. On macOS/Linux use `KafkaBoost.command` (untested). |

The steps: detect hardware, back up `ThrottleStop.ini`, get ThrottleStop, VBS choice, apply the tuning, always-on startup, verify.
**VBS:** the undervolt only works with virtualization-based security off, which breaks WSL2/Docker until you run
`scripts\maintenance\restore_vbs.ps1` and reboot. Reboot once after turning it off.

## 3. Check it
Open the app: **Dashboard** runs a read-only health check and should say *Your PC is optimized*. It also works without
administrator rights; only *Fix it* and the wizard need them.

Make a shortcut with the app icon:

```powershell
powershell -File scripts\Create-Shortcut.ps1        # Desktop + Start Menu, "run as administrator" set
```

## 3b. Keep it in the tray
Close the window: the app keeps running next to the clock and re-checks every 30 minutes (notification if something breaks).
Tick **Settings > Start with Windows** to have it start hidden at every logon. Theme (system, dark, light), language
(English, Português), notifications and the check interval are in **Settings** too.

## 3c. More optimizations, cleanup and updates
- **Optimizations** lists 30 tweaks (performance, GPU, gaming, network, privacy, appearance). Each shows what it changes and its
  risk. *Apply recommended* applies only the safe ones; *advanced* ones ask for confirmation; the two *risky* ones (Defender
  real-time protection, core isolation) need two confirmations and are never part of "recommended". Switching a tweak off restores
  the value it had before.
- **Cleanup** measures temp files, Prefetch, Windows Update downloads, the thumbnail cache and the Recycle Bin first, and deletes
  only what you tick. Emptying the Recycle Bin cannot be undone and asks twice.
- **Restore** shows your Windows restore points and can create one. The app makes one before your first tweak (Windows allows one per 24 hours).
- **Updates:** the app checks GitHub Releases (a lookup only) and shows a banner with the changelog when a newer version exists.
  Turn it off in Settings.
## 4. After a Windows update
Open **Dashboard** again. If it is amber or red, read the list (a Windows update can reset settings or switch VBS back on) and
press **Fix it**. VBS is only turned off again if you tick the box.

## 5. Watch the temperatures (optional)
1. Put `config\HWiNFO64.INI` next to `HWiNFO64.exe` (it sets `SensorsOnly=1` and `SensorsSM=1`) and start HWiNFO **without
   command-line arguments**.
2. `powershell -File scripts\monitoring\hwinfo_logger.ps1 -Minutes 20` writes `logs\hwinfo_log.csv` while you play.
3. Compare peak temperature, package power and throttle flags with `docs/RESULTS.md`.

## 6. Undo everything
*Roll everything back* in the app (restores the newest `ThrottleStop.ini.bak_*`, removes the startup task; tick the box to
re-enable VBS too), or run `scripts\maintenance\restore_vbs.ps1`.
