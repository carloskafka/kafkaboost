# Results (Lenovo 83DE, i9-14900HX, CS2, plugged in, Legion Balance Mode)

Measured with HWiNFO shared memory (`scripts/monitoring/hwinfo_logger.ps1`, one sample every 2 s). "Before" figures come
from HWiNFO/HWMonitor screenshots taken during the original sessions, so they are maxima, not a controlled A/B.

| Configuration | Peak temp | Avg temp | Peak package power | Peak P clock | Thermal-throttle samples | WHEA |
|---|---|---|---|---|---|---|
| Stock (Lenovo limits), no undervolt | 99-100 C | n/a | 139 W | 5.39 GHz | frequent | 1 corrected |
| -100/-100/-90 mV, P 49x / E 36x, PL 65/85 W | 92 C | about 80 C | 82 W | 4.89 GHz | 6 (about 12 s in 19 min) | 0 |
| **Current:** same, **P 47x** | **90 C** | about 79 C | 73 W | 4.69 GHz | **0** (19 min) | 0 |

Notes
- The 19-minute runs were taken after the PL change at 21:11 (49x) and 21:35 (47x); temperatures stayed flat across the
  session (80, 79, 78, 78 C per 5-minute block at 47x).
- The two extra HWiNFO sensors ("CPU Package", "CPU IA Cores") peaked at 100 C once after the 49x cap and at 89 C at 47x.
- The user judged CS2 smooth at both 49x and 47x. FPS was not measured; CPU use stays around 12 %, so the cost of the cap
  should be small.
- Undervolt alone did not fix the heat: with -100 mV and no caps the P-cores still reached 99-100 C at 139 W.

How to repeat: start HWiNFO (sensors only, `SensorsSM=1`), run `scripts/monitoring/hwinfo_logger.ps1 -Minutes 20`, play the
same route, then compare the CSV in `logs/`.
