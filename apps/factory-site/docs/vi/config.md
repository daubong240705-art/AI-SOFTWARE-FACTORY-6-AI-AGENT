---
title: Biến cấu hình factory.env
section: reference
order: 2
---

## File và thứ tự ưu tiên

File mặc định `~/.factory/config/factory.env` dùng dạng `KEY=VALUE`, không phải shell script. Biến môi trường ghi đè file. Dùng `factory config show` để xem nguồn và giá trị có hiệu lực; giữ file ở quyền `600`.

## Biến thường dùng

| Biến | Ý nghĩa |
| --- | --- |
| `FACTORY_PORT`, `FACTORY_LISTEN_HOST` | Cổng và địa chỉ nghe; mặc định `8787` và `127.0.0.1`. |
| `FACTORY_LOGIN_TOKEN` | Token đăng nhập khi mở LAN; từ 24 ký tự. |
| `FACTORY_MODEL_BASE_URL`, `FACTORY_MODEL_API_KEY` | Gateway tương thích OpenAI và API key ở Host. |
| `FACTORY_LEAD_MODEL`, `FACTORY_AGENT_MODELS` | Model của Lead và danh sách tối đa 8 model API agent, cách nhau bằng dấu phẩy. |
| `FACTORY_PROJECTS_ROOT` | Thư mục gốc dự án. |
| `FACTORY_EXTENSIONS`, `FACTORY_EXTENSIONS_DIR` | Danh sách extension và đường dẫn tuyệt đối thay thế nếu cần. |
| `NODE_EXTRA_CA_CERTS` | File CA bổ sung cho gateway TLS nội bộ. |
