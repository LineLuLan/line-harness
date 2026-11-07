---
name: ram-leak-investigation
description: "ĐÃ ĐÓNG ÁN 2026-08-19 - zombie process leak do driver AMD 780M đời 2023; fix bằng Adrenalin 26.7.1; còn việc: khôi phục OEM drivers + Vanguard, hạ cap Docker"
metadata: 
  node_type: memory
  type: project
  originSessionId: 497128f3-349d-4f26-964b-e6246fb60619
  modified: 2026-08-19T15:36:09.356Z
---

KẾT LUẬN (2026-08-19, ĐÓNG ÁN): thủ phạm là driver AMD Radeon 780M v31.0.14005.22001 (2023-11-08 — bản mới nhất Lenovo Vantage có, Lenovo ngừng cập nhật). Fix: cài AMD Adrenalin 26.7.1 trực tiếp từ amd.com → driver 32.0.31035.1003 (2026-07-24) → leak-check: frees bám allocs (699/442 → 778/486). Case Framework Community xác nhận AMD Adrenalin đời 2023 gây đúng lỗi này. BÀI HỌC: driver AMD iGPU trên máy Lenovo phải lấy từ amd.com, Vantage không đủ.
KHÔI PHỤC XONG (2026-08-19): rollback OEM drivers + vgk start=system đã chạy, verified (Nahimic ×3 + FBNetFilter = Manual, pwdrvio = Boot, vgk = System). Tất cả kích hoạt lại ở lần reboot kế. Lưu ý nhỏ: pwdrvio (MiniTool sót) đã về Boot-start — vô hại với leak nhưng có thể disable vĩnh viễn nếu muốn dọn.
VIỆC CÒN LẠI: DockerRamTrack còn chạy — sau vài ngày có data lúc tải nặng thì hạ cap .wslconfig theo report (`docker-ram-track.ps1 -Report`) rồi gỡ task (`Unregister-ScheduledTask -TaskName DockerRamTrack -Confirm:$false`).

--- Chi tiết điều tra ---
RAM investigation trên máy Line (Lenovo 82Y9 Legion Slim 5, 16GB, Win11 25H2 build 26200):

- Triệu chứng: RAM full dù chỉ mở Docker + 1 Claude session. Nonpaged Pool 1.6GB, Page Table 1.9GB.
- Poolmon (2026-08-19): tag `Proc` = 102,311 process objects leaked (366MB), `MiP2` khớp 102,312, `Toke` 110k (205MB). Frees đứng ở 7 → MỌI process chết đều thành zombie (kernel driver giữ reference, không phải user-mode handle — tổng handle toàn máy chỉ 148k).
- Test xác nhận leak sống: spawn 20 cmd → allocs tăng, frees không đổi.
- Nghi phạm #1: Riot Vanguard `vgk.sys` (boot-start, StartMode=System, luôn chạy). Nghi phụ: Nahimic driver (DDK 10.0.10011 cổ), hoặc bug của bản preview 26200. Case tương tự trên MS Q&A: ASUS Armoury Crate gây đúng leak Proc tag này.
- Test theo round (Line chơi game lúc code nên Vanguard để cuối). Poolmon x64: `C:\Program Files (x86)\Windows Kits\10\Tools\10.0.28000.0\x64\poolmon.exe` (bản arm64 cùng thư mục không chạy được; poolmon KHÔNG cần admin). LƯU Ý: `poolmon -n file` APPEND vào file — phải xóa file cũ hoặc lấy match cuối.
- Round A (2026-08-19, XONG): stop NahimicService + LenovoVantageService + LenovoFnAndFunctionKeys rồi spawn 20 process → allocs +176, frees +0 → user-mode OEM services TRẮNG ÁN.
- Round A2 (2026-08-19, XONG): tắt hẳn Docker Desktop + `wsl --shutdown` (vmmemWSL chết) → spawn 20 → allocs +87, frees +0 → Docker/WSL TRẮNG ÁN. Docker tự khởi động lại sau đó.
- Round B (2026-08-19, XONG): 5 driver OEM disabled (verified StartMode=Disabled State=Stopped sau reboot) → leak-check: fresh boot Allocs=579 Frees=1, spawn 20 → +53/+0 → OEM kernel drivers TRẮNG ÁN. Còn 2 nghi phạm: Vanguard (round C) và Windows preview 26200 (round D). Driver OEM vẫn đang disabled — khôi phục bằng rollback script khi kết thúc điều tra.
- Round C (2026-08-19, XONG): vgk Disabled/Stopped (verified), fresh boot 3 phút → leak-check 558→644 allocs, frees=1 đứng yên → VANGUARD TRẮNG ÁN.
- NGHI PHẠM CHÍNH HIỆN TẠI: driver AMD Radeon 780M v31.0.14005.22001 ngày 2023-11-08 (3 năm tuổi; NVIDIA thì mới 2026-07). Case Framework Community y hệt: zombie ~100k process, thủ phạm AMD Adrenalin driver đời 2023, fix bằng đổi version. Tag DAL3 (AMD DAL) từng chiếm 112MB nonpaged. KẾ HOẠCH: Line update driver AMD 780M (Lenovo Vantage System Update hoặc AMD Adrenalin) → leak-check lại. Nếu hết → đóng án, chạy leak-roundB-rollback.ps1 (admin) + `sc.exe config vgk start= system` + 1 reboot gộp để trả Nahimic/FBNetFilter/pwdrvio/Vanguard về nguyên trạng.
- Trạng thái tạm thời đang tắt (cần khôi phục khi đóng án): 5 driver OEM (round B) + Vanguard (round C).
- Round B (thông tin scripts): boot-disable 5 driver OEM (Nahimic_Mirroring, NahimicBTLink, NahimicXVAD, FBNetFilter, pwdrvio) + reboot + đo lại. Scripts trong `~/.claude/bin/`: `leak-roundB-disable.ps1` (admin), `leak-check.ps1` (đo, không cần admin), `leak-roundB-rollback.ps1` (khôi phục từ `~/.claude/logs/roundB-backup.txt`). Kết quả "VAN LEAK" → round C: test Vanguard (`sc config vgk start= disabled` + reboot; bật lại `start= system`; Vanguard bắt buộc reboot mới chơi game được). Vẫn leak sau round C → nghi bug Windows preview 26200 → update build / Feedback Hub.
- Phiên Claude không chạy elevated — mọi lệnh sc/Stop-Service phải để Line chạy trong PowerShell admin.
- Docker KHÔNG leak: VM dùng thật ~880MB, containers ~85MB, cap 2GB trong .wslconfig. Tracker: task `DockerRamTrack` + script [[docker-ram-track]] `~/.claude/bin/docker-ram-track.ps1` (đã vá bug [int] overflow → [long]), log `~/.claude/logs/docker-ram.csv`, report mode gợi ý hạ cap ~1536MB sau khi có data lúc tải nặng.
- Wi-Fi RZ616/MT7922 driver 25.40.2.579: từng nghi nhưng đã loại; cập nhật qua Lenovo Vantage vẫn nên làm.
