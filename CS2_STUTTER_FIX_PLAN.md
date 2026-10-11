# CS2 / Multi-Game Stutter Fix Plan

**For review only — no settings have been changed.** This plan reconciles the project notes with the recent HWiNFO/ThrottleStop screenshots and current reference material. It is not an instruction to apply every tuning suggestion.

## What is known, and what is not

**Evidence in the project and screenshots**

- `AGENTS.md` identifies the machine as Lenovo type **83DE**, i9-14900HX, RTX 4090 Laptop, and calls it “Legion Pro 5 16IRX9 class.” The HWiNFO screenshot instead labels it **“LENOVO Legion Pro 7 16IRX9H.”** These identifiers have not been independently reconciled. Lenovo publishes separate PSREF pages for the Pro 7 16IRX9H and Pro 5 16IRX9; neither page alone proves which exact machine type/MTM is installed. Confirm the full MTM in BIOS, Lenovo Vantage, or the device label before applying model-specific assumptions.
- Screenshots show CPU maximums around **100–101 °C** and thermal-throttling flags **Yes**; static PL1/PL2 **140/190 W**, dynamic PL1 peak **80 W** and PL2 **119 W**; maximum P-core ratio **54x**; and WHEA total **1**, including **1 internal CPU error**. These are UI snapshot/Max-column observations, not a controlled before/after test. The timing and meaning of the WHEA event are unknown.
- The FIVR screenshot reads approximately **−99.6 mV Core/P-cache** and **−89.8 mV E-cache**, consistent with the documented −100/−100/−90 mV settings. The ThrottleStop main view shows **PROCHOT 97 °C**; that display does not establish the configured PROCHOT offset.
- Project notes say the INI encodes **70/100 W** PL1/PL2 with `LockPowerLimits=1`, while the TPL UI and HWiNFO show other values. The effective limits, their units/meaning, and which control currently wins are **unresolved**. Do not assume the INI values are effective.
- A proposed **P-core 50x / E-core 36x** cap was investigated but **not applied**. No verified ThrottleStop ratio-control path or effective ratio cap is recorded.
- VBS/hypervisor is documented as disabled so FIVR undervolting works; this affects the user's WSL2/Docker-WSL2 setup. The current VBS state should be checked before deciding whether to continue this tuning path.

**Interpretation**

- Intel lists a 100 °C Tjunction for the i9-14900HX. The observed temperatures and thermal flags make heat/throttle a strong hypothesis for late-session stutter, but screenshots alone do not establish when throttling occurs or prove it causes the stutter.
- The single internal-CPU WHEA count is a stability warning to investigate, not proof that the undervolt caused it. It does mean **do not deepen the undervolt** until its event details and timing are known.
- There is no single manufacturer-approved ThrottleStop voltage/ratio profile for this laptop. Forum reports are individual silicon/cooling results, not safe settings to copy. The current undervolt should be treated as a test configuration, not a universally validated value.

## Ordered, reversible plan

1. **Identify and preserve the current state.** Record the exact Lenovo MTM, BIOS version, active ThrottleStop profile/version, VBS state, and the relevant screenshots. Copy the active `ThrottleStop.ini` to a dated snapshot without changing it. Keep the laptop on AC and the same Lenovo thermal mode for comparisons.
2. **Triage WHEA before stressing or tuning.** In Event Viewer, inspect the internal-CPU WHEA event's timestamp, event ID, processor/APIC details, and whether it predates the current offsets. Do not increase any negative voltage. If a new/recurrent CPU WHEA event, calculation error, freeze, reboot, or application crash appears during testing, stop; revert the test change. If the event is current or its timing cannot be established, first establish a stock-voltage baseline (offsets zero using the supported ThrottleStop UI, after saving the current profile) before further tuning.
3. **Capture a matched baseline.** After the WHEA issue is understood and the machine is stable, record two repeatable CS2 runs with the same route, duration, AC power, Lenovo mode, background VM/Docker/WSL load, and ambient conditions. Log HWiNFO CSV sensors for per-core/package temperatures, effective clocks, CPU package power, thermal/PROCHOT and power-limit flags, GPU temperature/power, and ratios. Record actual ThrottleStop TPL/FIVR screens and the HWiNFO sensor names/units; reset or note accumulated Max values at each run. Capture frametime/1% and 0.1% lows and a same-duration LatencyMon report. Do not treat repeated identical LatencyMon snapshots as new runs.
4. **Resolve power-limit and threshold discrepancies before touching them.** Compare the live TPL dialog, saved INI, HWiNFO's static/dynamic PL labels, and observed package power under a repeatable load. Establish which PL values are configured, which are active, and whether the “dynamic peak” fields describe limits or measured values. In ThrottleStop Options, inspect—not change—the PROCHOT-offset setting and reconcile it with the 97 °C display and HWiNFO. Do not blindly set 70/100 W, lock MMIO/MSR limits, raise the PROCHOT threshold, or infer a Lenovo offset from another model.
5. **Test one supported thermal control at a time.** Keep voltage unchanged during each comparison. First verify whether ThrottleStop/firmware exposes editable P/E turbo-ratio limits for this exact machine; do not add guessed INI keys. If supported and the baseline justifies it, the previously proposed P 50x/E 36x values may be tested as a reversible *candidate*, not as a community-validated recommendation: save the profile, change only the ratios, run the identical workload, and verify the effective clocks/limits in telemetry. Separately test a PL or Lenovo-mode change only after step 4 establishes its real starting/effective values. Do not combine ratio, voltage, PL, and fan/power-mode changes in one run.
6. **Revisit undervolting only after thermal testing is stable.** Keep offsets at zero if WHEA is new, recurring, or unexplained. If the user elects to test undervolting after a clean baseline, make only a small, single-variable change, then test idle/low-load transitions, a CPU workload, and the matched game run; check WHEA after each. Do not pursue −125/−150 mV or copy anecdotal V/F boosts. Restore the last error-free setting at the first instability.
7. **Treat VBS as a separate user trade-off.** Do not disable security/virtualization features just to enable tuning. The project documents that restoring VBS/hypervisor may make FIVR writes unavailable and can restore WSL2/Docker-WSL2 functionality; confirm that trade-off before using the existing restore procedure, then reboot and verify both VBS and WSL behavior. Do not modify those features during the thermal A/B tests.

## Stop conditions and success criteria

- Stop a test immediately for any new WHEA/internal-CPU error, BSOD/restart, freeze, calculation error, or unexplained app crash; revert the most recent change and do not continue voltage tuning.
- Stop a sustained stress run if the CPU sits at its thermal limit or repeatedly asserts thermal throttling. A brief peak is not by itself evidence of damage, but repeated throttle periods during the matched game run are a failed thermal result. Do not raise PROCHOT to hide the flag.
- A change is a candidate to keep only if two matched runs show **no new WHEA/instability**, less sustained thermal throttling (ideally none during the game segment), no repeated clock collapse at the stutter points, and stable or improved frametimes. A practical performance gate is no more than a 3% regression in median 1% lows, with a measurable improvement in 1% lows or stutter/frametime spikes to justify keeping a thermal cap. If results are mixed or within run-to-run noise, revert and do not stack more changes.

## Rollback

Before each test, preserve the current INI/profile and screenshot the live UI. Revert only the last changed control through the supported ThrottleStop or Lenovo UI, then repeat the same measurement. For undervolt instability, return offsets to zero rather than restoring the old `ThrottleStop.ini.bak`, which the project notes was substantially more aggressive (about −140 mV Core/−115 mV P-cache). Do not use the inconsistent 70/100 W INI snapshot as a rollback target until its effective values are verified. Restore VBS/WSL independently of tuning and reboot if that separate choice is made.

## References

**Manufacturer / platform documentation**

- Lenovo PSREF, [Legion Pro 7 16IRX9H](https://psref.lenovo.com/Product/Legion/Legion_Pro_7_16IRX9H) and [Legion Pro 5 16IRX9](https://psref.lenovo.com/Product/Legion/Legion_Pro_5_16IRX9) — product-family documentation; confirm the exact MTM separately.
- Intel ARK, [Core i9-14900HX specifications](https://www.intel.com/content/www/us/en/products/sku/235995/intel-core-i9-processor-14900hx-36m-cache-up-to-5-80-ghz/specifications.html) — processor specification reference, including Tjunction.
- Microsoft Learn, [Install WSL](https://learn.microsoft.com/en-us/windows/wsl/install) — WSL prerequisites/features; VBS and virtualization choices should be managed as a separate system-function decision.

**ThrottleStop / community material**

- ThrottleStop developer thread, [ThrottleStop 9.7](https://www.techpowerup.com/forums/threads/throttlestop-9-7.284677/) — third-party utility/developer discussion, not Lenovo firmware documentation.
- TechPowerUp forum [i9-14900HX undervolting discussion](https://www.techpowerup.com/forums/threads/undervolting-i9-14900hx.320844/) — anecdotal user reports only; individual voltage, ratio, temperature, and stability results are not transferable guarantees.

**Local evidence:** `AGENTS.md`, `CS2_STUTTER_PLAN.md`, `cs2_backup\ThrottleStop.ini.pre_tpl`, `cs2_backup\ThrottleStop.ini.before_ratio_20261010_150757`, and the user-provided HWiNFO/ThrottleStop screenshots. The INI snapshots document saved state, not necessarily live hardware behavior.
