# WW-5 — Đóng gói Windows và bàn giao

Mục tiêu: phát hành bản Standalone có bộ cài và quy trình sử dụng ngắn. Không phụ thuộc hạ tầng ASF hoặc phase thử runtime riêng.

## Đầu việc

| Mã | Công việc | Điều kiện hoàn thành |
|---|---|---|
| WW5-01 | Product metadata/icon/version | Tên Windows Worker nhất quán, app ID và thư mục userData ổn định |
| WW5-02 | Build Electron và native SQLite | Main/preload/renderer/resources đầy đủ, giữ binary Node-API SQLite đúng platform/arch khi đóng gói, không rebuild theo Electron ABI hoặc kèm dev secret |
| WW5-03 | Tích hợp runtime khi phân phối | Mặc định chọn OpenCode cài sẵn với version được hỗ trợ; app hướng dẫn cài/đổi path. Chỉ bundle khi đã rõ license và artifact Windows |
| WW5-04 | NSIS installer x64 | Cài theo user, shortcut, uninstall; không yêu cầu admin nếu không cần |
| WW5-05 | Dữ liệu khi cập nhật/gỡ app | Giữ settings/history/key ciphertext qua cập nhật; xóa dữ liệu là lựa chọn riêng, không chạm source |
| WW5-06 | Onboarding ngắn | Chọn project → Gateway/key/model → Run; phần CA/toolchain chỉ hiện khi cần |
| WW5-07 | Hướng dẫn dự án mới | Chọn folder, cấu hình model/command nếu cần; không bắt tạo VM/GitLab/OpenProject |
| WW5-08 | Release notes và known limits | Phân biệt chức năng có thật, cấu hình cần có, runtime hỗ trợ và hạng mục chưa làm |
| WW5-09 | Build/release scripts | Build local theo lockfile; CI desktop tùy chọn theo path/manual, không gọi release pipeline ASF |
| WW5-10 | Chốt bản bàn giao | File installer, checksum, version, hướng dẫn và checklist trạng thái thực tế |

## Kiểm tra gắn với bàn giao

Không dựng một bộ benchmark hoặc repo mẫu để chứng minh runtime trước sản phẩm. Các kiểm tra cần thiết khi phát hành tập trung vào bản app thật: cài/mở, giữ dữ liệu khi cập nhật, quyền lưu credential, task/Stop, history/diff và báo lỗi thiếu runtime/gateway. Ghi rõ phần nào đã thực hiện và phần nào chưa; không dùng kế hoạch này như bằng chứng đã đạt.

Build/test của source do người dùng giao agent xử lý vẫn là chức năng sản phẩm, không bị bỏ khỏi phạm vi vì bỏ bước thử runtime độc lập.

## Tài liệu người dùng

- Cài Windows Worker và các dependency cần cho project.
- Cấu hình 9Router, model từng role, CA nội bộ nếu có.
- Chọn source, giao task, theo dõi và dừng.
- Xem diff, kết quả lệnh, chạy app local và mở lại lịch sử.
- Xử lý lỗi phổ biến: key/model/TLS, runtime path, toolchain, hết hạn mức, task bị gián đoạn.

Hướng dẫn theo thao tác ngắn. Không đưa kiến trúc nội bộ hoặc nhiều đoạn mô tả vào onboarding.

## Checklist chốt MVP

- [ ] App Windows cài/mở được và chọn source local.
- [ ] Cấu hình 9Router, CA và key lưu an toàn.
- [ ] Lead và sáu role có model riêng, sáu role phụ bật/tắt được.
- [ ] Task được giao và thực thi thật; activity, Stop và giới hạn có tác dụng.
- [ ] Có command evidence và xử lý sửa lỗi hữu hạn khi cần.
- [ ] Có diff, history, kết quả và local run/preview khi project hỗ trợ.
- [ ] Source thay đổi sẵn của người dùng được giữ, không tự commit/push/deploy.
- [ ] Hoạt động độc lập với ASF; không yêu cầu các VM đang bật ngoài nơi cung cấp 9Router nếu gateway đặt tại đó.
- [ ] Bộ cài, checksum, tài liệu và known limits được bàn giao.
- [ ] Commit WW-5, đánh dấu phạm vi hoàn thành đúng thực tế.

## Sau MVP

Chỉ mở kế hoạch mới cho Connected Mode, nhiều run/worker, worktree song song, sandbox source không tin cậy, code signing/auto-update hoặc marketplace. Những mục này không kéo dài mốc chốt bản Standalone.
