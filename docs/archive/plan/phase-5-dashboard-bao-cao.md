# Phase 5 — Dashboard, thực nghiệm và báo cáo

> **Backlog tham khảo:** theo [lộ trình code v0](lo-trinh-code-v0.md), dashboard được làm ở Phase 3 mới trước deploy ASF v0.1; thực nghiệm/template/báo cáo chuyển sang Phase 6 mới. Không chờ đủ dữ liệu từ sáu Agent thật để bắt đầu giao diện nền tảng.

> **Thời lượng gợi ý:** 2 tuần (khung dashboard có thể bắt đầu từ cuối Phase 1)  
> **Phụ thuộc:** API và SSE của Phase 1; dữ liệu đầy đủ từ Phase 2–4  
> **Tham chiếu tài liệu kiến trúc:** mục 9 (API), 10 (Dashboard), 12 (MVP), 13 (Demo và thực nghiệm)

---

## 1. Mục tiêu

1. **Dashboard** để giám sát Agent và phê duyệt các gate.
2. Chạy **3 kịch bản thực nghiệm** và lấy số liệu thật từ hệ thống.
3. Chuẩn bị **demo 8–10 phút** và hoàn thành **báo cáo bài tập lớn**.

## 2. Phạm vi

**Trong phạm vi:**

- 7 màn hình ở mục 10.
- Event feed thời gian thực.
- API báo cáo.
- Thực nghiệm, demo, báo cáo.

**Ngoài phạm vi:** đa tenant, phân quyền chi tiết theo tổ chức, giao diện dành cho mobile riêng.

## 3. Điều kiện bắt đầu

- API của orchestrator có OpenAPI docs (P1-12).
- Đã có ít nhất một run hoàn chỉnh (Phase 4) để có dữ liệu hiển thị.

---

## 4. Công việc chi tiết

### P5-01. Khung dashboard

- Next.js (App Router) + TypeScript + Tailwind CSS, đặt ở `apps/dashboard/`.
- API client sinh từ OpenAPI của orchestrator.
- Đăng nhập; phân quyền `viewer` (chỉ xem) và `approver` (được duyệt gate).
- Chỉ truy cập qua NetBird + Caddy + DNS nội bộ. Không mở ra Internet.

### P5-02 → P5-08. Bảy màn hình

| Mã | Màn hình | Nội dung | Nguồn dữ liệu |
|---|---|---|---|
| P5-02 | **Project Overview** | Danh sách dự án, các run, trạng thái, task đang chạy | `GET /api/runs` |
| P5-03 | **Agent Activity** | 6 card theo role: trạng thái, task hiện tại, model, số lần thử, thời gian | `agent_executions` + SSE |
| P5-04 | **Task Board** | Cột theo trạng thái, quan hệ phụ thuộc, link sang Work Package OpenProject | `GET /api/runs/{id}/tasks` |
| P5-05 | **Communication Monitor** | Timeline message nhóm theo `correlation_id`; thay đổi contract; lỗi và phản hồi | `GET /api/runs/{id}/messages` |
| P5-06 | **GitLab / CI** | Branch, MR, commit SHA, pipeline, job log, test artifact | GitLab API, gọi qua orchestrator |
| P5-07 | **Approvals** | Danh sách gate đang chờ; xem SRS / AC / contract và diff giữa các version; approve hoặc reject kèm comment | `POST /api/runs/{id}/approve` |
| P5-08 | **Run Report** | Tổng thời gian, số task, số lượt sửa, tỷ lệ test pass, số lượt gọi model, token / chi phí (nếu có) | `GET /api/runs/{id}/report` |

**Thứ tự ưu tiên khi thiếu thời gian:**

1. Approvals
2. Agent Activity
3. Communication Monitor
4. Run Report

Task Board và GitLab/CI có thể thay bằng link sang OpenProject và GitLab.

### P5-09. Cập nhật thời gian thực

- Event feed dùng SSE. Khi mất kết nối, tự nối lại và gửi `Last-Event-ID` để không mất event.
- Lịch sử tải từ PostgreSQL, nên refresh trang không mất dữ liệu (mục 10).

### P5-10. API báo cáo

- `GET /api/runs/{run_id}/report` tính số liệu trực tiếp từ DB. Không nhập số liệu bằng tay.
- Có thể xuất JSON / CSV để đưa vào báo cáo.

Các chỉ số:

| Chỉ số | Cách tính |
|---|---|
| Tổng thời gian | `runs.finished_at - runs.started_at` |
| Thời gian theo role | Tổng `duration_ms` trong `agent_executions` theo role |
| Số lượt gọi model | Số dòng `agent_executions` |
| Token / chi phí | Tổng `prompt_tokens`, `completion_tokens`, `cost` (nếu 9Router trả về) |
| Task completion | Số task `DONE` / tổng số task |
| Tỷ lệ build/test pass | Số pipeline pass / tổng số pipeline của run |
| Số lần retry | Tổng `retry_count` |
| Bằng chứng | Danh sách commit SHA, pipeline ID, deployment version |

### P5-11. Thực nghiệm

Chạy 3 kịch bản ở mục 13 tài liệu kiến trúc (yêu cầu đầu vào đã chuẩn bị ở P4-12):

| Kịch bản | Nội dung |
|---|---|
| New feature | Thêm bộ lọc ticket theo trạng thái và độ ưu tiên |
| Bug fix | Phát hiện và sửa lỗi null/validation tái hiện được |
| Deployment | Deploy staging, smoke test, kiểm chức năng |

- Nếu đủ thời gian, mỗi kịch bản chạy nhiều lần (ví dụ 3 lần) để thấy mức độ dao động.
- Ghi lại cả những lần thất bại và nguyên nhân.
- **Không đặt trước số liệu kết quả.** Mọi con số trong báo cáo đều lấy từ API báo cáo.

### P5-12. Chuẩn bị demo

Theo bảng kịch bản ở mục 13:

| Phần | Thời lượng | Nội dung |
|---|---:|---|
| 1. Tổng quan | 1 phút | Dashboard, hạ tầng, kiến trúc 6 Agent |
| 2. PM + BA | 1,5 phút | Nhập yêu cầu; Work Packages trên OpenProject; AC/contract; duyệt |
| 3. BE + FE | 2 phút | Hai Agent chạy song song; branch, commit, MR trên GitLab |
| 4. TEST | 1,5 phút | Test fail thật; bug gửi về BE/FE; sửa; CI chạy lại |
| 5. DEVOPS | 1 phút | Duyệt; deploy staging; smoke test |
| 6. Nghiệm thu | 1–3 phút | Chạy module; lịch sử Agent; số liệu; báo cáo |

Cần chuẩn bị:

- [ ] Một run đã hoàn thành, đủ bằng chứng trên dashboard, OpenProject, GitLab và staging
- [ ] Một thay đổi nhỏ để demo trực tiếp (chạy nhanh, ít rủi ro)
- [ ] Video quay sẵn toàn bộ luồng, dùng khi hạ tầng hoặc model gặp sự cố
- [ ] Diễn tập ít nhất 2 lần, có bấm giờ
- [ ] Checklist trước buổi bảo vệ: các dịch vụ đang chạy, quota 9Router còn đủ, DNS/TLS ổn, dữ liệu demo đã reset

### P5-13. Báo cáo bài tập lớn

Mục lục gợi ý:

1. Đặt vấn đề và mục tiêu
2. Cơ sở lý thuyết: hệ đa tác tử, LangGraph, human-in-the-loop
3. Kiến trúc hệ thống
4. Thiết kế Agent, giao thức giao tiếp, dữ liệu
5. Triển khai và hạ tầng
6. Thực nghiệm và kết quả (số liệu thật từ P5-11)
7. Đánh giá, hạn chế và hướng phát triển
8. Phụ lục: ảnh chụp màn hình, link pipeline, log, ADR

---

## 5. Sản phẩm bàn giao

- Dashboard với 7 màn hình (hoặc tối thiểu 4 màn hình ưu tiên kèm link sang OpenProject/GitLab).
- API báo cáo và file số liệu của 3 kịch bản.
- Video demo dự phòng; kịch bản demo; checklist trước buổi bảo vệ.
- Báo cáo bài tập lớn.

## 6. Tiêu chí nghiệm thu

- [ ] Các màn hình hoạt động với dữ liệu thật
- [ ] Event cập nhật theo thời gian thực; refresh không mất lịch sử
- [ ] Approve/reject từ giao diện chạy được cho spec gate và deploy gate
- [ ] Số liệu 3 kịch bản lấy từ hệ thống, có bằng chứng (SHA, pipeline ID, deployment)
- [ ] Có run hoàn chỉnh lưu sẵn và video dự phòng
- [ ] Đã diễn tập demo trong khoảng 8–10 phút
- [ ] Báo cáo hoàn chỉnh

## 7. Cách kiểm chứng

| Loại | Nội dung |
|---|---|
| Component test | Các card, timeline, form approve |
| E2E (Playwright) | Đăng nhập → mở run → approve spec gate → thấy event mới xuất hiện |
| Đối chiếu số liệu | So số liệu trên Run Report với dữ liệu trong DB, GitLab, OpenProject |
| Diễn tập | Chạy toàn bộ kịch bản demo, bấm giờ |

## 8. Rủi ro và cách xử lý

| Rủi ro | Cách xử lý |
|---|---|
| Model chạy chậm khi demo | Dùng run đã lưu sẵn; chỉ demo trực tiếp một thay đổi nhỏ; có video dự phòng |
| Làm dashboard tốn nhiều thời gian | Ưu tiên 4 màn hình chính; các màn hình còn lại dùng link ngoài |
| Hạ tầng gặp sự cố ngày bảo vệ | Chạy checklist trước 1 ngày và trước giờ demo |
| Số liệu thực nghiệm ít, khó kết luận | Chạy lặp mỗi kịch bản; nêu rõ giới hạn trong báo cáo |
