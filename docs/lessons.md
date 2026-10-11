# Lessons learned and constraints

Read this before changing anything.

## Constraints (from the user)
- **VBS/hypervisor stays off** while the undervolt is wanted. FIVR writes are locked otherwise. This breaks WSL2 and
  Docker (WSL2) until `scripts/maintenance/restore_vbs.ps1` is run and the PC rebooted; the undervolt then stops working.
- No disassembly or repaste, no capping the VM's RAM. The laptop is plugged in while gaming.
- 13th/14th-gen Vmin-shift / degradation: change offsets in small steps, validate with a game, a CPU benchmark and a
  WHEA check, and keep a margin. Prefer capping boost clocks over chasing negative offsets.

## Stability finding
- WHEA event 19 (corrected "Internal parity error", processor core, APIC 33) was logged on 2026-09-26 and
  2026-10-10 14:56. That is a warning that -100 mV is near this chip's limit. **Do not deepen the undervolt.** If it
  returns, go to -80/-80/-70 mV. Forum values of -135..-160 mV belong to other chips.
- Event 37 (firmware throttle) is **not** zero: about 16/day since February, 96 on 2026-10-10. Do not assume the
  throttling was purely thermal PROCHOT.

## How to drive ThrottleStop
- **ThrottleStop runs elevated.** A normal process cannot send it window messages (UIPI), so automation needs an
  elevated PowerShell (UAC prompt). Pattern: enumerate child windows, locate controls by window-relative x,y, use
  `SendMessageTimeout` (a plain `SendMessage` can hang), `WM_CHAR` to type, `BM_CLICK` to press buttons. The model cannot
  view images directly; a window screenshot written by the app itself is the safe way to check a UI.
- **Boost caps** live in FIVR -> *Turbo Groups*. The "Performance Cores" radio switches to the single E-core group.
- **Saving:** ThrottleStop writes ratios and limits on a **clean exit** (send `WM_CLOSE`; `SaveOnExit=2`). Edit the INI by
  hand only with ThrottleStop *stopped*, otherwise the exit rewrites your edit.
- **Power limits:** the cause of "70/100 W never applies" was the **"Disable Controls"** checkbox in the TPL window
  (`NoSetPL`). Unchecked + PL1 65 / PL2 85 works. HWiNFO's "PL1/PL2 (Static)" rows keep showing 140/190 W because they are
  not the live MSR; use the "Power Limit Exceeded" flags to see enforcement.
- Keep ThrottleStop running: the scheduled task `ThrottleStop_Autostart` runs at logon plus a 5-minute watchdog and never
  starts a second copy.

## Installer pitfalls
- An early draft stopped **every** `ThrottleStop.exe` and killed the live instance for 1-2 minutes. The library now stops only
  the copy whose `Path` equals the install dir's exe (`Merge-ThrottleStopSettings`).
- `$PSScriptRoot` in a `param()` default is empty in Windows PowerShell 5.1 without `[CmdletBinding()]`; resolve it in the
  script body instead (see `Steps.ps1`).
- `perf_logger.ps1` needs a UTF-8 **BOM** and pt-BR performance-counter names.

## HWiNFO and monitoring
- Never start `HWiNFO64.exe` with command-line arguments: the free version shows an error dialog.
- Shared-memory logging needs `SensorsSM=1` in `HWiNFO64.INI` (`config/HWiNFO64.INI`). The extra "CPU Package" and
  "CPU IA Cores" sensors read about 2-10 C hotter than the DTS ones and caught the 100 C spikes.
- HWMonitor's Max column is cumulative since it was opened; reopen it for fresh maxima.

## Other findings
- The HWiNFO label ("Legion Pro 7 16IRX9H") and the original notes ("Legion Pro 5 16IRX9 class", type 83DE) disagree.
  Confirm the exact MTM before assuming model-specific limits.
- Lenovo's own limits (Legion Balance Mode) were PL1 80 W / PL2 119 W dynamic, 140/190 W static, PL4 246 W.
- LatencyMon is secondary: the newest distinct report shows interrupt-to-process 6432 us, ISR 705 us (Wdf01000), DPC 1583 us;
  several saved reports were byte-identical copies, so check hashes before trusting "new" captures.
