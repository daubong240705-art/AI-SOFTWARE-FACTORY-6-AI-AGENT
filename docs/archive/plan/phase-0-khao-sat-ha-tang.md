# Phase 0 — Khảo sát & chuẩn bị hạ tầng

> **Kết quả khảo sát 03/11/2026:** [inventory](../docs/infra-inventory.md), [kế hoạch thi công](../docs/deployment-plan.md), [ADR-001](../docs/adr/ADR-001-module-mau.md), [ADR-002](../docs/adr/ADR-002-phan-bo-ha-tang.md), [ADR-003](../docs/adr/ADR-003-coding-cli.md). S1 đã pass trên `coding-main`; MCP đọc đủ 214 WP mẫu; OpenCode sửa file thật pass trên Windows. S2–S7 còn các bước nghiệm thu môi trường thật; không tick hoàn thành Phase 0 từ kết quả read-only.

> **Cập nhật 04/11/2026:** `.60` đã mở LV từ 29 lên 58 GiB, cài Docker/CLI image và pass probe sửa code + ba test trong Linux container. GitLab Runner đã cài nhưng chưa register; S4, egress/recovery và toàn bộ luồng CI/deploy chưa nghiệm thu. Xem [worker readiness](../docs/worker-bootstrap-2026-11-04.md).

> **Thời lượng gợi ý:** 1 tuần  
> **Phụ thuộc:** không  
> **Tham chiếu tài liệu kiến trúc:** mục 6 (Phân quyền), mục 7 (Tích hợp hạ tầng), mục 15 (Thông tin cần xác minh)

---

## 1. Mục tiêu

Xác nhận hạ tầng thật đáp ứng được thiết kế **trước khi viết code**:

- Mỗi dịch vụ (9Router, OpenProject, GitLab, runner, server deploy, mạng nội bộ) được gọi thử thành công bằng tài khoản dịch vụ có quyền tối thiểu.
- Chốt module mẫu và tech stack của module đó.
- Chốt nơi đặt từng thành phần (orchestrator, worker, runner, staging).

## 2. Phạm vi

**Trong phạm vi:** kiểm kê hạ tầng, tạo tài khoản dịch vụ và secret, tạo repo, chạy spike kiểm chứng, ghi các quyết định.

**Ngoài phạm vi:** viết code orchestrator và Agent (Phase 1 trở đi).

## 3. Điều kiện bắt đầu

- Có quyền quản trị (hoặc người hỗ trợ có quyền) trên GitLab, OpenProject, 9Router và server deploy để tạo tài khoản dịch vụ.
- Máy làm việc đã kết nối NetBird.

---

## 4. Công việc chi tiết

### P0-01. Kiểm kê hạ tầng

Ghi vào `docs/infra-inventory.md`:

| Hạng mục | Thông tin cần ghi |
|---|---|
| GitLab | Phiên bản; URL nội bộ; Container Registry có bật không; giới hạn API |
| GitLab Runner | Phiên bản; executor (docker / shell / kubernetes); chạy trên host nào; tags |
| OpenProject | Phiên bản; API v3; các type Work Package (Task, Bug, Feature…); danh sách status và workflow chuyển trạng thái; có plugin GitLab integration không |
| 9Router | URL nội bộ; kiểu API (có tương thích OpenAI không); danh sách model; cách xác thực; rate limit / quota; có trả số token sử dụng không; có hỗ trợ structured output / tool calling không |
| Deploy server | CPU, RAM, dung lượng đĩa, OS, phiên bản Docker / Compose; các dịch vụ đang chạy trên đó |
| NetBird | Danh sách peer; ACL / group giữa các host |
| Caddy | Các route hiện có; cách cấp TLS (CA nội bộ hay ACME); máy nào cần tin CA |
| DNS nội bộ (AdGuard) | Hostname cần thêm: `asf-api`, `asf-dashboard`, `helpdesk-staging`… |

### P0-02. Chọn module mẫu và tech stack

- **Đề xuất:** Mini Helpdesk. Tính năng cơ bản gồm tạo ticket, danh sách ticket (có phân trang), xem chi tiết, cập nhật trạng thái.
- **Stack gợi ý:** FastAPI + PostgreSQL cho BE, Next.js cho FE. Cùng stack với nền tảng nên coding worker chỉ cần một bộ toolchain.
- Tách hai nhóm tính năng:
  - **v0:** phần khung do người dựng (Phase 3, P3-01).
  - **Phần Agent làm:** ticket CRUD, bộ lọc theo trạng thái/độ ưu tiên (kịch bản thực nghiệm 1), lỗi null/validation tái hiện được (kịch bản 2).
- Ghi thành `docs/adr/ADR-001-module-mau.md`.

### P0-03. Tài khoản dịch vụ và secret

| Dịch vụ | Tài khoản | Quyền tối thiểu |
|---|---|---|
| GitLab (coding) | Bot user `asf-bot` hoặc project access token | Developer trên repo module mẫu; **không** admin; không push được vào protected branch |
| GitLab (DEVOPS) | Token riêng | Chạy pipeline, play manual job trên repo module mẫu |
| GitLab (nền tảng) | Token đọc | Đọc MR, pipeline, artifact |
| OpenProject | User `asf-bot` + API key | Thành viên project demo; role tạo/sửa Work Package |
| 9Router | API key riêng cho nền tảng | Giới hạn quota nếu gateway hỗ trợ |
| Deploy server | User `deploy`, không sudo | Chỉ thao tác thư mục/stack staging; tốt nhất chỉ được dùng qua CI |

Quy tắc lưu secret:

- Môi trường dev: file `.env` nằm ngoài git, có `.env.example` không chứa giá trị thật.
- CI: GitLab CI variables bật **masked + protected**.
- Không bao giờ đưa secret vào prompt hoặc log.
- Cài `gitleaks` làm pre-commit hook ngay từ đầu.

### P0-04. Tạo repo và cấu hình GitLab

- Repo `ai-software-factory`: mã nguồn nền tảng.
- Repo `mini-helpdesk`: sản phẩm do Agent phát triển.
- Trên cả hai repo:
  - Protected branch `main`: chỉ merge qua MR, cần người duyệt.
  - MR template.
  - Bật pipeline cho MR.

### P0-05. Spike kiểm chứng

Mỗi spike là một script nhỏ trong `spikes/`. Ghi kết quả và các vấn đề gặp phải vào `docs/infra-inventory.md`.

| Spike | Việc cần làm | Kết quả cần thấy |
|---|---|---|
| **S1** 9Router | Gọi 1 completion thường và 1 lần yêu cầu JSON theo schema, với model dự định cho từng role | Có phản hồi; JSON parse được; biết latency; biết có số token sử dụng hay không |
| **S2** OpenProject | Tạo Work Package, tạo relation `precedes`, đổi status, thêm comment, đọc lại | Thành công bằng API key của `asf-bot` |
| **S3** GitLab API | Tạo branch, commit file, mở MR, đọc trạng thái pipeline | Thành công bằng token bot |
| **S4** Runner | Pipeline hello-world chạy trên runner cô lập, xuất artifact JUnit | Pipeline xanh, thấy báo cáo test trong MR |
| **S5** Staging | Deploy container hello-world lên server deploy qua CI | Truy cập được qua `https://helpdesk-staging.<domain nội bộ>` (Caddy + DNS) |
| **S6** Webhook | GitLab gửi webhook tới một endpoint thử trên máy chạy orchestrator | Webhook tới nơi; worker và runner phân giải được hostname và tin CA nội bộ |
| **S7** Coding tool | Chạy Codex CLI (hoặc tool tương đương) trong container, trỏ model qua 9Router | Tool sửa được một file mẫu theo yêu cầu |

> **S7 rất quan trọng.** Nếu coding tool không dùng được 9Router, Phase 3 phải dùng phương án dự phòng (tự viết coding loop). Cần biết điều này sớm.

### P0-06. Phân bố thành phần

- Quyết định orchestrator, dashboard, Redis, PostgreSQL, coding worker, runner và staging chạy trên máy nào (mục 7.1 tài liệu kiến trúc).
- **Quy tắc bắt buộc:** code do Agent sinh ra không được chạy trên host đang chứa GitLab, OpenProject hoặc các dịch vụ quan trọng khác.
- Vẽ lại sơ đồ phân bố thực tế. Ghi thành `docs/adr/ADR-002-phan-bo-ha-tang.md`.

### P0-07. Thiết lập theo dõi dự án

- (Tùy chọn) Tạo project trong OpenProject để theo dõi chính các công việc `P0-xx` … `P5-xx`.
- Chốt lịch họp, người duyệt các gate trong demo, hạn nộp.

---

## 5. Sản phẩm bàn giao

- `docs/infra-inventory.md`: bảng kiểm kê và kết quả spike.
- `docs/adr/ADR-001-module-mau.md`, `ADR-002-phan-bo-ha-tang.md`. ADR chọn coding tool (`ADR-003`) có thể ghi sau khi chạy xong S7.
- Thư mục `spikes/` với các script đã chạy.
- Hai repo GitLab đã cấu hình; tài khoản dịch vụ; secret đã lưu đúng chỗ.

## 6. Tiêu chí nghiệm thu

- [ ] Mọi mục trong mục 15 tài liệu kiến trúc đều có câu trả lời trong `infra-inventory.md`
- [ ] 7 spike chạy thành công, hoặc spike nào thất bại thì đã có phương án thay thế được ghi lại
- [ ] Nền tảng không dùng bất kỳ token quản trị nào
- [ ] Module mẫu và stack đã chốt (ADR-001)
- [ ] Sơ đồ phân bố thực tế đã chốt (ADR-002); code của Agent không chạy trên host dịch vụ quan trọng
- [ ] `gitleaks` pre-commit hoạt động trên cả hai repo

## 7. Rủi ro và cách xử lý

| Rủi ro | Cách xử lý |
|---|---|
| 9Router không hỗ trợ structured output / tool calling với model cần dùng | Yêu cầu JSON trong prompt, parse + validate + retry; chọn model khác |
| Coding tool không gọi được qua 9Router | Tự viết coding loop đơn giản (đọc/sửa file, chạy lệnh) gọi 9Router trực tiếp |
| Runner hiện có dùng shell executor trên host quan trọng | Dựng runner mới trên VM riêng với docker executor |
| Webhook từ GitLab không tới được orchestrator | Dùng polling GitLab API làm phương án dự phòng |
| Server không đủ tài nguyên | Giảm số worker chạy song song; tách staging sang máy khác |
| Workflow trạng thái OpenProject không cho phép chuyển trạng thái cần thiết | Điều chỉnh workflow cho type dùng trong project demo, hoặc map lại trạng thái |

## 8. Câu hỏi cần chốt trong phase này

- Hạn nộp và số thành viên? Dùng để điều chỉnh thời lượng các phase.
- Module mẫu là Mini Helpdesk hay một module tách biệt của dự án đang có?
- Ai là người duyệt các gate khi demo?
- Có cần ghi chi phí model vào báo cáo không? (Phụ thuộc 9Router có trả số token hay không.)
