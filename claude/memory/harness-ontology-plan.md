---
name: harness-ontology-plan
description: "15/11 Line chốt: codegraph MCP đã gỡ; thứ tự R1 fix -> harness ontology (rules-as-data, phải đo được mạnh hơn) -> SkillEvaluator Tier 1 local; ontology repo công việc để sau"
metadata:
  node_type: memory
  type: project
  originSessionId: ea625a11-9d35-4bcd-9eab-c3b3d804ee03
  modified: 2026-11-14T17:05:52.643Z
---

Quyết định của Line ngày 2026-11-15:
- codegraph MCP + hook codegraph-init-check đã gỡ (4 lần gọi/30 ngày, Codex không dùng MCP). Backup + lệnh khôi phục: D:\Backups\codegraph-off-2026-11-15\. Skill `learn` vẫn bắt buộc codegraph -> phải sửa qua bank gate.
- Thứ tự: (1) R1 việc 1+2 (review evidence, sync repo/live), (2) **harness ontology** cho chính harness agentic coding: một file nguồn (object Packet/Run/Model/Rule/Hook/Skill, relationship, rule routing/review, action + quyền) mà Hub và sensor đọc; Line yêu cầu **chứng minh nó làm harness mạnh hơn thật** (đo trước/sau, A/B), (3) SkillEvaluator (NVIDIA, Experimental) chỉ Tier 1 local cho 34 skill đang bật - không gửi skill ra ngoài.
- Ontology nghiệp vụ cho repo công việc (TwoHearts): để sau ("từ từ").

**Why:** R1 review tìm ra luật mâu thuẫn + drift repo/live + số câu luật tăng 30->53; ontology = một nguồn luật. PDF "harness_final.pdf" (ẩn danh, KHÔNG phải Google) khuyên: luật đã có sensor thì xoá khỏi guide, guide phải giảm dần, knowledge graph "do not add yet" -> dùng file.
**How to apply:** khi làm ontology, bắt đầu bằng file YAML/JSON + sensor kiểm nhất quán, không dựng graph DB; đặt chỉ số đo trước (mâu thuẫn luật, drift, số dòng guide, first-pass %) rồi so sau. Liên quan [[review-gate]], [[harness-upgrade-mandate]].
