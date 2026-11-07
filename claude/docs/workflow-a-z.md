# Workflow A đến Z trên máy Line

Cập nhật 2026-09-28 (Line: dòng GPT-6; Sol cho Skip và Standard-A, Astra cho Standard-B trở lên; khám phá Luna max rồi Sol ultra). Nguồn luật: `~/.codex/AGENTS.md` (team v1.0 + addendum §15) và `~/.claude/CLAUDE.md` (harness Claude). File này chỉ tóm tắt, không thay luật.

## Vai trò

| Vai | Ai | Model | Làm gì |
| --- | --- | --- | --- |
| Line | người | - | Ra ý định, quyết định fork, duyệt tier Critical, ra lệnh commit và push |
| Supervisor | Claude Code | Opus 5.5 high mặc định; Fable 5.1 qua `/model` cho lớp 3 Important/Critical, root-cause khó, kiến trúc | Interview, spec, decompose, packet, đọc verdict, quyết định ship, memory |
| Worker | Codex CLI | Skip, Standard-A: GPT-6 Sol high. Standard-B, Important, Critical: GPT-6 Astra high qua `-Model`. High thất bại: Astra xhigh. `-Fast` = medium. Fast tier luôn bật | Viết code trong sandbox, tự test, báo diff và kết quả validate |
| Explorer | Codex CLI | Tầng 1 tìm, liệt kê, đếm, sửa hàng loạt: GPT-6 Luna max. Tầng 2 tổng hợp nhiều module, bằng chứng mâu thuẫn, root-cause: GPT-6 Sol ultra | Khám phá, gom bằng chứng, sửa hàng loạt cơ học |
| Lớp 1, cổng máy móc | Script `codex-review.ps1` | Không có model | Typecheck, lint, quét secret, quét console.log. Chạy trước mọi review |
| Lớp 2, reviewer | Codex CLI, session mới | Astra high | Đọc diff và tiêu chí, trả PASS hoặc FAIL. Chỉ Important và Critical |
| Lớp 2b, reviewer khác hãng | Claude subagent, context mới | Fable 5.1 | Chỉ Important và Critical |
| Lớp 3, supervisor kiểm chứng | Claude Code | Opus 5.5 ở Skip/Standard; Fable 5.1 ở Important/Critical | Đối chiếu từng tiêu chí, chạy lại validate, chạy thật. Bắt buộc mọi tier |

## Các bước

1. Nhận yêu cầu. Supervisor xác nhận thư mục và project, đọc `AGENTS.md` gần nhất và `.handoff/` mới nhất, route qua `team-router`. Việc TwoHearts đi qua `twohearts-engineering-standards` trước.
2. Interview khi có fork thật, việc lớn, hoặc hai cách đọc. 2 đến 4 câu, mỗi câu có lựa chọn, lựa chọn khuyên dùng đứng đầu. Việc rõ và nhỏ thì bỏ qua bước này.
3. Chọn tier: Skip, Standard, Important, Critical. Tier quyết định số reviewer và có cần Line duyệt không.
4. Viết packet theo mẫu §4: GOAL, BUSINESS REASON, SUCCESS CRITERIA, FILES, PATTERNS, CONSTRAINTS, NON-GOALS, DONE WHEN, VALIDATE, STOP RULES, ROLLBACK. Supervisor lấy sẵn dữ kiện ngoài (docs, API, số liệu) và nhúng vào packet. Worker không có MCP.
5. In packet đầy đủ ra màn hình trước khi gọi worker.
6. Gọi worker. Việc một lần: `codex-do.ps1 -Dir <repo> -SpecFile <packet>`. Việc dài: plugin `codex-rescue` chạy nền, theo dõi `.job.updatedAt`. Worker chỉ ghi trong `-Dir`. Home directory thì worker làm trong bản chép ở scratchpad, supervisor chép về sau khi kiểm chứng.
7. Worker tự chạy VALIDATE và trả diff cộng kết quả. STOP RULES bắt worker dừng và báo khi thiếu tiền đề, mơ hồ, hoặc chỉ còn cách hack.
8. Supervisor đối chiếu diff với từng SUCCESS CRITERIA, tự chạy lại VALIDATE, và chạy thật thay đổi ít nhất một lần. Không tin self-report. Bước này bắt buộc ở mọi tier và không bao giờ giao lại cho Codex, vì Codex chấm Codex có thể cùng sai một chỗ.
9. Review gate, là lớp thêm vào bước 8, không thay bước 8. Chuỗi kiểm tra theo tier:

| Tier | Điều kiện | Viết code | Lớp 1 cổng máy móc | Lớp 2 review session mới | Lớp 3 supervisor | Line |
| --- | --- | --- | --- | --- | --- | --- |
| Skip | dưới 20 dòng, config, typo, đổi tên, docs | Astra hoặc tôi | không | không | Fable 5.1 chạy validate | không |
| Standard-A | 1 đến 2 file, có validate chạy được, logic một nhánh, packet có ví dụ vào ra | Sol high | có, `codex-review.ps1 -SkipModel`, không gọi model | không. Tôi được tự bật khi diff trên 150 dòng hoặc logic nhiều nhánh, ghi lý do vào ledger | Fable 5.1 đối chiếu tiêu chí, chạy validate, chạy thật | không |
| Standard-B | từ 3 file, chuỗi lệnh dài, phải tự tìm ngữ cảnh trong repo, validate mơ hồ, hoặc Sol từng STOP hay FAIL ở việc tương tự | Astra high | có, `-SkipModel` | không, như Standard-A | như Standard-A | không |
| Important | nhiều file, API contract, module dùng chung | Astra high | có | Astra high session mới, cộng subagent Fable 5.1 context mới. Bắt buộc, không được bỏ | như trên | không |
| Critical | security, payment, auth, migration | Astra high, xhigh nếu high thất bại | có | Astra high session mới, cộng subagent Fable 5.1 | hai lượt | duyệt bằng chữ |

   Lớp 1 không có model: chỉ chạy tsc, lint, và so khớp regex trên diff. Worker có model nhưng viết bài thì không được chấm bài, nên không tính là lớp kiểm tra. Ở Standard vẫn có hai model làm việc: Sol hoặc Astra viết tùy A hay B, Fable chấm. Tier con ghi vào đầu packet trước khi gọi, kèm lý do một dòng.
10. FAIL thì quay lại bước 6 với finding, rồi bước 9 với reviewer mới. Ba lần FAIL thì dừng và báo Line.
11. Ship: supervisor chép file vào chỗ thật, chạy kiểm tra cuối, báo cáo theo Completion Contract §14 với nhãn Verified, Static review only, hoặc Not verified. Không commit, không push, trừ khi Line ra lệnh đích danh.
12. Learn: ghi memory cho điều không suy ra được từ code, cập nhật handoff khi gần hết context hoặc kết thúc phiên. Ghi một dòng vào `~/.claude/state/review-ledger.log`: ngày, tier, lớp 2 có chạy không, số lỗi từng lớp bắt được. Sau 20 dòng, tổng kết và chỉnh tier bằng số.

## Context window

- Statusline ghi phần trăm context của phiên ra file cache mỗi lần vẽ.
- Hook `context-guard.ps1` đọc file đó ở mỗi lượt Line gửi tin và chèn cảnh báo: 60 đến 69 CHECKPOINT, 70 đến 79 OFFER HANDOFF, từ 80 HANDOFF MANDATORY. Dưới 60 im lặng.
- Hook chỉ nhắc. Từ 80 supervisor phải tự chạy `/handoff`.
- Delegation giữ output worker ngoài context supervisor: worker tiêu 82.000 token, supervisor chỉ nhận 40 đến 60 dòng cuối.

## Cửa an toàn

- Không đụng DB production, auth, payment, secrets, deploy, GitHub write lớn nếu Line không yêu cầu bằng chữ.
- Không đọc giá trị secret. Chỉ kiểm tra tên biến có tồn tại.
- Song song hai worker chỉ khi phạm vi file hoàn toàn rời nhau.
- Job không cập nhật timestamp 5 phút là zombie. Job chậm nhưng còn nhịp thì để chạy.

## Hiệu quả, số đo được

| Số | Giá trị | Nguồn |
| --- | --- | --- |
| Khởi động worker lean so với có MCP | 12.6 giây so với 48.7 giây | đo 2026-08-01 |
| Một lượt lớp 2, diff nhỏ | 17.713 token Codex, 8 đến 13 giây | đo 2026-09-08 |
| Lớp 1 ở Standard | vài giây, 0 token | đo 2026-09-08 |
| Hook context | dưới 300 ms mỗi lượt | đo 2026-09-08 |
| Task statusline hôm nay | worker 54k token, một lượt, supervisor kiểm chứng đạt 5/5 tiêu chí | 2026-09-07 |
| Task codex-review.ps1 | worker 82k token, một lượt code, supervisor vá 2 chỗ parse verdict sau khi thử thật | 2026-09-08 |
| Mục tiêu tỷ lệ việc | supervisor 30, worker 70 | AGENTS.md §1 |

Ledger 3 task đầu (7 đến 8/9): lớp 3 bắt 2 lỗi, lớp 1 và lớp 2 bắt 0. Hạn mức Codex: Astra ăn 6,5 điểm mỗi triệu token so với Sol 5,1; sáng 8/9 lên 13,5 sau khi OpenAI reset cửa sổ, nên Line rút Astra về chỉ Critical. Chưa đo: tỷ lệ FAIL, số lần làm lại, lỗi lọt production. Ledger ghi tiếp từ giờ.

## Đây có phải harness do Line tự dựng không

Có. Nền là hai sản phẩm có sẵn: Claude Code và Codex CLI. Mọi thứ nối chúng thành một quy trình là do Line và supervisor dựng trên máy này:

- Luật: `AGENTS.md`, `CLAUDE.md`, mẫu packet, tier, review gate.
- Script: `codex-do.ps1`, `codex-review.ps1`, hook delegation-reminder, hook context-guard, hook chất lượng, statusline UltraThink.
- Kho skill dùng chung tại `D:\01_Workspaces\SKILLs-repository`.
- Memory và handoff để phiên sau tiếp tục.
- Backup tại `D:\01_Workspaces\agent-coding`.

Đây là harness cá nhân, dùng chung một phần với team qua kho skill. Không phải sản phẩm đóng gói, và không có ai bảo trì ngoài Line.
