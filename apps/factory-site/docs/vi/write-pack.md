---
title: Viết pack riêng
section: extensions
order: 2
---

Pack phân phối vai trò trong đội, skill, hồ sơ và workflow template. Hãy bắt đầu từ pack mẫu có sẵn thay vì tự dựng cấu trúc.

## Khi nào nên dùng

Viết pack khi nhiều dự án cần cùng đội và workflow ban đầu. Nếu chỉ cần dùng chung checklist, dùng [Thư viện](./library.md).

## Viết, kiểm tra và nhập pack

1. Sao chép `packs/_template` sang thư mục như `packs/my-team`. Đặt key riêng trong `pack.json`, rồi sửa thông tin hiển thị, vai trò và tham chiếu skill hoặc hồ sơ.
2. Đặt workflow v2 trong `flows/<key>.json`, với `schema: 2` và key trùng tên tệp. Tệp v2 không cần khai báo trong manifest. Bắt đầu với sơ đồ không ghi ra hệ thống ngoài.
3. Từ `apps/factory-host`, chạy `npm run build` rồi `npm run pack:check -- ../../packs/my-team`. Sửa lỗi và khởi động lại Host để nạp pack.
4. Tạo dự án từ **Team template** của bạn. Dùng **Workflow** → **Nhập từ template**, xem draft, chạy thử rồi **Publish**.

![Trang Workflow có nút nhập template và các định nghĩa đã nhập](/images/docs/workflow-list.png)

*Nhập template tạo draft trong dự án chứ chưa publish.*

> **Lưu ý:** Nếu v1 và v2 trùng key, trình nhập ưu tiên v2. Danh sách tool được phép trong pack chỉ có thể thu hẹp quyền của Host.

## Lỗi thường gặp

- Đặt tên tệp khác key định nghĩa.
- Mong khởi động lại Host sẽ publish draft hoặc cấp tool bị chính sách Host chặn.

## Bước tiếp theo

[Chạy thử workflow](./create-workflow.md) hoặc [chẩn đoán template bị thiếu](./troubleshooting.md).
