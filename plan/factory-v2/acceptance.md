# Nghiệm thu giao diện và nghiệp vụ Factory V2

**Cập nhật UI/UX 06/11/2026:** [Đánh giá và kế hoạch nâng cấp](uiux-upgrade.md) là quyết định hiện hành: Light mặc định, Dark/System, Inter, vi/en và nhiều cửa sổ chat kéo/resize. Thay mục tiêu sao chép palette/font trên 90% và giới hạn một dock; giữ phạm vi nghiệp vụ và tiêu chí tin cậy. Prototype F0-02 còn dở, chưa có Host/UI V2 thật.

Thuộc [kế hoạch hợp nhất](README.md). **Mục tiêu, chưa phải kết quả đã đạt.** “Trên 90%” phải có cách đối chiếu và evidence, không chỉ là nhận xét cảm quan hoặc tỷ lệ code được viết lại.

## 1. Định nghĩa trên 90% giống CrewHub

Hai thang đo độc lập:

1. **Visual fidelity lịch sử:** đích cũ ≥92/100 toàn bộ, ≥91/100 mỗi màn hiện chỉ dùng tham khảo, không còn gate bắt buộc sao chép màu/font. Giao diện mới nghiệm thu theo quality matrix trong kế hoạch UI/UX; không có baseline CrewHub Light đã xác minh để công bố tỷ lệ giống.
2. **Business parity local:** độ bao phủ các khả năng được định nghĩa từ ảnh/trang Loops và nhu cầu người dùng. Đích **≥92/100**, đồng thời tất cả luồng bắt buộc bản 2.0 phải pass. Không dùng tỷ lệ này để chấp nhận 8% task sai hoặc bỏ kiểm tin cậy.

Nguồn Loops chưa đầy đủ backend/source: không thể chứng minh “mọi nghiệp vụ ẩn giống 90%”. Báo cáo chỉ ghi trên ma trận có phạm vi dưới đây. Remote/3D/native media chuyên sâu thuộc scope sau, không nhập mẫu số local rồi âm thầm bỏ.

## 2. Visual rubric lịch sử — chỉ tham khảo hình học

Các ngưỡng so khớp palette/font bên dưới thuộc mục tiêu cũ. Không áp làm gate cho Light Theme, Inter hoặc chat windows; chất lượng hiện hành dùng ma trận ở kế hoạch UI/UX. Các lỗi clipping/focus/scroll/contrast vẫn chặn nghiệm thu.

| Nhóm | Trọng số | Quan sát/đo |
|---|---|---|
| Bố cục chính | 25 | Sidebar/topbar/projectbar, vị trí toolbar/content/dock, tỷ lệ vùng và khoảng trắng |
| Màu và phân tầng | 20 | Canvas/surface/border/text/accent/primary buttons theo token; không sai tông chủ đạo |
| Typography | 15 | Font/glyph/weight/size/line-height, baseline và text wrapping |
| Components | 15 | Card/input/menu/button/chip/avatar/icon/radius/border |
| Mật độ thông tin | 10 | Thứ bậc title/body/meta, số hàng/card nhìn thấy, truncation hợp lý |
| Hình học tương tác | 10 | Height/padding/alignment/ports/arrow, scroll region/dock không che controls |
| State styling | 5 | Active/selected/working/review/disabled/focus/loading theo hệ chung |
| **Tổng** | **100** | Mỗi nhóm có checklist từng chi tiết ở UI-01–09 |

Chia mỗi nhóm thành checklist hữu hạn trước khi chấm; mỗi mục có trọng số bằng nhau trong nhóm, đánh 1 đạt / 0,5 sai khác nhỏ có mô tả / 0 thiếu hoặc sai. `screenScore = Σ(groupWeight × mean(itemScores))`. Lưu item-level results/crops, không gán một số 94% thiếu cơ sở. Tính overall là trung bình chín màn cùng trọng số; không lấy nhiều ảnh Dashboard để lấn át màn Graph chưa làm.

Đối chiếu ở canvas 1600×1000 CSS, DPR 2, browser zoom 100%, dark mode, font ready, dataset seed ổn định tương đương ảnh. Ảnh gốc 3200×2000; không suy ra CSS gốc từ pixel vật lý. So bounding boxes sau normalize, target sai số ≤4 CSS px cho shell/headers/control alignment; màu nền/surface phẳng target mỗi kênh RGB lệch ≤3, accent ≤6. Đây là ngưỡng khởi đầu đề xuất, F0-02 ghi vùng đo trước khi triển khai; không đổi ngưỡng sau để hợp thức hóa sai lệch.

So cả full-frame và crops toolbar/menu/card/chat/node. Mask chỉ phần nội dung động được kê trước: tên/giờ/task text/avatar/own logo. Không mask layout/controls/font/cột/card đang lỗi. Có thể dùng pixel diff/SSIM hỗ trợ với masking hợp lý; SSIM không thay rubric hay accessibility. Chấm typography bằng nhịp chữ/glyph/baseline nếu nội dung tiếng Việt khác, không coi mọi line break khác là bug.

**Lỗi chặn đạt dù score cao:** chữ/control đè nhau hoặc bị cắt, action quan trọng bị che, text không đọc được, dropdown sai focus/không thao tác keyboard, status không thể phân biệt, Board kéo dài vô hạn thay vùng cuộn, layout khiến không thấy lý do chờ. Những sai khác chủ động như brand ASF, tiếng Việt, Board cao theo viewport, helper gọn và timezone địa phương được ghi rõ; không dùng chúng làm cớ thay toàn bộ phong cách.

Màn không có ảnh chuẩn chấm consistency/flow, không nhập vào số “chín màn giống CrewHub” để tăng điểm. Cần đủ UI-01–09 trước tuyên bố đạt toàn bộ; Alpha F2 chỉ báo điểm các màn đã có.

## 3. Ma trận nghiệp vụ local

| ID | Khả năng từ reference / yêu cầu | Điểm | Bằng chứng cần có |
|---|---|---:|---|
| BP01 | Setup computer/runtime/readiness/auth | 6 | Thực trạng probe, lỗi/khôi phục và startup |
| BP02 | Project wizard/type/template/Lead | 6 | Tạo project qua wizard, không Git vẫn hoạt động |
| BP03 | Dashboard quick ask/feed/attention | 5 | Lead nhận đúng context, feed chỉ mốc hữu ích |
| BP04 | Lead chat/session/dock/context/attachments | 10 | Tư vấn và giao việc thật, reply/stop/reconnect |
| BP05 | Agent tự do/nhiều runtime/model/skills/tools | 10 | Ba adapter, agent CRUD, skill và MCP/CLI dùng thật |
| BP06 | Team/session/working-idle-blocked/freshness | 6 | Projection đúng từ run/task, không fake online |
| BP07 | Board/List/ticket/subtask/dependency/assignee | 10 | Một nguồn dữ liệu, task từng agent rõ, song song |
| BP08 | Workflow/status/custom fields/transition guards | 6 | Chỉnh workflow có revision, mapping/guards thực thi |
| BP09 | Questions/review/send-back/Done | 8 | Human-final/auto/hybrid, đúng output version |
| BP10 | Reports/documents/comments/export/evidence | 7 | BA thiết kế và output đọc/xuất được, refs đúng |
| BP11 | Automation rules/List/Graph/simulation/history | 12 | Event-condition-action thực, round-trip và chống lặp |
| BP12 | Schedules/templates/switches/history | 6 | Dispatch theo lịch, timezone, missed/dedup |
| BP13 | Search/saved views/archive/park | 4 | Tìm/mở/restore không replay |
| BP14 | Git overview/history/local task links | 2 | Repo thật, status/diff/history/freshness |
| BP15 | Provider PR/issues khi connection hợp lệ | 2 | Dữ liệu provider thật; unsupported ghi rõ |
| **Tổng** | | **100** | |

Mỗi hàng chi tiết thành cases ở ticket liên quan, chấm coverage như visual rubric bằng results verified/partial/not implemented. Dùng trọng số để theo dõi tiến độ, không tự đánh 1 chỉ vì có schema hoặc nút. **Release 2.0 cần BP01–BP14 đầy đủ theo scope**, BP15 conditional có thể chưa verified nếu thiếu auth, tối đa mất 2 điểm; ghi rõ giới hạn. Những yêu cầu mở rộng ngoài reference như domain jobs/permissions/recovery là mandatory quality gates bên dưới, không bị bỏ vì chưa có trong ảnh.

## 4. Luồng kiểm chứng bắt buộc

| Case | Kịch bản | Điều kiện đạt | Đợt |
|---|---|---|---|
| AT01 | Setup → project → Lead sửa việc nhỏ | Source/output/check có thật, đúng workspace, không Bash prompts thường ngày | F1/F2 |
| AT02 | Chat tư vấn rồi giao việc | Tư vấn không ticket rác; giao việc link/create đúng một lần dù double-send/reconnect | F2 |
| AT03 | Thiếu quyết định nghiệp vụ | Một câu hỏi rõ, trả lời trong chat/card, tiếp tục đúng nhánh/version; nhánh khác không đứng | F2/F4 |
| AT04 | Stop trong lúc runtime/tool đang chạy | Có interrupt/cancel và xác minh owned process tree dừng; không tiếp tục ghi output ngoài ý muốn | F2/F3 |
| AT05 | Host crash/WSL shutdown sau mutation | Reconcile outcome, không tự replay shell/action không rõ kết quả, không duplicate task/output | F2/F8 |
| AT06 | Đội hai runtime chạy độc lập | Hai task overlap về thời gian, đủ inputs/scopes; tranh file/resource thì chờ có lý do | F3/F4 |
| AT07 | Callback attempt cũ đến sau retry | Bị fencing, không ghi đè trạng thái/output của attempt mới | F3 |
| AT08 | Cài/gắn skill và MCP/CLI | Đúng pinned version, discovery/use thật, không tự chạy installer; grants không do skill nâng | F3 |
| AT09 | BA→FE/BE→integration→QA | Tasks rõ, BA docs đọc được, input versions đúng, tích hợp và evidence thực | F4 |
| AT10 | Đổi contract/output khi đang review | Review cũ bị stale, không Done sai bản; changed criteria không coi auto pass | F4 |
| AT11 | Human-final/Automatic/Hybrid | Cùng task khác policy ra đúng gate; không hỏi Accept từng shell và không bypass human-final | F4 |
| AT12 | Quota/auth/permission/network failures | Reason chuẩn, no retry flood; issue cấu hình được gom, không hundreds of Bash accepts | F1/F3/F8 |
| AT13 | Label routing + review rule | Typed action đúng grant/target; List/Graph cùng semantics; simulation không mutation | F5 |
| AT14 | Rule vòng lặp/conflict/master Off | Có loop budget/quarantine/conflict order; Off không đổi rule configs, trace giải thích | F5 |
| AT15 | Lịch timezone/missed/restart | Một occurrence tạo tối đa một dispatch record; skip/coalesce đúng, không chạy bù hàng loạt | F5 |
| AT16 | Nghiên cứu không repo | Tạo dự án/artifact, có nguồn/plan/output; không yêu cầu Git hoặc build code vô nghĩa | F6 |
| AT17 | Video basic render/preview/review/export | File đầu ra validate, job độc lập agent, cancel/disk-full/crash không xuất final dở | F6 |
| AT18 | Backup/import/restore V1 | Counts/hashes/links đúng, không overwrite DB thật, imported tasks không tự chạy | F8 |
| AT19 | Local API mở từ origin/session sai | Mutation bị chặn, secrets không nằm trong export/log/UI | F1/F8 |
| AT20 | Event stream reconnect/large dataset | Không event/task trùng hoặc trạng thái lùi; pagination/filter/scroll còn dùng được | F7/F8 |

Runtime matrix: Codex / Claude / OpenCode × installed/auth/version compatible × stream/stop/resume/error/tool grants. Test behavior chung bằng deterministic adapter fixtures trước; runtime smoke dùng model/quota được cấp để kiểm integration thật. Không gọi model cho mọi unit test. Nếu chỉ OpenCode pass thì báo một runtime pass, không tuyên bố cả ba.

## 5. UI/content và performance checks

Kiểm 1600×1000 reference, 1440×900, 1366×768, 1024×768 và mobile 390 px (adaptation); zoom 125%, nội dung tiếng Việt dài, nhiều badges, empty/loading/error/stale, mở menu sát bốn cạnh, keyboard/IME, reduced motion. Board scroll không kéo toàn page, Team không lệch header, chat giữ draft và composer không che messages/action. Cần bạn xử lý card luôn nêu “việc gì / chờ gì / thao tác nào”, không dump UUID/log.

Dataset thử tải: 1.000 task, 50 agent definitions, 10.000 events có pagination; không đồng nghĩa chạy đồng thời 50 model. Đo trên máy/WSL resource profile ghi rõ. Mục tiêu khởi đầu: UI interactions/filter cục bộ p95 ≤150 ms, projection query p95 ≤300 ms, reconnect render trạng thái nhất quán ≤2 giây sau khi Host phản hồi, ngoài model/network latency. Nếu chưa đạt ghi bottleneck/measurements và xử lý trước release khi cản trở luồng; không coi các số này là benchmark đã có.

Chỉ probe runtime theo TTL/explicit refresh; không mỗi render gọi `--version`/model. Giới hạn render/log payload, virtualize khi số liệu đo cần, giữ backpressure/event cursors. Không bổ sung framework/cache server chỉ vì dataset thử lớn.

## 6. Evidence và trạng thái hoàn thành

Mỗi ticket ghi: commit, môi trường/versions, commands/tests đã chạy, kết quả thực, output/hash/revision, lỗi/chưa chạy và giới hạn. Unit/integration tests tập trung state/ownership/idempotency/guards/import, UI tests tập trung flows quan trọng; không viết test chỉ mirror CSS hoặc chạy full build sau mọi thay đổi chữ.

Ảnh reference và screenshot QA giữ local `.cache/factory-v2/visual/` hoặc thư mục ignored, manifest/report text có thể commit; không push PNG, DB hoặc secrets. Chỉ chạy lint/typecheck/build/tests phù hợp module đổi; docs-only hiện tại kiểm links/JSON/hash/diff, **không báo app build/test đã pass**.

Điều kiện đóng F8: BP01–14 verified, business score ≥92, chín màn đạt quality gates và ma trận UI/UX Light/Dark × vi/en + window lifecycle, AT01–20 pass theo scope/capability đã công bố, không critical/high issues mở, backup/rollback dùng được và checklist three-runtime/effective permissions có evidence. Tính năng chưa nghiệm thu phải ghi partial/deferred.

## 7. Các khác biệt có chủ đích với reference

Brand ASF và tiếng Việt; quyền tool cấp trước thay Bash prompt; review policy có thể tự động theo tiêu chí; local timezone thay UTC-only; Board fill viewport; đơn giản hóa helper text; Git optional; local WSL không ép Tailscale/Docker/remote; multi-domain outputs. Giữ phong cách và vòng nghiệp vụ, không sao chép các giới hạn không phù hợp người dùng. Các khác biệt này được liệt kê trong release report, không dùng claim “90%” để ngụ ý sản phẩm là CrewHub chính thức.
