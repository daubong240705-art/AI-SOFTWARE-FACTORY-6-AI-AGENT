# Phase 3 — BE Agent + FE Agent

> **Thời lượng gợi ý:** 3 tuần  
> **Phụ thuộc:** Phase 2 (contract v1 đã freeze); spike S3 (GitLab API) và S7 (coding tool) ở Phase 0  
> **Tham chiếu tài liệu kiến trúc:** mục 3.1 (Phân biệt trách nhiệm), 4.1 (Song song), 4.2 (Quy tắc tích hợp mã nguồn), 6.2 (Sandbox), 7.1 (Phân bố)

---

## 1. Mục tiêu

BE Agent và FE Agent **viết code thật**:

- Chạy **song song** trong hai workspace cô lập.
- Mỗi bên có branch riêng và MR riêng trên GitLab.
- Sau đó hai phần được gộp thành một **ứng viên tích hợp** có commit SHA cụ thể, để TEST dùng ở Phase 4.

## 2. Phạm vi

**Trong phạm vi:**

- Khung module mẫu.
- Coding worker cô lập.
- Công cụ coding.
- GitLab client đầy đủ.
- Path guard.
- BE Agent, FE Agent.
- Development Coordinator.
- Tạo ứng viên tích hợp.

**Ngoài phạm vi:**

- Pipeline CI đầy đủ và Integration Gate (Phase 4).
- Deploy (Phase 4).

## 3. Điều kiện bắt đầu

- Contract v1 nằm trong repo `mini-helpdesk` (P2-05).
- Đã biết coding tool nào dùng được với 9Router (S7).
- Có host riêng cho coding worker (ADR-002).

---

## 4. Công việc chi tiết

### P3-01. Khung module mẫu (người dựng, không để Agent tự dựng)

Repo `mini-helpdesk`:

```text
mini-helpdesk/
├── backend/            # BE Agent
│   ├── app/
│   ├── migrations/
│   └── tests/
├── frontend/           # FE Agent
│   ├── src/
│   └── tests/
├── tests/e2e/          # TEST Agent
├── deploy/             # DEVOPS Agent
├── docs/specs/         # BA Agent
├── docs/contracts/     # BA Agent
├── .gitlab-ci.yml      # DEVOPS Agent
└── ownership.yaml      # path → role (người quản lý)
```

- Cấu hình sẵn lint, format, test cho cả hai phía.
- Có sẵn một endpoint `/health` và một trang trống để Agent có mẫu làm theo.
- `ownership.yaml` khai báo thư mục nào thuộc role nào. Path guard (P3-05) dùng file này.
- **Lý do:** khung ổn định giúp Agent sửa đúng chỗ và tránh mất thời gian vào lỗi cấu hình dự án.

### P3-02. Coding worker cô lập

Mỗi job coding chạy trong một container tạm, dựng từ image `asf-coder` (có Python, Node, git và coding tool).

| Yêu cầu | Cách làm |
|---|---|
| Không đặc quyền | Không `--privileged`; không mount Docker socket; chạy bằng user không phải root |
| Giới hạn tài nguyên | Giới hạn CPU/RAM; timeout cho cả job và cho từng lệnh |
| Giới hạn filesystem | Root filesystem chỉ đọc; chỉ thư mục workspace được ghi |
| Giới hạn mạng | Chỉ cho ra GitLab nội bộ, 9Router và mirror package (PyPI/npm), dùng network riêng hoặc proxy |
| Workspace tạm | Mỗi job clone mới; xóa sạch sau khi xong |
| Bằng chứng | Lưu lại log các lệnh đã chạy và kết quả |

- Worker chạy trên host riêng, **không** chung host với GitLab hay OpenProject (mục 7.1).
- Tiến trình launcher (nhận job từ queue `coding`, khởi động container) tách khỏi container chạy code của Agent.

### P3-03. Công cụ coding

| Phương án | Mô tả | Khi nào dùng |
|---|---|---|
| **A** | Codex CLI chạy non-interactive trong container, provider trỏ về 9Router | Spike S7 thành công |
| **B** (dự phòng) | Coding loop tự viết, với các tool `read_file`, `write_file`, `list_files`, `search`, `run_command` (whitelist lệnh), gọi 9Router | S7 thất bại hoặc A không ổn định |

Dù chọn A hay B:

- Prompt chỉ chứa task, các AC liên quan, contract v1 và các file liên quan.
- Token GitLab không bao giờ nằm trong prompt.
- Ghi quyết định vào `docs/adr/ADR-003-coding-tool.md`.

### P3-04. GitLab client đầy đủ

`integrations/gitlab/`:

- Tạo branch, mở và cập nhật MR, comment trên MR, đọc pipeline/job, tải artifact.
- Push qua HTTPS bằng token bot có scope hẹp. Token được truyền vào container qua biến môi trường của job, không nằm trong prompt hay log.

Quy ước:

| Mục | Quy ước |
|---|---|
| Branch | `feature/OP-<id>-be`, `feature/OP-<id>-fe`, `integration/OP-<id>` |
| Commit message | `[OP-123][BE] <tóm tắt>` + trailer `Run-Id: run-001` |
| MR template (mục 4.2 quy tắc 3) | Task ID, AC đáp ứng, file thay đổi, kết quả lint/build/test, commit SHA, contract version |

### P3-05. Path guard

- **Lớp 1, trong worker:** trước khi push, tính diff và đối chiếu với `ownership.yaml` và ma trận quyền. Có file ngoài phạm vi → không push, gửi message yêu cầu điều phối. Ví dụ BE cần sửa `frontend/` → gửi `QUESTION` hoặc `BLOCKED`.
- **Lớp 2, trong CI:** job kiểm tra lại diff của MR theo branch/role, phòng trường hợp lớp 1 bị bỏ qua.
- Test: cố tình cho BE sửa một file trong `frontend/` → bị chặn ở cả hai lớp.

### P3-06. BE Agent

**Input:** task BE, contract v1, AC liên quan, khung backend.

**Việc cần làm:**

- Model dữ liệu và migration.
- Endpoint đúng theo OpenAPI.
- Validation và mã lỗi đúng contract.
- Unit test và API test.

**Tự kiểm trong sandbox trước khi push:**

1. Lint và type check.
2. Unit test.
3. Khởi động app thử.
4. (Tùy chọn) Chạy contract test bằng Schemathesis với file OpenAPI.

**Khi tự kiểm thất bại:** tự sửa trong giới hạn số lần thử. Vẫn fail → push dưới dạng **MR draft** kèm báo cáo lỗi, hoặc chuyển `BLOCKED`.

**Output:** branch, commit SHA, MR ID, báo cáo (các lệnh đã chạy và kết quả).

### P3-07. FE Agent

**Input:** task FE, contract v1, AC liên quan, khung frontend.

**Việc cần làm:**

- Sinh type và API client từ OpenAPI (`openapi-typescript` hoặc tương đương), để FE không phải đoán cấu trúc dữ liệu.
- Phát triển độc lập với BE bằng **mock server sinh từ contract** (ví dụ Prism), không cần chờ BE xong.
- Các màn hình:
  - Danh sách ticket (phân trang, lọc theo trạng thái và độ ưu tiên).
  - Tạo ticket.
  - Chi tiết ticket và cập nhật trạng thái.
- Mỗi màn hình có đủ trạng thái loading, rỗng và lỗi; hiển thị tốt trên màn hình nhỏ.
- Component test; build pass.

**Output:** giống BE.

### P3-08. Development Coordinator

- Đây là logic scheduler trong `orchestrator/scheduler.py`, **không phải Agent thứ bảy** (mục 3.1).
- Phát job BE và FE song song khi điều kiện phụ thuộc đã thỏa (contract đã freeze).
- Giới hạn số job coding chạy cùng lúc theo tài nguyên máy.
- Theo dõi heartbeat và timeout của job; hủy job khi run bị cancel.
- Nhận `CONTRACT_UPDATED` giữa chừng → dừng job, hoặc đánh dấu job cần làm lại theo version mới.

### P3-09. Ứng viên tích hợp

Chính sách (ghi thành ADR):

1. Tạo `integration/OP-<id>` từ `main`.
2. Merge branch BE, sau đó merge branch FE (tuần tự). Không để hai Agent ghi chung một working tree.
3. Xung đột merge → giao cho Agent sở hữu file đó. Nếu xung đột vượt ranh giới hai role → `BLOCKED` để người xử lý.
4. Ghi `integration_commit_sha` vào state. Phase 4 TEST phải chạy đúng trên SHA này.
5. Merge vào `main` chỉ được làm sau Integration Gate (Phase 4), qua MR có người duyệt.

### P3-10. Giới hạn và chi phí

- Mỗi task có `max_attempts`, timeout và budget token.
- Mỗi lượt chạy ghi vào `agent_executions`: model, token, thời gian, các lệnh đã chạy.

### P3-11. Ngữ cảnh code

- Dùng **repo map** (cây thư mục + chữ ký hàm/class) thay vì đưa toàn bộ repo vào prompt.
- Chọn file liên quan dựa trên `ownership.yaml` và từ khóa trong task.

---

## 5. Sản phẩm bàn giao

- Khung `mini-helpdesk` và `ownership.yaml`.
- Image `asf-coder` và launcher của coding worker.
- `integrations/gitlab/`, path guard, scheduler.
- BE Agent và FE Agent hoàn chỉnh.
- ADR-003 (coding tool), ADR chính sách tích hợp.
- Hai MR thật và một branch tích hợp trên GitLab.

## 6. Tiêu chí nghiệm thu

- [ ] Từ contract v1, job BE và FE chạy cùng lúc trong hai container riêng (log cho thấy thời gian chạy chồng nhau)
- [ ] GitLab có 2 branch và 2 MR với template đầy đủ; commit có OP-ID và `run_id`
- [ ] Lint và test trong sandbox pass cho cả hai phía
- [ ] FE dùng type sinh từ contract và chạy được với mock server
- [ ] Path guard chặn sửa ngoài phạm vi, ở cả worker và CI (có test)
- [ ] Container không privileged, không có Docker socket, mạng ra ngoài bị giới hạn (có bằng chứng kiểm tra)
- [ ] `integration_commit_sha` được ghi lại
- [ ] Không có token trong prompt, log hoặc commit (`gitleaks` pass)

## 7. Cách kiểm chứng

| Loại | Nội dung |
|---|---|
| Unit test | Path guard, scheduler, GitLab client (mock) |
| Kiểm tra sandbox | Trong container thử: gọi Docker socket, ghi ra ngoài workspace, gọi một domain không được phép → tất cả đều phải thất bại |
| End-to-end | Từ một run đã qua spec gate → 2 MR → branch tích hợp |
| Kiểm tay | Đọc code của MR; chạy app từ branch tích hợp trên máy dev |

## 8. Rủi ro và cách xử lý

| Rủi ro | Cách xử lý |
|---|---|
| Code Agent sinh ra không build hoặc chất lượng thấp | Khung dựng sẵn; tự kiểm trước khi push; chia task nhỏ; giới hạn số lần thử |
| Codex CLI không tương thích 9Router | Phương án B (coding loop tự viết) |
| Agent sửa lấn sang vùng của role khác | Path guard hai lớp |
| Tốn nhiều token | Repo map; budget theo task; chỉ đưa file liên quan |
| BE/FE lệch nhau do contract đổi | Version contract; FE dùng mock từ contract; Integration Gate |
| Cài dependency chậm hoặc không có Internet | Mirror package nội bộ; image dựng sẵn dependency |
