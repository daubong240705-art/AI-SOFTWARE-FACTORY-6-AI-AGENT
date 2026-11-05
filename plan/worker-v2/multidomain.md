# Worker V2 — Đội AI đa lĩnh vực

Ngày: 05/11/2026. Trạng thái: **thiết kế mở rộng, chưa triển khai**. Tài liệu này mở rộng [kiến trúc V2](architecture.md); khi ví dụ cũ mặc định cần Git/source/test code, áp dụng mô hình tổng quát ở đây. Các ràng buộc runtime, mailbox, quyền, recovery và migration của V2 vẫn giữ.

Nguồn chính: [Paperclip và quyết định áp dụng](paperclip-multidomain-research.md). Học cơ chế quản lý công việc, không nhập toàn bộ server, database, UI hay hệ phân cấp công ty của Paperclip.

Mở rộng yêu cầu sau đó: [nghiệp vụ Loops](loops-parity.md), [rule engine/List/Graph](automations.md). Các tài liệu này đưa visual automation editor và project type/workflow editor vào 2.0; thay quyết định “chưa cần visual editor” ban đầu ở phần workflow bên dưới. Các ràng buộc jobs/media/resources vẫn giữ.

## 1. Sản phẩm sau mở rộng

Worker là nơi người dùng giao mục tiêu, tổ chức đội AI và nhận đầu ra đã kiểm tra. Dự án có thể làm phần mềm, nghiên cứu, nội dung, thiết kế, video hoặc kết hợp các lĩnh vực. Không bắt mọi dự án phải có repository, bảy role, commit hoặc lệnh test.

```text
Không gian làm việc
  ├─ Agent và kết nối runtime dùng lại được
  ├─ Skills, Tools và bộ mẫu lĩnh vực
  └─ Mục tiêu → Dự án → Công việc → Đầu ra → Đánh giá
                    └─ Đội dự án, Lead, ngân sách và lịch
```

Mặc định một không gian local, không bắt người dùng tạo “công ty” hay CEO. Tách dữ liệu bằng scope ngay từ đầu nhưng chưa làm SaaS đa tenant. Mục tiêu cấp cao là tùy chọn: giao một việc nhỏ trực tiếp vẫn được, không phải điền cả cây mục tiêu.

Ví dụ mục tiêu “Ra mắt sản phẩm A” có dự án phần mềm, nghiên cứu khách hàng và video giới thiệu. Các dự án có thể dùng lại agent, nhưng task và quyền không tự chia sẻ. Bàn giao chéo dự án qua artifact được cấp quyền, không tự đưa mọi tài liệu vào context của mọi agent.

## 2. Áp dụng Paperclip có chọn lọc

| Cơ chế Paperclip | Thiết kế cho Worker |
|---|---|
| Goal → project/issue, parent task | Mục tiêu → dự án → task/subtask; truy ngược được vì sao việc tồn tại |
| Reports-to và escalation | Lead theo dự án; manager tùy chọn trong membership; người xử lý blocker được chỉ rõ |
| Task checkout và run identity | Giữ claim/epoch/fencing; không có hai owner hợp lệ cùng thực hiện một task |
| Heartbeat/wakeup | Đánh thức theo sự kiện giao việc/câu trả lời/job xong; không giữ model chạy nền để hỏi tiến độ |
| Routines có revision và concurrency policy | Lịch áp dụng template cố định, chống trùng, bỏ/gộp lần lỡ theo cấu hình |
| Documents/assets/work products | Đầu ra có file, version, preview và review; artifact có thể là video/âm thanh/ảnh, không chỉ Markdown |
| Completion contract/assessment | Tiêu chí + bằng chứng + người có quyền kết luận; “agent nói xong” chưa đủ hoàn thành |
| Budget policies/reservations | Ngân sách theo dự án/agent; có chi phí đang giữ và chi phí chưa xác định |

Không buộc strict CEO tree, duyệt tuyển agent, duyệt mọi chiến lược, polling heartbeat tốn model hoặc graph workflow nặng. Khi người dùng đã cấp quyền giao việc tự động, kế hoạch hợp lệ được chạy; chỉ chờ ở review gate đã cấu hình hoặc quyết định vượt phạm vi được cấp.

## 3. Hai lớp thực thi khác nhau

### Agent runtime

Codex, Claude Code, OpenCode: đọc ngữ cảnh, suy luận, tạo nội dung, chọn tool, giao việc qua Factory tools. Chúng không tự cung cấp engine dựng video, thiết kế hoặc render 3D. Session, model, usage và stop thuộc adapter runtime.

### Tool/job runner

Chạy FFmpeg, render, transcribe, xử lý ảnh hoặc API job bất đồng bộ. Có thể chạy lâu hơn một lượt agent; tiếp tục được quản lý khi lượt agent đã kết thúc. Dùng process supervision hiện có, mở rộng thành durable job service trong cùng Worker Host, không tạo orchestrator thứ hai.

Task có thể có nhiều agent attempts và jobs; task không Done khi agent kết thúc nhưng render còn chạy. Agent có thể `ready` trong khi job nó đã tạo còn render; UI hiển thị riêng để người dùng hiểu tài nguyên đang dùng.

```text
Agent lập phương án → submit job → Job queue → công cụ/API
       │                                       │
       └─ kết thúc lượt / chờ sự kiện           └─ progress / output / failed
                                                         │
                                          Host đánh thức agent cần xử lý
```

Không tự cấp quyền submit job chỉ vì một skill có lời hướng dẫn. Job tool phải enabled, schema input hợp lệ và agent có grant phù hợp.

## 4. Mô hình dữ liệu bổ sung

| Thực thể | Thuộc tính chính và quy tắc |
|---|---|
| Goal | owner, parent, mô tả, kết quả cần đạt; không có vòng parent; task nhỏ không bắt goal |
| Project | domain labels, Lead, team, artifact library, resource/budget policies; repo optional |
| WorkspaceBinding | `git-worktree`, `managed-directory`, `external-directory`, `artifact-only`; dữ liệu đầu vào và vùng output rõ |
| ProjectMembership | lead/member, managerMembershipId tùy chọn, năng lực, quyền; không cycle; manager chỉ trong cùng project |
| TaskRevision | kind, agent, input refs, outputs, completion contract, workspace/resource needs, review authority |
| WorkflowTemplateVersion | steps/dependencies, output schemas, roles cần bind, review/retry policy; snapshot khi tạo task |
| DomainPackVersion | các template agent/skill/tool/workflow/validator, nguồn/license; dữ liệu cấu hình, không code chạy trong host |
| Job / JobAttempt | executor/tool version, task/revision/epoch, input/output hashes, progress, resource claim, process/external job ID, lifecycle |
| AssetVersion | content type, bytes/hash, provenance, rights metadata, storage ref, media metadata; không nhét binary vào SQLite |
| DeliverableVersion | tập asset/document refs, bản nháp/cuối, tiêu chí, decision/evidence refs; một job output chưa tự là sản phẩm được duyệt |
| ReviewDecision | task/contract/artifact version, actor, verdict, rationale, evidence; artifact đổi thì decision cũ không áp dụng bản mới |
| Budget/ResourceReservation | scope, metric, amount, state, expiry/reconcile; allocation nguyên tử trước dispatch |

Đây là mô hình logic; reuse ArtifactVersion/TaskRevision/Attempt của V2, không tạo bảng tương đương chỉ vì đổi từ “artifact” sang “asset”. Document là một loại artifact; deliverable là tập đầu ra có mục đích/nghiệm thu. Schema quyết định cụ thể ở V2-01/05.

`TaskKind` là registry có các giá trị built-in như analyze, research, write, code, design, media-edit, render, validate, review. Kind hỗ trợ UI/validator; không quyết định quyền theo tên. Template role cũng chỉ là slot để bind agent phù hợp, không quay lại enum BA/FE/BE bắt buộc.

## 5. Workspace không phụ thuộc Git

| Kiểu | Áp dụng | Ghi và bàn giao |
|---|---|---|
| Git worktree | Code hoặc tài liệu cần version trong repo | Worktree/commit/integration như V2 gốc |
| Managed directory | Dựng video, xử lý ảnh, xuất tài liệu | Input snapshot/read-only khi hỗ trợ; output theo attempt/job; publish bằng rename trong cùng filesystem hoặc copy+verify+finalize |
| External directory | Tài nguyên người dùng chọn | Không sửa/xóa file gốc mặc định; xuất sang vùng được cấp quyền; không giả là OS sandbox |
| Artifact-only | Nghiên cứu, lập kế hoạch | Đọc artifact/context, xuất version mới; không cần clone repo |

Task readiness chung kiểm tra dependency artifact versions và resource grants. Chỉ task dùng code yêu cầu source integration/fingerprint. Media task bàn giao file đã publish/hash ổn định; không đợi một commit Git giả để chạy tiếp.

## 6. Domain packs

Một pack gom cấu hình phù hợp lĩnh vực, không phải một framework mới. Người dùng có thể dùng mẫu, sửa mẫu hoặc tự lắp đội không cần pack. Gắn một pack không tự cài executable, mua API, cấp network hay cho phép script ngoài chạy.

| Pack | Agent mẫu | Công cụ/đầu ra | Lộ trình |
|---|---|---|---|
| Software | Analyst, UI, API, QA | Git, shell, browser; contract/source/test report | Kế thừa và hoàn thiện trong 2.0 |
| Research & Planning | Researcher, Analyst, Editor | Search connector được cấu hình, documents/data tools; source list, plan/report | Lát cắt không Git trong 2.0 |
| Video Basic | Producer, Scriptwriter, Editor, Reviewer | FFmpeg/ffprobe; storyboard, edit plan, subtitles, MP4/proxy | 2.0 với tài nguyên người dùng cung cấp và tool đã cài |
| Design | Art director, Designer, Reviewer | SVG/image tools/API phù hợp; brief, assets, export | Template/contract trong 2.0; tích hợp chuyên sâu sau |
| Content & Marketing | Planner, Writer, Reviewer | Research/doc tools; campaign plan, nội dung, lịch | Template dựa lõi 2.0; đăng bài ngoài app là tích hợp riêng |

Pack có `id`, `schemaVersion`, `version`, nguồn commit/hash/license, required capabilities/tool versions, templates và validator refs. Import qua extension lifecycle. Validator executable là tool đã đăng ký, không script ẩn trong metadata. Cập nhật pack không thay template snapshot hay workflow run đang hoạt động.

Kiểm tra trước chạy trả về ba nhóm: đã sẵn sàng, thiếu cấu hình có thể bổ sung, không được hỗ trợ trên host hiện tại. Ví dụ có FFmpeg không đồng nghĩa có NVIDIA encoder; model text không đồng nghĩa tạo ảnh/giọng nói được.

## 7. Workflow và giao tiếp

Workflow template mô tả steps, dependency, input/output, acceptance, reviewer và budget/retry policy. Lead instantiate thành các task bền vững rồi bind agent. Có thể chỉnh trước chạy; chỉnh lúc đang chạy tạo revision, invalidate consumer tương ứng. Workflow form/danh sách dùng được độc lập; automation Graph/List của chuẩn Loops biên tập event-condition-action trên cùng model, không trộn cạnh task DAG với cạnh automation.

Lead hoặc manager được cấp quyền đề nghị child task, nhưng Host kiểm tra membership, scope, task/budget/depth limits và chỉ scheduler dispatch. Manager không tự spawn process hoặc tự tạo agent vô hạn. Agent đề nghị bổ sung nhân sự/công cụ khi thiếu; chỉ tự tạo cấu hình từ template nếu project đã cấp quyền và có hạn mức, không tự mua tài khoản/cấp secrets.

Giao tiếp giữ mailbox gắn task và artifact refs của V2. Mention chỉ là ngữ cảnh, không tự tạo execution. Sự kiện có type rõ mới wake agent, có dedup, debounce và giới hạn vòng sửa. Mặc định route cập nhật thường về task thread, câu hỏi vượt phạm vi về Lead, quyết định cần người dùng về Cần xử lý. Chat người dùng chủ yếu với Lead; mở thread chuyên môn là thao tác phụ.

Context bàn giao gồm brief hiện tại, input versions, quyết định đã chốt, output/evidence và việc chưa xong. Ghi chú học được của project phải có provenance/scope; không trộn raw log thành “memory” hoặc chia sẻ secret qua ghi nhớ. Cài skill cải thiện hướng dẫn, không có nghĩa model đã được fine-tune.

## 8. Job lifecycle, tài nguyên và recovery

Job: `queued → preparing → running → validating → succeeded`; nhánh `failed`, `cancelling`, `cancelled`, `needs-reconciliation`. Task có thể `waiting:job`; khi job xong gửi event cho consumer, không gọi model mỗi vài giây.

Job submission cần idempotency key, task revision/epoch và input hashes. Host atomically ghi job + reservation + outbox; launcher reconcile marker sau crash. Process start/API side effect không nguyên tử với SQLite, vì vậy không hứa exactly-once. API có external job ID thì lưu và đối chiếu trước submit lại; kết quả không rõ phải chờ reconcile. Retry render local chỉ tự động khi attempt cũ đã dừng, output nằm vùng riêng và không có side effect ngoài cần quyết định.

Resource needs: CPU slots, RAM estimate, GPU/device/encoder slots khi hỗ trợ, disk reservation, connection/account quota, output/project-file locks. Admission kiểm tra tổng reservation và khả năng host; OS không enforce quota nào thì ghi rõ là estimate/admission limit. Không hứa hard RAM/GPU isolation hoặc cost cap tuyệt đối khi provider báo phí trễ.

- Một writer cho native project file như timeline/design; parallel tasks xử lý asset độc lập được.
- Video lớn dùng file storage theo hash/version, proxy/thumbnail riêng; tránh nạp toàn bộ binary qua IPC/React.
- Progress do tool cung cấp hoặc ghi “đang xử lý”; không tạo phần trăm giả. ETA chỉ khi có dữ liệu đủ.
- Cancel chỉ dừng process/job do Worker sở hữu; remote cancellation cần xác nhận provider. `cancelling` chưa là `cancelled`.
- Temp/cache có retention/quota; asset gốc, output được tham chiếu hoặc deliverable đã duyệt không tự bị GC. Xóa dữ liệu người dùng là hành động riêng theo quyền được cấp.
- Khi app đóng/máy ngủ, không hứa lịch/render local tiếp tục. Worker cảnh báo job đang chạy và thực hiện stop/drain theo policy; khởi động lại reconcile. Background service/headless host là đợt sau, không ẩn tự cài.

## 9. Ngân sách, review và quyền tự động

Theo dõi riêng model tokens/cost, API media cost, thời gian compute và dung lượng. Không cộng USD với GPU-minute; mỗi metric có policy riêng. Reservation trước dispatch giảm vượt budget khi song song; release/settle/reconcile khi terminal. Giá chưa biết là unknown: chế độ tiền nghiêm ngặt chặn nếu không có giá/ước lượng hợp lệ; chế độ cho phép ghi rõ người dùng đã chọn tiếp tục với chi phí chưa xác định.

Review có thể tự động bằng tool, agent reviewer hoặc người dùng, tùy contract. AI đánh giá cảm quan không thay bằng chứng kỹ thuật. Quyết định review gắn đúng artifact version/hash; sửa output phải kiểm tra lại các tiêu chí bị ảnh hưởng.

Full access vẫn bỏ hỏi từng Bash đã được cấp quyền. Không mặc định thêm “duyệt chiến lược/duyệt tuyển” như một rào chắn từ Paperclip. Gate có ích là xem bản nháp sáng tạo hoặc hành động người dùng đã đặt là cần duyệt. Đăng video, gửi nội dung cho người khác, mua tài nguyên hay dùng tài khoản ngoài cần quyền hành động tương ứng; `render local` không tự bao gồm `publish`.

## 10. Luồng video nghiệm thu cụ thể

Yêu cầu: video giới thiệu 60 giây, 1920×1080, 30 fps, MP4, phụ đề; dùng asset/logo/âm thanh được cung cấp. Chính sách ví dụ: cần người dùng duyệt bản nháp, không tự đăng mạng.

| Bước | Người thực hiện | Input → Output | Điều kiện chuyển |
|---|---|---|---|
| 1 | Lead/Producer | Brief + asset inventory → task plan, tiêu chí | Thiếu media/tool thì hỏi đúng thứ cần; không dựng task giả |
| 2 | Scriptwriter | Brief → script/storyboard v1 | Nội dung và độ dài phù hợp brief |
| 3A | Designer | Storyboard → title cards/graphics | Assets có hash và thông tin nguồn |
| 3B | Audio/Subtitles | Script/media → audio/SRT | Công cụ TTS/transcribe chỉ dùng nếu đã có; có thể dùng file cung cấp |
| 4 | Editor | Storyboard + assets + audio/SRT → edit plan version | File refs hợp lệ; timeline/resource lock được cấp |
| 5 | FFmpeg job | Edit plan + immutable inputs → preview MP4 | Process exit thành công, output publish nguyên vẹn |
| 6 | Validator + Reviewer | Preview → technical report + review notes | ffprobe kiểm duration tolerance đã khai báo, resolution/fps/codecs/tracks; kiểm subtitle bounds; người/agent review nội dung |
| 7 | Người dùng | Preview + report → approve hoặc yêu cầu sửa | Quyết định gắn version; sửa bước bị ảnh hưởng, không làm lại mọi thứ |
| 8 | Export job + Lead | Bản được duyệt → final MP4 + summary | Final spec kiểm lại; không tự đăng ngoài app |

3A/3B có thể song song. Job render giữ CPU slot nhưng không giữ một phiên model ngồi chờ. 2.0 chưa hứa điều khiển timeline Premiere/DaVinci hoặc round-trip native project; chỉ bảo đảm pipeline FFmpeg cơ bản sau khi được triển khai/kiểm chứng.

## 11. UX sau mở rộng

- Dự án mới chọn “Phần mềm / Nghiên cứu / Video / Thiết kế / Tự do”; mẫu chỉ preset, không khóa loại task.
- Chỉ hiện cấu hình Git khi có Git binding. Dự án video chọn thư mục tài nguyên/vùng xuất; dự án nghiên cứu có thể artifact-only.
- Điều hướng dự án: **Công việc / Chat / Đầu ra**. Trong Đầu ra lọc tài liệu, ảnh, âm thanh, video, source và báo cáo; không thêm tab cấp cao cho mỗi định dạng.
- Task detail giữ yêu cầu/trao đổi/đầu ra; hiển thị job progress, input versions và review ở đúng task. Raw command/tool logs ở inspector thu gọn.
- Đội ngũ hiển thị agent state và current task; project có vùng tiến trình công cụ riêng cho render/transcribe. Không gọi FFmpeg là agent đang “suy nghĩ”.
- Preview media có poster/proxy, player, metadata và review notes/timestamp; ảnh có zoom; tài liệu có version/diff. Không xây trình dựng video đầy đủ trong Worker 2.0.
- Cần xử lý chỉ chứa blocker/câu hỏi/quyết định; job vẫn chạy bình thường không tạo notification lặp. Lead báo mốc hoàn thành, không gửi mọi frame render vào Chat.
- Mục tiêu và ngân sách là phần mở rộng trong overview/settings; mặc định giao diện một người dùng vẫn ngắn gọn.

## 12. Lộ trình điều chỉnh

Giữ V2-01–07, mở rộng đầu ra từng đợt trong [implementation.md](implementation.md):

1. V2-01: core task/output/workspace không phụ thuộc code; agent/runtime abstraction; OpenCode hoạt động như trước.
2. V2-02/03: thêm Codex/Claude, không ghép kiến thức lĩnh vực vào adapter.
3. V2-04: pack manifest/templates/validators cùng skill/tool registry; built-in Software, Research, Video Basic; công cụ ngoài chưa có phải hiện Needs setup.
4. V2-05: goals, membership escalation, mailbox/DAG, artifact types, completion decisions, durable jobs/resources/budgets và routines. Chia nhỏ ticket để tránh một merge quá lớn.
5. V2-06: Đầu ra và preview phù hợp kiểu dữ liệu; dự án không Git; job progress riêng agent state.
6. V2-07: nghiệm thu đội software đa runtime, nghiên cứu không repo và video cơ bản thực tế; migration bảo toàn lịch sử phần mềm.

Phạm vi 2.0 tăng so với kế hoạch software-only; không coi mở rộng này là thay vài nhãn UI. Giữ UI+tests cùng mỗi lát cắt. Tích hợp NLE chuyên nghiệp, tạo video AI trả phí, GPU scheduling nhiều máy, publish mạng xã hội và marketplace thuộc 2.1+ theo nhu cầu thực tế.

## 13. Điều kiện nghiệm thu đa lĩnh vực

1. Project không có Git tạo task, output và review được; migration V1 vẫn đọc source/commit/evidence cũ.
2. Cùng cơ chế Lead/task/mailbox phục vụ cả software và video, không có nhánh orchestrator mới theo lĩnh vực.
3. Software: contract → FE/BE song song → integrate → QA; source/test evidence đầy đủ.
4. Research: input brief → có nguồn tham khảo thực sự truy cập được → report có citation → review; nguồn không truy cập được ghi thiếu, không bịa.
5. Video: FFmpeg/ffprobe đã cài và kiểm phiên bản; dùng input cho phép, render/preview/review/export được; technical metadata và output hashes có evidence.
6. Đóng/mở app hoặc kill process ở giữa render không tạo job trùng hay nhận file dở làm final. Out-of-disk/cancel/encoder thiếu trả đúng blocker.
7. Lịch tạo task có dedup, timezone và skip/coalesce, không chạy bù hàng trăm việc sau khi máy ngủ. Lịch chỉ hoạt động khi host hoạt động; trạng thái này hiện rõ.
8. Cost chưa biết không hiện 0; reservation/job state được reconcile; giới hạn tài nguyên đã cấu hình chặn admission đúng.
9. Review chỉ có giá trị với đúng output version; sửa bản nháp không được giữ dấu approved cho bản mới.
10. Full access không sinh Accept Bash; thiếu tool/permission được báo cụ thể. Không tự publish hoặc cài tool mới ngoài quyền đã cấp.
