---
name: feedback-ram-no-worry
description: "Line 2026-11-14 - RAM thấp là bình thường; session/worker luôn chạy, harness KHÔNG BAO GIỜ tự chặn/chờ/tắt vì RAM, hết RAM thì để Windows tự xử"
metadata:
  node_type: memory
  type: feedback
  originSessionId: ea625a11-9d35-4bcd-9eab-c3b3d804ee03
  modified: 2026-11-14T15:10:53.721Z
---

RAM vật lý trống trên máy Line thường gần hết (0.5 GB), nhưng worker vẫn chạy đủ. Line: "các session luôn chạy; khi RAM còn ít, nó hết RAM thì nó tự tắt chứ không tự chủ động tắt".

**Why:** Line thấy thực tế run vẫn chạy tốt (pagefile cho commit headroom ~15 GB); một gate chặn/chờ vì RAM chỉ làm mất việc.
**How to apply:** Không chặn, không chờ, không kill, không thêm ràng buộc "chạy 1 process" vì RAM; không nêu RAM thấp như rủi ro khi giao việc. `ram-preflight.ps1` (`Wait-FreeRam`) từ 2026-11-14 chỉ in commit headroom + cảnh báo, luôn trả $true. Hub rule b chỉ toast khi commit > 90% (thông báo, không dừng gì). Kill do timeout/cancel/zombie (không liên quan RAM) vẫn giữ. Xem [[ram-leak-investigation]].
