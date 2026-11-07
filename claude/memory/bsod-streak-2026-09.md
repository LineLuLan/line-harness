---
name: bsod-streak-2026-09
description: "Line laptop crash streak 2026-08-28 to 09-07 during Riot games (4 dumps, 4 different modules, not RAM exhaustion). 2026-09-07: BIOS flashed to M3CN50WW, Realtek codec reinstalled from Lenovo package; Vanguard On-Demand skipped by Line. Watch for new bugchecks."
metadata:
  type: project
---

Crash streak on Line's laptop (Ryzen + Radeon 780M + RTX 4060 Laptop, 16 GB RAM), analyzed 2026-09-07 with kd.exe on copies of C:\Windows\Minidump (needs an elevated copy; kd output saved in the session scratchpad).

| Date | Bugcheck | Blamed module | Process at crash |
| --- | --- | --- | --- |
| 2026-08-28 09:01 | 0x50 PAGE_FAULT_IN_NONPAGED_AREA | RTKVHD64.sys (Realtek audio, 2023 driver) | FnHotkeyUtility |
| 2026-09-01 13:39 | 0x1A MEMORY_MANAGEMENT | portcls.sys (Windows audio) | audiodg.exe |
| 2026-09-04 17:03 | 0x50 | dxgmms2.sys (Windows GPU memory manager) | VALORANT-Win64 |
| 2026-09-07 01:24 | 0x3D INTERRUPT_EXCEPTION_NOT_HANDLED | nvlddmkm.sys (NVIDIA 32.0.16.1088) | LeagueClient |
| 2026-09-07 ~01:37 | none (Kernel-Power 41, BugcheckCode=0, no dump) | hard reset; last events: Vanguard DNS lookup, Windows Search "insufficient quota" 0x800705ad, gamingservices.exe stack-buffer overrun | Riot client running |

Evidence against "RAM overflow": zero Resource-Exhaustion-Detector events in 7 days, pagefile 25 GB with peak use 341 MB, commit limit 40 GB, zero WHEA events. Four unrelated kernel modules faulting = memory corruption by a third-party kernel driver or bad RAM. Vanguard vgk.sys 1.19.0-6 file date 2026-08-26, first crash 2026-08-28. Realtek audio driver 6.0.9464.1 is from 2023-01.

**How to apply:** Next steps proposed to Line (not executed): 1) Windows Memory Diagnostic to rule out RAM; 2) uninstall or disable Vanguard for a week as the A/B test; 3) update Realtek audio driver from the OEM; 4) clean NVIDIA reinstall. Related: [[ram-leak-investigation]] (AMD 780M zombie leak, closed) still lists "rollback OEM + Vanguard" as pending.

## Status 2026-09-07 ~02:00 (Line rebooting for BIOS flash)

Machine: Lenovo Legion R7000P APH8 (82Y9 = Legion Slim 5 16APH8), Ryzen 7 7840H, Radeon 780M + RTX 4060 Laptop, Realtek ALC257 (VEN_10EC DEV_0257 SUBSYS_17AA3BF5), Win11 25H2 26200.9168.

Line's decisions: BIOS = Line ran it themself in Lenovo Vantage (M3CN31WW -> M3CN50WW, staged, flashes on reboot). Vanguard = keep, ONLY enable On-Demand (no reinstall). Audio = reinstall the same Lenovo package 6.0.9464.1 (Lenovo has no newer one; Windows Update offers none).

Done: Lenovo System Update 5.08.04.85 installed via winget (tvsu.exe in Program Files (x86)\Lenovo\System Update). Downloaded and SHA256-verified to C:\Users\ADMIN\Downloads\Lenovo-82Y9\ : o1y5057fm94a8ue0_audio_6.0.9464.1.exe (170452168 B), m3cn50ww_BIOS.exe (15497224 B), m3cn50ww_BIOS_notes.txt. Vanguard On-Demand prechecks all pass (Secure Boot, TPM 2.0, VBS running, HVCI on, IOMMU, 25H2). vgtray 1.19 contains the precheck/on-demand menu strings.

NEXT after reboot, in order:
1. Verify `(Get-CimInstance Win32_BIOS).SMBIOSBIOSVersion` = M3CN50WW.
2. Install audio: run elevated `o1y5057fm94a8ue0_audio_6.0.9464.1.exe /verysilent /DIR=<tmp>` (Lenovo's own cmdline; reboot type 3 = reboot after). Verify Realtek driver 6.0.9464.1, no yellow bang, Nahimic and Dolby intact.
3. Vanguard On-Demand: Line right-clicks the Vanguard tray icon (vgtray), Pre-Check / On-Demand option. Verify HKLM\SYSTEM\CurrentControlSet\Services\vgk Start changes from 1 (system start) and vgk is not running when no Riot game is open.
4. Watch for new bugchecks: System log Id 1001 and C:\Windows\Minidump (needs an elevated copy to read).

## Status 2026-09-07 02:20 (after BIOS reboot)

- BIOS: Verified M3CN50WW (release 2026-04-23), clean boot 02:09, VBS/HVCI still on, no new bugcheck.
- Audio: Lenovo package extracted to Downloads\Lenovo-82Y9\TMP; InstallPackage.bat ran via pnputil but same-version packages were skipped ("no better matching driver"). Then deleted oem54 (hdxacplv 6.0.9464.1) and re-added it from the package; pnputil said "System reboot is needed". Line to reboot once more. Nahimic, Fortemedia, Realtek service and UAPO2 packages reported up-to-date.
- Vanguard: Line chose to skip On-Demand for now ("Làm 1 và 2 thôi"). vgk Start still 1. Revisit only if crashes continue.
- Watch: bugcheck Id 1001 in System log and C:\Windows\Minidump after 2026-09-07 02:00.
