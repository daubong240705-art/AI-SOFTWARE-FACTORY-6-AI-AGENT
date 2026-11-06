# Worker V2 — Automation rules và Graph/List

Thiết kế đề xuất, chưa triển khai. Bổ sung cho [chuẩn nghiệp vụ Loops](loops-parity.md), [task/mailbox](architecture.md), [jobs đa lĩnh vực](multidomain.md). Graph là một cách biên tập/giải thích rules, không phải một scheduler khác.

## 1. Bốn khái niệm riêng

| Khái niệm | Vai trò |
|---|---|
| Task DAG | Công việc cụ thể, phụ thuộc và đầu ra của một mục tiêu; chạy theo revision/claim |
| Workflow template | Mẫu tạo DAG và business status/guards; instantiate thành task |
| Automation rule | Khi event X thỏa điều kiện Y, đề nghị thực hiện các action Z |
| Schedule | Tạo event theo thời gian; đi vào cùng rule/task queue, không bypass scheduler |

Ví dụ: workflow dựng video chứa storyboard → assets/audio → render → review. Rule “ticket được tạo có label reel thì dùng workflow video” chọn workflow và giao Lead. Lịch “thứ Hai 8:00 tạo tổng kết” phát event tạo report task. Không trộn những loại cạnh khác nhau vào một engine chạy tùy ý.

## 2. Rule definition

Mỗi rule có ID, revision/hash, project scope, name, lifecycle (`draft`, `proposed`, `enabled`, `disabled`, `archived`), event selector, điều kiện có schema, action list, priority/conflict group, quyền cần, budget/loop bounds, author và approval/enable provenance khi cần. Danh sách và graph dùng cùng object này.

Ví dụ minh họa, chưa phải schema JSON đã triển khai:

```json
{
  "schemaVersion": 1,
  "id": "rule-route-reels",
  "revision": 3,
  "projectId": "project-marketing",
  "name": "Giao video ngắn cho editor",
  "state": "enabled",
  "priority": 50,
  "trigger": { "event": "ticket.created" },
  "when": {
    "all": [
      { "field": "ticket.labels", "op": "contains", "value": "reel" },
      { "field": "ticket.assigneeId", "op": "isEmpty" }
    ]
  },
  "actions": [
    { "type": "ticket.assign", "target": { "projectMemberId": "video-editor-member" } },
    { "type": "ticket.addLabel", "labelId": "video-label" },
    { "type": "task.enqueue", "workflowTemplateVersionId": "video-basic-v1" }
  ],
  "limits": { "maxMatchesPerTicketRevision": 1, "maxCausalDepth": 8 },
  "failurePolicy": "stop_and_report"
}
```

IDs và cấu trúc trên cần validation thực khi code. `ticket.assign` không tự khởi động model; chỉ enqueue task/workflow hợp lệ mới tạo scheduler work. Rule không thêm raw shell script; action gọi typed application service hoặc tool/job binding đã được cấp quyền. Template interpolation giới hạn field/escaping, không JavaScript eval.

## 3. Event, condition và action catalog

| Nhóm | Built-in dự kiến |
|---|---|
| Ticket events | created, revision submitted, business status changed, assignee changed, label added/removed, unparked, archived |
| Work events | task ready/completed/failed/blocked, question answered, review requested/decided, artifact published, job terminal |
| Time events | schedule due, snooze expired; có occurrence ID và timezone |
| Conditions | project/type, ticket kind/labels/priority/custom fields, from/to status ID/category, assignee/capability, input artifact/version, review/evidence state |
| Actions | add/remove label, assign/reassign hợp lệ, create bounded child task, instantiate workflow, enqueue task, request review/question, write report draft, add task comment, set hold/snooze, guarded business transition |
| Tool actions | submit registered job qua grants/policy; publish/external connector action chỉ khi quyền tương ứng đã có |

Sự kiện trước khi chuyển trạng thái dùng command guard/before-transition hook có timeout hữu hạn. Không giả một rule chạy sau `status.changed` có thể quay ngược atomic transition đã xảy ra. Ví dụ “kiểm brand trước Review” tạo prerequisite/review stage trước khi cho chuyển, thay vì tới Review rồi mới chạy và báo như đã kiểm xong.

Điều kiện quyết định thuần dữ liệu được đánh giá deterministic; phân loại bằng AI phải là task có output/evidence riêng. Rule dùng kết quả phân loại đã lưu và version, không gọi model ẩn trong mỗi predicate.

## 4. Quyền và ownership

Rule có actor/service scope được user/project grants cấp khi enabled. Author agent không đồng nghĩa tự có quyền mở rộng grant. Engine kiểm tra lại policy/membership/quota ngay trước effect, không chỉ lúc lưu rule. Không cho action đánh cắp task đang có owner; reassign phải theo cancel/drain/epoch và giữ lịch sử.

Dynamic target có thể là project Lead hoặc slot có capability. Phải có resolution policy tường minh: bound member, priority pool, hoặc ask Lead. Không có ứng viên thì waiting reason; không tự chọn model/provider khác. Một slot nhiều ứng viên phải có tie-break có thể giải thích được.

Question/review card là một loại action; không tự nhân bản prompt approval. Human-final completion không thể bị một rule đổi thành Done. Full access cho shell không cấp quyền sửa policy, secrets hay tự phê duyệt rule.

## 5. Các thực thể bền vững

| Thực thể | Nội dung |
|---|---|
| AutomationEvent | eventId/type, project/entity/revision, immutable payload, occurredAt, source actor, correlation/causation/root event, causal depth |
| RuleVersion | Definition snapshot/hash, enabled effective range, grants refs, author/enable provenance |
| RuleEvaluation | event+rule version, input snapshot/hash, matched/skipped/conflict/error và giải thích |
| AutomationRun | action plan, actor/grant/policy snapshots, state, receipts và output refs |
| ActionReceipt | run/action ordinal/idempotency key, pending/applied/failed/unknown/cancelled, result/evidence |
| AutomationLayout | project/view, node positions/viewport, version; không chứa logic rule riêng |
| ProjectAutomationPolicy | global/project hold, enable generation, permissions/budgets, conflict/loop settings |

Có thể tái sử dụng event/outbox/attempt tables phù hợp; tránh lưu cùng một effect ở hai queue độc lập. Cặp event+rule version unique cho evaluation; action key ổn định theo run+step. Event snapshot để giải thích, current state/version để tránh ghi đè dữ liệu đã đổi.

## 6. Luồng xử lý

```text
Application command
  → transaction: domain change + event/outbox
  → evaluator chọn rule versions hợp lệ theo thời điểm/generation
  → deterministic match + permissions/preconditions + conflict resolution
  → transaction: evaluation + run/action plan + action outbox
  → action executor kiểm tra lại hold/grants/current revision
  → application service / scheduler / job queue
  → receipt + domain event mới có causation/root IDs
```

Rule engine chọn hành động; scheduler duy nhất quản lý execution agent/job. Task/claim/membership checks vẫn authoritative. Không gọi thẳng `spawn` hoặc API provider trong evaluator.

Trạng thái dữ liệu thay đổi giữa match và execute thì optimistic precondition thất bại; ghi skipped/stale hoặc re-evaluate bằng event mới theo policy, không tự ghi đè. Rule version thay đổi không làm mutation kế hoạch đang chờ một cách âm thầm; action cũ được hủy/review theo enable generation.

Thay đổi DB nội bộ gắn receipt trong cùng transaction khi cùng application boundary. Với action nhiều bước có tác dụng ngoài, từng bước lưu receipt và có thể chỉ hoàn thành một phần; không tuyên bố rollback toàn bộ. Lỗi dừng bước còn lại; compensation là command có scope riêng, không tự xóa công việc người dùng để “rollback”.

## 7. Pause, resume và lifecycle

Effective enabled = host automation allowed AND project automation On AND rule enabled AND grants/budget hợp lệ. Project Off giữ nguyên từng rule On/Off; bật lại không tự enable Draft/Proposed/Disabled.

- Off chặn đánh giá/dispatch mới và chặn pending effect chưa bắt đầu sau khi executor quan sát hold generation; bước đã commit/start trước điểm đó có thể đang chạy.
- Running agent/job tiếp tục hoặc dừng theo hành động riêng “Dừng tác vụ đang chạy”; không lẫn pause rule với cancel process.
- Các effect đang chờ được đánh dấu held/cancelled theo policy và có history. Khi resume, mặc định **không replay event cũ**; người dùng có thể chọn replay preview giới hạn nếu cần.
- Schedule giữ định nghĩa riêng; default skip missed hoặc coalesce theo policy, không chạy bù không giới hạn.
- Không hứa xử lý schedule khi app/host tắt. Remote/background profile là đợt riêng.

Lifecycle: draft → proposed hoặc enabled theo quyền; proposed → enabled/disabled qua quyết định hợp lệ; enabled → disabled/archived. Agent được quyền tự cấu hình chỉ trong template/action allowlist đã cấp; không sửa quyền để tự hợp thức hóa đề xuất.

## 8. Xung đột và vòng lặp

Nhiều rule có thể match cùng event. Action commutative như thêm hai label được hợp nhất/dedup. Action độc quyền như hai assignee/transition xung đột có conflict group và strategy cấu hình: `first-match` theo priority/order đã lưu hoặc `fail-on-conflict`. Default nên fail có giải thích cho assignment ngang ưu tiên, không ngẫu nhiên theo thứ tự query DB.

Không có `label.added` mới nếu label đã tồn tại, hoặc `assignee.changed` nếu giá trị không đổi. Giới hạn mỗi rule/ticket revision, causal depth, số actions/tasks, cooldown và project rate/budget. Chặn trực tiếp chuỗi tạo lại cùng effect signature trong root chain; `maxCausalDepth` chỉ là lớp chặn cuối, không thay kiểm tra duplicate. Hết giới hạn tạo một actionable item tổng hợp, không spam mỗi event.

Rule không tạo child task vô hạn hoặc trigger review↔in-progress vô hạn. Vòng business workflow hợp lệ để sửa lại được phép với revision/attempt mới và bounded fix count. Action của rule mang origin nên có thể bỏ self-origin theo selector.

## 9. Graph và List

Graph tham khảo ảnh: moment ở trái, actor/label targets ở phải, rule card/edge liên kết và state. Màu/line style là design token của ASF; chữ và badge phải đủ phân biệt, không dựa màu duy nhất. Có filter event/agent/label/state, zoom/fit/minimap và inspector của rule.

Graph compiler là hai chiều có giới hạn: graph edit hợp lệ cập nhật canonical rule model, List đọc cùng version. Không cho kéo dây tùy ý giữa node types không có ngữ nghĩa. Nhánh nhiều action/điều kiện phức tạp được mở ở inspector; nếu graph không biểu diễn đầy đủ thì ghi rõ và không làm mất logic khi save. Chỉ dùng read-only projection cho cấu trúc chưa hỗ trợ edit.

Layout lưu riêng: kéo node không đổi hash logic hoặc chạy rule. Draft/proposed cạnh có style/badge riêng; disabled không giả đang thực thi. Rule không match là trạng thái khác rule lỗi. List luôn dùng được bằng keyboard; graph không phải đường duy nhất để cấu hình.

Có thể dùng React Flow/XYFlow cho canvas khi triển khai sau khi kiểm tra phiên bản/license của dependency; ảnh có watermark React Flow không cấp quyền sao chép code/asset CrewHub. Chưa cài dependency trong đợt thiết kế.

## 10. Simulation và quan sát

Simulation nhận sample event hoặc bản sao event đã ghi, chạy match/conflict/policy checks ở chế độ read-only; không tạo message/task/job/tool call. Kết quả: rule nào match, điều kiện nào sai, agent nào được chọn, action nào sẽ chạy và chi phí chưa biết. AI-based classification input thiếu thì ghi needs-input, không gọi model ngầm.

History trình bày “Vì sao ticket này được giao cho agent X?” bằng rule version, event, conditions, receipts và output refs. Lỗi có retry chỉ cho bước đủ idempotency/recovery evidence; external effect unknown cần reconcile. Trace kỹ thuật ở inspector; user feed chỉ kết quả/mốc có ý nghĩa.

## 11. Acceptance và test trọng tâm

- Single rule: event → match → task enqueue một lần; no-op và duplicate event không tạo việc trùng.
- Restart ở giữa event/evaluation/outbox/effect/receipt; internal mutations atomic, external unknown không replay mù.
- Two matching rules: labels merge, assignee conflict xử lý đúng strategy, priority có trace.
- Pause ở giữa queued và executing: không start pending effect sau hold check; running task không bị báo cancelled giả; resume không replay mặc định.
- Self-trigger, status loops, burst schedule và max budget không tạo task storm.
- Stale task revision, revoked grants, disabled agent/runtime offline trả đúng waiting/skipped/blocked.
- Human-final không có code path rule tự đóng Done; policy-auto cần evidence/authority đúng version.
- List/Graph round-trip giữ canonical semantics; incompatible edge, concurrent editor và draft validation không mất logic.
- Schedule recurring report → output version/comments, dedup occurrence, timezone/sleep/resume.
- Full access chạy tool đã cấp không phát Accept Bash; arbitrary script từ rule JSON không được eval.

Không có test/lint/build sản phẩm trong đợt tài liệu này. Những mục trên là yêu cầu nghiệm thu cho LP-02–LP-08 khi implement.
