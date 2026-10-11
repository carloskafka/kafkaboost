# Reference machine and system changes

| Item | Value |
|---|---|
| Model | LENOVO 83DE (HWiNFO: "Legion Pro 7 16IRX9H"; earlier notes: "Legion Pro 5 16IRX9 class") |
| CPU | Intel Core i9-14900HX (8 P + 16 E, 24C/32T), TjMax 100 C |
| GPU | NVIDIA RTX 4090 Laptop |
| RAM | 32 GB |
| OS | Windows 11 Home, build 26300 |
| Tools (this machine) | ThrottleStop 9.7.3 in `C:\Users\carlo\Downloads\ThrottleStop_9.7.3`, HWiNFO64 8.30 in `...\hwi_830`, LatencyMon in `C:\Program Files\LatencyMon` |

## Cleanup done before the tuning (latency and background load)
- Nahimic service and Appx removed/disabled; Razer Synapse 3 and NGENUITY uninstalled.
- Page file fixed at 16384-32768 MB (was a 2 GB dynamic file).
- Startup entries disabled: Epic, FACEIT, Spotify, G-Menu, Ollama `.lnk`, Edge auto-launch, TightVNC `tvncontrol`,
  `Start WingMan Profiler`; Edge background and startup boost disabled by policy.
- VBS/hypervisor off (`bcdedit /set hypervisorlaunchtype off`, DeviceGuard VBS = 0, HVCI = 0) so FIVR writes work.
  Restore with `scripts/maintenance/restore_vbs.ps1`.

## Timeline (2026-10-10)
1. Diagnosis: stutter in every game, worse with session length, temperatures to 100 C.
2. Latency and startup cleanup (above), then VBS off.
3. Undervolt stepped -50 -> -75 -> -100 mV (core and P-cache) / -90 mV (E-cache), each verified in the FIVR window; V/F point 1
   +100 mV with `UseVFCore=1`.
4. IccMax to max. First power-limit attempt (70/100 W in the INI) never applied.
5. Turbo caps found in FIVR -> Turbo Groups: P 49x, E 36x; "Disable Controls" unchecked and PL 65/85 W applied.
6. P cap lowered to 47x (peak 92 C -> 90 C, no thermal throttling).
7. One-click installer, autostart + watchdog, Electron wizard, repo published (private).
