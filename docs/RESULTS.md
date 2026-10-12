# Results (Lenovo 83DE, i9-14900HX, CS2, plugged in, Legion Balance Mode)

Measured with HWiNFO shared memory (`scripts/monitoring/hwinfo_logger.ps1`, one sample every 2 s). "Before" figures come
from HWiNFO/HWMonitor screenshots taken during the original sessions, so they are maxima, not a controlled A/B.

| Configuration | Peak temp | Avg temp | Peak package power | Peak P clock | Thermal-throttle samples | WHEA |
|---|---|---|---|---|---|---|
| Stock (Lenovo limits), no undervolt | 99-100 C | n/a | 139 W | 5.39 GHz | frequent | 1 corrected |
| -100/-100/-90 mV, P 49x / E 36x, PL 65/85 W | 92 C | about 80 C | 82 W | 4.89 GHz | 6 (about 12 s in 19 min) | 0 |
| **Current:** same, **P 47x** | **90 C** | about 79 C | 73 W | 4.69 GHz | **0** (19 min) | 0 |

Notes
- **No average temperature was recorded before the tuning** (the old screenshots show maxima and the average column is cut off, and those sessions were not matched runs), so no average improvement is claimed. After the tuning the average is about 79 C and flat over the session.
- The 19-minute runs were taken after the PL change at 21:11 (49x) and 21:35 (47x); temperatures stayed flat across the
  session (80, 79, 78, 78 C per 5-minute block at 47x).
- The two extra HWiNFO sensors ("CPU Package", "CPU IA Cores") peaked at 100 C once after the 49x cap and at 89 C at 47x.
- The user judged CS2 smooth at both 49x and 47x. FPS was not measured; CPU use stays around 12 %, so the cost of the cap
  should be small.
- Undervolt alone did not fix the heat: with -100 mV and no caps the P-cores still reached 99-100 C at 139 W.

How to repeat: start HWiNFO (sensors only, `SensorsSM=1`), run `scripts/monitoring/hwinfo_logger.ps1 -Minutes 20`, play the
same route, then compare the CSV in `logs/`.

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