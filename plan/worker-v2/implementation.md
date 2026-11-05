# Worker V2 — Backlog và tiêu chí hoàn thành

Ngày lập: 05/11/2026. **Chỉ V2-00 hoàn thành ở mức nghiên cứu/tài liệu; V2-01–07 chưa triển khai.** Không suy ra tính năng đã tồn tại từ checklist dưới đây.

Phạm vi đã mở rộng sang [đa lĩnh vực](multidomain.md) theo [nghiên cứu Paperclip bổ sung](paperclip-multidomain-research.md). Kế hoạch đợt giữ nguyên ID; tickets bổ sung bên dưới thuộc 2.0, không mặc định đã có. Software là lát cắt đầu, Research không Git và Video Basic là hai lát cắt kiểm chứng tính tổng quát trước phát hành.

## 1. Quy tắc triển khai

- Mỗi đợt một lát cắt dùng được: schema/host/IPC/UI/verification; không chỉ giao interface rỗng.
- Trước thay đổi lớn tạo Git checkpoint; commit theo đợt. Không stage report/template hay file người dùng không liên quan.
- Schema/migration additive và có fixture V1. Giữ app hiện tại hoạt động trong quá trình chuyển đổi; không có hai scheduler cùng chạy một task.
- Không chạy code từ repo ngoài trong quá trình nghiên cứu. Khi cần dependency chính thức, pin version và lockfile; không chạy installer của tool chưa được xem xét/cho phép.
- Lint/typecheck/build và tests liên quan từng đợt. Với lỗi tự sửa, tối đa ba vòng cho cùng vấn đề; còn lỗi phải ghi trạng thái chưa đạt, không gắn nhãn hoàn thành.
- Không yêu cầu permission từng Bash đã được profile cấp quyền. Không suy ra Full access cho phép thay đổi credentials/hệ thống hoặc file ngoài nhiệm vụ người dùng.

## 2. V2-00 — Nghiên cứu, baseline và hợp đồng kiến trúc

Kết quả trong đợt này:

- [x] Kiểm tra fixed-role/runtime/controller/dispatch/skills của ASF.
- [x] Đọc source CrewHub/Paperclip, LICENSE và tài liệu runtime chính thức; phân biệt stub, prototype và capability thật.
- [x] Chốt mô hình agent, adapter, task mailbox, artifacts và migration.
- [x] Thiết kế hành trình UX và backlog có điều kiện nghiệm thu.
- [x] Ghi nguồn pinned revision/hash; checkpoint baseline.

Không sửa runtime, không migration DB thật, không tuyên bố adapter mới đã chạy. Kiểm tra đợt này chỉ gồm tính hợp lệ tài liệu, liên kết nội bộ, JSON và manifest nguồn.

## 3. V2-01 — Tách runtime và mở mô hình agent

Mục tiêu: **người dùng tạo một agent mới ngoài bảy role, chọn OpenCode và chạy một task có kết quả**.

| Mã | Công việc | Đầu ra |
|---|---|---|
| 01-A | Chốt schemas AgentDefinition, Connection, Membership, execution snapshot; map bảy role cũ | Shared contracts có validation, không mất legacy reader |
| 01-B | Runtime registry, capability/probe, bọc OpenCode hiện tại | Start/stop/events/error qua adapter; giữ timeout/proxy/recovery hiện có |
| 01-C | Agent/connection repositories và migration additive | IDs ổn định, authRef, legacy mapping fixture |
| 01-D | Đổi quyền từ role-name sang capability; chọn assignee theo agent ID | Role labels không quyết định shell/write permission |
| 01-E | Agent editor tối thiểu, chọn Lead theo project, chọn agent cho task | Tạo/sửa/nhân bản/tắt agent, lỗi validation rõ |
| 01-F | Chuyển đường execution hiện tại qua interface duy nhất | Một backend dispatch; chưa tăng concurrency toàn app |
| 01-G | Task/input/output kind và workspace binding không phụ thuộc Git; goal/membership contracts | Project có repo hoặc không repo; source fingerprint chỉ bắt buộc cho workflow code; manager membership không cycle |

Nghiệm thu: tạo agent thứ tám tên tùy ý, nhận task và có evidence; sửa agent không làm đổi snapshot attempt đang chạy; agent disabled không nhận việc mới; project không có Lead hợp lệ trả lỗi setup rõ; task V1/lịch sử/tài liệu BA vẫn đọc được. Tạo một project artifact-only, giao task tài liệu và xem đầu ra mà không clone repo/tạo commit. Unit/schema/migration tests, integration adapter OpenCode và desktop flows thực tế; không gọi đây là hỗ trợ multi-runtime cho tới V2-02/03.

## 4. V2-02 — Codex adapter

- Probe executable/version và auth readiness; không trích secret vào log.
- Implement App Server stdio handshake, thread/start/resume, turn/start/events và interrupt theo protocol của bản được hỗ trợ.
- Map tool/text/usage/errors; lưu native session riêng theo task và connection.
- Process supervision trên Windows; malformed event, stderr lớn, exit đột ngột và stop timeout không làm treo host.
- Kết nối Factory tool bridge bằng MCP; không phụ thuộc dynamic tools experimental.
- UI cấu hình connection/provider/model và capability unsupported rõ ràng.

Nghiệm thu: chạy task sửa file trong workspace mẫu, nhận output/test evidence; gửi tiếp vào session hợp lệ; stop xác nhận process đã dừng; mất kết nối không tạo bản sửa lặp; đổi provider không resume mù; CLI thiếu/version không tương thích không ảnh hưởng OpenCode. Protocol fixture tests + một model thật khi auth/model đã sẵn sàng. Không ghi “đạt runtime” chỉ bằng `--version`.

## 5. V2-03 — Claude Code adapter và đội nhiều runtime

- Pin Agent SDK TS và môi trường Claude Code tương thích; chạy ngoài Electron main.
- Xác thực API key qua secret store; phương án dùng local CLI auth phải đối chiếu điều khoản/phạm vi hỗ trợ, không hứa subscription mặc định.
- Map stream/session/interrupt/errors/usage, permission hooks và MCP config.
- Model selection theo connection, không ép định dạng `nine_router/*`.
- Xử lý thiếu CLI/auth, throttling/quota và config drift; không fallback model/runtime âm thầm.

Nghiệm thu: hai agent dùng hai runtime khác nhau, task/context không lẫn, runtime lỗi được cô lập; một lần chạy Claude thật; resume/stop/quyền có evidence; số liệu không biết hiện unknown. Giai đoạn này có thể tuần tự, chưa tuyên bố DAG song song hoàn tất.

## 6. V2-04 — Skill và tool registry

| Mã | Công việc | Điều kiện nghiệm thu |
|---|---|---|
| 04-A | Import skill từ thư mục/Git subdir+revision, source/hash/license metadata | Cài hai version, xem diff, disable/rollback; không auto-update theo branch |
| 04-B | Binding theo agent/project, snapshot theo attempt | Chỉ agent được gắn nhận đúng skill; run đang chạy không đổi nội dung |
| 04-C | Materializer theo adapter, progressive loading | Xác nhận discovery/context trên cả ba runtime; unsupported không hiện như supported |
| 04-D | MCP registry stdio/HTTP, namespace/schema/timeout/auth refs | Gọi được tool mẫu; crash/tool collision cô lập; không leak credentials |
| 04-E | CLI manifest + install recipe preview, executable/argv/cwd/env mapping | Không chạy installer lúc import; chỉ chạy tool đã enabled và đúng scope |
| 04-F | Policy profiles và permission enforcement mapping | Bash hợp lệ tự chạy; action ngoài grant bị từ chối rõ; autoallow không bỏ qua kiểm tra bắt buộc |
| 04-G | Extension UI và package lifecycle | Cài/cấu hình/kiểm tra/gắn/cập nhật có trạng thái thật, lỗi chỉ đúng bước |
| 04-H | DomainPackVersion và workflow/agent/validator templates | Bản mẫu không khóa role; version snapshot; không tự cài executable/chạy script khi import |
| 04-I | Built-in Software, Research & Planning, Video Basic; Design/Content templates | Capability preflight hiện Needs setup cho tool chưa có; Video Basic có FFmpeg/ffprobe recipes được kiểm tra, không kèm lời hứa NLE |

Fixtures quan trọng: path traversal, symlink/junction thoát scope, package quá lớn, metadata hỏng, tool cùng tên, dependency thiếu, secret trong output và update thêm hook. Đây là kiểm tra import/tool boundary có tác dụng thực tế, không phải bộ kiểm thử mọi format bên ngoài.

## 7. V2-05 — Điều phối, artifacts, jobs và tài nguyên

Đây là lõi phối hợp, chia nhỏ để có thể review độc lập:

1. **05-A: Task contracts.** Input/output/acceptance, agentId, dependency DAG, cycle detection và bounded plan size. Task state/reason codes; validate trước lưu.
2. **05-B: Claim và execution fencing.** Transactional claim, lease/epoch, process ownership reconciliation; cancel/reassign chặn stale completion.
3. **05-C: Mailbox/outbox.** Typed messages, authenticated sender, recipient scope, delivery/ack/dedup, correlation; Factory tools cho trao đổi và báo cáo.
4. **05-D: Artifacts.** Immutable version/body/hash, preview/export, contract/source references, dependency stale khi contract đổi.
5. **05-E: Ready queue/concurrency.** Global/project/agent/connection budget; scopes và dependency/source readiness; giữ một integration writer/project.
6. **05-F: Handoff/review.** Structured output + actual evidence; Lead nhận kết quả, QA dùng đúng source; tối đa ba vòng sửa cho cùng issue.
7. **05-G: Recovery.** Boot reconciliation, stop/drain, duplicate event/message và crash windows; retry chỉ khi đủ bằng chứng, không tự replay external effect.
8. **05-H: Mục tiêu và delegation.** Goal/project/task links, membership escalation, bounded child tasks; mention không tự wake. Không bắt tạo CEO/goal hoặc duyệt kế hoạch khi project đã cấp quyền tự động.
9. **05-I: Job service.** Durable one-shot jobs, task/epoch-scoped submission, progress, process/API ownership, cancel/reconcile; không giữ model chờ render; một scheduler dispatch cả agent và job.
10. **05-J: Resource admission.** CPU/RAM/GPU/disk estimates/reservations, tool/account quotas, native project file locks; tách application admission và quota OS thực sự enforce được.
11. **05-K: Budget ledger.** Provider/media cost, pending/unknown accounting, reservations/settle; policy project/agent; metric khác đơn vị không cộng gộp, không hứa hard cap khi phí báo trễ.
12. **05-L: Deliverable/review.** Typed media metadata, proxy refs, validators và completion authority; decision/evidence gắn đúng version; binary lưu file, không nhét SQLite/IPC.
13. **05-M: Routines.** Kế thừa schedule hiện có, template revision snapshot, timezone, trigger/run dedup, skip/coalesce, sleep/resume policy; chỉ chạy khi host hoạt động, không tạo engine lịch song song.

Nghiệm thu: BA xuất contract v1; FE/BE chạy song song trong scopes độc lập và dùng v1; integration xong mới QA; QA report gắn source fingerprint; đổi contract thành v2 chỉ rõ consumer stale; agent hỏi agent khác qua đúng task; duplicate message không tạo execution trùng; crash trước/sau claim/start/ack không làm hai owner cùng tác động task. Conflict, quota và dependency hiện đúng waiting reason.

Nghiệm thu bổ sung: task không Git chờ đúng input artifacts; render job hoàn thành khi agent đã kết thúc lượt vẫn cập nhật đúng task; cancelled/stale job không publish output vào revision mới; thiếu disk/encoder/budget trả đúng reason; đồng thời hai job không cùng giữ một slot độc quyền. Schedule qua restart không tạo run trùng; unknown cost không hiện 0. Chia 05-H–M thành PR/ticket riêng với tests phù hợp, không nhập cả Paperclip control plane để làm nhanh.

Thứ tự nội bộ: A/B/C làm nền task ownership/mailbox; D/E/F mở artifact/dependency/review; H nối mục tiêu/delegation; I/J/K nối jobs với admission trước khi bật render cho người dùng; L hoàn thiện typed outputs/review; M nối trigger lịch vào đúng task/job queue. G chạy xuyên suốt các lát cắt recovery. Job UI không được bật trước resource/budget/policy checks tương ứng.

## 8. V2-06 — Hoàn thiện UX

Theo [ux.md](ux.md), cập nhật các màn hình hiện có thay vì thêm nhiều trang cạnh tranh:

- Tổng quan, project Công việc/Chat/Đầu ra và Cần xử lý có chung task detail route.
- Board hiển thị task thực, filter agent, dependency và viewport-fixed columns.
- Đội ngũ: ready/busy/waiting/offline có căn cứ; agent editor tự do.
- Chat Lead tự nhiên, linked task cards; không trộn tool trace nội bộ vào lượt người dùng.
- Tài liệu version/diff/export và task consumers; bỏ summary-only cho thiết kế BA.
- Connections/Extensions có readiness thực; Settings có nhóm ngắn, advanced disclosure.
- Base components/spacing/typography/menu/focus đồng nhất; dọn nút trùng và empty tabs.
- Chọn bộ mẫu lĩnh vực khi tạo project; Git là tùy chọn. Project tabs dùng Công việc/Chat/Đầu ra; bộ lọc tài liệu/ảnh/audio/video/source trong Đầu ra.
- Media preview/proxy, review notes theo thời điểm, output version/evidence; job progress riêng agent state, không hiển thị phần trăm giả.
- Goal, budget và routine settings trong vùng phù hợp; không ép giao diện cá nhân thành bảng quản lý công ty nhiều tầng.

Nghiệm thu bằng các hành trình: setup → giao việc → xem ai làm → đọc câu hỏi → xem thiết kế → theo dõi song song → review → yêu cầu sửa. Kiểm tra các viewport/zoom trong UX; dữ liệu dài và Board nhiều card không kéo giãn page. Không ship status mock/đồ thị giả thay cho host events.

## 9. V2-07 — Cutover và phát hành

- Migration fixture từ schema V1 hiện tại; counts/references/hashes và legacy history vẫn đúng.
- Backup/restore drill trên bản sao; không chạy thử phá hủy DB thật.
- Drain V1, bật V2 cho project chọn trước, chỉ một execution owner. Có đường quay về pre-migration snapshot và giải thích dữ liệu phát sinh mới.
- Crash/restart/offline/stop và quota recovery trên Windows thật, giới hạn tài nguyên đo được; không đặt target concurrency theo suy đoán.
- Installer/package integrity; first-run, nâng cấp, giữ credentials/config, uninstall không tự xóa dữ liệu dự án.
- Dọn code dead/compatibility bridge sau khi hết tham chiếu và kiểm chứng migration; chưa xóa legacy readers cần để xem lịch sử.
- Cập nhật README, release notes, supported runtime versions, limitation matrix và hướng dẫn tạo project/agent/skill/tool.

Nghiệm thu đầu cuối bắt buộc: **Lead Codex → Analyst Claude → UI Codex và API OpenCode song song → integrate → QA → review**. Có evidence task/artifact/source/test, một kịch bản duplicate và một kịch bản stop/crash. Nếu thiếu auth/CLI cho runtime nào, ghi rõ blocked/unverified cho runtime đó, không đánh dấu bản đa runtime đã nghiệm thu đầy đủ.

Nghiệm thu đa lĩnh vực bắt buộc: **Research brief → report có nguồn → review** trên project không repo; và **video brief → storyboard → asset/audio song song → edit plan → FFmpeg preview → kiểm kỹ thuật/review → final export** từ input cung cấp. Không tự publish. Kiểm crash/cancel/out-of-disk và schedule skip/coalesce; contract/review chỉ áp dụng output version đúng. Chỉ ship nhãn hỗ trợ Video Basic sau khi chạy thật, không dựa vào việc registry có tên FFmpeg.

## 10. Phụ thuộc và các quyết định đã chốt

```text
V2-00 → V2-01 ─┬─ V2-02 ─┐
               ├─ V2-03 ─┼── adapter compatibility ─┐
               ├─ V2-04 ─┘                         │
               └─ V2-05 ──────────────────────────┼─ V2-06 → V2-07
                    UI tối thiểu đi cùng từng đợt ─┘
```

Có thể phát triển contracts/mailbox độc lập sau V2-01, nhưng nghiệm thu phối hợp phải nối các adapter/tool thật. Sơ đồ là phụ thuộc logic, không phải chỉ thị phải mở nhiều cửa sổ agent cùng sửa source.

Không cần người dùng chọn lại kiến trúc cho mỗi đợt: Windows desktop local-first, adapter registry, agent tự do, một scheduler, mailbox/task/artifact bền vững, quyền định trước và UI gọn đã là đề xuất thống nhất. Quyết định chỉ phát sinh khi có bằng chứng mới như runtime không hỗ trợ quyền bắt buộc, vướng giấy phép hoặc cần tác động ngoài workspace/phạm vi đã cho phép.

Đợt code tiếp theo cụ thể là **V2-01**, bắt đầu từ shared schemas và wrapper OpenCode, không viết lại tất cả màn hình trước khi đường execution mới hoạt động.

Các tích hợp sau 2.0: native NLE project/timeline, image/video generation provider chuyên sâu, social publishing, tool host từ xa và background service nhiều máy. Các domain template đơn giản có thể dùng lõi 2.0 ngay khi đủ tool, nhưng không được coi template là bằng chứng mọi chuyên môn đã hoạt động.
