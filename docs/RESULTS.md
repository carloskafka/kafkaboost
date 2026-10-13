# Results (Lenovo 83DE, i9-14900HX, CS2, plugged in, Legion Balance Mode)

Measured with HWiNFO shared memory (`scripts/monitoring/hwinfo_logger.ps1`, one sample every 2 s). "Before" figures come
from HWiNFO/HWMonitor screenshots taken during the original sessions, so they are maxima, not a controlled A/B.

| Configuration | Peak temp | Avg temp | Peak package power | Peak P clock | Thermal-throttle samples | WHEA |
|---|---|---|---|---|---|---|
| Stock (Lenovo limits), no undervolt | 99-100 C | n/a | 139 W | 5.39 GHz | frequent | 1 corrected |
| -100/-100/-90 mV, P 49x / E 36x, PL 65/85 W | 92 C | about 80 C | 82 W | 4.89 GHz | 6 (about 12 s in 19 min) | 0 |
| **Current:** same, **P 47x** | **90 C** | about 79 C | 73 W | 4.69 GHz | **0** (19 min) | 0 |

Notes
- **Before-tuning average: 91 C, the owner's own figure, not backed by a recorded log** (the old screenshots show maxima and the average column is cut off, and those sessions were not matched runs). Treat the average improvement as indicative, not measured. After the tuning the average is about 79 C and flat over the session.
- The 19-minute runs were taken after the PL change at 21:11 (49x) and 21:35 (47x); temperatures stayed flat across the
  session (80, 79, 78, 78 C per 5-minute block at 47x).
- The two extra HWiNFO sensors ("CPU Package", "CPU IA Cores") peaked at 100 C once after the 49x cap and at 89 C at 47x.
- The user judged CS2 smooth at both 49x and 47x. FPS was not measured; CPU use stays around 12 %, so the cost of the cap
  should be small.
- Undervolt alone did not fix the heat: with -100 mV and no caps the P-cores still reached 99-100 C at 139 W.

How to repeat: start HWiNFO (sensors only, `SensorsSM=1`), run `scripts/monitoring/hwinfo_logger.ps1 -Minutes 20`, play the
same route, then compare the CSV in `logs/`.

## Latency (LatencyMon)

Secondary to heat, but recorded so a later run can be compared. All reports are from the same laptop (BIOS N2CN32WW, Windows 11 build
26300, NVIDIA driver 617.42). Values are the worst single event of each run, so a longer run naturally shows higher peaks.

| Report | Duration | Interrupt to process | Worst ISR | Worst DPC | Hard page faults |
|---|---|---|---|---|---|
| Before the tuning | 3:54:33 | 6261 us | 651 us (ACPI.sys) | 2153 us (storport.sys) | 72,778 |
| Report 4 (after) | 1:39 | 3603 us | 260 us (ACPI.sys) | 863 us (ACPI.sys) | 2,340 |
| Report 8 (after) | 8:18:43 | 6432 us | 705 us (Wdf01000.sys) | 1583 us (ntoskrnl.exe) | 275,768 |
| Report 10 (after) | 0:13:35 | 3782 us | 468 us (ACPI.sys) | 1509 us (nvlddmkm.sys) | 57,019 |

- **Verdict:** LatencyMon says "trouble handling real-time audio" in every report, including the one before the tuning. That text is
  generic and aimed at audio work; it does not measure game stutter or temperature.
- **Report 10 in detail:** 99.97 % of the 1.1 million DPCs ran under 250 us; 336 ran 0.5 ms or longer, 13 of them 1-2 ms; only 3 of
  about 191,000 ISRs ran 0.5 ms or longer. The longest DPC belongs to the NVIDIA driver (1.5 ms), the longest ISR to `ACPI.sys`
  (laptop firmware / embedded controller), and Windows Defender (`msmpeng.exe`, 7,075) was hit by the most page faults.
- **Reading it:** the peaks are lower than before the tuning, but the runs differ in length, so this is not a matched comparison.
  Nothing here shows a latency problem worth chasing; the game was judged smooth. If it ever matters, check for a newer NVIDIA driver
  and a Lenovo BIOS update. Do not follow LatencyMon's "disable CPU throttling in BIOS" hint (the throttling here is deliberate) and do
  not disable Defender.
- Several saved reports were byte-identical copies (reports 4-7); compare file hashes before trusting a "new" capture.

## Reference machine

| Item | Value |
|---|---|
| Model | LENOVO 83DE (HWiNFO calls it "Legion Pro 7 16IRX9H"; the first notes said "Legion Pro 5 16IRX9 class") |
| CPU | Intel Core i9-14900HX (8 P + 16 E, 24C/32T), TjMax 100 C |
| GPU / RAM / OS | RTX 4090 Laptop / 32 GB / Windows 11 Home build 26300 |
| Tools | ThrottleStop 9.7.3, HWiNFO64 8.30, LatencyMon |

System changes made before the tuning (latency and background load): Nahimic, Razer Synapse 3 and NGENUITY removed; fixed
16-32 GB page file; autostart entries (Epic, FACEIT, Spotify, G-Menu, Ollama, Edge, TightVNC, WingMan) disabled; Edge
background mode disabled; VBS/hypervisor off so FIVR writes work.