# Chuẩn thiết kế — CrewHub Loops làm tham chiếu chính

**Cập nhật UI/UX 06/11/2026:** [Đánh giá và kế hoạch nâng cấp](uiux-upgrade.md) là quyết định hiện hành: Light mặc định, Dark/System, Inter, vi/en và nhiều cửa sổ chat kéo/resize. Thay mục tiêu sao chép palette/font trên 90% và giới hạn một dock; giữ phạm vi nghiệp vụ và tiêu chí tin cậy. Prototype F0-02 còn dở, chưa có Host/UI V2 thật.

Thuộc [kế hoạch hợp nhất Factory V2](README.md). Ngày 05/11/2026. Tài liệu này thay palette/font và cách giảm project tabs trong các phương án UX cũ. Chưa phải giao diện đã triển khai.

## 1. Bộ ảnh chuẩn và mức chắc chắn

Đã xem trực tiếp **9 PNG, mỗi ảnh 3200 × 2000** trong `crewhub/`. Thư mục hiện tại không có `image copy 9.png` hoặc `image copy 10.png`. Mapping 11 ảnh trong tài liệu R trước đây không còn đúng với bộ này; dùng bảng dưới. Hash/dimensions ở [manifest](../../research/factory-v2/reference-manifest.json).

| ID | File hiện tại | Màn hình thực tế | Vai trò thiết kế |
|---|---|---|---|
| UI-01 | `image.png` | Settings → Projects → New project, bước 1/3 | Wizard, forms, custom select, footer actions |
| UI-02 | `image copy.png` | Automations → Graph | Canvas/nodes/edges, rule lifecycle, switches |
| UI-03 | `image copy 2.png` | Team | Sessions/computers, cây Lead/worker, state/context |
| UI-04 | `image copy 3.png` | Board với Lead chat dock | Columns/cards/filterbar, chat overlay/dock |
| UI-05 | `image copy 4.png` | Reports | Filter/export, report cards, author/time/comments |
| UI-06 | `image copy 5.png` | Scheduled tasks | Project switch, lịch sử, templates, New task/form |
| UI-07 | `image copy 6.png` | Git | Overview/history/PR/issues và freshness |
| UI-08 | `image copy 7.png` | Dashboard | Quick ask, feed, Waiting on you, Needs attention |
| UI-09 | `image copy 8.png` | Setup | Stepper, máy/runtime readiness, version/auth/error |

Ảnh chứng minh hình thức và các control được thể hiện, không chứng minh backend CrewHub. Ticket detail, trang Cần bạn xử lý đầy đủ, List/Archive, project Overview, agent editor và skills editor **không có ảnh riêng trong bộ này**: thiết kế từ primitives và luồng đã xác định, không tự nhận đã đối chiếu pixel với CrewHub.

## 2. Hình học và design tokens

Các tỷ lệ quan sát: sidebar khoảng 495/3200 chiều rộng; topbar khoảng 104/2000 chiều cao; project subnav khoảng 106/2000; lề main khoảng 48 pixel ảnh. Không biết DPR/zoom lúc chụp. Canvas so sánh quy ước là **1600 × 1000 CSS px, DPR 2**, tạo output 3200 × 2000; đây là cấu hình nghiệm thu đề xuất, không khẳng định cấu hình gốc.

| Token | Giá trị khởi đầu | Cơ sở / quy tắc |
|---|---|---|
| `color.canvas` | `#232323` | Màu nền phẳng phổ biến đo từ ảnh |
| `color.surface` | `#2C2C2C` | Sidebar/panels/cards đo từ ảnh |
| `color.surfaceRaised` | `#333333` | Layer/node/menu; tinh chỉnh theo crop |
| `color.border` | `#3D3D3D` | Divider phổ biến; không dùng làm focus duy nhất |
| `color.controlBorder` | `#666666` | Đề xuất cho input/outline cần dễ phân biệt |
| `color.text` / `color.primaryFill` | `#FDFDFD` | Text chính/nút chính trắng |
| `color.muted` / `color.subtle` | `#B9B9B9` / `#929292` | Đề xuất cho metadata; kiểm contrast thực tế |
| `color.accent` | `#FE676F` | Chuẩn hóa nhóm coral lấy từ raster |
| `color.working` | `#FD8F52` | Chuẩn hóa nhóm tangerine trong ảnh |
| `color.warningSurface` | `#493A34` | Tinted warning/progress panel quan sát được |
| `color.onPrimary` / `color.onAccent` | `#232323` | Chữ tối trên nền trắng/coral |
| `layout.sidebar` | 248 px | Đích khởi đầu theo tỷ lệ ảnh; collapsed 64 px |
| `layout.topbar` / `layout.projectbar` | 52 / 54 px | Grid shell cố định, không cộng header ở từng view |
| `layout.gutter` | 24 px | Desktop; 16 px khi hẹp |
| `space` | 4, 8, 12, 16, 24, 32 px | Dùng tập giá trị chung |
| `radius` | 6 px chip, 8 px field/button, 10–12 px panel | Tránh mỗi trang một kiểu bo |
| `control.height` | 34 px thường, 40 px large, 28 px compact | Không trộn height trong cùng toolbar |
| `icon.size` | 18–20 px, stroke nhất quán | Monochrome, không thêm emoji tùy ý |
| `chat.width` | 384 px, mở rộng tối đa 560 px | Panel phải vừa vùng content, không che action đang focus |
| `motion` | 120–180 ms | Respect reduced-motion, không animation trạng thái giả |

Màu đo từ ảnh là mẫu pixel, không phải chứng cứ CSS upstream có đúng từng mã hex. Lưu token tập trung và kiểm bằng screenshot crops. Không dùng gradient nền xanh/tím, glassmorphism, shadow nặng hoặc hàng KPI nhiều màu ngoài reference. Coral dùng cho active underline/rail, badge, send; primary CTA như New ticket/Continue màu trắng. Status có icon/text, không chỉ có màu.

**Typography hiện hành:** Inter Variable self-host là ứng viên chính, thay Archivo. UI 14/20 px, chat 15/24, metadata 12/18; glyph Việt/Anh và license asset được kiểm ở F2-01. Fallback system-ui; code monospace 13/20. Không dùng monospace cho mô tả hoặc chữ 10 px cho thông tin cần đọc. Font trong chín ảnh chưa được chứng minh chính xác. Bảng màu dark trên là tham chiếu lịch sử; palette Light/Dark hiện hành theo kế hoạch UI/UX.

## 3. App shell và điều hướng

```text
┌ Sidebar cố định ┬ Search tickets                     New ticket  🔔  Computer ┐
│ ASF             ├ Project • Overview Board Reports List Archive Automations…│
│ Tổng quan       │                                                            │
│ Cần bạn xử lý n │ Nội dung route: một mục tiêu chính, toolbar cùng baseline   │
│ Đội ngũ         │                                                            │
│ ─ Dự án ─      │                                        Lead chat overlay   │
│  Project A      │                                                            │
│  Project B      │                                                            │
│                 │                         Agent dock                         │
│ Trợ giúp        │                                                            │
│ User  Settings  │                                                            │
└─────────────────┴────────────────────────────────────────────────────────────┘
```

Giữ thứ tự tab desktop đích: **Overview / Board / Reports / List / Archive / Automations / Scheduled / Git**. Tên hiển thị tiếng Việt tương ứng: Tổng quan / Bảng việc / Báo cáo / Danh sách / Lưu trữ / Tự động hóa / Lịch / Git. Dashboard toàn app cũng có thể dùng “Tổng quan”, nhưng project header/breadcrumb phải phân biệt phạm vi. Từ điển nhãn duy nhất, không dùng “Trang chính” xen “Home” xen “Workspace”. Reference fidelity chấm trên bố cục/tỷ lệ, không bắt tiếng Anh.

Sidebar có ba điểm vào toàn app, danh sách project, help và footer user/settings/collapse. Project row: monogram, tên, tối đa hai counter có tooltip rõ; không UUID/model/schema. Search có kết quả/deep links thật. Không nhân bản nút “Mở Board/Team/Chat” trên mọi card. Git chỉ xuất hiện khi project có Git; missing provider được giải thích trong trang Git chứ không giả PR/issues.

Desktop ≥1440: sidebar 248, đủ tab; 1180–1439: ưu tiên sidebar thu gọn nếu thiếu chỗ, overflow tab có tên; 768–1179: sidebar drawer/collapsed, chat/ticket panel chiếm content khi cần; <768: nav drawer, một view tại một thời điểm, Board cuộn ngang. Đây là adaptation do thiếu ảnh mobile, không dùng nó để thay bố cục desktop. Kiểm cả 1366×768 và zoom 125%.

## 4. Bộ base phải xây trước các màn

| Nhóm | Primitives và contract bắt buộc |
|---|---|
| Layout | AppShell, SidebarItem, ProjectTabs, PageHeader, Toolbar, SplitPane, ScrollRegion |
| Forms | Field(label/control/error/help), Input, Textarea, custom Select/Combobox, Checkbox, Switch, Stepper |
| Actions | Button(primary/secondary/ghost/danger), IconButton(aria-label), Menu/Popover, Tooltip |
| Data | Card, Badge, Avatar/status, DataRow, Table, Empty/Error/Loading/StaleState |
| Work | TicketCard, WorkflowColumn, AgentRow, DecisionCard, ReviewCard, EvidenceSummary |
| Communication | ChatDock, Thread, ContextChip, Composer, AttachmentPreview, ActivityRow |
| Automation | RuleRow, RuleStatus, GraphNode/Port/Edge, SimulationPanel, RunHistory |

Custom Select/Menu dùng headless accessible primitive đã xem license, không native select popup. Arrow nằm trong slot 16–20 px, căn giữa theo chiều cao control; padding phải riêng, text không đè arrow. Popover portal có collision/scroll boundary, max-height/overflow, active/selected/disabled/focus states, keyboard/escape và trả focus về trigger.

Mọi flex/grid text container có `min-width: 0`, vùng scroll có `min-height: 0`; không dùng `width: 100vw` trong content sau sidebar. Card header và footer dùng slots chung; title không kế thừa căn giữa của button. Field error nằm dưới input, không đẩy nhãn cùng hàng lệch baseline. Test content tiếng Việt dài, đường dẫn, code blocks, nhiều badges và tên agent dài. Không cắt lý do blocked/decision quan trọng mà thiếu đường mở đầy đủ.

Z-index theo layer thống nhất. Chỉ một drawer chi tiết nghiệp vụ bên phải hoạt động; chat thuộc layer nhiều cửa sổ riêng, có tray/auto-arrange/focus theo kế hoạch UI/UX. Menu/modal ở trên windows; close/minimize không stop run. Dev trace là disclosure trong chi tiết.

## 5. Đặc tả từng màn theo bộ ảnh

### UI-01 — New project / Settings

![UI-01 — Wizard tạo dự án](<../../crewhub/image.png>)

Giữ settings tabs và card wizard rộng khoảng 990 px tại canvas quy ước, ba bước Project → Lead agent → Confirm. Bước 1: tên; project code/slug cùng hàng; type; start from template; root folder/workspace mode. Bước 2: chọn/tạo Lead, runtime/model readiness và execution/review profile theo defaults. Bước 3: tóm tắt, validation và Create. Cancel trái/Continue phải, cố định trong footer card; quay lại không mất draft.

Không bắt repo cho research/content. Linux path có browse/validate từ Host, browser không truy cập filesystem tùy ý. Duplicate slug, thiếu runtime, path không có quyền hiển thị đúng field; create có idempotency key chống double-click. Settings giữ phong cách tab Profile/Notifications/General/Agents/Projects/Plugins/Computers/Setup; Users chỉ hiện khi thật sự có multiuser. Không tạo tab rỗng để bắt chước.

### UI-02 — Automations Graph

![UI-02 — Automations Graph](<../../crewhub/image copy.png>)

Giữ project master switch ở đầu, List/Graph bên phải, toolbar nổi trong canvas, dotted grid, nodes theo Moment/Who/Label, ports và rule labels trên edges; zoom/fit góc trái dưới, minimap góc phải dưới. Lifecycle Draft/Proposed/On/Off đọc được bằng text và kiểu nét; edge hover/selection không chỉ khác màu. Node positions là metadata, kéo node không kích hoạt công việc.

Một dòng mô tả trạng thái thay các đoạn hướng dẫn dài trong ảnh; help sâu mở khi cần. Nhấn edge/rule mở inspector có trigger/conditions/actions, target, version, simulation và enable. Kiểm rule chưa đủ field trước On, graph/list round-trip và project Off giữ nguyên từng rule On/Off. Không triển khai graph trang trí hoặc editor tạo rule khác semantics với List.

### UI-03 — Team

![UI-03 — Team, cây phiên và agent](<../../crewhub/image copy 2.png>)

Giữ header, message-delivery status gọn và lưới session/computer hai cột. Session card: tên, máy, counters working/idle/done/blocked/unknown; Lead row và workers có đường cây, avatar, title/context, task link và state badge bên phải. Card cùng hàng có header/padding thống nhất; không kéo tất cả card theo session dài nhất. Group rỗng thu gọn.

State lấy từ Host/run/heartbeat, có freshness; configured khác ready, idle khác offline, completed run khác idle agent. Mỗi row trả lời “ai / việc gì / bước nào / đang chờ ai”. Thiếu quyết định hiện link trả lời trong app; lỗi permission hiện blocker cấu hình, không bắt người dùng đi terminal trả lời hàng trăm Bash prompts. Model/runtime nằm chi tiết hoặc metadata nhỏ. Remote computer chỉ hiện khi có kết nối thật; F2 local không tạo máy giả.

### UI-04 — Board và Lead chat dock

![UI-04 — Board và Chat dock](<../../crewhub/image copy 3.png>)

Giữ thứ tự mẫu Backlog → Planned → In progress → Review → Done, icon/count, menu/add ở header, filterbar và card style. Project workflow có thể đổi tên/cột; không ánh xạ mọi execution state thành cột mới. Mỗi agent task có card/subtask rõ owner/summary/output, không chỉ một card tổng đang chạy che toàn bộ FE/BE/BA.

Board dùng phần chiều cao còn lại của viewport, mỗi cột scroll riêng; header cột cố định, hàng cột không dài theo số card. Chiều rộng đích 240–280 px/cột, cuộn ngang khi cần, không ép năm cột ở màn hẹp. Card có code, title tối đa 2–3 dòng, nhãn ngắn, assignee, dependency/subtask/attention indicators. Description dài ở detail, không nhét vào card. Filter toolbar một hàng có overflow, tránh nhảy cao.

Dock phải trong ảnh là preset ban đầu; chat hiện hành cho kéo/resize, mở nhiều cửa sổ, thu nhỏ về tray và mở lớn trong content. Mỗi cửa sổ có header agent + controls, context strip, messages và composer cố định dưới. Tray hiển thị session/recent conversation, status/unread, không liệt kê mọi agent đã lưu. Giữ context/draft khi đổi route; tin theo thời gian, auto-scroll chỉ khi đang cuối; tool chatter collapse. Send/Stop có trạng thái thật; close không stop, retry không gửi trùng. Contract chi tiết ở kế hoạch UI/UX.

Composer ghi “Nhắn Lead”, context rõ và một Send chính. Tư vấn không mặc định tạo ticket; “hãy làm…” tạo/link việc và link trở lại Board. Model/profile ở menu ngắn, không bắt chọn mỗi lượt. Enter gửi/Shift+Enter xuống dòng có xử lý IME; cho preference Ctrl+Enter, không thay shortcut âm thầm để giống ảnh.

### UI-05 — Reports / Documents / Outputs

![UI-05 — Reports](<../../crewhub/image copy 4.png>)

Giữ filter Made by/Show, Export, New report bên phải và report cards full-width. Card: title, tóm tắt ngắn 1–2 dòng, source/author, time, comments; không token/attempt ID. Show chọn Reports/Documents/Media/All outputs để mở rộng đa lĩnh vực mà vẫn giữ cấu trúc reference. Không thêm hàng tab phụ trên mọi trang.

Detail mở văn bản/preview, version, task links, evidence và review. BA documents có mục Yêu cầu/Data model/API contract, renderer bảng/schema/Mermaid/code block dễ đọc, tải bản nguồn; FE/BE task hiển thị input version. Export có format khả dụng thật; lỗi/partial/obsolete phải rõ. Không gọi run tư vấn là báo cáo công việc hoàn thành.

### UI-06 — Scheduled tasks

![UI-06 — Scheduled tasks](<../../crewhub/image copy 5.png>)

Giữ master switch, New task/Use the form, schedule cards với On/history/edit/menu và template cards dưới. New task mở Lead chat đúng ngữ cảnh để diễn đạt lịch; Use the form mở editor trực tiếp. Tạo một schedule record qua cùng API, không hai hệ lịch.

Mỗi card: tên, mô tả lịch, timezone cụ thể, agent/target, next/last run, trạng thái; counters chi tiết mở trong history. Dùng timezone người dùng/project mặc định Asia/Ho_Chi_Minh, lưu UTC; không sao chép hạn chế UTC-only từ ảnh. Mặc định enable tường minh; Off không catch-up hàng loạt, mặc định skip missed, tùy chọn coalesce. Host tắt thì báo không chạy được, không giả đúng giờ.

### UI-07 — Git

![UI-07 — Git](<../../crewhub/image copy 6.png>)

Giữ subnav Overview/Commit history/Pull requests/Issues, repo/branch + Refresh, card commits/PR và freshness. Local Git cung cấp status/diff/history/task refs; PR/issues lấy từ provider đã kết nối. Nếu chưa có provider thì tab có giải thích setup/unsupported, không spinner vô hạn hay list mock. Project không Git ẩn destination này. Commit/push/merge là action có quyền riêng, không phát sinh chỉ vì mở trang.

### UI-08 — Dashboard

![UI-08 — Dashboard](<../../crewhub/image copy 7.png>)

Giữ greeting/date gọn, bố cục chính/phụ khoảng 2:1; quick ask phía trên feed, Waiting on you và Needs attention bên phải. Quick ask có đích project/Lead rõ; nếu chưa biết project, Lead hỏi tối thiểu hoặc giữ conversation inbox, không tự ghi vào project gần nhất. Send coral, attach và target cùng hàng.

Feed: ai thay đổi việc nào, nội dung có ý nghĩa, timestamp/project; group burst tương tự, mark seen độc lập hoàn thành task. Không log từng token/read/shell/heartbeat. Cần bạn xử lý chỉ gồm câu hỏi thật/review đã chọn/blocker cần người dùng; card nêu việc gì, vì sao chờ, cần trả lời gì và một action chính. Counter dựa trên record unresolved, không đếm lại cùng decision ở nhiều views.

### UI-09 — Setup / readiness

![UI-09 — Setup](<../../crewhub/image copy 8.png>)

Giữ title, stepper card, bảng machine/runtime/version/auth/status và “Checked … ago”. Bước đề xuất: Máy & WSL → Runtime → Lead → Dự án đầu → Bắt đầu; Network/remote optional mở sau, dùng NetBird hiện có thay ép Tailscale. Không đưa bước network vào điều kiện bắt buộc local. Docker chỉ xuất hiện optional nếu tool/job cần, không buộc cài vì reference có hàng Docker.

Readiness tách installed/authenticated/compatible/ready/unknown/stale, có recheck và lỗi ngắn có hành động đúng nơi. Không đọc credentials vào UI/log, không dùng version Windows để kết luận CLI Linux ready. Có thể bỏ qua bước tùy chọn và quay lại; chưa có runtime nào ready thì nêu đúng một blocker trước khi gửi việc.

## 6. Các màn bổ sung chưa có screenshot chuẩn

| Màn | Thiết kế từ hệ primitives | Điều kiện dùng được |
|---|---|---|
| Ticket detail | Header + Yêu cầu/Trao đổi/Tiến độ/Kết quả; inspector metadata thu gọn | Đọc brief/criteria, trả lời, xem từng agent task, xem output đúng version |
| Cần bạn xử lý | Nhóm Câu hỏi / Duyệt kết quả / Cần can thiệp, không nhóm theo tool call | Giải quyết tại chỗ và biến mất ở mọi view; issue có reason/next action |
| Project Overview | Mục tiêu, việc đang làm, việc chờ, kết quả gần nhất | Không lặp toàn bộ Dashboard và Board |
| List/Archive | Shared filters, table rows, saved view; restore có policy | Cùng task IDs/state với Board, archive không xóa dữ liệu |
| Agent editor | Name/instructions/runtime/model, skill/tool bindings, scope | Probe/validation, clone/archive, tách defaults với live session |
| Skills/Tools | Registry/list + version/source/readme/permissions preview | Import không tự chạy installer; thay version không đổi run đang chạy |
| Output/job detail | Preview + trạng thái/progress + version/evidence/review | Cancel/retry phù hợp job, không nhận file dở thành kết quả cuối |

Các màn này được nghiệm thu nhất quán visual system và hoàn chỉnh flow; không chấm “90% giống ảnh gốc” khi ảnh gốc chưa tồn tại trong bộ cung cấp.

## 7. Chuẩn chất lượng áp dụng xuyên suốt

- Mỗi view có loading/empty/error/stale/partial/offline; không dùng dữ liệu demo lẫn dữ liệu thật.
- Không chữ/arrow/icon lệch, text đè badge, card nhảy baseline, board kéo dài vô hạn, menu tràn viewport hoặc action bị dock che.
- Body/controls đạt contrast phù hợp WCAG AA; mọi control có tên, focus rõ, thao tác keyboard và screen reader labels. Tăng contrast cục bộ nếu cần và ghi sai khác có lý do.
- Mặc định gọn: một primary action theo ngữ cảnh, metadata sâu có disclosure; việc cần người dùng quyết định phải đọc được ngay.
- Tuân thủ [quality gates](acceptance.md) và [ma trận UI/UX hiện hành](uiux-upgrade.md); chụp đúng viewport/theme/locale/data, kiểm từng crop, không dùng nhận xét “trông khá giống” làm bằng chứng duy nhất.
