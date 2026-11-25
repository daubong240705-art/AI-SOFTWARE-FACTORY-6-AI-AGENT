---
title: Lệnh factory
section: reference
order: 1
---

## Cài đặt và vận hành

| Lệnh | Mục đích |
| --- | --- |
| `factory setup` | Cấu hình tương tác cho model, cổng và runtime. |
| `factory doctor` / `factory doctor --json` | Kiểm điều kiện chạy, hoặc lấy kết quả cho script. |
| `factory start` / `factory stop` / `factory restart` | Điều khiển Host. |
| `factory status` / `factory logs -f` | Xem trạng thái hoặc theo dõi log. |
| `factory config show` | Xem cấu hình có hiệu lực; secret được che. |
| `factory backup` / `factory restore FILE` | Tạo hoặc khôi phục bản backup SQLite. |

## Khi có lỗi

Chạy `factory doctor` và tra [mã doctor](./doctor.md). Giữ backup và log trong phạm vi người vận hành được phép truy cập.
