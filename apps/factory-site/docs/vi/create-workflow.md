---
title: Tạo workflow trên canvas
section: guides
order: 2
---

## Vẽ luồng nhỏ nhất

Mở **Workflow**, tạo Draft mới và thêm Trigger, Agent, Output. Chọn vai trò hoặc agent cho node Agent, mô tả task và đầu ra. Nối port `out` của Trigger vào Agent rồi `out` của Agent vào Output; thêm đường `error` nếu cần kết quả riêng khi lỗi.

## Kiểm tra trước khi Publish

Khai báo input cần thiết; sửa lỗi validation và lưu Draft. Chọn **Chạy thử** với mock agent để xem đường đi và đầu ra trước. Thêm Approval trước thao tác bên ngoài, nối cả nhánh từ chối và hết hạn nếu muốn xử lý riêng. Khi Draft đạt yêu cầu, chọn **Publish** để tạo version.
