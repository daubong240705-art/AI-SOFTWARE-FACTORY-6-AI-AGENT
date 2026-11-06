# R1 — Shell và điều hướng workspace

Ngày: 05/11/2026. Worker `1.3.0-alpha.8`, SQLite 14. [Kế hoạch R0–R7](../archive/plan/experience-loops/crewhub-workspace-redesign.md), [baseline R0](workspace-r0-baseline.md). Checkpoint trước source: `c8c81f9`.

## Đã triển khai

- Sidebar: **Trang chính**, **Cần xử lý**, danh sách dự án; **Công cụ nâng cao** và **Cài đặt** ở cuối. Phạm vi toàn ứng dụng vẫn dùng được khi chưa có dự án.
- Chọn dự án mở **Công việc**. Tab **Công việc / Trao đổi / Khác** nằm dưới header, không lẫn với điều hướng toàn app. Khác chứa Tổng quan dự án, Đội ngũ dự án, Git local và Văn phòng thử nghiệm.
- Header có một **Tạo công việc**, dùng form Board hiện có. Menu tên dự án chỉ chứa thông tin/quản lý dự án; danh sách hội thoại chỉ xuất hiện trong Trao đổi. Lịch sử nằm trong Công cụ nâng cao.
- Trang chính tối thiểu: danh sách dự án và active run thật từ RuntimeView, trạng thái chưa đồng bộ hoặc không có lượt chạy. Không dùng danh sách run giới hạn để dựng số liệu toàn app.
- Một ChatHost xuyên suốt đổi tab/dock; flush nháp trước điều hướng/chuyển project. Lỗi lưu giữ nguyên trang và project. Đổi project rồi quay lại khôi phục hội thoại/ngữ cảnh đã chọn trong phiên ứng dụng, nháp và ảnh từ SQLite.
- Board giữ view/bộ lọc/scroll theo từng dự án trong phiên ứng dụng. Board ẩn không subscribe monitor; editor/panel ẩn không chiếm top layer. Bỏ dự án khỏi danh sách cũng bỏ Board cache tương ứng.
- Tái dùng token, Select và Popover hiện có. Tên dài rút gọn, sidebar tự thu ở cửa sổ hẹp. Không thêm dependency.

## Source

| File | Thay đổi |
|---|---|
| `apps/windows-worker/src/features/WorkspaceShell.tsx` | Sidebar/header, phạm vi trang, tab và menu |
| `apps/windows-worker/src/features/WorkspaceHome.tsx` | Trang chính tối thiểu |
| `apps/windows-worker/src/workspace-shell.css`, `src/main.tsx` | Style shell responsive |
| `apps/windows-worker/src/App.tsx` | Nối handler hiện có, state chuyển trang/project, Chat và Board cache |
| `apps/windows-worker/src/features/KanbanBoard.tsx` | Mở form từ header; giữ state/scroll, scope DOM và modal theo Board |
| `apps/windows-worker/src/features/GlobalInbox.tsx` | Nhãn Cần xử lý nhất quán |
| `apps/windows-worker/scripts/acceptance-workspace-shell-ui.cjs` | Regression shell bằng Electron/IPC/SQLite thật |
| `apps/windows-worker/scripts/acceptance-chat-host-ui.cjs`, `acceptance-overview-ui.cjs`, `run-acceptance.cjs` | Cập nhật đường điều hướng và thêm entry kiểm tra shell |

## Kết quả thực tế

Chạy trong `apps/windows-worker`, DB fixture riêng, không gọi model thật:

| Kiểm tra | Kết quả |
|---|---|
| `npm run typecheck` | Đạt |
| `npm test` | 227/227 đạt |
| `npm run build` | Đạt; cảnh báo annotation Zod có từ baseline |
| Prettier trên các file source/script thay đổi | Đạt |
| `node scripts/run-acceptance.cjs workspace-shell-ui` | Đạt 4 layout; tạo đúng một item vào đúng project; giữ filter/list/scroll; nháp/ảnh; lỗi lưu chặn điều hướng; menu Escape/focus; Board ẩn không polling |
| `node scripts/run-acceptance.cjs workspace-shell-ui --empty` | Đạt 4 layout; Home/Cần xử lý/Cài đặt dùng được khi chưa có project |
| `node scripts/run-acceptance.cjs chat-host-ui` | Đạt 4 layout; một composer, IME/scroll/dock, dedup gửi, revision conflict, tách context project và khôi phục đúng work revision khi quay lại |
| `node scripts/run-acceptance.cjs overview-ui` | Đạt 5 layout; attention/result/held queue, stale disable action, project switch, hội thoại và lịch sử |

Layout: 1366×768, 850×700, zoom 125%/150%; Tổng quan thêm 1440×900. Không tràn ngang hoặc lỗi renderer trong các fixture. Đã xem ảnh Home và Board/list ở zoom thường/150%. Bằng chứng local (Git ignore):

- `apps/windows-worker/.cache/workspace-shell-ui-anNzuY/`
- `apps/windows-worker/.cache/workspace-shell-ui-mnEkFi/`
- `apps/windows-worker/.cache/chat-host-ui-rGfh0W/`
- `apps/windows-worker/.cache/overview-ui-LCncja/`

## Giới hạn và bước sau

- R1 hoàn thành presentation/navigation; chưa phải toàn bộ thiết kế đích. **R2** tiếp theo: hồ sơ bốn tab và detail host chung, tránh nhiều lớp panel.
- Đội ngũ vẫn thuộc từng dự án. Summary toàn app, badge actionable và Kết quả index ở R4; Home hiện không có những số liệu đó.
- Cache view/filter/scroll và hội thoại được chọn là trong phiên; nháp/ảnh vẫn bền vững theo cơ chế hiện có. Chưa benchmark trên fixture lớn hoặc nghiệm thu usability với người dùng.
- Không đổi Controller, queue, permission, model/profile, schema hay credentials; không đụng DB người dùng, không triển khai R2–R7 hoặc phát triển thêm 3D. Các acceptance cũ khác chưa được chuyển toàn bộ selector sang shell mới và chưa chạy lại trong R1.
- Revert commit R1 để về shell cũ; không cần rollback SQLite.
