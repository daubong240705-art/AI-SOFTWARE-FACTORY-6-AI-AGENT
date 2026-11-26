---
title: Tạo agent
section: guides
order: 1
---

Thêm `Checklist Reviewer` vào dự án `Recipe Box`. Agent này báo cáo tiêu chí nào có bằng chứng, tiêu chí nào chưa kiểm chứng và không sửa tệp.

## Khi nào nên dùng

Tạo agent riêng khi một vai trò cần chỉ dẫn, runtime hoặc quyền khác. Nếu đã có cấu hình phù hợp, hãy tạo từ template.

![Hộp thoại tạo agent với tên, vai trò, runtime, model và phần nâng cao](/images/docs/create-agent.png)

*Điền hồ sơ cơ bản trước, rồi xem skill, quyền và giới hạn trong Nâng cao.*

## Tạo và kiểm tra hồ sơ

1. Mở **Agent & Team** → **Tạo agent**. Nhập `Checklist Reviewer` vào **Tên** và mô tả trách nhiệm ở **Vai trò**.
2. Chọn **Runtime** sẵn sàng trên Host và **Model** nếu cần. Trong **Hướng dẫn chính**, yêu cầu báo đạt, không đạt hoặc chưa kiểm chứng cho từng tiêu chí, kèm bằng chứng và không sửa tệp.
3. Mở **Nâng cao**. Gắn checklist trong **Skill & Tool**, kiểm tra **Quyền & ủy quyền** và đặt mức phù hợp trong **Giới hạn & ngân sách**. Chọn **Lưu**.
4. Mở lại agent để kiểm tra cấu hình. Gán agent vào [workflow checklist](./create-workflow.md), rồi dùng một task nhỏ để kiểm tra runtime và kết quả chạy thật.

> **Lưu ý:** Mock kiểm tra đường đi của workflow, không kiểm tra runtime thật hay chất lượng báo cáo.

## Lỗi thường gặp

- Cấp quyền ghi cho agent chỉ cần đọc bằng chứng.
- Mong agent tự chạy khi chưa gán task hoặc node.

## Bước tiếp theo

[Gắn agent vào workflow](./create-workflow.md) hoặc [lưu cấu hình để dùng lại](./library.md).
