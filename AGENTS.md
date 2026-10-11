# AGENTS.md — CS2/Game Stutter Fix + ThrottleStop Undervolt (machine `83DE`)

Purpose of this file: give any other AI agent (Claude Code, Codex, Cursor, etc.) or a
human enough context to **continue this work without re-discovering it**. Read this top
to bottom first, then `CS2_STUTTER_PLAN.md`.

Last updated: 2026-10-10 (evening: boost caps + PL1/PL2 applied and verified in CS2).

---

## 0. TL;DR / current state

- **RESULT (2026-10-10 21:30):** CS2 is smooth; over a 19-min session (HWiNFO log
  `cs2_backup\hwinfo_log2.csv`) max temp 92 °C (was 99–100 °C), avg ~80 °C, package power
  max 82 W (was 139 W), 0 WHEA errors, thermal-throttle flags in only 6 samples (~12 s).
- **Current live tuning (all saved in ThrottleStop.ini, auto-started at logon):**
  P-core turbo groups **49x** (all 8, was 54/54/52/52/50/50/49/49), E-core **36x** (was 41x),
  **PL1 65 W / PL2 85 W** (profile 0), undervolt −100/−100/−90 mV unchanged.
- **Goal:** eliminate stutter in CS2 (and other games) on a Lenovo Legion `83DE`
  (i9-14900HX + RTX 4090 Laptop, Win11). Root cause ranked: **thermal throttling**
  (temps hit 100 °C). NOTE: Event 37 (firmware throttle) is NOT zero — ~16/day since Feb,
  96 on 2026-10-10 — so do not assume it is purely thermal PROCHOT.
  Then memory/commit pressure from the always-on VM/Docker/WSL, then DPC/ISR latency.
- **Stability warning:** WHEA Event 19 (corrected "Internal parity error", processor core,
  APIC 33) logged 2026-10-10 14:56 and 2026-09-26 → the −100 mV undervolt is near the limit.
  **Do not deepen it** (forum −135…−160 mV values are other chips; at −160 some crash in long
  tests). If event 19 returns, back off to −80/−80/−70 mV.
- **VBS/hypervisor is DISABLED** (required to unlock FIVR undervolting). This **breaks
  WSL2 / Docker-WSL2** until restored (`cs2_backup\restore_vbs.ps1`).
- **ThrottleStop 9.7.3 undervolt is LIVE:** CPU Core −100 mV, P-Cache −100 mV,
  E-Cache −90 mV, plus V/F Point 1 (800 MHz) +100 mV ("mV Boost"), `UseVFCore=1`.
- Undervolt is applied from `C:\Users\carlo\Downloads\ThrottleStop_9.7.3\ThrottleStop.ini`
  via the scheduled task `ThrottleStop_Autostart` (highest privileges).
- **Open items** (see §8): optional 47–48x P cap if the ~92 °C peaks matter; keep watching
  WHEA 19. PROCHOT offset = **3** (read from TPL window / ini `PROCHOT_Offset0=0x3`, i.e.
  ~97 °C) — not 7.
- **All automation scripts and backups live in `cs2_backup\`.**

### 0b. How the tuning is actually applied (lessons learned — read before editing)
- **ThrottleStop runs elevated**; a normal shell cannot send it window messages (UIPI).
  Drive it from an *elevated* PowerShell (UAC prompt). Scripts used live in the session
  scratchpad; pattern = enumerate child windows, locate controls by window-relative x,y, use
  `SendMessageTimeout` (plain `SendMessage` can hang), `WM_CHAR` for typing, `BM_CLICK` buttons.
- **Boost caps:** FIVR window → *Turbo Groups* (P-core groups; the "Performance Cores" radio
  switches to the single E-core group). Saved by ThrottleStop on **clean exit** (send
  `WM_CLOSE`; `SaveOnExit=2`) as `OneAD_EAX0/EDX0=0x31313131` (8×49x) and `Six50_EAX0=0x24` (36x).
  Previous: `OneAD_EAX0=0x34343636`, `OneAD_EDX0=0x31313232`, `Six50_EAX0=0x29`.
- **Power limits (TPL window):** the cause of "70/100 W not applying" was the **"Disable
  Controls" checkbox being checked**. Unchecked + PL1 65 / PL2 85 → saved as
  `PowerLimitEAX0=0x00DF8208` / `PowerLimitEDX0=0x004282A8` (profile 0). The old
  `POWERLIMITEAX/EDX` (70/100 W) keys are legacy and ignored. Other profiles (1–3) still
  hold 140/190 W. HWiNFO's "PL1/PL2 Static" rows keep showing 140/190 — they are not the
  live MSR; use the "Power Limit Exceeded" flags instead.
- **HWiNFO monitoring:** `HWiNFO64.INI` now has `SensorsOnly=1` and `SensorsSM=1` (shared
  memory); backup `HWiNFO64.INI.bak`. **Do NOT pass command-line args to HWiNFO64.exe (free
  version → error dialog).** Logger: `cs2_backup\hwinfo_logger.ps1` (reads
  `Global\HWiNFO_SENS_SM2`, 2 s samples → `hwinfo_log2.csv`, includes the extra "CPU Package"
  / "CPU IA Cores" sensors that read ~2–10 °C hotter than the DTS ones).
- HWMonitor Max columns are cumulative since it was opened; reopen it for fresh maxima.

> ⚠️ Placeholder tokens in this file: none. Paths are absolute and real.

---

## 1. Machine / environment

| Item | Value |
|---|---|
| Model | LENOVO 83DE (Legion Pro 5 16IRX9 class) |
| CPU | Intel Core i9-14900HX (8 P + 16 E, 24C/32T), TjMax 100 °C |
| GPU | NVIDIA RTX 4090 Laptop |
| RAM | 32 GB (32492 MB usable) |
| OS | Windows 11 Home, build 26300.9550 |
| BIOS | (Lenovo) NOCN/N2CN — microcode updated earlier |
| ThrottleStop | `C:\Users\carlo\Downloads\ThrottleStop_9.7.3\ThrottleStop.exe` |
| ThrottleStop.ini | `C:\Users\carlo\Downloads\ThrottleStop_9.7.3\ThrottleStop.ini` |
| LatencyMon | `C:\Program Files\LatencyMon\LatMon.exe` |
| HWiNFO64 | `C:\Users\carlo\Downloads\hwi_830\HWiNFO64.exe` |
| HWMonitor | installed (user's preferred temp reader) |

Lenovo specifics known so far:
- **Nahimic** service + Appx removed/disabled; **Razer Synapse 3** uninstalled;
  **NGENUITY** uninstalled (latency work).
- Page file forced to fixed 16384–32768 MB (was 2 GB dynamic).
- Startup entries disabled (Epic, FACEIT, Spotify, G-Menu, Ollama `.lnk`, Edge auto-launch,
  TightVNC `tvncontrol`, `Start WingMan Profiler`).
- **Edge background + startup boost disabled** (HKCU+HKLM `Policies\Microsoft\Edge`).
- **PROCHOT Offset:** verified = **3** on this unit (TPL window / `PROCHOT_Offset0=0x3`; main
  window shows PROCHOT 97 °C). Left unchanged — do not raise it to hide throttle flags.
- **Model name discrepancy:** `AGENTS.md`/LatencyMon say type 83DE ("Pro 5 16IRX9 class"),
  HWiNFO labels it "Legion Pro 7 16IRX9H". Confirm the exact MTM before model-specific assumptions.
- Lenovo power plan in use: "Legion Balance Mode"; Lenovo Vantage dynamic limits seen at
  PL1 80 W / PL2 119 W, static 140/190 W, PL4 246 W (before our TPL change).

---

## 2. FIVR voltage encoding (verified against this machine)

`ThrottleStop.ini` stores FIVR offsets as a 32-bit hex. The voltage offset lives in
bits [30:21] (an 11-bit two's-complement field), i.e. `value = (field & 0x7FF) << 21`.

**FIVR offset planes** (`FIVRVoltage{plane}{profile}`):
`field = 2048 − round(|mV| × 1.024)` (negative offsets), so:

| mV | hex | | mV | hex |
|---|---|---|---|---|
| 0 | `0x00000000` | | −90 | `0xF4800000` |
| −50 | `0xF9A00000` | | −100 | `0xF3400000` |
| −75 | `0xF6600000` | | −115 | `0xF1400000` |
| −125 | `0xF0000000` | | −140 | `0xEE000000` |

Python: `format((2048 - round(mv*1.024)) & 0x7FF << 21 ...` → see `replicate_undervolt.ps1`.

**Plane index** (first digit): `0`=CPU Core, `1`=Intel GPU, `2`=CPU P-Cache,
`3`=System Agent, `4`=Analog I/O / iGPU Unslice, `5`=CPU E-Cache.
**Profile index** (second digit): `0`..`3` (UI shows 1..4).
`UnlockVoltage{plane}{profile}=1` is the per-plane "unlock/variable" flag.

**V/F point offsets** (`UseVFCore`, `UseVFCache`, `VFPoint{pt}{profile}{0=core,1=cache}`):
`field = round(mV × 1.024)` (signed, NO 2048 base), `value = field << 21`.
So V/F Point 1 (800 MHz) @ **+100 mV** → `0x0CC00000`.

Notes:
- On this CPU **Core and P-Cache must move together** (CPU uses the higher/lower value);
  if Core < Cache the CPU ignores it and uses the lower for both.
- Intel GPU and System Agent are linked internally; if you touch one you must touch both.

---

## 3. Current ThrottleStop config (live, in ThrottleStop.ini)

Only these differ from stock / are set by us (profile index 0 = UI "Performance"):

```
FIVRVoltage00=0xF3400000   ; CPU Core   -100 mV
UnlockVoltage00=1
FIVRVoltage20=0xF3400000   ; P-Cache    -100 mV
UnlockVoltage20=1
FIVRVoltage50=0xF4800000   ; E-Cache     -90 mV
UnlockVoltage50=1
UseVFCore=1                ; "Use Core V/F Offsets"
UseVFCache=0
VFPoint110=0x0CC00000      ; V/F point 1 (800 MHz) core = +100 mV
IccMaxNew00=0x000007FF     ; Core current limit = max (511.75 A)
PowerLimitEAX0=0x00DF8208  ; ACTIVE PL1 = 65 W (bits[14:0] = W x 8) -- profile 0
PowerLimitEDX0=0x004282A8  ; ACTIVE PL2 = 85 W
OneAD_EAX0=0x31313131      ; P-core turbo groups 1-4 = 49x
OneAD_EDX0=0x31313131      ; P-core turbo groups 5-8 = 49x
Six50_EAX0=0x00000024      ; E-core turbo = 36x
PROCHOT_Offset0=0x3        ; read-only finding (97 C)
; legacy/ignored: POWERLIMITEAX=0x00DD8230 (70 W), POWERLIMITEDX=0x00428320 (100 W), LockPowerLimits=1
```
(The earlier 70/100 W snapshot never applied because TPL "Disable Controls" was checked.)

Other noteworthy current (mostly defaults): `Profile=0`,
`ProfileName1..4=Performance/Game/Internet/Battery`, `SaveOnExit=2`, `OffsetRange=1`,
`IccMaxNew20..=0x7FF (511.75 A, max)`,
`CacheMinMax0=0x832 (min 8 / max 50)`, `NonTurboRatio=0x15 (21)`,
`SSTEPP=0`, `EnPerfPref0..3=128`, `POWERLIMITEAX`/`POWERLIMITEDX` + `LockPowerLimits` set
(see TPL block), `PP0`/`MMIO` lock keys absent, no PROCHOT-offset key present.

---

## 3b. Community recommendation vs our config (gap analysis)

Sources: TechPowerUp (unclewebb) "Undervolting i9-14900HX", "Throttlestop Settings Guide
for 13th/14th Gen Intel", "Legion 5 16IRX9 i9-14900hx undervolt"; Intel Community
(14900hx E-cores); Lenovo Gaming "Undervolting show and tell part 2"; MSI forum.

| Setting | Community rec (14900HX) | Ours | Status |
|---|---|---|---|
| CPU Core offset | start −100, push −125/−150 | −100 | ✅ start matched (deeper pending) |
| P-Cache offset | = Core (−100) | −100 | ✅ |
| E-Cache offset | ~−90 | −90 | ✅ |
| Core vs Cache rule | must be equal | equal | ✅ |
| V/F Point 1 @800 (mV Boost) | 100, ≥**115** before raising P-cache | 100 | ⚠️ bump to 115 when pushing |
| Intel GPU / System Agent | leave at **0** (linked; undervolt hurts stability) | 0 | ✅ |
| **IccMax (core+cache)** | set to **max** (255.75/511.75) for stability | **max** (core + cache) | ✅ |
| **Turbo ratio / boost cap** | cap P (4.0–5.4 G), E (2.4–3.6 G) to cut heat | not set | ❌ **GAP** (main heat lever) |
| **PL1 / PL2 (TPL + MMIO Lock)** | e.g. PL1 70 / PL2 100 W, MMIO Lock on | **70/100 W + `LockPowerLimits=1`** (no MMIO lock) | ✅ PL set; MMIO lock absent |
| PROCHOT Offset | Lenovo=7 (93 °C); 0 → 100 °C | unverified | ⚠️ verify |
| Speed Shift EPP | 0 performance / 84 balanced | 128 | ➖ optional |
| Cache Ratio | some cap to 35–42 | 8–50 default | ➖ optional |

**Conclusion: closer, but NOT a 100% match.** The *voltage* part matches the mainstream
recommendation, **IccMax is now max**, and **PL1/PL2 = 70/100 W** with
`LockPowerLimits=1` (MMIO lock not available). Still missing: the **turbo-ratio (boost)
cap** (the main remaining heat lever) and deeper voltage (−125/−150).

Notable community data points:
- Legion 7i Pro 14900HX: −137 core & P-cache + P boost 5.4 G (2 cores)/4.7 G + E boost cap
  → 85–92 °C, no throttle.
- Lenovo Gaming tuned: V/F core −200, P-cache −90..−140, E-cache −90, SA −40, iGPU −40,
  P 4 G / E 3 G, cache ratio 35.
- Intel Community: E-cores thermal-throttle first; capping P/E boost is what fixes it.
- MSI: −80 mV is a safe daily value; **lowering boost clocks lets you go lower on volts**.
- 14900HX Vmin-shift/degradation warning: do **not** chase huge offsets; validate and keep
  a stability margin.

---

## 4. Full `ThrottleStop.ini` key reference (what exists and what it means)

Grouped. Keys we set/non-default are **bold**.

**Identity / profiles**
- `StartFailed` (0/1 sanity flag), `Profile` (active profile 0-3),
  `ProfileName1..4`, `LogFileDirectory`, `FileName` (path echo).
- `DTSAlarm`, `GPUAlarm`, `LowBattPercent`, `DTSButton` — alarm toggles.

**Options bitsets** — `Options1..4=0x…` (per profile; bitmask of Options-window checkboxes:
Start Minimized, Minimize on Close, Grid Lines, PROCHOT Offset, BD PROCHOT, etc.).
`EIST`, `DutyCycle1..4=16`, `TimePeriodAC`, `PSMinimum`.
UI cosmetics: `ColorXX`, `*Color`, `MainIcon`, `CPUIcon`, `*Icon`, `GridLines`,
`BlackIcon`, `LogoMin`, `TaskBar`, `NoTitleBar`, `DTSButton`, `ColorIndex`, `HotKey0..4`.

Boot/behaviour: `StartFailed`, `SaveOnExit=2`, `DisableSafeStart`, `WDBoost` (Defender
boost), `SleepZeroVoltage`, `DefaultCache`.

**Startup / misc:** `Options1..4`, `EnPerfPref0..3` (Speed Shift EPP per profile),
`SSTEPP` (EPP enable), `PSMinimum`.

**Legacy/old-CPU (usually inert on 14th gen):** `Payload1..4`, `EIST`, `NewCStateLimit`,
`HaswellOverclock`, `OneAD_*`, `OneAE_*`, `Six50_*`, `Six51_*`, `DTSButton`, `ZeroChipset`.

**Ratios:** `NonTurboRatio1..4` (+ `NonTurboRatioLock1..4`) = base/non-turbo ratio;
turbo ratio limits are the `TurboRatio*` group (unlocked only if BIOS allows);
`CacheMinMax*` = cache ratio min/max.

**FIVR voltages:** `FIVRVoltage{plane}{profile}` + `UnlockVoltage{plane}{profile}` (see §2).

**FIVR current limits:** `IccMaxNew{plane}{profile}` = Amps × 4 (so `0x7FF` = 511.75 A max;
`0x35C` = 215 A). Community: set core + cache to max.

**FIVR misc undervolt flags:** `TVBoost`, `RingDownBin`, `VMaxStress` (all `0xF` = off here);
`AVXOffset`, `AVX512Offset` (0 = none); `OffsetRange`, `VCCOffsetRange`.

**V/F tuning (9.7+, HX/K only):** `UseVFCore`, `UseVFCache`,
`VFPoint{point}{profile}{0|1}` (see §2).

**Power limits (TPL):** `POWERLIMITEAX`, `POWERLIMITEDX` (MSR PL1/PL2), `PP0`, `PowerLimit3/4`,
`LockPowerLimits`, `MMIO` lock, etc. **Our ini now has `POWERLIMITEAX`/`POWERLIMITEDX`
(PL1 70 / PL2 100 W) and `LockPowerLimits=1`; the separate `PP0`/`MMIO` lock keys are
absent** (this platform/driver exposes no MMIO lock).

> ThrottleStop has no official ini documentation; this mapping was derived from the file
> itself, the linux-intel-undervolt reverse engineering notes, and unclewebb's forum posts.

---

## 5. Directory contents — `C:\Users\carlo\Downloads\test`

| File | What it is |
|---|---|
| `AGENTS.md` | **this file** — context handoff for other agents |
| `CS2_STUTTER_PLAN.md` | the master remediation plan + execution log |
| `latencymon_report.txt` | LatencyMon baseline (pre-hypervisor) |
| `latency_report2.tx` | LatencyMon run #2 (idle, "suitable") |
| `latency_report3.txt` | identical snapshot to #2 (no new session) |
| `report4.txt` | **in-game** LatencyMon: "trouble handling real-time audio", 3602 µs ISR |
| `report5.txt` | LatencyMon run #5 — **byte-identical to report4** (same MD5; no new session) |
| `report6.txt` | LatencyMon run #6 — **byte-identical to report4/report5** (no new session) |
| `report7.txt` | identical to report4 (same MD5) |
| `report8.txt` | newest distinct LatencyMon capture: int→process 6432 µs, ISR 705 µs (Wdf01000), DPC 1583 µs (nvlddmkm top total) — worse than report4; latency is secondary |
| `CS2_STUTTER_FIX_PLAN.md` | cautious review plan (WHEA triage first, one change at a time) |
| `HWMonitor.txt`, `hwinfo*.png`, `FIVR.png`, `throttlestop_menu.png`, `hwmonitor_after_cs2_gameplay.png` | pre-tuning evidence (max 99–100 °C, 139 W, 5.39 GHz); FIVR.png shows the Turbo Groups UI |
| `cs2_backup\hwinfo_log.csv`, `hwinfo_log2.csv` | post-tuning HWiNFO logs (log2 adds extra temp sensors; PL change at 21:11) |
| `cs2_backup\ThrottleStop.ini.pre_turbo_20261010` | INI snapshot before boost caps / PL change |

### `cs2_backup\` — scripts & backups

**Undervolt / ThrottleStop automation**
- `replicate_undervolt.ps1` — **portable replicator**: writes the FIVR/V-F keys into any
  `ThrottleStop.ini` (auto-detect, backup, verify). Params: `-CoreMV -PCacheMV -ECacheMV
  -VFPoint1MV -ThrottleStopDir -StopProcess -Launch -WhatIfOnly`.
- `ThrottleStop_replication.ini` — the copy-paste 9-line snippet + encoding notes.
- `set_vfpoint.ps1` / `set_vfpoint2.ps1` / `set_vfpoint_admin.ps1` — early V/F-point setters
  (`WM_SETTEXT`/SendKeys). *Learn: the mV field ignores `WM_SETTEXT` until the dialog is
  touched; the value also auto-checks "Use Core V/F Offsets". Prefer the ini route.*
- `vf_attempt.ps1`, `vf_final.ps1` — V/F Point dialog drivers (find edit at window-relative
  `304,91`, Apply/OK buttons). Logs: `vf_*_log.txt`.
- `set_vfpoint.ps1`, `read_vfpoint.ps1`, `read_vf_state.ps1`, `dump_vfpoint.ps1`,
  `open_vfpoint.ps1` — open/dump/read the "V/F Point Offset Tuner" dialog via Win32.
- `openfivr.ps1`, `findfivr.ps1`, `enum_fivr.ps1`, `enum_ts.ps1`, `childenum.ps1`,
  `dump_children.ps1`, `open_and_dump.ps1`, `read_list.ps1`, `read_edits.ps1` — FIVR window
  discovery/enumeration.
- `read_monitor.ps1`, `read_mon2.ps1`, `read_mon3.ps1`, `read_offset.ps1`,
  `switch_planes.ps1` — read the FIVR monitor/offset values and switch planes.
- `capture_fivr.ps1`, `capture_ocr_coords.ps1`, `ocr_fivr.ps1`, `ocr_fivr_words.ps1` —
  screen-capture + OCR (model can't view images directly).
- `uia_probe.ps1`, `uia_fivr.ps1`, `uia_fivr2.ps1`, `uia_dump_fivr.ps1` — UI Automation probes.
- `apply_admin.ps1`, `apply_admin2.ps1`, `test2.ps1`, `test_pos_offset.ps1`, `ptest3..5.ps1`,
  `pt6.ps1`, `pt4_log.txt`, `pt5_log.txt`, `pt6_log.txt`, `apply_admin*_log.txt` — early
  experiments writing FIVR values (pre-encoding knowledge).

**V/F session (this run):** `set_vfpoint.ps1`, `set_vfpoint2.ps1`, `set_vfpoint_admin.ps1`,
`vf_attempt.ps1`, `vf_final.ps1`, `read_vf_state.ps1`, `read_vfpoint.ps1`, `dump_vfpoint.ps1`,
`open_vfpoint.ps1`, and logs `vfpoint_admin_log.txt`, `vf_attempt_log.txt`, `vf_final_log.txt`.

**Monitoring**
- `perf_logger.ps1` — logs CPU real freq, %perf, %max-freq, idle, avail MB, commit MB to CSV
  (pt-BR counters; script needs UTF-8 **BOM**). Run e.g. `-Minutes 120`.
- `perf_log.csv` — current/last capture; `perf_log_idle.csv` — archived idle baseline.
- `check_after_reboot.ps1` — post-reboot verifier: re-opens the ThrottleStop FIVR window,
  OCRs the monitor Offset column, and checks page file / services / task / VBS state.
- `debug_counters.ps1` — list available perf counters.

**Config snapshots / backups**
- `ThrottleStop.ini.bak` — original (aggressive: ≈ −140 core / −115 P-cache).
- `ThrottleStop.ini.bak_minus50` — after −50 step. `ThrottleStop.ini.bak_minus75` — after −75.
- `ThrottleStop.ini.pre_tpl` — snapshot taken immediately **before** the PL1/PL2 (TPL) edit.
- `ThrottleStop_replication.ini` — portable 9-line snippet (§3).
- `bcd_before.txt` — BCD (hypervisor) snapshot. `restore_vbs.ps1` — re-enable
  VBS/VMP/hypervisor for WSL2/Docker. *(An earlier revision was **buggy**; **fixed**
  2026-10-10.)*
- `HKCU_Run.reg`, `HKLM_Run.reg`, `Ollama.lnk` — autostart backups.
- `reg_deviceguard_before.txt`, `reg_lsa_before.txt` — registry snapshots. `edge_policy_backup.reg`.

**Screenshots (OCR artifacts):** `fivr*.png`, `mon*_1.png`, `check_mon.png`, `pos_*.png`.

---

## 5b. Useful commands

```powershell
# Preview the undervolt that would be written (no changes):
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\carlo\Downloads\test\cs2_backup\replicate_undervolt.ps1" -WhatIfOnly

# Apply to this machine (stop TS first) and relaunch:
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\carlo\Downloads\test\cs2_backup\replicate_undervolt.ps1" -StopProcess -Launch

# Read the live ThrottleStop values:
Select-String "C:\Users\carlo\Downloads\ThrottleStop_9.7.3\ThrottleStop.ini" -Pattern 'FIVRVoltage|UnlockVoltage|UseVF|VFPoint110|IccMaxNew00|IccMaxNew20|POWERLIMIT|LockPowerLimits'

# Start perf logging for 2 hours:
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\carlo\Downloads\test\cs2_backup\perf_logger.ps1" -Minutes 120

# Restore VBS (re-enables WSL2/Docker, disables undervolt capability):
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\carlo\Downloads\test\cs2_backup\restore_vbs.ps1"
```

**Editing `ThrottleStop.ini` safely:** kill ThrottleStop first (`Stop-Process -Name
ThrottleStop -Force`) — `SaveOnExit=2` otherwise rewrites the file on a clean exit. Then
edit, then start `ThrottleStop.exe` (the scheduled task also restarts it at logon).

---

## 6. What was done, in order (2026-10-10)

1. **Diagnosis:** stutter is cross-game, worsens with session length; temps to 100 °C;
   Event 37 firmware-throttle present but **0 during the thermal dips** → thermal PROCHOT.
2. **Plan** written to `CS2_STUTTER_PLAN.md`.
3. **Latency/startup cleanup:** Nahimic removed, Razer Synapse 3 + NGENUITY uninstalled,
   page file fixed 16–32 GB, startup entries pruned, Edge background/startup disabled.
4. **VBS/hypervisor disabled** (BCD `hypervisorlaunchtype off` + VMP/Core-Isolation) so
   FIVR voltage writes work. Verified `HypervisorPresent=False`.
5. **Undervolt via ini + restart:** stepped −50 → −75 → **−100 core / −100 P-cache /
   −90 E-cache**; each verified in the FIVR monitor (reads −0.0998/−0.0998/−0.0898).
6. **"mV Boost" = V/F Point 1 @ 800 MHz** discovered; +100 set via the dialog. Found the
   checkbox `UseVFCore` had to be 1; fixed in the ini (`UseVFCore=1`, `VFPoint110=0x0CC00000`).
7. **Portability:** created `replicate_undervolt.ps1` + `ThrottleStop_replication.ini`
   (tested end-to-end on a throwaway copy).
8. **This analysis:** full ini key reference + community gap analysis (§§2–4).
9. **IccMax → max** (Core `IccMaxNew00=0x7FF`, matching the cache), then **TPL edit**:
   `POWERLIMITEAX`/`POWERLIMITEDX` = **PL1 70 W / PL2 100 W** with `LockPowerLimits=1`
   (MMIO lock unavailable). Pre-edit snapshot saved to `ThrottleStop.ini.pre_tpl`.
10. **Post-reboot verification + tooling:** `check_after_reboot.ps1` (page file / services /
    task / VBS / undervolt), `perf_logger.ps1` CSV logging, LatencyMon runs (reports 4/5/6
    byte-identical → no new session captured), and `restore_vbs.ps1` fixed (earlier revision
    was buggy). PROCHOT offset still unverified; turbo-ratio cap still pending.

---

## 7. Open risks / constraints (respect these)

- **VBS stays off** until the user wants WSL2/Docker → run `restore_vbs.ps1` (+ reboot).
  Undervolt stops working once VBS is back on.
- User will **not** disassemble/repaste and will **not** cap the VM RAM; laptop is
  **plugged in** while gaming.
- 13th/14th-gen **Vmin-shift / degradation** caution: change offsets in small steps,
  validate (game + Cinebench + WHEA check), keep a stability margin. Prefer capping
  boost clocks over chasing extreme negative offsets.
- The model **cannot view images**; use the OCR scripts.

---

## 8. Status update (2026-10-10 evening) — supersedes the list below where they conflict

Done since the list below was written: turbo-ratio caps (P 49x / E 36x), PL1/PL2 = 65/85 W
(real fix: uncheck TPL "Disable Controls"), PROCHOT offset read (=3), HWiNFO shared-memory
logging, verified in CS2 (max 92 °C, smooth). Remaining optional: P cap 47–48x if the
~92 °C peaks matter (small CS2 FPS cost expected); keep monitoring WHEA 19; do not go
deeper than −100 mV. Not yet validated across a real reboot (task is enabled, logon trigger,
highest privileges, no battery restriction).

## 8b. Original suggested next steps (historical)

1. ✅ **DONE — IccMax → max** on Core (`IccMaxNew00=0x7FF`) to match unclewebb's stability rec.
2. ⚠️ **PARTIAL — Boost / power tuning** (biggest remaining heat lever): PL1/PL2 now set to
   **70/100 W** with `LockPowerLimits=1` (MMIO lock unavailable); the **turbo-ratio (boost)
   cap still pending** — consider capping turbo ratios (P ≈ 4.8–5.4 G, E ≈ 3.6 G), then
   re-measure temps.
3. **Verify PROCHOT Offset** in Options (Lenovo often 7 → 93 °C). Decide whether to leave
   (cooler) or raise toward 100 °C (fewer throttle events, hotter).
4. **Push voltage** toward −125 core/P-cache **only** after IccMax + boost caps are in and
   gaming is proven stable; bump mV Boost to **≥115** first.
5. **Validate:** LatencyMon report + `perf_log.csv` (freq dips / Event 37) before vs after;
   watch for WHEA-errors and silent app crashes.
6. Update `CS2_STUTTER_PLAN.md` execution log when each item lands.

---

## 9. Glossary

- **FIVR** — Fully Integrated Voltage Regulator (per-plane CPU voltage offsets).
- **mV Boost / V/F Point @ 800 MHz** — raises voltage at the lowest V/F point to keep idle/
  low-load undervolts stable (ThrottleStop 9.7 "V/F Point Offset Tuner", point 1 = 800 MHz).
- **DPC / ISR** — Deferred Procedure Call / Interrupt Service Routine latency (driver
  responsiveness); high values cause audio/game stutter.
- **PROCHOT** — processor-hot signal; triggers thermal throttling. PROCHOT *offset* lowers
  the effective throttle temperature (offset 7 → 93 °C on many Lenovo laptops).
- **PL1 / PL2** — long / short turbo power limits (TPL window).
- **EPP** — Energy Performance Preference (Speed Shift); 0 = max performance, 255 = min.
- **Thermal PROCHOT vs Event 37** — Event 37 = firmware power-limit throttle; thermal
 throttle may not raise Event 37, so watch temps/avg-frequency directly.

### Update 21:34 — P-core cap lowered to 47x (user-approved, to trim ~92 °C peaks)
P-core turbo groups now **47x** (`OneAD_EAX0/EDX0=0x2F2F2F2F`); E-core 36x, PL1/PL2 65/85 W, undervolt unchanged.
Snapshot before this change: `cs2_backup\ThrottleStop.ini.pre_p47_20261010` (revert = 49x). Needs a matched CS2
session to compare peak temp and 1% lows against the 49x run (max 92 °C, avg ≈80 °C).
- [x] **47x result (19-min CS2 session, 21:35–21:54):** max 90 °C (49x run: 92), avg ≈79 °C, package power max 73 W,
      P clock ≤ 4.69 GHz, **0 thermal-throttle samples**, 0 WHEA, temps flat across the session. Keep 47x unless
      the user reports FPS/smoothness loss (revert: `cs2_backup\ThrottleStop.ini.pre_p47_20261010`).

### Reproducible install + always-running (2026-10-10, 22:00)
- Repo layout: `install.cmd` → `scripts\Install-Tuning.ps1` (unpack ThrottleStop zip, optional VBS off, merge
  `config\ThrottleStop.settings.ini`, register task, start). See `README.md`. `cs2_backup\` stays local-only (gitignored).
- Task `ThrottleStop_Autostart` now = logon trigger **+ 5-min repetition** with action
  `powershell -Command "if not running → Start-Process ThrottleStop.exe"` (highest privileges, no time/battery limits,
  `MultipleInstances=IgnoreNew`). Exiting ThrottleStop from the tray → back within 5 min; verified no duplicate instance.
- **Pitfall found:** an earlier installer draft stopped *every* `ThrottleStop.exe` (it killed the live instance for ~1–2 min).
  Fixed to stop only the copy whose `Path` equals the install dir's exe.
- Installer tested: zip → fresh INI (17 keys), merge onto the old aggressive INI (17 keys identical to live, no duplicates),
  task registration. Not tested on a fresh Windows install.
