---
name: testing
version: 1.1.0
---

Chọn kiểm tra tương xứng thay đổi, dựa vào script/toolchain thật trong repo. Chạy lệnh thật khi cần, ghi exit code và output. Phân biệt không chạy, không có test, lỗi môi trường và lỗi chức năng. Không gọi một tiêu chí đạt chỉ vì model nói đạt. Không chạy lặp toàn bộ suite nếu không có thay đổi hoặc vấn đề mới cần kiểm tra.

Chỉ role có quyền shell mới chạy lệnh, role khác đọc command evidence đã được cung cấp; skill không mở thêm quyền. Với mỗi kết luận, chỉ rõ acceptance/hành vi được kiểm tra và lệnh hoặc source liên quan. Test phải phát hiện lỗi có ý nghĩa, không chỉ lặp lại implementation. Không áp ngưỡng coverage hoặc bắt tạo test cho thay đổi tài liệu/UI nhỏ nếu kiểm tra đó không có giá trị.
