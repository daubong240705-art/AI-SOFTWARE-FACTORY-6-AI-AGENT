---
title: Workflow v2
section: concepts
order: 4
---

## Node và port

Workflow là đồ thị node và edge. Edge nối một port đầu ra có tên tới node đích. Ví dụ, nối port `out` của Trigger tới Agent; nối `approved`, `rejected` và `timeout` của Approval tới các nhánh khác nhau. Condition rẽ nhánh, Loop lặp có giới hạn, Output thu kết quả.

## Draft, Publish và Run

Draft để sửa; Publish tạo version để chạy. Run giữ định nghĩa và đầu vào đã chọn. Engine lưu trạng thái node, thời điểm chờ và task; có thể tạm dừng, tiếp tục hoặc hủy theo trạng thái run. Khi Host khởi động lại, engine kiểm lại công việc đang chờ từ trạng thái đã lưu.

## Chạy thử với mock agent

Lưu Draft hợp lệ, chọn **Chạy thử**, bật **Mock agent** rồi điền đầu vào. Mock agent không tốn token model; dùng Pinned data khi cần giả lập đầu ra cụ thể. Không coi việc bật mock agent là cách vô hiệu mọi Action: chọn flow không có tác động bên ngoài khi thử.
