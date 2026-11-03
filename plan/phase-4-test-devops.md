# Phase 4 — TEST Agent + DEVOPS Agent

> **Thời lượng gợi ý:** 2–3 tuần  
> **Phụ thuộc:** Phase 3 (có ứng viên tích hợp); spike S4 (runner), S5 (staging), S6 (webhook) ở Phase 0  
> **Làm song song được:** runner, pipeline khung, Dockerfile, staging có thể bắt đầu từ Phase 2–3 (mục 4.1)  
> **Tham chiếu tài liệu kiến trúc:** mục 3.1, 4 (Quy trình), 5.5 (Event/webhook), 6 (Phân quyền, sandbox), 8.3 (Gate), 14 (Rủi ro)

---

## 1. Mục tiêu

Khép kín vòng lặp phát triển:

```text
kiểm thử trên đúng SHA ứng viên → báo lỗi → sửa → kiểm thử lại
  → duyệt → deploy staging → smoke test → (rollback nếu cần)
```

**Nguyên tắc:** pass hay fail được quyết định bằng **kết quả CI thật**, không dựa vào lời của LLM.

## 2. Phạm vi

**Trong phạm vi:**

- Pipeline CI của module mẫu; runner cô lập.
- Webhook GitLab.
- TEST Agent: soạn test, chạy test, báo lỗi.
- Vòng lặp sửa lỗi và Integration Gate.
- DEVOPS Agent: chuẩn bị deploy, Deployment Gate, deploy staging, smoke test, rollback.

**Ngoài phạm vi:** deploy production (chỉ là mở rộng tùy chọn, luôn cần duyệt thủ công riêng).

## 3. Điều kiện bắt đầu

- Có `integration_commit_sha` từ Phase 3.
- Runner cô lập và server staging đã kiểm bằng spike.
- Webhook từ GitLab tới được orchestrator (hoặc đã chốt dùng polling).

---

## 4. Công việc chi tiết

### P4-01. Pipeline CI của module mẫu

Các stage trong `.gitlab-ci.yml`:

| Stage | Nội dung |
|---|---|
| `lint` | Lint/format BE và FE; kiểm path guard (P3-05 lớp 2) |
| `build` | Build BE và FE |
| `test` | Unit test BE, unit/component test FE |
| `integration` | API test chạy với PostgreSQL thật (service container) |
| `e2e` | Playwright chạy với app đã khởi động trong CI |
| `package` | Build image, **tag = commit SHA**, push lên registry |
| `deploy_staging` | Job manual, chỉ chạy trên branch được bảo vệ |
| `smoke` | Smoke test trên staging |

- Báo cáo JUnit (`artifacts:reports:junit`), coverage, Playwright report và trace lưu làm artifact.
- Pipeline chạy cho MR và cho branch tích hợp.
- DEVOPS Agent được sửa `.gitlab-ci.yml` và `deploy/`. Thay đổi pipeline phải qua MR có người duyệt.

### P4-02. Runner cô lập

- Docker executor trên VM riêng, không privileged.
- Build image không dùng Docker-in-Docker privileged: dùng BuildKit rootless hoặc Buildah.
- Push image lên GitLab Container Registry (nếu đã bật, xem Phase 0).
- Runner không có quyền truy cập vào các host dịch vụ quan trọng ngoài những gì pipeline cần.

### P4-03. Webhook GitLab

Endpoint `POST /api/integrations/gitlab/webhook`:

1. **Xác thực:** so sánh header `X-Gitlab-Token` với secret (so sánh constant-time). Sai → 401.
2. **Chống xử lý trùng:** lấy idempotency key từ header của GitLab (`X-Gitlab-Event-UUID`, hoặc header tương ứng theo phiên bản đang dùng — kiểm ở Phase 0), lưu vào `integration_events` có ràng buộc unique.
3. **Trả 200 ngay**, đưa việc xử lý vào queue.
4. **Kiểm tra trước khi đi tiếp:** project, branch và commit SHA phải khớp `integration_commit_sha` của run. Gọi lại GitLab API để xác nhận trạng thái pipeline, không tin hoàn toàn vào payload.
5. **Dự phòng:** nếu webhook bị mất, định kỳ poll trạng thái pipeline.

### P4-04. TEST Agent — soạn test (chạy song song với BE/FE)

- Bắt đầu ngay khi BA có AC (mục 4.1).
- Từ AC sinh test case. Lập **ma trận truy vết** AC-ID → test ID.
- Chuẩn bị dữ liệu test.
- Viết API test (pytest + httpx, dựa trên contract) và e2e test (Playwright) trong `tests/e2e/`.
- Nếu được, chạy thử API test với mock server từ contract.

### P4-05. TEST Agent — chạy và đánh giá

- Kích hoạt pipeline trên `integration_commit_sha`, hoặc nhận kết quả qua webhook.
- Đọc báo cáo JUnit và log → tạo **test report** gồm:
  - AC nào pass, AC nào fail.
  - Test nào fail, log rút gọn.
  - Commit SHA, pipeline ID.
- **Quy tắc:** chỉ kết luận pass khi pipeline thành công trên đúng SHA ứng viên. LLM chỉ dùng để tóm tắt và phân loại lỗi.
- Lưu test report vào `artifacts`.

### P4-06. Báo lỗi

- Tạo Work Package loại Bug trong OpenProject, gồm:
  - Tiêu đề, bước tái hiện, kết quả mong đợi và kết quả thực tế.
  - AC bị vi phạm.
  - SHA, link pipeline/job, đoạn log liên quan.
- Gửi message `TEST_FAILED` cho Orchestrator.

### P4-07. Vòng lặp sửa lỗi (triage)

1. PM nhận `TEST_FAILED` và xác định ai cần sửa. Dựa vào file trong stack trace, loại test và AC bị vi phạm.
2. Gửi `FIX_REQUESTED` cho BE, FE, hoặc cả hai.
3. Task chuyển `TESTING → CHANGES_REQUESTED → IN_PROGRESS`.
4. Agent sửa trên branch của mình. Tạo ứng viên tích hợp mới với SHA mới, rồi test lại.
5. Mỗi vòng tăng `retry_count`. Vượt `max_retries` → `BLOCKED` và báo người.
6. Nếu cùng một test fail với cùng nguyên nhân nhiều lần liên tiếp → dừng sớm, không chờ hết `max_retries`.

### P4-08. Integration Gate

**Điều kiện đạt:**

- MR của BE và FE đã được review (người duyệt hoặc rule đã định).
- Lint, build, unit, integration và e2e đều pass trên SHA ứng viên.
- Không còn Bug mức cao đang mở.

**Khi đạt:** MR tích hợp được merge vào `main`. Người duyệt bấm merge theo quy định protected branch.

### P4-09. DEVOPS Agent — chuẩn bị deploy

Phần này làm sớm được, song song với Phase 3:

- Dockerfile cho BE và FE.
- `deploy/docker-compose.staging.yml`, có healthcheck cho từng container.
- Route Caddy cho hostname staging.
- Biến môi trường staging lưu trong GitLab CI variables.
- Image luôn tag bằng commit SHA. **Không** dùng `latest` khi deploy.

### P4-10. Deployment Gate và deploy staging

**Điều kiện:**

- Image gắn SHA đã qua kiểm thử.
- Người dùng đã approve (run ở trạng thái `WAITING_DEPLOY_APPROVAL`).

**Các bước:**

1. Sau khi approve, Orchestrator kích hoạt manual job `deploy_staging` qua GitLab API (play job). DEVOPS Agent **không** có SSH toàn quyền vào server.
2. Job deploy dùng user `deploy` có quyền hạn chế (hoặc một deploy agent) và chạy `docker compose pull` + `up -d` với tag SHA.
3. Ghi bảng `deployments`: environment, image tag, SHA, trạng thái, `rollback_ref` (tag ổn định gần nhất).

**Production:** ngoài phạm vi MVP. Nếu làm thì phải có gate thủ công riêng.

### P4-11. Smoke test và rollback

- **Smoke test** chạy qua hostname staging thật (đi qua Caddy và DNS):
  - `/health` của BE.
  - Trang chủ FE.
  - 1–2 luồng chính: tạo ticket, xem danh sách.
- Gửi kết quả về API bằng `DEPLOY_COMPLETED` hoặc `DEPLOY_FAILED`.
- **Fail:** tự động rollback về `rollback_ref`, sau đó chuyển lỗi sang triage.
- Diễn tập rollback ít nhất một lần.

### P4-12. Chuẩn bị kịch bản thực nghiệm

Theo mục 13 tài liệu kiến trúc:

- **Kịch bản bug fix:** chuẩn bị một lỗi null/validation tái hiện được. Ví dụ: tạo ticket thiếu `title` trả về 500 thay vì 422.
- **Kịch bản new feature:** bộ lọc ticket theo trạng thái và độ ưu tiên.
- **Kịch bản deployment:** deploy staging, smoke test, kiểm chức năng.
- Viết sẵn yêu cầu đầu vào cho từng kịch bản để dùng ở Phase 5.

---

## 5. Sản phẩm bàn giao

- `.gitlab-ci.yml` hoàn chỉnh và runner cô lập.
- Webhook handler có xác thực và chống trùng.
- TEST Agent và DEVOPS Agent hoàn chỉnh.
- Staging của Mini Helpdesk chạy qua hostname nội bộ.
- Ít nhất một run hoàn chỉnh từ yêu cầu đến `COMPLETED`.

## 6. Tiêu chí nghiệm thu

- [ ] Pipeline đầy đủ chạy trên runner cô lập, có báo cáo JUnit và Playwright
- [ ] Webhook: token sai bị từ chối; event gửi trùng chỉ xử lý một lần; SHA không khớp bị bỏ qua (có test cho cả ba)
- [ ] Test fail thật → Bug trong OpenProject → Agent sửa → pipeline chạy lại trên SHA mới → pass
- [ ] Vượt `max_retries` → run `BLOCKED` và có thông báo
- [ ] Deploy staging chỉ chạy sau approval; image tag = SHA; có bản ghi `deployments`
- [ ] Smoke test chạy qua hostname staging thật và báo kết quả về orchestrator
- [ ] Đã diễn tập rollback thành công
- [ ] Có một run hoàn chỉnh từ yêu cầu → `COMPLETED`, lưu đủ pipeline ID, SHA và deployment version

## 7. Cách kiểm chứng

| Loại | Nội dung |
|---|---|
| Unit test | Xác thực webhook, idempotency, so khớp SHA, logic triage, parse JUnit |
| Integration test | Gửi webhook giả (đúng, sai token, trùng, sai SHA) tới API chạy thật |
| End-to-end | Chạy kịch bản bug fix: cố ý để test fail → theo dõi vòng sửa đến khi pass |
| Kiểm tay | Mở link staging; xem pipeline trên GitLab; xem Bug trên OpenProject |

## 8. Rủi ro và cách xử lý

| Rủi ro | Cách xử lý |
|---|---|
| Test e2e chập chờn (flaky) | Chờ app sẵn sàng trước khi test; retry riêng test đó 1 lần; lưu trace Playwright |
| Dùng nhầm kết quả CI của commit cũ | Bắt buộc so khớp SHA với ứng viên hiện tại |
| Webhook bị giả mạo hoặc gửi trùng | Token + idempotency key + xác nhận lại qua GitLab API |
| Deploy ảnh hưởng hệ thống nội bộ | Staging tách biệt; user deploy hạn chế; rollback |
| Agent sửa lỗi lặp vô hạn | `max_retries`; dừng sớm khi lỗi lặp lại |
| Build image cần quyền cao | BuildKit rootless / Buildah thay vì Docker-in-Docker privileged |
