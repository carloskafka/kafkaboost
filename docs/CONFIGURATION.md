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
