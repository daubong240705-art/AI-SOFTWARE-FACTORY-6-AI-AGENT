# Worker V2 — Tương đương nghiệp vụ CrewHub Loops

> Nhu cầu chức năng tiếp tục dùng; ràng buộc Windows-native và nhánh V2-01–07 được thay bởi [quy trình WSL2](process-first-wsl.md) và [P0–P5](process-first-roadmap.md). Hai loại chấp nhận — quyền công cụ và quyết định nghiệp vụ — độc lập; không mặc định hỏi lại mỗi kế hoạch hoặc mỗi lệnh.

Ngày: 05/11/2026. Baseline thiết kế: `87320cf`; checkpoint `checkpoint/worker-v2-loops-parity-20261105`. **Đây là mục tiêu mở rộng, chưa triển khai tính năng.**

Yêu cầu: linh hoạt agent, dự án, ticket và automations tương tự CrewHub Loops, đồng thời giữ Windows native, nhiều runtime, skills/tools và khả năng đa lĩnh vực đã thiết kế. Đọc cùng [kiến trúc](architecture.md), [đa lĩnh vực](multidomain.md), [automation engine](automations.md), [backlog](implementation.md).

## 1. Chuẩn tương đương và giới hạn bằng chứng

“Giống Loops” được chuyển thành các hành vi có thể nghiệm thu; không cam kết sao chép toàn bộ sản phẩm chưa được truy cập. Source CrewHub classic/World đã khảo sát không chứng minh toàn bộ nghiệp vụ Loops. Trang [Loops](https://crewhub.dev/loops) tại ngày khảo sát vẫn ghi beta sắp ra; code/docs/release Loops chưa được xác minh từ bộ source đó.

Nguồn bằng chứng:

- **S:** ảnh Automations người dùng gửi trong hội thoại. Thấy project switch + rule switch, List/Graph, moment/agent/label nodes, rule states On/Off/Proposed/Draft và cạnh liên kết. Ảnh chứng minh bố cục/nội dung hiển thị; chưa chứng minh engine bên dưới.
- **P:** trang sản phẩm công bố project types, ticket/Lead/review, questions, automations, schedules, team, chat, reports, Git và onboarding. Công bố đóng Done bởi người, Windows qua WSL; remote sessions còn đang phát triển. Đây là claim sản phẩm, chưa phải kiểm thử độc lập.
- **A:** source ASF hiện tại và kế hoạch V2. Đối chiếu được những thành phần đã có, giới hạn hiện tại và việc còn phải triển khai.

Triển khai độc lập, giữ thương hiệu/component của ASF. Không sao chép source/assets AGPL của CrewHub vào sản phẩm. Không ép kiến trúc desktop theo mô hình terminal/postman/WSL của một sản phẩm khác nếu adapter và host hiện có giải quyết được hành vi tương ứng.

## 2. Kết luận phạm vi

Kế hoạch V2 trước đã bao phủ agent/runtime, task/DAG, skills/tools, đầu ra đa lĩnh vực và routines, nhưng **chưa đủ tương đương Loops**. Phải bổ sung rule engine, project type editor, workflow/ticket cấu hình được, giao diện automation List/Graph, policy review, reports, tìm kiếm và các hành trình quản lý liên kết với nhau.

Chỉ đổi giao diện hoặc thêm một graph minh họa không đủ. Hoàn thành khi thay rule/template/team trong UI thay đổi hành vi thực tế và truy được lịch sử vì sao hệ thống thực hiện hành động.

## 3. Ma trận chức năng cần đạt

Các dòng là mục tiêu của Worker, không tuyên bố Loops đã có mọi chi tiết mở rộng. Cột nguồn cho biết điểm xuất phát tham khảo; quy tắc triển khai/acceptance là thiết kế riêng.

| Nhóm | Người dùng cấu hình và sử dụng | Hiện tại / còn thiếu | Nghiệm thu |
|---|---|---|---|
| Project types (P) | Tạo loại dự án, ticket templates, skills, workflow/review/automation presets; import/export version | DomainPack mới ở thiết kế; cần editor và binding project | Type tự tạo dùng cho project không Git; sửa type không đổi run cũ |
| Agent và team (P/A) | Tên/role tùy ý, runtime/model, skills/tools, Lead/thành viên, manager tùy chọn | V1 fixed-role; đã có kế hoạch V2 | Thêm/bớt agent không sửa code; task đang chạy giữ snapshot |
| Ticket (S/P/A) | Mã, yêu cầu, criteria, labels, priority, assignee, subtasks, attachments, parked/snoozed | Có nhiều thành phần V1; thiếu registry/template tổng quát | Tạo từ chat/template/List/Board dùng cùng hồ sơ; parent/subtask rõ |
| Workflow (S/A) | Tùy tên/cột/chuyển trạng thái theo project type; map semantic states | Board V1 enum cố định | Đổi tên/thêm trạng thái không phá scheduler; transition có guard và history |
| Automation (S/P) | Event/condition/action, enable/pause, proposed/draft, priority, templates | Chưa có rule engine V2 | Rule thực thi thật, bounded, dedup và không bypass quyền |
| List/Graph (S) | Hai cách xem/sửa cùng rule; moment/actor/label links, filter, zoom | Kế hoạch trước hoãn graph; yêu cầu mới đưa vào phạm vi | Edit ở List phản ánh Graph và ngược lại; invalid edge không lưu |
| Scheduled (S/P/A) | Lịch theo timezone, next runs/history, rule/template target, pause, skip/coalesce | V1 chỉ tạo backlog, chưa tự dispatch theo rule | Lịch được cấp quyền tự tạo/giao việc; restart không tạo trùng |
| Chat Lead (P/A) | Trao đổi tự nhiên, linked tickets, ảnh/diagram, delivery/reply states; chuyển ngữ cảnh | Có chat/feed; cần binding agent/session tự do | Delivered khác answered; chat tư vấn không tự sinh task |
| Question/review (P/A) | Question cards, recommendations, trả lời trong task; review/send-back/Done | Có câu hỏi/report gates; cần policy theo type | Chỉ người có quyền kết luận; sửa output làm review cũ hết hiệu lực đúng phạm vi |
| Team monitor (P/A) | Lead/member/worker, busy/idle/waiting/blocked, task/job cụ thể | Có monitor V1; cần generalize | Runtime không khả dụng/lease cũ không hiện đang chạy giả |
| Reports/outputs (P/A) | Report độc lập có revision/comments; asset/video/source previews theo project | V1 có reports/BA docs; cần thư viện đa lĩnh vực và report entities | Báo cáo tuần nằm đúng thư viện, có nguồn task và version |
| Search/views/archive (S/A) | Tìm mã/từ, filters/saved views, Board/List/Archive, restore | Có truy vấn Board; cần unified index và lifecycle | Kết quả mở đúng project/ticket; archived/parked không tự nhận task mới |
| Git optional (S/P/A) | Commit/branch/PR/issue links, repo binding, explicit clone/refresh/actions | Có Git local; provider integration cần thêm | Không bắt Git ở media/research; không gọi PR/clone hoàn tất khi chỉ có link |
| Dashboard/inbox (S/P/A) | Quick ask, việc chờ quyết định, tiến độ cross-project và thông báo actionable | Nền R0–R6 đã có; cần nối model mới | Không trộn tool log thành thông báo; một blocker không nhân bản theo retries |
| Setup/settings (P/A) | Runtime/auth/tool checks, project scope, quyền tự động, resource budgets | V1 OpenCode settings; V2 adapter/policy có thiết kế | Chỉ báo ready khi đủ điều kiện; thiếu công cụ nêu đúng connection |
| Remote access (P/A) | Local-first, responsive; có thể mở từ thiết bị khác khi host hỗ trợ | V2 hiện desktop; remote client chưa triển khai | Tách profile 2.1: auth/TLS/session isolation; NetBird có mạng không đồng nghĩa có web host |

## 4. Các khái niệm phải linh hoạt thực sự

1. **Agent definition**: cấu hình tự do, không enum nghề nghiệp. Runtime/model và tool connection độc lập với nhãn role.
2. **Project type**: versioned bundle của defaults/templates/workflow/rules/skills; import/export không mang secrets và không tự cài/chạy scripts.
3. **WorkflowDefinitionVersion**: trạng thái/cạnh/guards do người dùng cấu hình; execution state của process vẫn là schema ổn định do host quản lý.
4. **TicketTemplateVersion**: form/input/criteria/output/review defaults; có thể thêm custom fields kiểu text/number/date/choice/artifact-ref có validation, không arbitrary JS.
5. **RuleDefinitionVersion**: event, conditions, actions, priority và scope; List/Graph cùng một persisted model.
6. **ScheduleDefinitionVersion**: thời điểm/zone/catch-up/concurrency + target template/rule; không một engine chạy riêng.
7. **Skill/tool/domain pack**: nguồn pinned revision, version và capabilities; update có diff, per-run snapshot.
8. **ReviewPolicy**: final authority và automation bounds; không hardcode một rule Done chung cho mọi lĩnh vực.

Không hứa người dùng thay tùy ý schema DB, chạy code plugin trong Electron main, sửa permission enforcement hoặc xóa audit để “linh hoạt”. Cấu hình là dữ liệu được validate và version hóa.

## 5. Workflow tùy biến không phá execution state

Người dùng có thể tạo “Ý tưởng → Viết nháp → Thiết kế → Kiểm tra thương hiệu → Chờ duyệt → Xong”. Mỗi business status có stable ID và semantic category như backlog/ready/active/waiting/review/done/cancelled. Host dùng category/guards để điều phối, UI dùng label/thứ tự riêng.

Không chuyển `running` thành `done` chỉ bằng kéo card. Transition command phải xác nhận task revision, authority, output evidence, child tasks/jobs chưa kết thúc và review policy. Không có guard script tùy ý; built-in conditions hoặc registered validators. Archive là lifecycle riêng, parked/snoozed là dispatch hold; không tự coi hai trạng thái đó là Done.

Thay workflow đang được dùng tạo version mới; mapping trạng thái cũ phải explicit, các ticket không map được giữ version cũ hoặc chờ migration. Không xóa status còn tham chiếu. Automation dùng status IDs/categories, không match tên tiếng Việt dễ đổi.

## 6. Review tương thích Loops và chế độ tự động

Hai trục độc lập:

- **Execution permissions:** agent được phép Bash/tools/file/network gì. Full access cấp trước trong phạm vi, không hỏi từng command.
- **Completion authority:** ai được kết luận ticket hoàn thành và output có cần review không.

Project type tương thích Loops dùng `human-final`: agent/subtask nội bộ có thể hoàn thành theo contract, nhưng ticket cấp người dùng chờ Review và người dùng mới chọn Done hoặc gửi sửa. Không biến final review thành Accept Bash.

Có thể chọn `policy-auto` cho mục tiêu tự động: output đạt validators/review đã cấu hình thì host được kết luận; thiếu evidence vẫn blocked/review. `hybrid` tự hoàn thành việc nội bộ, giữ gate cho đầu ra/action đã chọn. Các chế độ phải hiển thị ở project/template; quyền shell Full access không tự chuyển `human-final` sang `policy-auto`.

AI đề xuất automation thành `proposed`; người dùng bật hoặc project cấp trước quyền auto-enable cho nhóm thay đổi cụ thể. Không yêu cầu click proposal khi policy đã cho phép, không cho agent tự nâng policy hoặc tự bật rule vượt giới hạn. Hành động publish/gửi nội dung/mua dịch vụ vẫn cần quyền tương ứng theo phạm vi đã cấp.

## 7. Bố cục theo Loops, giữ giao diện gọn

```text
Toàn app: Tổng quan | Cần xử lý | Đội ngũ | Dự án | Cài đặt

Project header: tên, trạng thái, tìm kiếm, Tạo ticket
Tabs: Tổng quan | Công việc | Đầu ra | Tự động hóa | Khác
      Công việc: Board / List / Archive / saved filters
      Đầu ra: Reports / Documents / Media / Source (lọc theo loại)
      Tự động hóa: Rules [List / Graph] | Lịch | Lịch sử
      Khác: Git nếu có repo, thiết lập project/team/type

Chat với Lead: dock có thể thu gọn; task detail và chat không chồng nhiều panel
```

Việc đặt Automations và Scheduled dưới cùng khu vực không làm mất nghiệp vụ. Nếu người dùng muốn từng tab riêng có thể pin view, nhưng không render mọi tính năng đồng thời ở màn nhỏ. Graph cần vùng làm việc đủ rộng, minimap/zoom, keyboard và List thay thế; không bắt người dùng hiểu graph mới cài được rule.

Reports là loại đầu ra có tên/version/comments và nguồn tham chiếu, không chỉ một stream log. Search toàn app tuân scope/project và mở đúng detail. Notifications chỉ những thứ có ý nghĩa đối với người dùng; raw runtime debug ở inspector.

## 8. Thứ tự thực hiện và chuẩn phát hành

Giữ V2-01–07; bổ sung nhánh nghiệp vụ **LP-01–LP-08** nối vào các phase, không dồn mọi thứ vào một màn Graph cuối dự án:

| Nhánh | Đầu ra | Nối phase |
|---|---|---|
| LP-01 | Project types, ticket templates/custom fields, workflow semantic mapping | Schemas V2-01, registry/editor V2-04 |
| LP-02 | Rule definitions/events/conditions/actions, run/effect receipts | V2-05 sau claim/mailbox |
| LP-03 | Project/global/rule switches, draft/proposed/enabled, policies và pause semantics | V2-05, UI tối thiểu cùng đợt |
| LP-04 | Rule List editor, simulation/explanation, history/debug | V2-05, hoàn thiện V2-06 |
| LP-05 | Graph editor/projection, node/edge validation, layout persistence | V2-06 trên rule model đã chạy được |
| LP-06 | Schedule → rule/template/dispatch, recurring report, skip/coalesce | V2-05M, nối LP-02/03 |
| LP-07 | Reports/comments, question/review policies, archive/park/search/views; Git provider actions riêng | V2-04/05/06, có capability scope |
| LP-08 | Parity acceptance, migration preset và docs, limitations matrix | V2-07 |

**2.0 desktop:** các nghiệp vụ cốt lõi local trong ma trận, đa runtime, rule engine + Graph/List và lịch, quản lý đầu ra, ba lát cắt software/research/video. GitHub PR/issues/clone phải có connector được nghiệm thu trước khi gọi nhóm Git tương đương; nếu chưa đạt thì ghi partial, không tự bỏ khỏi checklist.

**2.1 remote profile:** trình duyệt qua mạng riêng, host API/auth/TLS, thiết bị/session, remote runtime hosts và job reconciliation. Không nằm trong chuẩn 2.0 desktop. Nếu yêu cầu là tương đương cả truy cập nhiều thiết bị thì phải hoàn thành profile này mới gọi là đầy đủ phạm vi đó. Chưa cam kết native Windows chạy theo đúng cách WSL/herdr của Loops; ưu tiên hành vi người dùng trên nền Windows hiện có.

## 9. Bộ nghiệm thu nghiệp vụ

1. Tạo project type Marketing riêng, định nghĩa trạng thái/labels/template và bind Lead/specialists mà không sửa source.
2. Ticket mới có nhãn social được rule giao đúng agent; nhãn reel tạo/giao việc video đúng cấu hình; có trace vì sao match.
3. Trước Review, rule tạo task kiểm brand voice; chỉ transition khi gate đạt. Không dùng status kéo card để bypass evidence.
4. Rule On/Off/Draft/Proposed có hiệu lực đúng; project Off chặn start mới nhưng giữ cấu hình từng rule; resume không tự replay hàng loạt event cũ.
5. List/Graph sửa cùng rule version; cạnh sai kiểu bị chặn; layout thay đổi không kích hoạt execution hoặc sửa logic âm thầm.
6. Recurring report tạo đúng một lần mỗi occurrence, chạy theo quyền đã cấp, output xuất hiện ở Reports với comment/version/source refs.
7. Crash/retry không nhân đôi child task, message, label change hoặc render job; side effect ngoài có outcome không rõ phải reconcile.
8. Rule xung đột, vòng lặp và event storm được chặn có trace; agent không nhận vô hạn task tự tạo.
9. Human-final ticket chỉ người đúng quyền đóng Done; policy-auto đạt điều kiện thì kết luận tự động; cả hai không xuất hiện Accept Bash cho lệnh đã cấp.
10. Agent idle/waiting/busy và job render khác nhau; delivery/answer/review states không bị nhập làm một.
11. History/migration V1 còn đọc được; không reset DB để làm engine mới; các chức năng R0–R6 còn dùng được hoặc có mapping thay thế.
12. Đối chiếu ma trận từng dòng bằng evidence sau implementation; thiếu runtime/tool/provider hoặc remote profile ghi partial/unverified. Không dùng ảnh giao diện làm bằng chứng hệ thống đã chạy.
