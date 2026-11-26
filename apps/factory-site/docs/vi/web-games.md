---
title: Làm game với đội Web Games
section: guides
order: 4
---

Đưa một game theo lượt tự thiết kế, dành cho hai đến bốn người, từ brief đã chốt qua QA đến bước người vận hành duyệt phát hành lên Portal.

## Khi nào nên dùng

Dùng `game-new` cho game mới. Thực hiện [thiết lập Portal](./portal.md) trước để có đội Web Games, workspace Git và kết nối đúng phạm vi.

## Từ brief đến phát hành

1. Trong **Workflow** → **Nhập từ template**, nhập template Web Games có key `game-new`. Kiểm tra draft và chọn **Publish**. Chốt luật chơi và tiêu chí nghiệm thu trước khi chạy.
2. Chọn **Chạy** và điền `title`, `players` (ví dụ `2-4`), `brief` Markdown đã chốt và `portalIntegrationId`. Chỉ điền `briefArtifactId` nếu có artifact; ID này không thay cho nội dung brief.
3. Theo dõi thiết kế, đối chiếu brief, luật, hình ảnh, mã client và QA trên run. Nếu QA không đạt và xác định được nhóm lỗi, workflow có thể sửa tối đa ba vòng. Duyệt soạn brief sửa tiếp không có nghĩa là cho phép phát hành.
4. Trong **Cần xử lý**, mở câu hỏi phát hành. Kiểm tra QA và commit tích hợp. Chỉ duyệt bản đã đạt có `dist/game.json` với `id` trùng tên thư mục dự án gốc. Kiểm tra đường dẫn chơi, version và commit được trả về.

![Run tạo game với các node triển khai và kiểm tra](/images/docs/workflow-run.png)

*Mở các node liên quan để kiểm tra bằng chứng từng giai đoạn trước khi duyệt phát hành.*

> **Cảnh báo:** Nếu chưa rõ kết quả phát hành, đối chiếu `versions` trên Portal theo ID game và commit, rồi đối soát trước khi thử lại.

## Lỗi thường gặp

- Dùng tên thư mục worktree làm ID game.
- Dán token Portal vào brief hoặc coi duyệt sửa lỗi QA là duyệt phát hành.

## Bước tiếp theo

[Xem cách phê duyệt hoạt động](./approvals.md) hoặc [kiểm tra phạm vi kết nối Portal](./portal.md).
