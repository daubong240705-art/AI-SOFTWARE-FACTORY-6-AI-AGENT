# WW-3 — Lead và sáu role

Mục tiêu: một yêu cầu được Lead phân công cho các role cần thiết, thực thi tuần tự và có tổng kết dựa trên bằng chứng.

Phụ thuộc: WW-2 đã có runtime adapter, events, process manager và storage.

## Đầu việc

| Mã | Công việc | Điều kiện hoàn thành |
|---|---|---|
| WW3-01 | Bảy profile có version/hash | Lead/PM/BA/BE/FE/TEST/DEVOPS có trách nhiệm, output và tool policy rõ; tái sử dụng hướng dẫn ASF phù hợp |
| WW3-02 | Bốn skill cố định | implement-feature, fix-bug, testing, local-dev; nạp rõ theo role, không tự import marketplace |
| WW3-03 | Lead phân loại yêu cầu | Task nhỏ đi thẳng role phù hợp, task lớn mới cần PM/BA; không gọi đủ sáu role mặc định |
| WW3-04 | Task plan và dependency | Mỗi task có role, mục tiêu, scope, AC, phụ thuộc; controller validate role bật, dependency hợp lệ và giới hạn |
| WW3-05 | Giao việc bằng native subagent hoặc adapter tuần tự | Chọn một cơ chế theo WW2-02; task/role/session liên kết trên UI và storage |
| WW3-06 | Model theo role | Dùng đúng snapshot; thiếu model/role cần thiết thì blocked, không tự thay model hoặc bỏ AC |
| WW3-07 | Handoff có cấu trúc | Chuyển AC, contract, tóm tắt code, file và kết quả liên quan; không nhét toàn bộ log vào mọi prompt |
| WW3-08 | TEST thực thi và ghi kết quả | Chạy lệnh phù hợp repo/policy, lưu exit code và output; không có suite thì ghi giới hạn thật |
| WW3-09 | Vòng sửa lỗi | Lead giao lỗi về role chịu trách nhiệm; tối đa hai vòng cho run, không lặp BE/FE đã hoàn thành không cần thiết |
| WW3-10 | DEVOPS local | Hướng dẫn/chạy dev server/package khi cần; không SSH hoặc deploy production |
| WW3-11 | Giới hạn và tương tác | Deadline, request/usage theo capability, blocked khi thiếu thông tin, lý do hết hạn mức cụ thể |
| WW3-12 | Final report | Mục tiêu đạt/chưa đạt, file, command result, cách chạy và phần còn thiếu; không công bố pass thiếu bằng chứng |

## Quy tắc giao việc

- Lead luôn bật, chỉ có quyền điều phối theo cấu hình. Không tự tăng ngân sách, enable role hoặc nâng tool policy.
- PM: chia việc và phụ thuộc ngắn. BA: làm rõ AC/luồng/contract cần thiết, không tạo tài liệu dài mặc định.
- BE/FE: sửa source theo task và quy ước repo. Scope là hợp đồng công việc; kiểm tra diff để phát hiện lệch phạm vi.
- TEST: được dùng model để đánh giá và chọn việc cần làm; kết quả pass/fail của lệnh do công cụ báo, không do model tự khai.
- DEVOPS: hỗ trợ môi trường local, giữ process để xem/chạy/dừng trên UI.
- Agent bị tắt được loại khỏi lựa chọn. Nếu vai trò còn lại không đủ khả năng, Lead báo blocked với lý do.
- Nếu task không cần build/test, phải ghi vì sao; không chạy mọi lệnh cho mọi thay đổi nhỏ.

## Dữ liệu đầu ra tối thiểu

Plan: danh sách task có dependency. Handoff: status, summary, changed paths, artifact refs, command refs và blocker. Final report: AC và trạng thái, file thay đổi, lệnh đã chạy, cách chạy app, giới hạn.

Output sai schema được xử lý có giới hạn; không tạo agent/task vô hạn để sửa định dạng. Lượt sửa định dạng và lượt sửa code được ghi riêng nhưng cùng chịu deadline/hạn mức run.

## Bàn giao

- [x] Có cấu hình bảy role và lựa chọn model theo snapshot.
- [x] Lead tự chọn task/role trong phạm vi được bật; thực thi tuần tự.
- [x] TEST có command evidence, vòng sửa hữu hạn và báo cáo cuối rõ ràng.
- [x] UI phân biệt role đang làm, task chờ, task bị chặn và task bỏ qua.
- [x] Bàn giao WW-3 trên nhánh `feature/windows-worker-ww3`; thực thi thật qua OpenCode/9Router, không dùng mock để tuyên bố hoàn thành.

Adapter tuần tự là cơ chế duy nhất: Controller tạo session cho từng task, không native subagent. Bảy profile và bốn skill cố định có version/hash, lưu nội dung vào run. Schema SQLite v3 giữ lịch sử cũ và trạng thái từng task. [Bàn giao và evidence](../../docs/windows-worker/ww3-completion.md).

WW3-10 hỗ trợ cấu hình/build/package local và hướng dẫn chạy; quản lý preview lâu dài ở WW-4. Dừng task kết thúc cây runtime, không giữ detached server. Giao diện native chưa được kiểm tra trực quan trong phiên này vì helper điều khiển Windows không khả dụng; build/typecheck không được xem là thay thế kiểm tra đó.
