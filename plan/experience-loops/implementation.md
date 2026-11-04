# Kế hoạch triển khai cải thiện trải nghiệm

Trạng thái: **UX-01–02 đã hoàn thành; tiếp theo UX-03**. Worker `1.3.0-alpha.8` / SQLite **8** sau UX-02; baseline UX-01 `34213d7` dùng SQLite 7. Giữ một active run toàn ứng dụng, tối đa hai lane tương thích trong isolated-pair. [Thiết kế](design.md), [khảo sát](research.md), [bàn giao UX-01](../../docs/windows-worker/ux01-completion.md), [UX-02](../../docs/windows-worker/ux02-completion.md).

## 1. Nguyên tắc triển khai

- Tạm dừng D-05 và nghiệm thu/hiệu năng liên quan 3D. Không xóa code hoặc dependency 3D trong đợt lập kế hoạch này. Kiểm thử chất lượng 2D tiếp tục theo từng lát cắt, không chờ 3D.
- Trước thay đổi lớn: kiểm tra HEAD/working tree/AGENTS, tạo Git checkpoint từ source đã thống nhất; không gom file người dùng chưa tracked vào commit. Mỗi UX là một hoặc vài commit có bàn giao riêng.
- Không thêm framework hoặc service. Renderer chỉ hiển thị/gửi ý định; main process validate schema/project, ghi DB và gọi Controller hiện có.
- Full access giữ policy hiện tại. Evidence gate, giới hạn chi phí/thời gian/vòng sửa và snapshot model/skills tiếp tục có hiệu lực.
- Phần này là công việc mới sau alpha.8, không tự tuyên bố V1.3 stable khi các hạng mục nghiệm thu cũ còn treo. Số release chốt lúc phát hành, không bump version vì tài liệu.

## 2. Các đợt và tiêu chí hoàn thành

### UX-01 — Tổng quan, điều hướng và hoạt động gọn (P0)

**Đã triển khai U1-01–05.** Tổng quan giới hạn 12 lượt logic gần nhất, tối đa 50 yêu cầu chờ và 12 mốc của lượt hiện tại/gần nhất; không phải inbox toàn bộ lịch sử hoặc nhiều project. Kiểm tra và giới hạn ghi trong bàn giao.

**Phụ thuộc:** baseline hiện tại. **Không migration.**

| Mã | Công việc | Nghiệm thu |
|---|---|---|
| U1-01 | Project header/sidebar thống nhất, điểm vào Hỏi Lead/Tạo công việc | Đổi trang giữ project, active-run khác project có nhãn đúng; Office còn trong nhóm phụ |
| U1-02 | Tổng quan project từ monitor/queue/run summary hiện có | Có loading/empty/error/stale; không gọi monitor cho toàn bộ project |
| U1-03 | Inbox các trạng thái hiện có: quyền, needs_input, queue held, lỗi cần xử lý | Chỉ rõ lý do; action dùng capability thật. Chưa có QuestionSet thì dẫn tới bổ sung ngữ cảnh hiện có |
| U1-04 | Timeline ngắn dùng compactTimeline, nhóm lặp; log sâu theo yêu cầu | Run/task/attempt đúng; không mất lỗi/stop/finish; không gọi LLM để tóm tắt feed |
| U1-05 | Hoàn thiện primitive layout/menu cần dùng và kiểm tra cửa sổ nhỏ | 1366×768, 850×700, scaling 125–150%; không lệch icon, dính chữ hoặc composer bị che |

**Source chính:** `src/App.tsx`, `src/ui/*`, `src/lib/use-monitor.ts`, `monitor-store.ts`, `shared/inspector.ts`, `src/features/TaskInspector.tsx`; mới `src/features/ProjectOverview.tsx` và selector thuần cho attention items. Reuse API hiện có trước; chỉ thêm summary IPC nếu dữ liệu bắt buộc chưa có, không trả toàn bộ event/diff.

**Bàn giao:** màn hình làm việc hàng ngày rõ ràng hơn, chưa cần đổi entity Board. Kiểm tra type/build/format, selector attention bằng test trạng thái thật và UI regression các màn hình bị ảnh hưởng.

### UX-02 — Hồ sơ công việc bền vững (P0)

**Đã triển khai U2-01–05.** BoardItem hiện có được mở rộng, thêm lịch sử requirement/submission/attempt và trao đổi; không tạo hệ thống ticket riêng. Giới hạn, migration và kiểm chứng ghi trong [bàn giao](../../docs/windows-worker/ux02-completion.md).

**Phụ thuộc:** UX-01. Đây là thay đổi dữ liệu chính đầu tiên.

| Mã | Công việc | Nghiệm thu |
|---|---|---|
| U2-01 | Mở rộng BoardItem, mã công việc, criteria/revision, link conversation | UUID/links cũ giữ nguyên; tạo mã atomic; không có entity ticket độc lập trùng BoardItem |
| U2-02 | Discussion và lịch sử revision; giữ snapshot yêu cầu từng submission | Sửa description/criteria không đổi yêu cầu của run cũ; optimistic conflict không ghi đè âm thầm |
| U2-03 | Panel Tổng quan/Trao đổi/Lần thực hiện, mở rộng toàn trang | Mở từ card giữ filter/scroll; đóng trả focus; chọn task mở đúng inspector |
| U2-04 | Board/List cùng projection; card gọn, cột cố định theo viewport | Runtime không drag đổi trạng thái; retry không tăng mẫu số hoặc tạo card trùng |
| U2-05 | Migration, export, retention, xóa project và legacy runtime cards | Upgrade từ schema 7 không mất dữ liệu; cancel/held/link vẫn nhất quán sau restart |

**Source:** `shared/board.ts`, `shared/contracts.ts`, `shared/channels.ts`, `electron/preload.ts`, `electron/main.ts` (kiểm tra vị trí handler lúc code), `electron/storage/database.ts`, `storage/board.ts`, `controller/board.ts`, `src/features/KanbanBoard.tsx`; mới `WorkItemPanel.tsx`, repository discussion và test migration tương ứng.

### UX-03 — ChatHost và trò chuyện theo ngữ cảnh (P0)

**Phụ thuộc:** UX-02; có thể tách refactor presentation ChatHost trước nhưng không gắn ticket giả.

- U3-01: tách state/lifecycle ChatWorkspace khỏi fullscreen layout thành một ChatHost; dock/fullscreen dùng chung composer, draft flush và run-detail store.
- U3-02: context chip project/work item/revision; Hỏi Lead từ Board, Team, kết quả về đúng hội thoại. Người dùng thấy và có thể thay đổi ngữ cảnh trước khi gửi.
- U3-03: trạng thái message đã lưu/chờ/held/đang xử lý/có phản hồi/lỗi dựa vào message/follow-up/run thật; không suy diễn model đã đọc.
- U3-04: điều chỉnh prompt giao tiếp Lead cho trả lời tự nhiên, ít mô tả nội bộ, hỏi khi cần; giữ protocol plan/review và routing hiện tại.
- U3-05: context builder bounded, gắn decisions/criteria hiện hành và refs, không đưa toàn bộ tool output. Không trộn project hoặc tự replay lệnh cũ.

**Source:** `src/features/ChatWorkspace.tsx`, `ChatMarkdown.tsx`, `src/chat.css`, `src/lib/run-detail-store.ts`, `shared/chat.ts`, các method conversation/follow-up trong `electron/storage/database.ts`, Controller và `electron/team/profiles.ts`/`handoff.ts` theo trách nhiệm hiện có; mới `ChatHost.tsx`, `ChatDock.tsx` nếu component hiện tại chưa đủ.

**Nghiệm thu:** chuyển fullscreen/dock giữ draft/IME/scroll; chỉ một writer/subscription tương ứng; double submit chỉ tạo một message/run; held/restart/error không hiển thị đã gửi thành công sai. Test conversation scoping, context budget và queue; UI nhập tiếng Việt, cửa sổ hẹp và run streaming.

### UX-04 — Câu hỏi nghiệp vụ có cấu trúc (P0)

**Phụ thuộc:** UX-02/03. Không dùng regex từ prose để biến thành câu hỏi có tính ràng buộc.

- U4-01: mở rộng versioned Lead decision bằng nhánh `questions`, giữ parse tương thích reply/plan cũ; validate số câu/options/text và refs hợp lệ.
- U4-02: store QuestionSet, answer drafts, version, source run/work item revision và các trạng thái; schema migration kế tiếp, backup trước upgrade.
- U4-03: cards trong Chat/panel và inbox UX-01; options đề xuất + text tự do, submit nhóm, required/optional rõ.
- U4-04: transaction nhận answers + tạo continuation intent/outbox; dispatch idempotent qua queue hiện có. Run needs_input đã kết thúc thì tạo run liên kết mới, không resume giả.
- U4-05: vô hiệu hóa bộ cũ/superseded, khôi phục sau restart, từ chối sai project/version; không tạo hàng đợi tiếp tục hai lần khi nhận lại event.

**Source:** `shared/team.ts`, `electron/team/*` prompt/parser, `electron/controller/runs.ts`, storage/database và chat/board integration; mới `shared/questions.ts`, storage questions, `QuestionCards.tsx`. Các nhánh permission và auto-approval không thay bằng protocol này.

**Nghiệm thu:** hai lần bấm/nạp lại/process crash giữa nhận answers và dispatch không tạo hai run; trả lời stale có lỗi rõ; Full access vẫn không hỏi Accept cho tool được phép; nhu cầu nghiệp vụ quan trọng chưa trả lời không bị tự chọn khuyến nghị. Kiểm tra native SQLite và lifecycle queue/needs_input.

### UX-05 — Kết quả, báo cáo và nghiệm thu tùy chọn (P0/P1)

**Phụ thuộc:** UX-02–04; phần đọc evidence có thể làm ngay sau UX-02.

- U5-01: Report immutable theo work item/run/attempt/revision, refs tới file/diff/command/review; danh sách kết quả mới và panel đọc.
- U5-02: phân biệt pass/fail/not-run/unknown; direct run chỉ completed không tự thành verified. Cost chưa có pricing thì để chưa xác định.
- U5-03: optional acceptance policy, mặc định không yêu cầu; quyết định gắn revision/report và invalidation khi source/criteria đổi. Không thay đổi evidence gate hoặc unique active-run lock.
- U5-04: Yêu cầu sửa lưu comment + continuation intent atomic, liên kết lần chạy mới; giữ bản cũ và giới hạn sửa hiện tại.
- U5-05: export có manifest/provenance, retention bảo vệ refs, attachment nội bộ nếu có. Markdown dùng renderer an toàn hiện có; không thêm raw HTML.

**Source:** `shared/evidence.ts`, `electron/team/evidence.ts`, storage evidence/board/database, controller và inspector; mới `shared/reports.ts`, storage reports, `WorkReport.tsx`. Bắt đầu bằng summary từ dữ liệu đã có, không bắt buộc thêm lần gọi model để sinh report.

**Nghiệm thu:** nội dung report khớp command/review thật; output missing hiển thị thiếu bằng chứng; revision cũ không dùng nghiệm thu revision mới; export/restart/prune không orphan report. UI đọc được report dài, tables, code và lỗi.

### UX-06 — Mẫu phát triển, readiness và Team (P1)

**Phụ thuộc:** UX-01–05. Không chặn người dùng chat ngay nếu môi trường đã sẵn sàng.

- Mẫu Feature/Bug/Review/Docs từ work types/skills đóng gói; không thêm Marketplace hoặc tự tải skills/hooks ngoài.
- Project readiness tái sử dụng tool status, Git root, model/gateway và trạng thái runtime hiện có; phân biệt thiếu điều kiện bắt buộc với khuyến nghị.
- Nếu lưu preset theo project, thêm ProjectConfig rõ version/override precedence; run lưu effective settings snapshot. Không âm thầm đổi credentials/global settings.
- Team compact list/optional cards, hierarchy task/execution thật, summary model, chờ dependency/slot/quyền/ngữ cảnh. Role rảnh không là worker process luôn chạy.
- Sau khi có questions/reports: inbox tổng hợp nhiều project bằng query DB bounded; không fan-out poller theo project. Có unread/seen cursor riêng, không trộn với resolved state.

**Nghiệm thu:** thêm repo mới dùng cấu hình gateway sẵn có; chọn mẫu không tự khởi chạy command; role disabled/unconfigured/stale hiển thị đúng; đổi model không đổi model của execution cũ.

### UX-07 — Git và nội dung phong phú (P2, tùy chọn)

Git local đọc branch/dirty/history và link work item trước; diff tiếp tục dùng inspector hiện có. GitHub PR/issues chỉ khi có `gh` và tài khoản người dùng, không thêm GitLab Server. Query giới hạn/thời gian timeout, không ngầm push/commit.

Ảnh inline cần asset store gắn project, giới hạn dung lượng/kích thước, kiểm tra MIME và đường dẫn, local protocol giới hạn, provenance/export/retention. Mermaid chỉ thêm khi chấp nhận dependency và renderer strict/sanitized, không HTML/script/external resource. Không chỉ bật `<img>` hoặc render raw SVG từ model vào Electron.

### UX-08 — Lịch và quy tắc đơn giản (P2, sau ổn định)

Thiết kế riêng khi bắt đầu: persistent Schedule/Rule/Delivery trong SQLite, timezone rõ, idempotency theo occurrence, preview hành động, toggle, history và queue chung. Đầu tiên chỉ rule allowlist tạo công việc/tóm tắt, không tùy ý shell từ rule. Graph chỉ là view đọc nếu danh sách chưa đủ.

Controller hiện có nhận delivery; không thêm orchestrator. Mỗi lần một active run toàn app. Khi tắt app/ngủ máy, lịch không chạy: hiển thị missed và gộp/bỏ qua theo policy, không chạy bù hàng loạt hay tự cài Windows service. Có giới hạn ngân sách, debounce, chống vòng lặp và nút tắt tất cả. Không coi mẫu minified graph từ ảnh là scope cần triển khai ngay.

## 3. Thiết kế dữ liệu và đồng bộ

Các tên bảng mới là đề xuất; kiểm tra lại migrations/constraints trước lúc code. Không cấp trước một loạt schema version cho các phase chưa làm.

| Dữ liệu | Cách lưu đề xuất | Quy tắc |
|---|---|---|
| Work item | Mở rộng board_items hiện có, giữ UUID; project counter cho display key | projectId + key unique; allocate atomic; item.version optimistic |
| Yêu cầu | board_item_revisions: title/body/criteria/createdAt | Submission giữ revision; run cũ không đổi theo editor mới |
| Liên kết | Mở rộng board links bằng revision và continuation lineage | FollowUp/run liên kết idempotent; một item có nhiều lần chạy |
| Thảo luận | work_comments với actor, content, source refs, version/timestamp | Nội dung có giới hạn; không copy nguyên event feed vào comment |
| Câu hỏi | question_sets, questions, answers, version/state và refs | Foreign keys project/item/run, transaction trả lời + continuation |
| Kết quả | reports + report_versions/refs hoặc immutable rows | Evidence provenance, immutable theo revision; không mutate run khi human accept |
| Nghiệm thu | acceptance_decisions với policy/revision/report/actor | Mặc định không yêu cầu; decision cũ không áp cho revision mới |
| Ý định tiếp tục | Outbox nhỏ trong DB hoặc mở rộng queue store hiện có | Chỉ thêm bảng nếu queue hiện tại không bảo đảm atomicity; vẫn một dispatcher trong Controller |

Migrations tăng dần từ schema hiện có; backup an toàn trước upgrade và transaction theo pattern dự án. Test DB schema 7 thực có planning card, runtime card, linked/held follow-up và archived item. Legacy run-only card giữ projection; chỉ materialize thành work item khi cần gắn thảo luận/câu hỏi, giao dịch không tạo bản trùng. Không tự biến mọi lịch sử chat thành hàng nghìn ticket.

Hiện `board_links.item_id` là primary key và `BoardStore.link(id)` trả một link. UX-02 phải giữ link này như liên kết submission đầu tiên để tương thích, đồng thời bổ sung bảng lịch sử submissions/attempt links một-nhiều (hoặc migration tương đương có adapter cũ). Không chỉ insert nhiều link vào bảng cũ. Unique theo run/follow-up và continuation key bảo đảm mỗi lần thực hiện chỉ ghi một lần; projection chọn lần hiện hành theo lineage, không đơn thuần lấy timestamp lớn nhất. Archive/submit/editor tiếp tục kiểm tra item.version trong transaction.

Xóa project phải có policy thống nhất cho comments/questions/reports/assets/links; archive không là delete. Retention không prune run/evidence còn được report/work item tham chiếu nếu chưa export/tombstone có chủ đích. Export ghi cả revision, refs và trạng thái thiếu artifact. Rollback DB bằng bản backup tương ứng và binary tương thích; không chạy binary schema 7 trên DB đã nâng cấp nếu chưa hỗ trợ.

Renderer dùng DTO validated qua IPC, không đọc SQLite/filesystem trực tiếp. Dữ liệu summary có epoch/revision hoặc cursor; detail lazy load. Tái sử dụng cache theo project/query và run-detail feed. Mục tiêu payload summary ≤100KB cho 50 card/7 role; pagination nếu vượt. Không poll nhiều project để giả lập global inbox. Thêm optimistic pending UI nhưng chỉ báo thành công sau transaction.

## 4. Kiểm chứng và bàn giao

Mỗi đợt chỉ chạy kiểm tra liên quan rồi broaden khi có nguyên nhân. Không tạo lại toàn bộ template/test framework trước khi có UI dùng được.

| Phần thay đổi | Bằng chứng cần có |
|---|---|
| UI/token/presentation | Typecheck, build, format; Electron kiểm tra layout/keyboard/IME ở kích thước quy định |
| Selector/DTO/protocol | Test behavior: quyền/needs_input/stale, sai project/version, legacy response, context limit |
| DB/queue | Native SQLite migration/transaction/restart/idempotency/retention; regression unique active run và giới hạn lane |
| Lead/question/review | Fixture cho parser/lifecycle; sau tích hợp chạy một luồng model thật qua cấu hình 9Router hiện có, ghi riêng kết quả/giới hạn |
| Report | Đối chiếu evidence pass/fail/not-run, immutable revision, export và source provenance |

Không gọi model thật chỉ để chứng minh một thay đổi CSS. Luồng tích hợp cuối: tạo công việc → Lead hỏi nghiệp vụ khi cần → trả lời → queued execution → kết quả/evidence → yêu cầu sửa → attempt mới cùng công việc. Kèm thử Full access, stop, held/restart và hai lane tương thích. Luồng này là kiểm tra sản phẩm sau triển khai, không điều kiện kéo dài đợt lập kế hoạch.

Mỗi lỗi tối đa ba vòng sửa tự động theo yêu cầu trước đây; không nâng `maxFixRounds` runtime hiện có (tối đa hai) để đạt con số đó. Nếu vẫn lỗi, báo nguyên nhân/bằng chứng và không đánh dấu phase hoàn tất. Không tái diễn toàn bộ suite nhiều lần khi chưa có thay đổi hoặc lỗi mới.

Ảnh chụp kiểm tra UI chỉ lưu cache local/đường dẫn đã ignore, không commit/push. Bàn giao ghi file đổi, checks thực tế, schema/version, limitation và commit; không ghi “pass” chỉ vì có mockup.

## 5. Ước lượng và rủi ro

Ước lượng sơ bộ theo ngày công cho một luồng triển khai, không phải thời gian model chạy hoặc lịch cam kết:

| Đợt | Công sức dự kiến | Rủi ro chính / xử lý |
|---|---|---|
| UX-01 | 2–3 ngày | Layout/feed nặng → summary bounded, reuse store, không migration |
| UX-02 | 3–5 ngày | Trùng entity/mất link → mở rộng BoardItem, migration/legacy tests |
| UX-03 | 3–4 ngày | Hai composer/mất draft → một ChatHost, lifecycle/IME regression |
| UX-04 | 3–5 ngày | Resume giả/dispatch kép → transaction/outbox/version/idempotency |
| UX-05 | 3–4 ngày | Report khẳng định sai → evidence refs, immutable revision, acceptance riêng |
| UX-06 | 2–3 ngày | Preset đổi global settings/inbox fan-out → effective snapshot và aggregate query |

UX-01–06 khoảng **16–24 ngày công**, cần điều chỉnh sau UX-02. UX-07/08 chưa ước lượng cố định vì là scope mở rộng. Dữ liệu schema 7 và tính đúng đắn queue quan trọng hơn việc có đủ mọi tab giống Loops.

## 6. Lát cắt bắt đầu

**UX-01–02 đã bàn giao.** Lát cắt tiếp theo là UX-03: ChatHost và trò chuyện theo ngữ cảnh công việc, tái sử dụng hồ sơ/revision/conversation của UX-02. Không tiếp tục D-05 hoặc dựng lại 3D trong quá trình này.
