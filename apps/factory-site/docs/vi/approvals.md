---
title: Phê duyệt & chính sách
section: concepts
order: 6
---

## Giới hạn trước khi chạy

Thiết lập `allow`, `ask`, `deny` cho tool theo agent. Ngân sách, mức tự chủ và circuit breaker giúp giới hạn phạm vi chạy. Approval ghi nhận quyết định và có thể chặn task, bước workflow hoặc thao tác bên ngoài.

## Quyết định trên bằng chứng

Trong **Cần xử lý**, đọc phạm vi và kết quả kiểm tra rồi chọn **Duyệt** hoặc **Từ chối**. Một node Approval có thể có nhánh khi hết hạn.

> External effect có kết quả chưa rõ phải được đối soát. Lỗi kết nối không chứng minh rằng thao tác ở hệ thống đích đã thất bại.
