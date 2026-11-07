---
name: fix-bug
version: 1.1.0
---

Dùng log/command evidence để xác định lỗi tái hiện. Chỉ sửa phần chịu trách nhiệm, giữ API/contract đã hoàn thành. Không xóa hoặc nới test để che lỗi. Không tự bắt đầu vòng sửa mới; Lead/Controller quản lý tối đa hai vòng cho run.

Nêu triệu chứng, bằng chứng và nguyên nhân trước khi chọn bản sửa nhỏ nhất. Kiểm tra lại hành vi bị lỗi và phần liên quan sau sửa. Role chỉ đọc chỉ phân tích và báo cách sửa; skill này không cấp quyền edit/shell. Nếu không tái hiện được, ghi rõ giới hạn và dữ kiện còn thiếu.
