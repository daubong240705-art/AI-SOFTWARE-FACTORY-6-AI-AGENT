# Giao diện gọn hơn

Ngày 04/11/2026. Tham khảo ảnh 9Router trong `ui/`: nền tối, chữ Segoe UI rõ ràng, viền nhẹ, màu nhấn cam, sidebar hẹp và nội dung gọn.

- Một tiêu đề trên thanh đầu trang; bỏ các đoạn giới thiệu lặp lại.
- Quản lý agent chia ba tab Worker, Model, Kỹ năng. Form đăng ký và chi tiết kỹ năng chỉ mở khi cần.
- Chọn model cho PM/BA/BE/FE; TEST/DEVOPS hiển thị đúng cơ chế thực thi theo quy tắc.
- Thu gọn tài liệu run; mở đặc tả đang chờ duyệt. Giữ thông báo lỗi, dấu mô phỏng và kiểm tra phiên bản/hash khi phê duyệt.
- Điều hướng và biểu mẫu thích ứng với màn hình 390px.

Đã đạt lint, typecheck và production build. Chromium với Next production, API/PostgreSQL/Redis thật kiểm tra: tạo dự án, lưu model, chạy PM/BA mô phỏng, duyệt đúng đặc tả; đăng ký/rotate/revoke worker; xem catalog model/kỹ năng. Không có page error hoặc tràn ngang ở 1440px/390px.

Ảnh kiểm chứng: [dự án](projects.png), [run](run.png), [run mobile](run-mobile.png), [worker](workers.png), [kỹ năng](skills.png), [kỹ năng mobile](skills-mobile.png). Dữ liệu trong ảnh thuộc DB kiểm thử riêng. Luồng này không thay thế kiểm chứng coding live và triển khai.
