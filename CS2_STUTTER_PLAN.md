# CS2 / Multi-Game Stutter Diagnosis & Remediation Plan

Status: **EXECUTING — Phase 1/2 applied + late-session thermal work done 2026-10-10. See
"Late-session work (post-reboot)" at the bottom.**
Date: 2026-10-10
Machine: LENOVO 83DE (Legion, i9-14900HX + RTX 4090 Laptop), Windows 11 Home 26300.9550

Legend: `[APPROVED]` = you said do it · `[DONE]` = already handled by you ·
`[SKIP]` = deliberately not doing · `[PENDING]` = needs decision · `[TODO]` = my task

---

## 0. Updated findings (from your answers)

Your answers materially change the diagnosis:

- **Not CS2-specific** — it happens in *other games after long use* too ⇒ system-level
  issue (thermal / power / memory), not a CS2 config problem.
- **Always plugged in** while gaming (rules out battery/AC power-plan switching).
- **VM / Docker / WSL must stay running** ⇒ we cannot free the ~14 GB+ they consume;
  mitigation must be page file + memory hygiene, not closing them.
- **Temps spike to 90–91 °C in HWMonitor** during CS2 and drift up with play time.
- **Performance mode = loud fans + very hot**; you revert to Balanced.
- **HAGS**: off ⇒ temps fluctuating/spiky; on ⇒ stable temps but 90 °C in CS2.
- Already **updated NVIDIA driver**, already **ran DDU**, **IPDT passed**, Game Mode/Xbox
  Game Bar off, CS2 high-priority already tried (didn't help).

### Revised root-cause ranking
1. **THERMAL / power-limit throttling (primary).** Cross-game, worsens with session
   length, 90–91 °C, Event ID 37 firmware throttle x176. This is now the top cause.
2. **Memory/commit pressure** from the always-on VM + Docker + WSL, with only a
   **2 GB page file** → trimming/paging hitches during long sessions.
3. **DPC/ISR latency** from Nahimic APO + Razer Synapse + NGENUITY (to be removed).
4. Windows build 26300 (secondary).

---

## 1. Baseline measurement — do FIRST (you have the tools) `[TODO]`

Capture a "before" baseline so we can prove each change.

- [ ] 1.1 **LatencyMon**: run ~10 min idle + ~10 min with CS2 open; save the report
      (Highest DPC/ISR, drivers list). Target later: DPC/ISR < ~250 µs.
- [ ] 1.2 **HWiNFO64**: enable logging (CSV) of CPU Package Temp, per-core clocks,
      "CPU Throttling", "Thermal Throttling", CPU Package Power, during a 15-min CS2 run.
- [ ] 1.3 Note the minute-mark where stutter starts vs. temp/clock at that moment.
- [ ] 1.4 Record CS2 1% / 0.1% lows (CapFrameX or `cl_showfps`) for a fixed route.

---

## 2. Phase 1 — Approved quick wins `[APPROVED]`

- [x] 2.1 **Page file → fixed 16–32 GB on C:** (was system-managed, only 2 GB).
- [x] 2.2 **Disable autostart** (leave installed, just stop at boot):
      Ollama, Epic Games Launcher, FACEIT, Spotify, Edge auto-launch,
      TightVNC, G-Menu, Logitech Gaming Software, NGENUITY.
      *(Note: NGENUITY also scheduled for uninstall in Phase 2 — pick one.)*
- [ ] 2.3 Keep Lenovo **Balanced** plan for now (see Phase 3 — we test Performance
      *with* temperature monitoring rather than blindly switching).
- [x] 2.4 ~~NVIDIA App settings~~ — keep as is. `[SKIP]`
- [x] 2.5 ~~Update NVIDIA driver~~ — already done. `[DONE]`
- [x] 2.6 ~~Game Mode / high priority~~ — already tried / off. `[SKIP]`

## 3. Phase 2 — Approved latency fixes `[APPROVED]`

- [x] 3.1 **Uninstall Nahimic** (service + APO + notifier). Biggest DPC/audio-latency
      suspect. Reboot after.
- [x] 3.2 **Uninstall Razer Synapse 3** (Service, Central, Game Manager).
      Keep only if you need macros → otherwise remove; mouse still works as HID.
- [x] 3.3 **Uninstall NGENUITY** (HyperX) — it also crashed earlier (.NET error).
- [x] 3.4 Re-run **LatencyMon** after 3.1–3.3 and compare to §1.1.

## 4. Phase 3 — Thermal control (SOFTWARE-ONLY; highest priority) `[IN PROGRESS]`

Constraint: **no opening the laptop (no repaste/fan cleaning) and no capping the VM RAM.**
So we manage heat in software and lower the thermal load. Temps hit 90–91 °C and drift
with session length across all games — that is throttling territory on a 14900HX.

- [ ] 4.1 **Cap max processor state** with a power plan: create a Custom/"Gaming" plan,
      set **Maximum processor state = 90–95%** (and Processor performance boost mode =
      Efficient Enabled). This trims the hottest turbo bins → lower, *more consistent*
      clocks → less throttle-based stutter. Fully reversible; test 95% then 90%.
- [x] 4.2 **Undervolt via software** (biggest heat win if the chip allows it):
      **ThrottleStop 9.7.3** — final **−100 mV Core / −100 mV P-Cache / −90 mV E-Cache**,
      validated at each step (−50 → −75 → −100). Watch for WHEA/instability; back off if
      unstable.
- [x] 4.3 **Power-limit (PL1/PL2) tune via ThrottleStop**: set **PL1 = 70 W / PL2 = 100 W**
      with **LockPowerLimits** to trade a little peak for stable sustained clocks (MMIO lock
      not exposed on this platform).
- [ ] 4.4 **Legion Vantage — keep Balanced** (your preference) and instead test its
      **Custom fan profile** only for fan response, not power mode. If it just gets
      loud without lowering temps, drop it.
- [ ] 4.5 **Reposition only** (no disassembly): ensure rear/side vents are unobstructed,
      raise the back of the laptop (stand/book), use a **cooling pad/external fan** if you
      have one, and keep the lid-open screen out of the exhaust path. Can shave several °C.
- [ ] 4.6 **HAGS**: keep **enabled** (your testing showed stability); revisit only if
      DPC latency remains high after Nahimic removal.
- [ ] 4.7 Log whether 90 °C is CPU-package only or GPU too (HWiNFO64) — tells us if the
      whole loop is saturated or just the CPU.

## 5. Phase 4 — Verification `[TODO]`

Re-run §1 baseline after each phase:
- LatencyMon DPC/ISR before vs after.
- HWiNFO64 CSV: max temp and throttle-flag time during CS2 before vs after.
- Event Viewer → System → **Kernel-Processor-Power ID 37** count per session.
- CS2/game 1% / 0.1% lows before vs after.

## 6. Already handled (no action) `[DONE]`
- NVIDIA driver updated · DDU clean reinstall done · IPDT passed (no CPU fault found).
- Fast Startup disabled · disks healthy · no BSODs/minidumps.

## 7. Open questions / risks
1. ~~Repaste / fan cleaning~~ — **ruled out** (no disassembly). Cooling handled in software.
2. Wiping Nahimic may change audio (no more "Nahimic effects"); confirm OK.
3. Removing Razer Synapse loses per-app macros/lighting sync — confirm OK.
4. ~~Cap VM RAM~~ — **ruled out** (VM/Docker/WSL must keep full resources). We instead
   rely on the larger page file (§2.1) to absorb commit pressure.
5. **ThrottleStop / undervolt**: install + tune is a separate, slightly more involved
   step — confirm you're OK installing ThrottleStop (or Intel XTU) so I can guide it.
   Risk is low if validated step-by-step; fully reversible by closing the tool.

---

## Proposed execution order (once you approve)
1. §1 baseline capture (LatencyMon + HWiNFO64 CSV during a CS2 run).
2. §2 page file + startup cleanup.
3. §3 uninstall Nahimic → reboot → LatencyMon → uninstall Razer/NGENUITY → LatencyMon.
4. §4 software thermal control (max-processor-state cap → then ThrottleStop undervolt/PL
   tune if you approve) + repositioning.
5. §5 re-measure and report deltas vs §1.

**Reply "go" to start at step 1, or tell me which phases to run/reorder.**

---

## Execution log — 2026-10-10

Backups: `C:\Users\carlo\Downloads\test\cs2_backup\` (HKCU_Run.reg, HKLM_Run.reg, Ollama.lnk).

### Done (verified)
- [x] **Page file** → fixed **initial 16384 MB / max 32768 MB** on C:
      (`AutomaticManagedPagefile=False`; registry `PagingFiles = C:\pagefile.sys 16384 32768`).
      **Takes effect after reboot.**
- [x] **Startup disabled (user):** EpicGamesLauncher, FACEIT, Spotify, G-Menu, NGENUITY,
      MicrosoftEdgeAutoLaunch (HKCU Run), Ollama (Startup folder .lnk).
- [x] **Startup disabled (system):** `tvncontrol`, `Start WingMan Profiler` (HKLM Run).
- [x] **TightVNC** service `tvnserver` → Stopped + **Disabled**.
- [x] **Nahimic** → service `NahimicService` Stopped + **Disabled**; Appx
      `A-Volute.Nahimic` **removed**. (Driver/APO files left in DriverStore — inert without
      the service; reversible by reinstalling from the Store.)
- [x] **NGENUITY** → uninstalled (quiet, user-level).
- [ ] **Razer Synapse 3** → official uninstaller launched; **complete the wizard**.

### Still to do
1. **Turbo-ratio (boost) cap** — the main remaining heat lever: cap P (≈ 4.8–5.4 G) /
   E (≈ 3.6 G) ratios, then re-measure temps. *(Not yet done.)*
2. **Verify PROCHOT Offset** in ThrottleStop → Options (Lenovo often 7 → 93 °C).
   *(Still unverified.)*
3. **Push voltage** toward −125 Core/P-Cache only after the boost caps land and gaming is
   proven stable; bump mV Boost to **≥115** first.
4. **Validate:** LatencyMon + `perf_log.csv` (freq dips / Event 37) after the boost cap;
   watch for WHEA errors and silent app crashes.

### Pre-reboot thermal setup (done 06:21)
- [x] **Razer Synapse 3** uninstalled (wizard completed) — no services/processes/entries left.
- [x] Leftover folders removed: `Program Files (x86)\Razer`, `ProgramData\Razer`.
- [x] **ThrottleStop.ini** undervolt built up in steps → final **−100 mV CPU Core (plane 0) /
      −100 mV P-Cache (plane 2) / −90 mV E-Cache (plane 5)** plus **V/F Point 1 (800 MHz)
      +100 mV** ("mV Boost", `UseVFCore=1`). *(Original file had ≈ −140 mV Core / −115 mV
      Cache — very aggressive; backed up to `cs2_backup\ThrottleStop.ini.bak`.)*
- [x] **ThrottleStop autostart**: scheduled task `ThrottleStop_Autostart`
      (At log on · Run as `carlo` · Highest privileges → needed for FIVR access).
- [ ] **After reboot, validate**: open ThrottleStop → FIVR window, confirm the offsets
      (should read −0.0998 / −0.0998 / −0.0898), then stress briefly.

### Late-session work (post-reboot)
- [x] **VBS/hypervisor disabled** (BCD `hypervisorlaunchtype off` + VMP/Core-Isolation) so
      FIVR writes work; `HypervisorPresent=False`. **`restore_vbs.ps1` fixed** (earlier
      revision was buggy) to re-enable VBS/VMP/hypervisor for WSL2/Docker + reboot.
- [x] **IccMax → max**: Core `IccMaxNew00=0x7FF` (511.75 A), matching the cache planes
      (`IccMaxNew20..=0x7FF`) — unclewebb's stability rec.
- [x] **TPL (power limits)**: set **PL1 = 70 W / PL2 = 100 W**
      (`POWERLIMITEAX=0x00DD8230`, `POWERLIMITEDX=0x00428320`) with **`LockPowerLimits=1`**.
      MMIO lock is **not exposed** on this platform → absent. Pre-edit snapshot:
      `cs2_backup\ThrottleStop.ini.pre_tpl`.
- [x] **Portability**: `replicate_undervolt.ps1` + `ThrottleStop_replication.ini` **tested
      end-to-end** on a throwaway copy.
- [x] **perf_logger.ps1** CSV logging working (`perf_log.csv`, `perf_log_idle.csv`).
- [x] **Scheduled task** `ThrottleStop_Autostart` (At log on · Highest privileges) confirmed.
- [x] **LatencyMon runs** captured: `report4.txt` (in-game, 3602 µs ISR); `report5.txt` and
      `report6.txt` are **byte-identical to report4** (same MD5) — no new session logged.
- [ ] **PROCHOT Offset** still **unverified**.
- [ ] **Turbo-ratio (boost) cap** still **pending**.

### Turbo-cap follow-up (2026-10-10)
- [x] Confirmed the saved profile still encodes PL1/PL2 = **70/100 W**
      (`POWERLIMITEAX=0x00DD8230`, `POWERLIMITEDX=0x00428320`,
      `LockPowerLimits=1`), with no `TurboRatio*` keys. The existing ratio keys are
      `NonTurboRatio1..4=0x15`; these are base ratios, not turbo caps.
- [x] Saved a byte-identical pre-change copy at
      `cs2_backup\ThrottleStop.ini.before_ratio_20261010_150757`; SHA-256 matched the
      active INI after inspection, so no setting was changed.
- [ ] **Cap not applied:** the live ThrottleStop TPL dialog displays 140 / 190 in its
      PL1 / PL2 fields, while the persisted INI encodes 70 / 100 W. The UI also showed
      140 / 190 in its long / short limit fields. Their units and relationship to the
      persisted values were not established, so the effective live watt limits remain
      unconfirmed. The inspected TPL dialog exposes power-limit controls, but no
      P-core/E-core ratio fields; no ratio write was attempted.
- [ ] **Thermal result not established:** there is no HWiNFO in-game temperature /
      thermal-throttle CSV to compare. Existing `perf_log.csv` reports zero Event 37
      and WHEA events, but does not measure temperature or rule out thermal PROCHOT.
      `report4.txt` is the only distinct post-tuning in-game LatencyMon capture
      (1:39; `report5.txt` and `report6.txt` are byte-identical): versus the 3:54:33
      baseline, interrupt-to-process peak fell 6261→3603 µs (~42%), ISR 651→260 µs
      (~60%), and DPC 2153→863 µs (~60%). It still reports trouble, and the 260 µs ISR
      peak remains slightly above the approximate 250 µs target. These latency results
      do not demonstrate a temperature improvement.
- [ ] Resume only after confirming the live power-limit interpretation and a supported
      ratio-control path in ThrottleStop / firmware. Then run a matched, user-supervised
      workload with HWiNFO temperature and thermal-throttling logging before and after
      applying the approved P 50x / E 36x caps. Do not force undocumented INI keys.

### Tools confirmed installed
- LatencyMon: `C:\Program Files\LatencyMon\LatMon.exe`
- HWiNFO64: `C:\Users\carlo\Downloads\hwi_830\HWiNFO64.exe`
- ThrottleStop: `C:\Users\carlo\Downloads\ThrottleStop_9.7.3\ThrottleStop.exe`

### Notes / not done (per your constraints)
- NVIDIA settings unchanged · HAGS kept enabled · Game Mode/Xbox untouched.
- VM/Docker/WSL left fully running (no RAM cap). Steam/Docker autostart kept.

### Evening update (2026-10-10, 20:30–21:30) — turbo caps, PL1/PL2, verification
- [x] ThrottleStop was **not running** (autostart task ended earlier); restarted via the task.
- [x] **Turbo-ratio cap applied** via FIVR → Turbo Groups (needs elevated automation; ThrottleStop
      is elevated): P-core groups → **49x** (all 8), E-core → **36x**. Saved on clean exit
      (`OneAD_EAX0/EDX0=0x31313131`, `Six50_EAX0=0x24`). Backup: `cs2_backup\ThrottleStop.ini.pre_turbo_20261010`.
- [x] **Power limits fixed:** the 70/100 W never applied because TPL **"Disable Controls"** was
      checked. Now enabled with **PL1 65 W / PL2 85 W** (`PowerLimitEAX0=0x00DF8208`,
      `PowerLimitEDX0=0x004282A8`). HWiNFO now shows "Power Limit Exceeded" flags (limits enforcing).
- [x] **PROCHOT offset read:** 3 (≈97 °C). Not changed.
- [x] **HWiNFO shared-memory logging** enabled; `cs2_backup\hwinfo_logger.ps1` → `hwinfo_log2.csv`.
      (Do not launch HWiNFO with command-line args — free version errors.)
- [x] **Result, 19-min CS2 session after PL change:** max 92 °C (was 99–100), avg ≈80 °C,
      package power max 82 W (was 139 W), P clock ≤ 4.89 GHz, **0 WHEA**, thermal-throttle
      samples 6 (~12 s). User: "CS2 is perfect and smooth".
- [!] **Corrections to earlier notes:** Event 37 is *not* 0 (≈16/day, 96 today). WHEA 19
      "Internal parity error" (APIC 33) logged 2026-09-26 and 2026-10-10 14:56 → keep −100/−100/−90,
      do **not** go deeper; if it recurs, back off to −80/−80/−70. Forum −135…−160 mV values are
      not transferable (some chips crash in long tests at −160).
- [ ] Optional: P cap 47–48x for the ~92 °C peaks; not applied (user's CS2 already smooth).
- [ ] Not yet verified across a real reboot (task `ThrottleStop_Autostart`: enabled, at logon,
      highest privileges, no battery limits).

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
