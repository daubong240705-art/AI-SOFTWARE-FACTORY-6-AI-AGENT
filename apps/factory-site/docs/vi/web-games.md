---
title: Làm game với đội Web Games
section: guides
order: 4
---

## Chuẩn bị dự án

Làm theo [thiết lập Portal / Web Games](./portal.md) để có Portal đang chạy, Integration đúng phạm vi và dự án dùng Team template Web Games. Bắt đầu bằng một cơ chế chơi theo lượt, ít màn hình và đồ họa gốc.

## Từ brief tới QA

Nhập và Publish `game-new`. Điền `title`, `players` (ví dụ `2-4`), `brief` Markdown đã chốt và `portalIntegrationId`; `briefArtifactId` là tùy chọn. Luồng đi qua thiết kế, đối chiếu brief, luật, art và client với review theo vai trò, rồi QA. QA không đạt thì phân loại và sửa tối đa ba vòng; không được bỏ qua cổng QA.

## Duyệt để Publish

Khi checklist phát hành sẵn sàng, mở **Cần xử lý** và kiểm commit tích hợp, kết quả QA và ứng viên. Chọn **Duyệt** để gửi bundle có `dist/game.json`; dùng ID trùng tên thư mục dự án gốc, không lấy tên worktree. Kiểm đường dẫn chơi, version và commit trả về. Nếu kết quả chưa rõ, kiểm `versions` trên Portal rồi đối soát effect; không chạy lại ngay.
