---
name: feedback-no-clear-nag
description: "Line 2026-11-15 - đừng nhắc /clear hay phiên mới; cứ làm tiếp, compact lo context; hook chỉ nhắc từ 85% và chỉ để tự cập nhật handoff"
metadata:
  node_type: memory
  type: feedback
  originSessionId: ea625a11-9d35-4bcd-9eab-c3b3d804ee03
  modified: 2026-11-14T17:10:19.344Z
---

Line: "làm đi đừng có quan tâm clear vì mình có thể compact; mới 60% mà đã kêu rồi".

**Why:** Line thấy nhắc /clear làm gián đoạn; compaction đủ giữ mạch làm việc.
**How to apply:** Không bao giờ đề xuất /clear, /handoff-rồi-dừng, hay "phiên mới" cho Line. Cứ làm tiếp. Từ 85% context: tự cập nhật file .handoff mới nhất (không hỏi), rồi làm tiếp. Hook `context-guard.ps1` đã đổi theo (im dưới 85%). "One goal per session" đã bỏ khỏi CLAUDE.md.
