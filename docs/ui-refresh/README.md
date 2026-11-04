# Giao diện gọn hơn

Ngày 04/11/2026. Tham khảo ảnh 9Router trong `ui/`: nền tối, chữ Segoe UI rõ ràng, viền nhẹ, màu nhấn cam, sidebar hẹp và nội dung gọn.

- Một tiêu đề trên thanh đầu trang; bỏ các đoạn giới thiệu lặp lại.
- Quản lý agent chia ba tab Worker, Model, Kỹ năng. Form đăng ký và chi tiết kỹ năng chỉ mở khi cần.
- Chọn model cho PM/BA/BE/FE; TEST/DEVOPS hiển thị đúng cơ chế thực thi theo quy tắc.
- Thu gọn tài liệu run; mở đặc tả đang chờ duyệt. Giữ thông báo lỗi, dấu mô phỏng và kiểm tra phiên bản/hash khi phê duyệt.
- Thu gọn lịch sử phê duyệt, lượt gọi model và timeline; ẩn form thao tác khi run đã kết thúc. Execution hiển thị trạng thái tiếng Việt và SHA kết quả.
- Điều hướng và biểu mẫu thích ứng với màn hình 390px.

Đã đạt lint, typecheck và production build. Chromium với Next production, API/PostgreSQL/Redis thật kiểm tra: tạo dự án, lưu model, chạy PM/BA mô phỏng, duyệt đúng đặc tả; đăng ký/rotate/revoke worker; xem catalog model/kỹ năng. Không có page error hoặc tràn ngang ở 1440px/390px.

Ảnh kiểm chứng: dự án (`projects.png`, ?nh local), run (`run.png`, ?nh local), run mobile (`run-mobile.png`, ?nh local), worker (`workers.png`, ?nh local), kỹ năng (`skills.png`, ?nh local), kỹ năng mobile (`skills-mobile.png`, ?nh local). Dữ liệu trong ảnh thuộc DB kiểm thử riêng. Luồng này không thay thế kiểm chứng coding live và triển khai.

Production đã kiểm chứng đăng nhập, worker online, catalog, SSE, duyệt spec theo hash và duyệt release theo tuple. Run tổng hợp774ebe41 hoàn tất với TEST5/5 và staging health khớp. Ảnh run production (`production-run.png`, ?nh local), mobile (`production-run-mobile.png`, ?nh local); [kết quả và giới hạn](../phase-5-completion.md).

Phần thu gọn lịch sử/ẩn form kết thúc đã merge tại fb58901, chưa deploy theo yêu cầu dừng công việc. Ảnh production ghi bản851a053 đang chạy.
