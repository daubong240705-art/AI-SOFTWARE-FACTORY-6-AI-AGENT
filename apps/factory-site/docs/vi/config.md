---
title: Biến cấu hình factory.env
section: reference
order: 2
---

Host mặc định đọc `~/.factory/config/factory.env` dưới dạng `KEY=VALUE`, không chạy như script shell. Biến môi trường ghi đè các mục trong tệp.

## Khi nào nên dùng

Tra trang này khi cần đổi gateway, cổng, địa chỉ lắng nghe hoặc bật tiện ích mở rộng.

## Đổi và kiểm tra thiết lập

1. Chạy `factory config show` để xem giá trị đã che bí mật và nguồn tương ứng. Giữ quyền tệp ở `600`.
2. Sửa mục liên quan hoặc dùng `factory setup`. Nếu tệp đã đổi nhưng giá trị không đổi, kiểm tra biến môi trường ghi đè.
3. Khởi động lại Host và chạy `factory doctor`, hoặc chọn **Hệ thống** → **Thiết lập** → **Kiểm tra lại** khi vào được giao diện.

![Thiết lập hiển thị kiểm tra model, chứng chỉ và mạng](/images/docs/system.png)

*Xem kết quả của mục vừa sửa thay vì chỉ nhìn trạng thái chung.*

| Biến | Mục đích |
| --- | --- |
| `FACTORY_PORT`, `FACTORY_LISTEN_HOST` | Cổng (mặc định `8787`) và địa chỉ lắng nghe (mặc định loopback). |
| `FACTORY_LOGIN_TOKEN` | Đăng nhập qua LAN; tối thiểu 24 ký tự. |
| `FACTORY_MODEL_BASE_URL`, `FACTORY_MODEL_API_KEY` | Gateway tương thích OpenAI và khóa API. Chỉ có khóa không tự chọn gateway. |
| `FACTORY_LEAD_MODEL`, `FACTORY_AGENT_MODELS` | Model cho Lead và tối đa tám model cho agent dùng API, phân cách bằng dấu phẩy. |
| `FACTORY_PROJECTS_ROOT` | Thư mục gốc cho các dự án. |
| `FACTORY_EXTENSIONS`, `FACTORY_EXTENSIONS_DIR` | Các khóa tiện ích cách nhau bằng dấu phẩy và đường dẫn tuyệt đối thay thế nếu cần. |
| `NODE_EXTRA_CA_CERTS` | Tệp CA đọc được cho gateway dùng CA nội bộ. |

> **Cảnh báo:** Không commit tệp cấu hình hoặc dán thông tin bí mật vào yêu cầu hỗ trợ. Dùng đầu ra đã che bí mật.

## Lỗi thường gặp

- Chạy `factory.env` như script hoặc bỏ sót biến môi trường ghi đè.
- Chỉ đặt khóa gateway mà quên URL hoặc model cho Lead.

## Bước tiếp theo

[Xử lý lỗi thiết lập](./troubleshooting.md) hoặc [xem cách bảo vệ truy cập LAN](./security.md).
