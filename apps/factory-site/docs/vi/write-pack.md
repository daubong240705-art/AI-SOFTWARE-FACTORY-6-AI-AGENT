---
title: Viết pack riêng
section: extensions
order: 2
---

## Bắt đầu từ mẫu

Sao chép `packs/_template` thành thư mục pack mới; đổi key, metadata và cấu hình vai trò trong `pack.json`. Thêm skill, hồ sơ và workflow phù hợp. Với Workflow v2, đặt `flows/<key>.json` có `schema: 2` và `key` trùng tên file. Không cần kê file v2 trong manifest; nếu trùng key với v1, v2 được ưu tiên.

## Kiểm và nhập

Từ `apps/factory-host`, build rồi chạy validator:

```bash
npm run build
npm run pack:check -- ../../packs/my-team
```

Host đọc pack lúc khởi động. Chọn Team template hoặc nhập Workflow template vào dự án rồi kiểm cấu hình và Publish. Allowlist của pack chỉ thu hẹp quyền tool; không cấp thêm quyền ngoài chính sách Host.
