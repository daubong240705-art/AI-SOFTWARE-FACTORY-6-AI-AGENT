---
title: Integration & Secret
section: concepts
order: 7
---

## Kết nối có phạm vi

Integration kết nối MCP server hoặc HTTP API. Cấu hình ở phạm vi dự án truy cập được và cấp quyền tool theo agent. Với HTTP, chọn đúng thao tác đã khai báo, không đưa token vào đầu vào workflow.

## Secret ở lại Host

Tạo secret trong **Secret** và tham chiếu bằng ID từ Integration. Host mã hóa giá trị và chỉ gửi ID cùng metadata đã che ra ngoài. Agent nhận grant có phạm vi, không nhận API key của model provider.
