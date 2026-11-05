# Worker V2 — Đội AI đa lĩnh vực, nhiều runtime

> **Đã hợp nhất:** dùng [Factory V2 — kế hoạch hiện hành](../factory-v2/README.md), [UI theo chín ảnh CrewHub](../factory-v2/design-reference.md) và [40 ticket F0–F8](../factory-v2/delivery-plan.md). Yêu cầu mới lấy CrewHub làm chuẩn trên 90%, thay palette/font/tab cũ; WSL2/web Host, không bắt LangGraph. Tài liệu dưới đây là lịch sử/đầu vào nghiên cứu, không là backlog triển khai song song.

> **Định hướng mới nhất 05/11/2026:** người dùng yêu cầu không ràng buộc kiến trúc cũ. Đọc [quy trình mới và WSL2](process-first-wsl.md), [lộ trình P0–P5](process-first-roadmap.md) trước. Đề xuất hiện tại là web UI + Host/runtime trong WSL2, tự động quyền thao tác thường ngày, hỏi quyết định nghiệp vụ khi cần. Những đoạn bên dưới bắt buộc giữ Electron/Windows-native hoặc coi V2-01–07 là thứ tự phải theo đã được thay; giữ làm lịch sử thiết kế và backlog tham khảo. Chưa cài/migrate hoặc thay runtime/DB.

Ngày khảo sát: **05/11/2026**. Trạng thái: **đã chốt đề xuất kiến trúc và kế hoạch; chưa triển khai runtime V2**.

Baseline: `bf9b4977b1f26cb45dc5a0a095575b4148fda375`, nhánh `feature/worker-office-v1.3d`. Checkpoint: `checkpoint/worker-v2-design-20261105`. Không thay đổi DB thật trong đợt nghiên cứu này.

Mở rộng 05/11/2026 theo yêu cầu đội AI làm video, thiết kế, nghiên cứu và lập kế hoạch: [thiết kế đa lĩnh vực](multidomain.md), [nghiên cứu Paperclip bổ sung](paperclip-multidomain-research.md). Checkpoint trước mở rộng: `checkpoint/worker-v2-multidomain-20261105` tại commit thiết kế `1e01391`. Những ví dụ phần mềm bên dưới là một workflow mẫu, không phải giới hạn sản phẩm.

Yêu cầu tiếp theo lấy CrewHub Loops làm chuẩn nghiệp vụ: [ma trận tương đương Loops](loops-parity.md) và [automation engine + Graph/List](automations.md). Checkpoint `checkpoint/worker-v2-loops-parity-20261105` tại `87320cf`. Mở rộng này đưa project types, ticket/workflow cấu hình được, rules và graph editor vào phạm vi local 2.0; truy cập nhiều thiết bị thuộc profile 2.1 riêng. Chưa triển khai các khả năng mới.

## 1. Quyết định sản phẩm

Thiết kế lại Worker thành ứng dụng desktop quản lý **mục tiêu, dự án, đội agent và đầu ra đa lĩnh vực**, có thể giao việc cho Codex, Claude Code và OpenCode trong cùng đội. Phần mềm, video, thiết kế, nội dung và nghiên cứu dùng chung lõi công việc; công cụ chuyên môn và bộ mẫu được gắn theo nhu cầu. Không tiếp tục mở rộng mô hình bảy role cố định bằng các điều kiện riêng lẻ.

Giữ Electron/React/TypeScript, SQLite và Windows local-first. Tái sử dụng Git worktree, bằng chứng thực thi, quản lý process, lưu credentials và hồ sơ công việc hiện có. Thay mô hình agent/runtime, phân phối công việc, mailbox và cấu hình phần mở rộng. Không có dịch vụ cloud bắt buộc; không cần thêm Redis, PostgreSQL hoặc một orchestrator cạnh scheduler của Worker.

| Người dùng cần | Hành vi V2 đề xuất |
|---|---|
| Chạy nhiều công cụ AI | Một danh sách kết nối runtime; mỗi agent chọn một kết nối và model tương thích |
| Khai báo agent tự do | Tạo, nhân bản, tắt, lưu trữ agent; tên và vai trò tùy ý; Lead được chọn theo dự án |
| Cài skill từ repo/thư mục | Chọn đúng thư mục, xem nội dung/giấy phép/commit, cài phiên bản cố định và gắn cho agent |
| Dùng tool từ mã nguồn | Đăng ký MCP server hoặc CLI có cấu hình cài/chạy; không coi mọi URL Git là tool có thể chạy ngay |
| Agent phối hợp rõ ràng | Task có người nhận, dependency, contract đầu vào, đầu ra, tiêu chí nghiệm thu; tin nhắn gắn đúng task |
| Không bấm Accept Bash liên tục | Bộ quyền được cấu hình trước theo agent/dự án; quyền tự động và lỗi thiếu quyền hiển thị rõ |
| Biết ai đang làm gì | Trạng thái lấy từ task claim, process và sự kiện; hiện task hiện tại, bước gần nhất và lý do chờ |
| Chat dễ dùng | Trao đổi chủ yếu với Lead; khi giao việc, Lead liên kết tới các task cụ thể |
| Xem lại thiết kế BA | Tài liệu có phiên bản, xem/xuất được; FE/BE sử dụng cùng phiên bản contract |
| Làm việc ngoài phần mềm | Project không bắt Git; bộ mẫu lĩnh vực và đầu ra tài liệu/ảnh/âm thanh/video/source |
| Chạy render hoặc xử lý dài | Job có tiến độ, quyền, tài nguyên, stop/recovery riêng; agent không phải ngồi chờ model |
| Giao mục tiêu/lịch | Goal tùy chọn, task/subtask có owner; lịch có revision, dedup, skip/coalesce và budget |
| Tự động hóa như Loops | Event → conditions → actions; agent/label/status targets, Rule List/Graph cùng một model, trace và công tắc project/rule |
| Tùy biến nghiệp vụ | Project type, ticket/custom-field/workflow/review/rule templates; import/export không kèm secrets |

“Tự do” nghĩa là người dùng không bị khóa vào bảy role hoặc một catalog nội bộ. Mỗi runtime vẫn có giới hạn về model, xác thực, tool và khả năng tiếp tục session; ứng dụng phải hiển thị những giới hạn này.

## 2. Kết quả khảo sát quyết định hướng đi

- ASF hiện khóa `Role`, số lượng agent, policy và dispatch vào bảy role; runtime duy nhất là OpenCode. Sửa UI riêng không giải quyết được yêu cầu mới.
- CrewHub classic có abstraction kết nối và UX session đáng tham khảo, nhưng adapter Codex ở revision đã khảo sát vẫn là **stub**, chưa thực thi công việc.
- CrewHub World là prototype hoạt động mô phỏng. Trang CrewHub Loops công bố luồng ticket/Lead/report và onboarding đa CLI, nhưng không được coi những công bố đó là bằng chứng source đã chạy.
- Paperclip có adapter thực thi, session theo task, nhận việc nguyên tử, goals, đội có manager, routine revisions, tài liệu/đầu ra và budget admission. Học cơ chế; không nhập cả mô hình công ty/control plane. Workflow service đã đọc là prompt template, không được coi là bộ máy media hoàn chỉnh.
- Codex có App Server chính thức qua stdio; không cần dùng stub CrewHub. Claude có Agent SDK/CLI streaming; cần kiểm chứng xác thực và bộ quyền riêng.

Đọc [nghiên cứu và nguồn](research.md) để phân biệt tính năng thực tế, thiết kế và giới hạn giấy phép.

## 3. Bản V2 đầu tiên phải hoàn thiện những gì

Phạm vi bản **2.0**:

1. Tạo agent tùy ý; kết nối OpenCode, Codex và Claude Code; chọn runtime/model theo agent.
2. Tạo đội theo dự án, chọn Lead và giao task cho agent cụ thể.
3. Import skill và đăng ký MCP/CLI; có phiên bản, phạm vi và quyền truy cập rõ.
4. Mailbox bền vững, task graph, chạy song song khi độc lập; dừng/khôi phục không tự chạy lặp công việc.
5. Tài liệu/contract có phiên bản; Board, Chat, Đội ngũ, Tài liệu và Cần xử lý dùng dữ liệu thực.
6. Migration từ V1 có backup, bảo toàn lịch sử và đường quay lại.
7. Workspace có hoặc không Git; domain packs, đầu ra có kiểu, job runner, resource/budget admission và lịch chống trùng.
8. Nghiệm thu Software, Research & Planning không repo, và Video Basic bằng FFmpeg/ffprobe với tài nguyên được cung cấp. Template Design/Content dùng lõi chung; công cụ chuyên sâu cần connection/tool riêng.
9. Project type/ticket/workflow editor, rule engine và List/Graph, schedule → dispatch/report, lifecycle Draft/Proposed/On/Off; chống vòng lặp, simulation và history.
10. Ticket review policy tách khỏi quyền Bash: human-final tương thích Loops, policy-auto theo bằng chứng hoặc hybrid. Search/views/archive/park và reports/comments nối cùng hồ sơ. Chức năng Git provider có phạm vi riêng, không đánh đồng local Git với GitHub PR/issues.

Chưa nằm trong 2.0: 3D, marketplace công khai, tool chạy trên máy khác, điều phối phân tán, native subagent không giới hạn, extension JavaScript chạy trong Electron main, kết nối hệ quản lý dự án/server mới, điều khiển timeline NLE chuyên nghiệp, tạo video AI trả phí và tự đăng nội dung ngoài app. Có thể thêm sau khi lõi V2 ổn định.

## 4. Một luồng công việc mẫu

```text
Người dùng ↔ Lead (Codex)
               │ tạo kế hoạch task + điều kiện hoàn thành
               ▼
         Analyst (Claude) ── yêu cầu + data model + API contract v1
                              │                       │
                              ▼                       ▼
                         UI (Codex)               API (OpenCode)
                              └───────────┬───────────┘
                                          ▼
                                  tích hợp source
                                          ▼
                                   QA (runtime đã chọn)
                                          ▼
                                   Lead tổng hợp
                                          ▼
                            Người dùng xem kết quả / yêu cầu sửa
```

Đây là ví dụ, không phải một chuỗi role bắt buộc. Dự án có thể chỉ dùng một agent hoặc một đội khác. UI và API chạy đồng thời sau khi contract đủ rõ; xung đột file/source hoặc thiếu quota phải hiện lý do chờ. Agent cần trao đổi gửi câu hỏi gắn task, không tự tạo vòng hội thoại vô hạn.

## 5. Thứ tự triển khai

| Đợt | Kết quả có thể dùng | Phụ thuộc |
|---|---|---|
| V2-00 | Baseline, thiết kế, nguồn nghiên cứu, checkpoint | Hoàn thành tài liệu trong đợt này |
| V2-01 | Runtime interface + agent tùy ý; task/output/workspace không khóa vào code; chạy qua OpenCode hiện có | V2-00 |
| V2-02 | Codex App Server hoạt động qua cùng interface | V2-01 |
| V2-03 | Claude adapter và chọn runtime/model trên agent | V2-01; nghiệm thu đội hỗn hợp sau V2-02 |
| V2-04 | Skills/MCP/CLI/domain packs, project types/templates/workflow editor, quyền cấu hình trước | V2-01; kiểm tra cả ba adapter sau V2-03 |
| V2-05 | Mailbox/DAG/claims, artifacts/jobs/resources/budgets; rules engine, simulation/List và schedule dispatch | Mô hình V2-01; nối adapter/extension trước nghiệm thu |
| V2-06 | UX đa lĩnh vực, automation Graph, output/job preview, reports/search/views; Git connector theo capability | UI tối thiểu có từ V2-01; hoàn thiện sau V2-05 |
| V2-07 | Migration/recovery/đóng gói; nghiệm thu ba lĩnh vực và ma trận Loops local | V2-02–06 |

Đọc [kiến trúc](architecture.md), [giao diện và hành trình sử dụng](ux.md), [backlog và điều kiện hoàn thành](implementation.md). Không đợi đến V2-06 mới làm UI, và không đợi đến V2-07 mới viết kiểm thử. Mỗi đợt phải có một lát cắt hoạt động thực tế.

## 6. Điều kiện khởi động

Máy khảo sát có `codex-cli 0.166.0` và `opencode 1.19.5`. Lệnh `claude` chưa được tìm thấy trong PATH. Chưa xác minh xác thực, gọi model hoặc khả năng cung cấp model của từng tài khoản trong đợt này.

Có thể bắt đầu **V2-01 ngay trên source hiện tại**, không cần tạo VM hay cài một hệ điều phối mới. Codex/Claude cần kiểm tra phiên bản, xác thực và model trước khi nghiệm thu adapter tương ứng; không chặn việc tách lõi OpenCode. Giữ 9Router như một lựa chọn provider cho kết nối phù hợp; không mặc định mọi endpoint 9Router dùng được với Codex hoặc Claude.

Video cần FFmpeg/ffprobe và storage/tài nguyên phù hợp, chưa được cài hoặc xác minh ở đợt thiết kế. Domain pack không tự mang theo mọi executable/API. Lịch local chỉ chạy khi Worker Host hoạt động; chưa có background service bắt buộc. Phạm vi đa lĩnh vực làm V2-04–07 lớn hơn kế hoạch gốc, cần chia các lát cắt trong backlog, không coi là một lần đổi nhãn giao diện.

Chuẩn Loops bổ sung backlog LP-01–LP-08 theo [ma trận](loops-parity.md); không thể tuyên bố “y hệt 100%” từ trang giới thiệu và ảnh. Khi triển khai đối chiếu hành vi có evidence, ghi partial cho provider/remote chưa đạt. Không sao chép thương hiệu/asset hay đổi nền Windows sang WSL chỉ để giống kiến trúc tham khảo.

Đây là thay đổi lớn về sản phẩm nên gọi là **Worker V2**, thay vì tiếp tục gắn thành một đợt sửa UI V1.3. Các đợt R0–R6 cũ không bị coi là chưa làm; chúng là nền được kế thừa.
