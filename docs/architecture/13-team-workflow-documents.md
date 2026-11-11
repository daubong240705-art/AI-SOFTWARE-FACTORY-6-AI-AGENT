# 13 · Trang Đội "Đang làm gì", sơ đồ Quy trình và thư viện Tài liệu: phân tích phương án

| Mục | Nội dung |
|---|---|
| Trạng thái | **Đã duyệt 12/11/2026**: người dùng đồng ý toàn bộ T1–T3, W1–W3, D1–D8 ở §7 |
| Đề bài | Người dùng (11–12/11/2026): trang Đội khó hiểu, muốn kiểu "ai đang làm gì" như ảnh mẫu; trang Quy trình muốn sơ đồ kiểu n8n; trang Tri thức thành thư viện tài liệu chứa cả doc/pdf/file sinh ra, có xem trước, và có bộ công cụ xử lý tài liệu để giảm tải cho agent |
| Phạm vi | `apps/factory-host`, `packages/factory-contracts`, `apps/factory-ui`. Không đụng V1 |
| Không làm | Chưa viết mã, chưa migration, chưa cài thư viện. Tài liệu này chỉ để chốt phương án |
| Liên quan | [02](02-collaboration-and-knowledge.md) (tri thức, artifact), [04](04-workflow-and-governance.md) (workflow, Plan Patch), [11](11-m5-slice-plan.md), [12](12-context-engineering.md) (Context Pack, L0/L1), [oss-options §6F](oss-options.md), [docs/ui/01](../ui/01-redesign-proposal.md) |

Ký hiệu: **[Có]** đã có trong mã · **[Thiếu]** chưa có · **[Đề xuất]** mới trong tài liệu này.

---

## 0. Tóm tắt

| Tính năng | Kết luận | Cần sửa Host | Thư viện mới |
|---|---|---|---|
| **Đội: "Đang làm gì"** | Làm được ngay. Dữ liệu trạng thái đã có, nhưng nằm rải rác ở nhiều API | Một API **chỉ đọc** gộp trạng thái từng agent (§1.4) | Không |
| **Quy trình: sơ đồ** | Làm được. Định nghĩa quy trình vốn là đồ thị (giai đoạn, cạnh, nhóm song song, cổng) | Trả thêm phần đồ thị trong API chi tiết quy trình, thêm API danh sách định nghĩa (§2.3) | `@xyflow/react` (đã duyệt O9), `@dagrejs/dagre` |
| **Tài liệu** | Hiện **chưa** chứa được PDF/DOCX/ảnh: Host chỉ nhận văn bản UTF-8, tối đa 8 MiB | Nhiều: lưu file nhị phân, tải lên, tải xuống an toàn, bản trích xuất, công cụ MCP đọc theo trang (§3) | Xem trước: `pdfjs-dist`, `mammoth`, `exceljs`, `react-markdown`… Xử lý: **MarkItDown** (Python, MIT); về sau Docling, OCRmyPDF |

Thứ tự đề xuất: **Đội → Quy trình V1 (chỉ đọc) → Tài liệu D1 (lưu, tải lên, xem trước) → Tài liệu D2 (xử lý cho agent) → Quy trình V2 (sửa qua Plan Patch) → Tài liệu D3 (OCR, Office chất lượng cao)**.

---

## 1. Trang Đội: "Đang làm gì"

### 1.1 Mục tiêu

Trang mặc định của mục **Đội** trả lời ba câu hỏi trong 3 giây: *ai đang làm gì*, *ai đang chờ tôi*, *có gì hỏng không*. Phần cấu hình hiện có (tạo đội từ gói, số suất, vòng đời, cam kết dự án) chuyển sang tab **Cấu hình**. Ảnh mẫu người dùng gửi (Crewhub "Team") là chuẩn bố cục.

### 1.2 Dữ liệu đã có [Có]

| Nguồn | Nội dung | Ghi chú |
|---|---|---|
| `GET /teams` | Đội, các vị trí (seat) với `slots`, `live` (số attempt đang chạy), năng lực, công cụ; cam kết dự án | `org/views.ts teamViews` |
| `GET /teams/:teamId/queue` | Việc chưa xong của đội: dự án, mã, tiêu đề, trạng thái việc, `seatName`, `liveAttemptState`, thời điểm vào hàng | Tối đa 200 dòng, chỉ việc `draft…active` |
| Trạng thái attempt | `queued, leased, preparing, running, waiting-input, parked, stopping, stopped, submitting, succeeded, failed, lease-expired, unknown, reconciling, requeued` | `contracts/attempt.ts` |
| Sự kiện attempt `progress` | `{ message, percent }` do agent báo qua công cụ tiến độ | Đọc được qua `GET /projects/:id/attempts/:attemptId/events`, **từng attempt một** |
| Bảng `nodes` | Máy chạy: tên, nền tảng, mức tin cậy, trạng thái, số slot, `last_heartbeat_at`; attempt có `node_id` | **Chưa có API**. Hiện chỉ có máy cục bộ (`node:local`) |
| Inbox / approvals | Các mục chờ người dùng (duyệt, câu hỏi, cổng bắt đầu) theo `taskId` | Đã dùng ở "Cần xử lý" |

### 1.3 Khoảng trống [Thiếu]

1. Không có một chỗ trả lời "agent X đang làm gì": giao diện phải ghép `teams` + `queue` từng đội + `events` từng attempt + inbox. Số lượng gọi tăng theo số agent.
2. Dòng ngữ cảnh ("đang gộp T8, chờ duyệt") cần tin nhắn tiến độ mới nhất của attempt: chưa có API trả sẵn.
3. Máy chạy (`nodes`) chưa lộ ra API, nên chưa hiện được chip "Máy này / Windows PC (từ xa)" như mẫu.

### 1.4 API đề xuất [Đề xuất]: `GET /org/activity` (chỉ đọc)

Một truy vấn SQL duy nhất, trả về toàn cảnh. Giao diện tải lại khi có sự kiện `entity.changed` cho attempt, task hoặc approval (gom 1 giây), giống cách các vùng khác đang làm.

```jsonc
{
  "generatedAt": "2026-11-12T08:00:00Z",
  "nodes": [{ "id": "…", "name": "Máy này", "platform": "linux", "trust": "server-sandboxed",
              "state": "online", "slots": { "total": 4, "used": 2 }, "lastHeartbeatAt": "…" }],
  "teams": [{
    "id": "…", "name": "Software Team", "lifecycle": "active",
    "counts": { "working": 3, "waiting": 1, "problem": 0, "queued": 2, "idle": 4 },
    "seats": [{
      "id": "…", "name": "BE", "role": "Backend developer", "isLead": false, "slots": 1,
      "status": "working",                         // §1.5
      "runs": [{                                   // một phần tử cho mỗi attempt sống (slots > 1 thì có thể nhiều)
        "projectId": "…", "projectName": "Demo project", "taskId": "…", "code": "TSK-002", "title": "…",
        "attemptId": "…", "attemptState": "running", "nodeId": "…", "startedAt": "…",
        "progress": { "message": "Đang viết test cho parser", "percent": 60, "at": "…" }
      }],
      "queued": 2,                                  // việc đã giao cho vị trí, chưa chạy
      "needsYou": [{ "approvalId": "…", "kind": "question", "taskId": "…", "code": "TSK-003" }],
      "lastFinished": { "code": "TSK-001", "outcome": "succeeded", "at": "…" }
    }]
  }]
}
```

Chi phí: một migration không cần (đọc bảng có sẵn), một route, test Host cho phép suy trạng thái (bảng §1.5) và cho giới hạn kích thước (tối đa 200 vị trí, tin nhắn tiến độ đã qua `sanitizeAgentText`, cắt 160 ký tự).

### 1.5 Suy trạng thái của một agent (vị trí)

Ưu tiên từ trên xuống, dòng đầu khớp thì dừng:

| Trạng thái hiển thị | Điều kiện | Màu |
|---|---|---|
| **Đang chờ bạn** | Có approval mở gắn với việc của vị trí (câu hỏi, cổng bắt đầu `awaiting-go`, duyệt `in-review`), hoặc attempt ở `waiting-input` / `parked` chờ quyết định | `need` (cam), kèm nút "Trả lời" mở thẳng mục trong Cần xử lý |
| **Có vấn đề** | Attempt ở `lease-expired`, `unknown`, `reconciling`, hoặc lần chạy cuối `failed` trong 30 phút | `info`/đỏ nhạt, chữ "Cần kiểm tra" |
| **Đang chạy** | Attempt ở `leased`, `preparing`, `running`, `submitting`, `stopping` | `run` (vàng), chấm nhấp nháy nhẹ |
| **Xếp hàng** | Không chạy nhưng có việc `ready`/`queued` đã giao | trung tính |
| **Vừa xong** | Lần chạy cuối `succeeded` trong 30 phút | `ok` (xanh) |
| **Rảnh** | Còn lại | xám |

"Cần xử lý" vẫn là nơi xử lý duy nhất; trang Đội chỉ chỉ đường tới đó.

### 1.6 Bố cục

```
Đội                                                     Cập nhật lúc 15:02
Ai đang làm gì, ai đang chờ bạn.          [Đang làm gì] [Cấu hình]   [☐ Chỉ việc cần tôi]

┌ Máy chạy ──────────────────────────────────────────────────────────────┐
│ ● Máy này · linux · 2/4 slot · nhịp 5 giây trước                        │
└─────────────────────────────────────────────────────────────────────────┘
┌ Software Team  7 agent  [Máy này] ── ● Đang chạy 3 ● Chờ bạn 1 ● Rảnh 3 ┐  ┌ Research Team ... ┐
│ (L) Lead      Đang lập kế hoạch TSK-012                  [Đang chạy]    │  │                   │
│   │ (B) BE    TSK-002 Viết test parser · 60%             [Đang chạy]    │  │                   │
│   │ (F) FE    TSK-003 Chờ bạn chọn định dạng             [Chờ bạn] [Trả lời] │                   │
│   │ (T) Test  Không có việc                              [Rảnh]         │  │                   │
└─────────────────────────────────────────────────────────────────────────┘  └───────────────────┘
```

- Lưới 2 cột từ 1280px, 1 cột dưới đó. Mỗi đội là một thẻ; vị trí trưởng nhóm đứng đầu, các vị trí khác thụt vào với đường nối dọc như mẫu.
- Mỗi hàng: ô chữ cái với chấm trạng thái, tên vị trí, dòng ngữ cảnh (mã việc + tin nhắn tiến độ, hoặc "Không có việc"), nhãn trạng thái bên phải. Vị trí có `slots > 1` hiện mỗi lần chạy thành một dòng con.
- Bấm hàng: mở việc trong khung chi tiết của Bảng việc (đã có). "Trả lời": mở mục ở Cần xử lý. Tùy chọn sau: "Dừng" (lệnh `runs.cancel`, có xác nhận).
- Tab **Cấu hình**: giữ nguyên phần hiện có. Màn **Agent** (hồ sơ, model, skill, công cụ qua `agents.configure`) là lát riêng, không thuộc tài liệu này.

### 1.7 Ước lượng

Host: 1 route + test (bắt buộc có test vì là Host). UI: 1 lát Codex (trang mới + tách tab). Không thư viện mới.

---

## 2. Trang Quy trình: sơ đồ hoạt động

### 2.1 Mô hình đã có [Có]

Định nghĩa quy trình (`workflowDefinitionSchema`, `contracts/workflow.ts`) là một đồ thị có kiểm tra chặt:

| Phần | Nội dung |
|---|---|
| `phases` | 1–12 pha (ví dụ: discovery, analysis, ready, execution, delivered) |
| `stages` (≤60) | `key, title, phase, requiredCapabilities, teamHint, optional, includeIf/skipIf, parallelGroup, placement (portable/node-bound), sideEffect (none/artifact/code/external), inputs, outputs (kind + mustReach), limits` |
| `edges` (≤200) | `finish-to-start`, `artifact-approved` (kèm loại tài liệu), `informs`, `rework` (kèm điều kiện và `maxLoops` ≤10) |
| `joins` | nhóm song song với chính sách `all` / `any` / `quorum n` |
| `gates` | trước một giai đoạn: `execution-gate`, `irreversible-action`, `review`; người duyệt `operator` / `project-lead`; có điều kiện |
| `allowedPatches` | chính sách từng phép sửa: `auto` / `approval` / `operator` |
| Phép sửa (Plan Patch) | `addTaskWithinStage`, `skipOptionalStage`, `splitStage`, `addStage` (trước/sau), `reorderStages`, `removeRequiredStage` |
| Trạng thái | Instance: `draft, active, awaiting-approval, paused, resuming, completed, failed, cancelled, superseded, stalled`. Giai đoạn: `pending, ready, active, done, skipped, failed, blocked` |
| Lệnh | `workflows.create/start/pause/resume/cancel/assign-stage/patch/decide-patch` |

Quy trình mẫu `software-delivery`: 7 giai đoạn, 8 cạnh (finish-to-start, artifact-approved, rework), 1 nhóm song song, 2 cổng, 5 pha. Cỡ này vừa với một sơ đồ ngang.

### 2.2 Khoảng trống [Thiếu]

1. `GET /projects/:id/workflows/:instanceId` trả về các giai đoạn với trạng thái, vòng lặp, việc, nhưng **không trả cạnh, cổng, nhóm song song**, cũng như tiêu đề, năng lực, đầu vào/đầu ra của giai đoạn. Không vẽ được đồ thị.
2. Không có API liệt kê các định nghĩa quy trình có thể tạo (từ gói của các đội đang tham gia dự án), nên chưa làm được nút "Tạo quy trình".
3. Giao diện hiện chỉ đọc; tám lệnh điều khiển chưa dùng (trừ duyệt Plan Patch).

### 2.3 API đề xuất [Đề xuất]

- Thêm trường `graph` vào phản hồi chi tiết instance, lấy từ **bản sao định nghĩa của chính instance** (không lấy từ gói, vì Plan Patch đã có thể sửa bản sao): `{ stages: [{ key, title, phase, optional, parallelGroup, placement, sideEffect, requiredCapabilities, inputs, outputs }], edges, joins, gates }`. Chỉ đọc, không migration.
- `GET /projects/:projectId/workflow-definitions`: các định nghĩa từ gói của đội đang tham gia, kèm `parameters` (để sinh form tạo) và `graph` (để xem trước trước khi tạo).

### 2.4 Sơ đồ

| Thành phần | Cách vẽ |
|---|---|
| Giai đoạn | Thẻ: dải màu theo pha, tiêu đề, chấm + chữ trạng thái, số việc, huy hiệu "vòng 2/3" khi có rework, chip năng lực. Tùy chọn: viền đứt. Bỏ qua: mờ. Đang chạy: viền sáng |
| Cổng | Hình thoi nhỏ trước giai đoạn: biểu tượng theo loại (duyệt / bắt đầu / không hoàn tác), người duyệt. Cổng đang chờ người dùng: màu `need` và bấm được để mở Cần xử lý |
| Nhóm song song | Khung bao các giai đoạn cùng nhóm, nhãn "tất cả" / "bất kỳ" / "≥ n" |
| Cạnh | `finish-to-start`: nét liền có mũi tên. `artifact-approved`: nét liền có nhãn ("ADR được duyệt"). `informs`: nét chấm, không mũi tên. `rework`: nét đứt cong quay lại, nhãn "≤ 3 vòng". Cạnh dẫn vào giai đoạn đang chạy có hoạt ảnh chảy |
| Bố cục | Trái sang phải; cột theo pha (làn bơi có nhãn pha phía trên); tự sắp bằng dagre (`rankdir: LR`). Thu nhỏ, phóng to, "vừa màn hình", bản đồ nhỏ góc dưới |
| Bấm giai đoạn | Khung bên phải: trạng thái, lý do bị chặn, danh sách việc (mở được), đầu vào/đầu ra cần đạt, cổng phía trước |
| Truy cập | Giữ chế độ **Danh sách** hiện có làm phương án thay thế (bàn phím, trình đọc màn hình, màn hình hẹp); nút chuyển "Sơ đồ / Danh sách" |

### 2.5 Điều khiển instance (V1)

Nút Tạo (form sinh từ `parameters`), Bắt đầu, Tạm dừng (bắt buộc lý do), Tiếp tục, Hủy (bắt buộc lý do, xác nhận hai bước), Giao giai đoạn cho một đội (`assign-stage`). Mỗi nút gửi đúng một lệnh đã có.

### 2.6 Chỉnh sửa kiểu n8n (V2)

Chỉnh trên sơ đồ **không đổi trực tiếp** quy trình. Mọi thao tác tạo một bản nháp Plan Patch:

| Thao tác trên sơ đồ | Phép sửa | Chính sách mặc định |
|---|---|---|
| Menu chuột phải "Thêm giai đoạn sau" | `addStage` (after) | cần duyệt |
| Kéo giai đoạn sang chỗ khác trong cùng làn | `reorderStages` | cần duyệt |
| "Bỏ qua" trên giai đoạn tùy chọn | `skipOptionalStage` | tự động |
| "Tách" giai đoạn | `splitStage` (2–5 phần) | tự động |
| "Thêm việc vào giai đoạn" | `addTaskWithinStage` | tự động |
| "Xóa giai đoạn bắt buộc" | `removeRequiredStage` | chỉ người vận hành |

Bản nháp hiện lớp phủ (giai đoạn mới viền đứt, mũi tên di chuyển), liệt kê chính sách từng phép, và chỉ gửi khi bấm "Gửi đề xuất" kèm lý do (`workflows.patch`). Phép cần duyệt đi vào "Cần xử lý" như hiện nay.

Giới hạn có chủ ý: **không vẽ tự do cạnh mới** vì Host không có phép sửa cạnh; muốn thiết kế quy trình mới từ đầu (trình soạn định nghĩa) cần định dạng gói v2 và kiểm tra phía Host, để sau.

### 2.7 Thư viện

| Gói | Phiên bản (12/11) | Giấy phép | Vai trò |
|---|---|---|---|
| `@xyflow/react` | 12.12.1 | MIT | Vẽ đồ thị, kéo thả, thu phóng. Đã duyệt (O9) |
| `@dagrejs/dagre` | 3.1.3 | MIT | Tự sắp xếp vị trí nút |
| ~~`elkjs`~~ | 0.12.1 | EPL-2.0 hoặc GPL-3.0 | **Loại**: giấy phép không hợp chính sách |

Tab Quy trình được tách gói (tải động) để không làm nặng gói chính (đang ~665 KB).

### 2.8 Ước lượng

Host: phần `graph` + API định nghĩa + test. UI: V1 một lát (sơ đồ + khung giai đoạn + điều khiển), V2 một lát (bản nháp Plan Patch).

---

## 3. Thư viện Tài liệu (đổi tên từ "Tri thức")

### 3.1 Mô hình đã có [Có]

| Phần | Hiện trạng |
|---|---|
| Đơn vị | Artifact có nhiều phiên bản bất biến; 13 loại (`research-report, requirements, adr, data-model, api-contract, ui-spec, design-asset, media, code-ref, dataset, dossier, plan, other`); trạng thái trên từng phiên bản (`draft → in-review → reviewed → approved…`), dấu "cũ" (stale) |
| Lưu trữ | Kho nội dung theo SHA-256, quyền 0700, chặn symlink, **tối đa 8 MiB mỗi đối tượng** |
| Đường vào | Chỉ agent tạo, qua công cụ MCP đăng ký đầu ra: đọc file trong workspace rồi **giải mã UTF-8 nghiêm ngặt**. PDF, DOCX, ảnh đều bị từ chối |
| Tìm kiếm | SQLite FTS5 trên tiêu đề, tóm tắt, nội dung (`unicode61 remove_diacritics 2`, tiếng Việt bỏ dấu được) |
| Cho agent | Công cụ MCP `knowledge.search`, `knowledge.get`. Context Pack mỗi lần chạy (mặc định 6.000 token) dùng tóm tắt L0 (≤400 ký tự) và L1 (≤6.000 ký tự) |
| Giao diện | Danh sách, tìm, đọc nội dung chữ |

### 3.2 Khoảng trống [Thiếu]

1. Không lưu được file nhị phân. 2. Người dùng không tải tài liệu lên được. 3. Không xem trước PDF/Office/ảnh. 4. Agent phải đọc nguyên văn (hoặc không đọc được) tài liệu lớn, tốn token. 5. Không đọc được theo trang/mục. 6. Không xuất tài liệu thành DOCX/PDF để bàn giao.

### 3.3 Mô hình đề xuất [Đề xuất]

Giữ **Artifact là đơn vị duy nhất** (không dựng hệ thống file song song), thêm:

- Trên phiên bản: `origin` (`agent` | `upload`), dùng `mediaType` sẵn có với **danh sách cho phép**, giới hạn kích thước theo loại (mặc định 25 MB, cấu hình `FACTORY_DOC_MAX_BYTES`).
- Bảng `artifact_derivatives` (bản dẫn xuất, xây lại được, không phải nguồn sự thật): `(project_id, artifact_id, version, kind: text | outline | thumbnail | preview-pdf, content_hash, converter, converter_version, status: pending | done | failed | skipped, error_code, created_at)`. Khóa bộ nhớ đệm là `(content_hash, converter@version)`, nên cùng một file không xử lý lại.
- Chỉ mục FTS5 dùng văn bản dẫn xuất cho file nhị phân. Bản gốc vẫn là nguồn sự thật.

### 3.4 Tải lên và tải xuống (D1)

- `POST /projects/:projectId/documents` (multipart): kiểm tra phiên và CSRF như mọi lệnh ghi; ghi luồng ra file tạm; dừng khi vượt giới hạn; **đọc chữ ký đầu file** để so với loại khai báo; tính SHA-256; tạo phiên bản `origin: upload`, trạng thái `draft`; đưa vào hàng xử lý (D2). Tải phiên bản mới của tài liệu cũ: cùng API với `artifactId`.
- Agent đăng ký đầu ra nhị phân: cho phép khi `mediaType` nằm trong danh sách; chỉ kiểm tra UTF-8 cho loại văn bản.
- `GET …/versions/:version/raw`: `Content-Type` lấy từ danh sách cho phép (không tin khai báo), `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox; default-src 'none'`, `Content-Disposition: attachment` cho mọi loại trừ PDF và ảnh raster; SVG luôn là tệp đính kèm.

### 3.5 Xem trước

| Định dạng | Cách xem | Giai đoạn |
|---|---|---|
| Markdown, văn bản, JSON, mã | Trong UI: `react-markdown` + `remark-gfm` + `rehype-sanitize`; mã tô màu bằng `shiki` | D1 |
| CSV | Bảng (`papaparse`), giới hạn 1.000 dòng xem trước | D1 |
| PDF | `pdfjs-dist` (luôn đặt `isEvalSupported: false` và cập nhật bản vá), có ảnh thu nhỏ trang, chuyển trang, phóng to | D1 |
| Ảnh PNG/JPG/WebP/GIF | `<img>` gốc; SVG chỉ tải xuống | D1 |
| DOCX | Nhanh: `mammoth` → HTML đã lọc. Trung thực cao: LibreOffice → PDF trên máy chủ | D1 / D3 |
| XLSX | Trang tính đầu thành bảng (`exceljs`) | D1 |
| PPTX | LibreOffice → PDF | D3 |
| Khác | Chỉ tải xuống | D1 |

### 3.6 Bộ xử lý tài liệu để giảm tải agent (D2)

**Ý tưởng:** agent không đọc nguyên file. Mỗi phiên bản được xử lý một lần thành Markdown có mốc trang/mục, mục lục, siêu dữ liệu và tóm tắt L0/L1. Context Pack chỉ mang L0 (≤400 ký tự mỗi tài liệu); agent gọi công cụ để xem mục lục rồi đọc đúng mục/trang cần. Một PDF 80 trang khi đó tốn vài trăm token thay vì vài chục nghìn.

**Kiến trúc**

```
Tải lên / agent đăng ký ─► Host ghi phiên bản ─► hàng đợi xử lý (SQLite)
                                                   │
                                                   ▼
                       doc-worker (tiến trình riêng, mỗi việc một lần chạy trong bubblewrap)
                       • chỉ đọc file đầu vào, chỉ ghi thư mục ra, KHÔNG có mạng
                       • giới hạn thời gian 120 giây, bộ nhớ, kích thước đầu ra
                       • trả JSON: markdown, outline[{level,title,page,offset}], pages, metadata, warnings
                                                   │
                                                   ▼
                    Host kiểm tra schema ─► lưu bản dẫn xuất ─► chỉ mục FTS5 ─► L0/L1 trích xuất
```

Không bao giờ chạy bộ chuyển đổi trong tiến trình Host (MarkItDown tự cảnh báo nó đọc ghi file với quyền của tiến trình gọi).

**Lựa chọn bộ chuyển đổi** (kiểm tra 12/11/2026 trên PyPI/npm và file LICENSE):

| Lựa chọn | Phiên bản | Giấy phép | Điểm mạnh | Điểm yếu | Đề xuất |
|---|---|---|---|---|---|
| **MarkItDown** (Microsoft) | 0.1.9 (21/10/2026), Python ≥3.10 | MIT | Một công cụ cho PDF, DOCX, PPTX, XLSX, HTML, CSV, JSON; đầu ra Markdown cho LLM; nhẹ, chạy CPU | PDF chỉ lấy lớp chữ (pdfminer), bảng và bố cục phức tạp kém, không OCR (OCR/chú thích ảnh chỉ qua LLM: tắt) | **Mặc định cho D2** |
| **Docling** (IBM, LF AI & Data) | 2.150.0 (10/11/2026), Python ≥3.10 | MIT (mô hình Granite-Docling: Apache-2.0) | Bố cục, bảng, thứ tự đọc, công thức, OCR | Nặng: PyTorch và mô hình vài GB; chậm trên CPU (WSL hiện có 6 lõi, 7 GB, không GPU) | D3, chạy trên máy M4 hoặc khi tài liệu bị gắn cờ "phức tạp/quét" |
| Unstructured | 0.27.37, Python 3.11–3.13 | Apache-2.0 | Chia đoạn, nhiều định dạng | Nhiều phụ thuộc, hướng tới ETL | Không chọn bây giờ |
| Apache Tika | máy chủ Java | Apache-2.0 | Định dạng rộng nhất, siêu dữ liệu | Thêm JVM, bố cục yếu | Không chọn |
| OCRmyPDF + Tesseract | 17.14.1 | MPL-2.0 / Apache-2.0 | Thêm lớp chữ cho PDF quét | Cần cài gói hệ thống | D3 |
| Thuần Node (`pdfjs-dist`, `mammoth`, `exceljs`) | | Apache-2.0 / BSD-2 / MIT | Không thêm runtime Python | Chất lượng thấp hơn, phải tự ghép từng định dạng | Dự phòng nếu không chấp nhận Python |
| ~~Pandoc~~, ~~PyMuPDF~~ | | GPL-2.0, AGPL-3.0 | | Giấy phép sao chép bắt buộc | **Loại** |

Môi trường WSL hiện có Python 3.12 và bubblewrap; chưa có LibreOffice, Tesseract. D2 thêm một **venv Python riêng, ghim phiên bản bằng `pip --require-hashes`**, cài qua script triển khai như Host.

**Công cụ MCP cho agent** (mở rộng nhóm `knowledge.*`, cùng quyền đọc theo dự án/đội như hiện tại):

| Công cụ | Đầu vào | Đầu ra | Giới hạn |
|---|---|---|---|
| `knowledge.outline` | `artifactId`, `version?` | mục lục có mã mục và số trang, số trang, loại, kích thước | |
| `knowledge.read` | `artifactId`, `section?` hoặc `pages {from,to}`, `maxChars?` | Markdown của phần đó, kèm mốc trang | ≤12.000 ký tự mỗi lần, tính vào ngân sách token của lần chạy |
| `knowledge.find` | `artifactId`, `query` | đoạn trích kèm trang/mục | ≤20 kết quả |

Văn bản trích xuất là **dữ liệu không tin cậy** (có thể chứa câu lệnh mồi): đưa vào ngữ cảnh trong khung "tài liệu bên ngoài", qua `sanitizeAgentText`, không bao giờ coi là chỉ dẫn.

**Tóm tắt L0/L1:** mặc định **trích xuất** (tiêu đề, đề mục, đoạn đầu), không tốn token. Tóm tắt bằng model là tùy chọn bật theo dự án, vì tốn chi phí thật.

### 3.7 An toàn với file không tin cậy

| Rủi ro | Biện pháp |
|---|---|
| Bom nén (DOCX/XLSX/PPTX là ZIP) | Giới hạn kích thước giải nén và số mục trong worker |
| XML độc (XXE) | Worker không có mạng, chỉ đọc một file; dùng thư viện đã tắt thực thể ngoài |
| Macro | Không bao giờ thực thi; không dùng bộ chuyển đổi chạy macro |
| PDF có mã độc nhắm trình xem | `pdfjs-dist` bản mới, `isEvalSupported: false`; xem trong khung có CSP sandbox |
| SVG/HTML chứa script | Chỉ tải xuống; HTML từ DOCX qua `rehype-sanitize` |
| File giả loại | So chữ ký đầu file với danh sách cho phép |
| Câu lệnh mồi trong tài liệu | Như §3.6: dữ liệu, không phải chỉ dẫn |
| Đầy đĩa | Hạn mức theo dự án (đề xuất 2 GB), từ chối khi vượt |

### 3.8 Giao diện "Tài liệu"

```
Tài liệu                                         [⬆ Tải lên]   [ Tìm trong tài liệu…        ]
[Tất cả] [Do agent tạo] [Tải lên]   Loại ▾  Trạng thái ▾  Việc ▾
┌─────────────────────────────── Danh sách / lưới ─────────┐ ┌──── Xem trước ───────────────────┐
│ 📄 Yêu cầu nghiệp vụ.pdf   PDF · 34 trang · Đã duyệt     │ │  ◀ Trang 3/34 ▶   − 100% +        │
│    Tải lên · 2 giờ trước · Đã trích xuất                 │ │  ┌─────────────────────────────┐ │
│ 📝 Ghi chú của agent       Markdown · Đang duyệt         │ │  │      (trang PDF)            │ │
│    TSK-002 · lần chạy 2                                  │ │  └─────────────────────────────┘ │
│ 📊 Số liệu Q3.xlsx         Bảng tính · Nháp              │ │  Phiên bản 2 · 1,2 MB · tải lên   │
└──────────────────────────────────────────────────────────┘ │  [Tải xuống] [Phiên bản mới] [▾]  │
  ┌ Hồ sơ dự án (Dossier) ─ ghim ─────────────────────────┐   └───────────────────────────────────┘
```

- Kéo thả để tải lên, thanh tiến trình, lỗi rõ ràng (loại không cho phép, quá cỡ).
- Trạng thái xử lý hiện bằng chữ: "Đang trích xuất", "Đã trích xuất 34 trang", "Không trích xuất được (PDF quét)".
- Hành động: tải xuống, tải phiên bản mới, chuyển trạng thái, chia sẻ sang dự án khác (`artifacts.share`), bỏ dấu cũ (`artifacts.clear-stale`).

### 3.9 Các giai đoạn

| Giai đoạn | Nội dung | Host | UI |
|---|---|---|---|
| **D1** | Lưu nhị phân, danh sách cho phép, tải lên, tải xuống an toàn, xem trước (§3.5 cột D1), đổi tên "Tài liệu", agent đăng ký file nhị phân | Migration (`origin`, giới hạn), 2 route, test bảo mật | 1–2 lát |
| **D2** | doc-worker + MarkItDown, bản dẫn xuất, chỉ mục, 3 công cụ MCP, L0/L1 trích xuất | Migration `artifact_derivatives`, hàng đợi, worker, test | Trạng thái xử lý |
| **D3** | OCR, Docling cho PDF phức tạp, LibreOffice cho DOCX/PPTX, xuất Markdown → DOCX/PDF, tìm kiếm ngữ nghĩa (chưa quyết) | Theo nhu cầu | Theo nhu cầu |

---

## 4. Thứ tự và phụ thuộc

1. **Đội "Đang làm gì"**: API `/org/activity` + trang. Không phụ thuộc gì.
2. **Quy trình V1**: `graph` + định nghĩa + sơ đồ chỉ đọc + điều khiển instance.
3. **Tài liệu D1**: lưu, tải lên/xuống, xem trước.
4. **Tài liệu D2**: worker, MCP đọc theo trang.
5. **Quy trình V2**: chỉnh qua Plan Patch.
6. **Tài liệu D3**.

Phần Host luôn có test (vitest Host, chạy cả Windows và WSL). Phần UI theo quyết định trước đó: không viết test UI, kiểm bằng `tsc`, build, ảnh chụp và `e2e/audit-align.mjs`.

## 5. Rủi ro

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| Thêm runtime Python cho Host | Trung bình | venv riêng, ghim hash, chỉ worker dùng; phương án thuần Node làm dự phòng |
| Docling quá nặng cho máy hiện tại | Cao nếu bật sớm | Chỉ D3, ưu tiên máy M4 |
| Bộ chuyển đổi bị khai thác qua file độc | Trung bình | bubblewrap, không mạng, giới hạn tài nguyên, không chạy trong Host |
| Sơ đồ khó dùng trên màn hình hẹp | Thấp | Giữ chế độ Danh sách |
| `/org/activity` chậm khi nhiều dự án | Thấp | Một truy vấn có chỉ mục, giới hạn 200 vị trí, gom sự kiện 1 giây |
| Khoảng cách test UI ngày càng lớn | Trung bình | Lên lịch một lượt khôi phục test UI trước khi gộp phần thiết kế lại vào `main` |

## 6. Ước lượng thô

| Hạng mục | Thẻ Codex (ước) | Ghi chú |
|---|---|---|
| Đội | 2 (Host 1, UI 1) | |
| Quy trình V1 | 2–3 | + 2 dependency |
| Tài liệu D1 | 3 | migration, bảo mật, xem trước |
| Tài liệu D2 | 3–4 | worker, MCP, venv |
| Quy trình V2 | 2 | |

## 7. Quyết định (đã duyệt 12/11/2026: "đồng ý tất cả")

| # | Câu hỏi | Đề xuất |
|---|---|---|
| T1 | Tách trang Đội thành "Đang làm gì" (mặc định) và "Cấu hình"? | Có |
| T2 | Thêm API chỉ đọc `GET /org/activity` (§1.4) và lộ danh sách máy chạy? | Có |
| T3 | Bộ trạng thái §1.5, cửa sổ "Vừa xong" / "Có vấn đề" 30 phút? | Có |
| W1 | V1 sơ đồ chỉ đọc + điều khiển instance, giữ chế độ Danh sách? | Có |
| W2 | Dùng `@xyflow/react` + `@dagrejs/dagre`, loại `elkjs`? | Có |
| W3 | Chỉnh sửa (V2) chỉ qua Plan Patch, không vẽ tự do cạnh? | Có |
| D1 | Đổi tên "Tri thức" thành "Tài liệu", giữ Artifact làm đơn vị? | Có |
| D2 | Danh sách loại cho phép: PDF, DOCX, XLSX, PPTX, CSV, MD, TXT, JSON, PNG, JPG, WebP, GIF, SVG (tải xuống); 25 MB mỗi file; hạn mức 2 GB mỗi dự án? | Có |
| D3 | Cho người dùng tải tài liệu lên (`origin: upload`, mặc định `draft`)? | Có |
| D4 | Chấp nhận thêm runtime Python (venv ghim hash) cho doc-worker với MarkItDown? Nếu không, dùng phương án thuần Node | Có, MarkItDown |
| D5 | Docling, OCR, LibreOffice để D3 (sau M4)? | Có |
| D6 | Ba công cụ MCP `knowledge.outline/read/find` với giới hạn §3.6? | Có |
| D7 | L0/L1 trích xuất mặc định, tóm tắt bằng model chỉ khi bật? | Có |
| D8 | Loại các công cụ GPL/AGPL (Pandoc, PyMuPDF) khỏi đường xử lý mặc định? | Có |
