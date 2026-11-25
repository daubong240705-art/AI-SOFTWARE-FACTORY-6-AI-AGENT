---
title: Trace / Monitor / Hiệu quả
section: concepts
order: 8
---

## Monitor và Trace

Monitor cho thấy tiến độ run và các node đang chạy hoặc chờ. Trace nối request → run → node → task → attempt → tool call → artifact. Dùng chuỗi này để tìm node lỗi, lần thử nào tạo thay đổi và bằng chứng để duyệt.

## Hiệu quả và chi phí

Hiệu quả (Insights) tổng hợp kết quả run và hỗ trợ đề xuất cải tiến. Nếu runtime không báo usage hoặc chi phí thì Factory giữ trạng thái chưa biết, không ghi thành 0. Xem [quy trình đề xuất Draft](./improve-workflow.md).
