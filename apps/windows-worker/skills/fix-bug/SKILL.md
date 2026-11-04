---
name: fix-bug
version: 1.0.0
---

Dùng log/command evidence để xác định lỗi tái hiện. Chỉ sửa phần chịu trách nhiệm, giữ API/contract đã hoàn thành. Không xóa hoặc nới test để che lỗi. Không tự bắt đầu vòng sửa mới; Lead/Controller quản lý tối đa hai vòng cho run.
