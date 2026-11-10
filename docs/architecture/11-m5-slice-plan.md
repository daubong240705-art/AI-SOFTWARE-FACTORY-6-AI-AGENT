# 11 · Kế hoạch lát cắt M5 (Workflow, Automation, Policy)

Trạng thái: **bản nháp tự quyết 08/11/2026** (người dùng giao quyền tự quyết cho phần M3 → M5; xem bộ nhớ dự án). Nguồn thiết kế đã duyệt: [04 · Workflow và Governance](04-workflow-and-governance.md) (W-01..W-18), [06 §M5](06-implementation-roadmap.md). Mức hiện thực: control plane xác định, không LLM; Lead chỉ **đề xuất**.

## Nguyên tắc

- Mỗi lát cắt: đặc tả → Codex (`codex-routing`) → review, đột biến, test Windows + Linux → commit. Lát cắt có cờ rủi ro dùng quyền tự quyết (ghi quyết định vào commit).
- Migration chỉ thêm số mới (0010 trở đi). Contracts chỉ thêm.
- **Không đổi hành vi M3**: workflow là lớp bổ sung; Task/CTR/Approval hiện có giữ nguyên. Workflow chỉ **tạo và nối Task** bằng đường lệnh sẵn có.
- **Quyết định thứ tự (tự quyết)**: roadmap ghi M5 phụ thuộc M4 (nhiều máy). M4 cần hai VM của bạn (AP-7) nên chưa làm được; lõi workflow, lịch và chính sách chạy trên một máy trước. Phần cần control plane tách khỏi máy làm việc (lịch 24/7) dùng nguyên cơ chế một máy và chuyển sang M4 sau, không đổi dữ liệu.
- **Giao diện**: chỉ API và màn hình tối thiểu; bạn sẽ có yêu cầu cải thiện giao diện lớn sau M5.
- **Khảo sát OSS**: croner (MIT) cho cron, đã duyệt ở OSS-11; cockatiel không cần (đã có cầu dao riêng ở V2b, sẽ tái dùng mẫu); không dùng n8n, Temporal, LangGraph (04 §1, OSS-08). Điều kiện dùng biểu thức có kiểu tự viết (không json-logic: tránh phụ thuộc, tập phép toán nhỏ).

## Lát cắt

| # | Lát cắt | Nội dung | Rủi ro |
|---|---|---|---|
| **W1a** | **Định nghĩa và Instance (dữ liệu)** | Schema Workflow Definition (tham số có kiểu, stage gắn capability, cạnh `finish-to-start`/`artifact-approved`/`informs`/`rework`, `parallelGroup` + `joins`, `gates`, `allowedPatches`, điều kiện có kiểu `includeIf`/`skipIf`) trong contracts; validator xác định (DAG, tham chiếu, giới hạn, capability tồn tại trong Pack nào đó); `pack.json` thêm `workflows`; `pack:check` kiểm; migration 0010: `workflow_instances`, `workflow_stages`; lệnh `workflows.create/start/pause/resume/cancel` và máy trạng thái Instance (04 §8.3); view API | Migration, public API → Critical |
| **W1b** | **Bộ máy chạy** | Stage → Task (capability, Engagement chọn theo danh sách ngắn xác định), cạnh/chặn, song song và join all/any/quorum, cổng (Execution Gate, approval), rework có `maxLoops`, hoàn tất/thất bại Instance; phản ứng khi Task/Artifact đổi trạng thái | Orchestration → Critical |
| **W2** | **Plan Patch** | Tool MCP `workflow.patch` cho Lead; validator; `allowedPatches` auto / approval / operator; revision; từ chối chu trình | Public API, security |
| **A1** | **Scheduler** | croner; lịch theo Project/Workflow; misfire skip/coalesce; không chạy chồng; khởi động lại không chạy bù ngoài ý muốn | Dependency (đã duyệt OSS-11) |
| **A2** | **Rule, Monitor, Watchdog** | Rule Evaluator (hop limit, quarantine rule lặp), Monitor theo cạnh, Watchdog phát hiện treo/deadlock → Stalled + chẩn đoán | |
| **P3** | **Policy** | Ngân sách nhiều cấp theo token (chưa có giá nên không quy tiền), reservation, mức tự chủ L0–L4, cầu dao | AP-8 do bạn duyệt giá trị mặc định |
| **N1** | **Approvals và thông báo** | Standing Approval, TTL, nhắc, digest, giờ yên lặng; ntfy nếu bạn bật | AP-8 |
| **E2** | **Kịch bản** | 04 §15.1 (Software Delivery: bỏ Design khi không có UI, rework QA → Dev ≤ 3 vòng), Reporting ngày §16 bằng runtime giả; model thật chờ bạn | |

## Tiến độ

| # | Trạng thái | Commit | Ghi chú |
|---|---|---|---|
| W1a | Xong | (commit này) | Schema Workflow Definition + validator xác định (chu trình, cạnh, join, điều kiện có kiểu, không có code), `pack.json` khai báo `workflows`, workflow `software-delivery` cho `software-team` (digest của gói này đổi có chủ ý), Instance + máy trạng thái 04 §8.3 (migration 0010), lệnh `workflows.create/start/pause/resume/cancel`, route đọc. Chưa tạo Task (W1b). Codex hết giờ 900 s sau khi ghi gần đủ; lead sửa 2 test đếm lệnh/trường registry và thêm test bổ sung |
| W1b | Xong | (commit này) | Bộ máy workflow xác định: Stage thành Task (một Task mỗi lần lặp, mã `WF-nnn`, brief chỉ từ định nghĩa), cạnh finish-to-start/artifact-approved/informs, join all/any/quorum, skipIf với fact thật (`project.hasApprovedArtifact`, `review.verdict`, `artifact.status`), cổng Go/review, rework có giới hạn và phản hồi review, chọn đội xác định (năng lực, dự phòng legacy, gợi ý, tải) + lệnh `workflows.assign-stage`, trạng thái awaiting-approval/stalled/completed, kích hoạt theo sự kiện và vòng quét 60 s (migration 0011). Chưa có fact label/check/monitor (tính là chưa biết = false) |
| W2 | Xong | (commit này) | Plan Patch: 6 thao tác (thêm việc trong Stage, bỏ Stage tùy chọn, tách, thêm, đổi thứ tự, gỡ Stage bắt buộc) kiểm xác định và ghi audit (migration 0012); chính sách `allowedPatches` (Lead chỉ tự áp được mức `auto`, còn lại chờ operator quyết bằng `workflows.decide-patch`); chỉ áp lên Stage chưa bắt đầu và chưa có Task; tool MCP `workflow.patch` mặc định từ chối, chỉ seat nào Pack khai báo rõ; bộ máy tạo Task phụ đúng một lần; patch chờ duyệt hiện trong Inbox |
| A1 | Xong | (commit này) | Scheduler: lịch `cron`/`interval`/`once` (croner 11.0.0 ghim chính xác, múi giờ IANA, mặc định `Asia/Ho_Chi_Minh`), mỗi lần chạy là một Occurrence có khóa chống trùng, mã lệnh xác định nên không thể khởi động hai instance cho một lần chạy; chính sách lỡ lịch skip/coalesce-once/catch-up-limited, concurrency skip-if-running/queue-one/allow-parallel, 3 lần lỗi liên tiếp thì tự tắt (quarantine), đồng hồ lùi không chạy, trần 100 occurrence mỗi tick; route đọc lịch và lịch sử (migration 0013). Chưa có trigger theo sự kiện, monitor, giờ yên lặng, ngân sách (A2/P3/N1) |
| A2a | Xong | (commit này) | Watchdog: đưa Instance `active` sang `stalled` với lý do cố định (hết thời gian tối đa, không tiến triển quá `stallAfterMinutes`, deadlock có tên các Stage bị chặn), tự resume được; Monitor: 4 probe nội bộ xác định (tuổi artifact đã duyệt, approval quá hạn, số workflow `stalled`, dung lượng đĩa trống của thư mục trạng thái), trễ trip/recover, chỉ phát sự kiện khi đổi trạng thái (`monitor.changed`, `workflow.state-changed`), Inbox thêm monitor đã trip và workflow stalled (migration 0014). Không có probe HTTP (không dùng mạng) |
| A2b | Xong | (commit này) | Rule theo sự kiện (migration 0015): điều kiện kiểu dữ liệu (eq/ne/in, all/any/not, không có mã), con trỏ sự kiện theo dự án, khởi chạy workflow bằng id xác định từ (dự án, rule, sequence) nên xử lý lại không tạo trùng; chặn vòng lặp (độ sâu nhân quả >3), debounce, giới hạn số lần/giờ (vượt thì cách ly), không chạy khi bản trước còn chạy, 3 lỗi liên tiếp thì cách ly; chỉ resume mới gỡ cách ly. 24 mutant, đều bị giết hoặc tương đương. |
| P3a | Xong | (commit này) | Chính sách phần 1 (migration 0016): ngân sách thêm hai cấp Project (cộng dồn) và Engagement, thứ tự kiểm day → project → engagement → task và báo cấp bị vượt đầu tiên; project/engagement không có hạn mức ngầm (chỉ khi đặt rõ); mức tự chủ L0–L4 (mặc định đã chọn, ghi cho AP-8: Project L3, Team L2, Team hiệu lực = min với Project; không bao giờ cho phép danh sách luôn-cần-Operator); chỉ chặn hai chỗ: Plan Patch auto hạ xuống approval khi mức < L3, CTR produce cần ≥ L3 và clarify/consult cần ≥ L2; lệnh autonomy.set và route GET /projects/:id/autonomy. Chưa làm: ngân sách Organization/tháng (chưa có thực thể Organization), cầu dao (P3b). 30 mutant, đều bị giết. |
| P3b, N1, E2 | Chưa | — | |
