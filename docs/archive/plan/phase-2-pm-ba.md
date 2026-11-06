# Phase 2 — PM Agent + BA Agent

> **Backlog tham khảo:** thứ tự hiện hành theo [lộ trình code v0](lo-trinh-code-v0.md). PM/BA nền tảng làm trước deploy đầu; tích hợp ghi OpenProject thật hoàn thiện ở Phase 5 mới.

> **Thời lượng gợi ý:** 2 tuần  
> **Phụ thuộc:** Phase 1; spike S2 (OpenProject) và S3 (GitLab API) ở Phase 0  
> **Tham chiếu tài liệu kiến trúc:** mục 3 (Sáu Agent), 4 và 4.1 (Quy trình, song song), 4.2 quy tắc 6 (đổi contract), 5.1 (Hỏi–đáp qua Orchestrator), 8.1 (Nguồn dữ liệu), 8.3 (Specification Gate)

---

## 1. Mục tiêu

Biến một yêu cầu viết bằng ngôn ngữ tự nhiên thành:

1. **Kế hoạch và Work Packages** trong OpenProject, có quan hệ phụ thuộc giữa các task.
2. **Đặc tả**: SRS rút gọn, AC và API contract, có version, được người dùng duyệt rồi **đóng băng (freeze) thành contract v1**.

## 2. Phạm vi

**Trong phạm vi:**

- Client OpenProject.
- PM Agent và BA Agent hoàn chỉnh.
- Specification Gate.
- Quản lý version của contract.
- Luồng QUESTION / ANSWER.

**Ngoài phạm vi:**

- Code BE/FE (Phase 3).
- Giao diện duyệt trên dashboard (Phase 5). Phase này duyệt qua API hoặc CLI.

## 3. Điều kiện bắt đầu

- Graph, queue và ma trận quyền của Phase 1 chạy được.
- Có API key OpenProject của `asf-bot` và project demo trong OpenProject.
- Đã biết type, status và workflow thực tế của OpenProject (P0-01).

---

## 4. Công việc chi tiết

### P2-01. Client OpenProject

`integrations/openproject/`:

- Gọi API v3 (định dạng HAL+JSON). Xác thực bằng API key qua basic auth (username `apikey`).
- Chức năng:
  - Tạo, đọc, cập nhật Work Package.
  - Tạo relation: `precedes`, `follows`, `blocks`, `relates`.
  - Đổi status, thêm comment.
  - Tìm Work Package theo subject hoặc custom field.
- Khi cập nhật phải gửi `lockVersion` để không ghi đè thay đổi của người khác.
- Retry có backoff; phân biệt lỗi 4xx (không retry) và 5xx (retry).
- Cache danh sách type, status, priority để tra ID theo tên.
- Test:
  - Mock HTTP bằng `respx`.
  - Một bộ test chạy với OpenProject thật, gắn marker riêng và không chạy mặc định trong CI.

### P2-02. Map trạng thái

- File cấu hình map trạng thái task nội bộ (`BACKLOG`, `READY`, `IN_PROGRESS`, `IN_REVIEW`, `TESTING`, `DONE`, `CHANGES_REQUESTED`, `BLOCKED`) sang status của OpenProject, dựa trên workflow thực tế.
- **Nguồn dữ liệu chính** (mục 8.1): OpenProject giữ công việc, Orchestrator giữ trạng thái và quyết định của Agent. Chỉ đồng bộ theo chiều đã chọn; không sao chép toàn bộ task board.
- Lưu `run_id` vào Work Package bằng custom field (nếu có) hoặc dòng đầu của mô tả.

### P2-03. PM Agent — lập kế hoạch

**Input:** yêu cầu, thông tin project, trạng thái hiện tại (nếu có).

**Output schema `ProjectPlan`:**

```text
goal
assumptions[]
tasks[]:
  key            # khóa ổn định trong run, vd "T1"
  title, description
  owner_role     # BA | BE | FE | TEST | DEVOPS
  depends_on[]   # danh sách key
  priority, estimate
  ac_refs[]      # điền sau khi BA có AC
risks[]
```

**Kiểm tra tự động sau khi model trả kết quả:**

- Đồ thị phụ thuộc không có vòng (DAG).
- Mỗi task có đúng một `owner_role`.
- Mỗi role cần thiết có ít nhất một task.
- Task BE/FE phụ thuộc vào task "chốt contract".

Kiểm tra fail → gửi lỗi cho PM sửa (tối đa N lần).

**Ghi vào OpenProject:**

- Tạo Work Package theo thứ tự topo, sau đó tạo relation.
- **Idempotent:** chạy lại không tạo trùng. Khóa chống trùng là `run_id` + `key`.
- Lưu `agent_tasks` với `external_ref` = ID Work Package.

**Xử lý blocker:** khi nhận message `BLOCKED`, PM chọn một trong ba hướng: giao lại cho role khác, hỏi người dùng, hoặc đề xuất hủy task.

### P2-04. BA Agent — đặc tả

**Input:** yêu cầu, ref tới kế hoạch của PM.

**Output:**

| Sản phẩm | Định dạng | Nội dung |
|---|---|---|
| SRS rút gọn | Markdown | Phạm vi, actor, luồng chính/phụ, quy tắc nghiệp vụ, dữ liệu, yêu cầu phi chức năng tối thiểu |
| User stories + AC | Markdown / YAML | AC dạng Given / When / Then, mỗi AC có ID ổn định (`AC-001`…) để truy vết sang test |
| API contract | OpenAPI 3.x (YAML) | Endpoint, schema request/response, mã lỗi, phân trang, quy tắc validation |
| Data contract | YAML | Entity, trường, kiểu, ràng buộc |

**Kiểm tra tự động:**

- OpenAPI hợp lệ (`openapi-spec-validator`; tùy chọn lint thêm bằng Spectral).
- Mỗi endpoint được ít nhất một AC tham chiếu.
- ID của AC là duy nhất.
- Không có endpoint nằm ngoài phạm vi yêu cầu.

Kiểm tra fail → gửi lỗi cho BA sửa (tối đa N lần) trước khi trình người duyệt.

### P2-05. Lưu artifact và version

- Mỗi bản đặc tả được lưu vào artifact store (volume `artifacts/{run_id}/`) và ghi vào bảng `artifacts`: `kind`, `version`, `uri`, `checksum`.
- Khi contract được duyệt: commit vào repo `mini-helpdesk` tại `docs/specs/` và `docs/contracts/v1/openapi.yaml`, để BE, FE và TEST dùng chung một nguồn.
  - Phase này chỉ cần GitLab client tối thiểu (Commits API). Client đầy đủ làm ở Phase 3.
- Contract đã freeze thì **không sửa tại chỗ**. Muốn thay đổi phải tạo version mới.

### P2-06. Specification Gate

1. Node `spec_gate` gọi `interrupt`. Run chuyển `WAITING_APPROVAL`, tạo bản ghi `approvals` ở trạng thái chờ, gửi message `APPROVAL_REQUESTED`.
2. Người dùng gọi `POST /api/runs/{run_id}/approve` với `{gate: "spec", decision: "approve" | "reject", comment}`.
3. **Reject:** comment được chuyển thành feedback cho BA → BA sinh bản mới (version tăng) → trình duyệt lại.
4. **Approve:** freeze contract v1, cập nhật `contract_version = 1` trong state, các Work Package liên quan chuyển `READY`.

### P2-07. Đổi contract (v1 → v2)

Theo mục 4.2 quy tắc 6 và sơ đồ mục 5.1:

- Khi BA phát hành v2 (do có câu hỏi từ FE/BE hoặc người dùng đổi yêu cầu), Orchestrator gửi `CONTRACT_UPDATED`.
- Các task đang dựa trên v1 bị đánh dấu "cần rà soát" và được thông báo tới BE, FE, TEST.
- Đổi contract sau khi đã freeze phải được duyệt lại (một spec gate nhỏ).
- Lưu diff giữa hai version để người duyệt xem (dùng `oasdiff` hoặc diff văn bản).

### P2-08. Luồng QUESTION / ANSWER

- Agent bất kỳ gửi `QUESTION` tới BA qua Orchestrator. BA trả lời bằng `ANSWER`, có thể kèm contract mới.
- Câu hỏi BA không tự trả lời được → `BLOCKED` → chuyển cho người dùng.
- Phase này kiểm bằng câu hỏi giả lập từ FE stub, ví dụ câu hỏi "page/limit hay cursor?" ở mục 5.1.

### P2-09. Chạy song song PM ‖ BA

- BA bắt đầu phân tích AC và contract ngay khi PM có danh sách task sơ bộ, không chờ PM tạo xong Work Package (mục 4.1).
- Trong graph: fan-out PM-ghi-OpenProject ‖ BA-phân-tích, rồi gộp lại trước `spec_gate`.

### P2-10. Prompt và bộ đánh giá

- Prompt PM và BA nằm trong `agents/*/prompt.md`, có ví dụ mẫu (few-shot) về Mini Helpdesk.
- Bộ yêu cầu mẫu (3–5 yêu cầu) trong `tests/fixtures/requirements/`.
- Checklist đánh giá đầu ra:
  - Có đủ task cho từng role.
  - AC kiểm thử được (có điều kiện và kết quả cụ thể).
  - OpenAPI hợp lệ.
  - Không tự thêm tính năng ngoài yêu cầu.
- Lưu snapshot đầu ra để phát hiện thay đổi bất thường mỗi khi sửa prompt.

---

## 5. Sản phẩm bàn giao

- `integrations/openproject/` với test.
- PM Agent và BA Agent hoàn chỉnh (prompt, schema, tool, kiểm tra tự động).
- Specification Gate và cơ chế version contract.
- Contract v1 của Mini Helpdesk nằm trong repo `mini-helpdesk`.

## 6. Tiêu chí nghiệm thu

- [ ] Nhập yêu cầu mẫu, ví dụ *"Xây dựng Mini Helpdesk: tạo ticket, xem danh sách có phân trang, lọc theo trạng thái và độ ưu tiên, cập nhật trạng thái"* → Work Packages xuất hiện trong OpenProject với quan hệ phụ thuộc đúng
- [ ] Chạy lại cùng bước không tạo Work Package trùng
- [ ] SRS, AC (có ID) và OpenAPI hợp lệ được lưu, có version và checksum
- [ ] Reject kèm comment → BA tạo bản sửa, version tăng
- [ ] Approve → contract v1 được freeze và commit vào repo module mẫu
- [ ] Luồng QUESTION → ANSWER → `CONTRACT_UPDATED` (v2) chạy được; các task liên quan bị đánh dấu cần rà soát
- [ ] Mọi Work Package, artifact và approval truy ngược được về `run_id`

## 7. Cách kiểm chứng

| Loại | Nội dung |
|---|---|
| Unit test | Kiểm tra DAG, kiểm tra AC/OpenAPI, map trạng thái, client OpenProject (mock) |
| Integration test | Graph PM → BA → spec gate với 9Router mock; client OpenProject với server thật (marker riêng) |
| Đánh giá chất lượng | Chạy bộ yêu cầu mẫu, chấm theo checklist P2-10 |
| Kiểm tay | Mở OpenProject xem Work Packages và relation; mở repo xem contract v1 |

## 8. Rủi ro và cách xử lý

| Rủi ro | Cách xử lý |
|---|---|
| BA sinh contract quá rộng hoặc tự thêm tính năng | Giới hạn phạm vi trong prompt; kiểm tra tự động; người duyệt ở spec gate |
| Workflow OpenProject chặn chuyển trạng thái | Dùng workflow thực tế từ Phase 0 để map; điều chỉnh workflow của project demo |
| Output của LLM không ổn định giữa các lần chạy | Validate theo schema + retry; snapshot fixture; nhiệt độ thấp cho PM/BA |
| Đồng bộ hai chiều với OpenProject gây xung đột | Chỉ đồng bộ một chiều có chủ đích; dùng `lockVersion` |
