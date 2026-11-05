# R2 — Hồ sơ công việc và trao đổi theo ngữ cảnh

Ngày: 05/11/2026. Worker `1.3.0-alpha.8`, SQLite 14. Baseline R1 `03e266e`; checkpoint/kế hoạch trước thay đổi `2058af8`. [Kế hoạch R2](workspace-r2-plan.md), [phương án R0–R7](../../plan/experience-loops/crewhub-workspace-redesign.md).

## Đã triển khai

- Một hồ sơ gồm **Yêu cầu / Trao đổi / Tiến độ / Kết quả**. Board, Git, Tổng quan, Cần xử lý và Đội ngũ mở cùng hồ sơ nếu run có liên kết. Run-only vẫn đọc bằng inspector; chỉ tạo hồ sơ khi người dùng chọn Lưu thành công việc.
- Một `DetailHost` với một `ChatHost` giữ nguyên parent. Đổi tab không tạo composer mới; giữ nháp, selection và IME. Inspector kỹ thuật thay nội dung trong cùng khung, có **Quay lại hồ sơ**, không chồng thêm modal.
- **Yêu cầu** hiển thị bộ câu hỏi đúng item/revision. Mỗi bộ chỉ có một form/writer; ẩn thay vì unmount khi đổi tab hoặc mở inspector. Flush nháp trước chuyển tab/đóng/điều hướng; lỗi lưu giữ nguyên màn hình. Gửi lại sau mất phản hồi dùng receipt/idempotency sẵn có.
- **Trao đổi** dùng chat thật của công việc và revision đã chọn. **Ghi chú riêng** thu gọn, có nhãn không gửi agent; không dùng ghi chú thay cho tin nhắn Lead. Chat dẫn về Yêu cầu khi cần trả lời.
- **Tiến độ** đọc run/task thật qua shared feed: role, trạng thái, dependency và lỗi; lịch sử submission/attempt/hàng chờ nằm trong mục thu gọn. Chi tiết model/lệnh/evidence mở inspector hiện có.
- **Kết quả** mở report của lượt đã kết thúc mới nhất hoặc lượt được mở cụ thể; chọn xem report cũ, giữ nhãn stale, policy nghiệm thu, xuất báo cáo và yêu cầu sửa hiện có. Quyết định nghiệm thu/yêu cầu sửa cập nhật hồ sơ.
- Header mở rộng/thu gọn, tab có cuộn riêng, giữ ghi chú khi drill-down. Khung chặn tương tác nền, giới hạn focus bàn phím, Escape đóng và trả focus về thẻ nguồn. Lỗi thao tác đóng vẫn đọc được trong khung.

## File thay đổi

| Nhóm | File trong `apps/windows-worker/` |
|---|---|
| Điều hướng và host | `src/App.tsx`, mới `src/features/DetailHost.tsx` |
| Hồ sơ/tiến độ | `src/features/WorkItemPanel.tsx`, mới `src/features/WorkProgress.tsx` |
| Chat/câu hỏi/kết quả | `src/features/ChatHost.tsx`, `QuestionCards.tsx`, `WorkReport.tsx`, `TaskInspector.tsx` |
| Điểm mở hồ sơ | `src/features/KanbanBoard.tsx`, `GitWorkspace.tsx` |
| Bố cục | `src/workspace-shell.css` |
| Acceptance | Mới `scripts/acceptance-work-detail-ui.cjs`; cập nhật `acceptance-chat-host-ui.cjs`, `acceptance-overview-ui.cjs`, `acceptance-reports-ui.cjs`, `acceptance-work-items-ui.cjs`, `acceptance-git-ui.cjs`, `run-acceptance.cjs` |

Tài liệu cập nhật: file bàn giao này, README Worker, README experience-loops và phương án R0–R7. Không thêm dependency, migration, API hoặc thay đổi Controller/runtime/credentials. Không đụng DB người dùng.

## Kiểm chứng thực tế

Chạy trong `apps/windows-worker`. Production renderer/preload/IPC, SQLite fixture riêng; không gọi model. Mỗi layout gồm cửa sổ 1366×768, 850×700, zoom 125%/150%; R2 kiểm cả bốn tab.

| Lệnh | Kết quả |
|---|---|
| `npm run typecheck` | Đạt |
| `npm test` | 227/227 đạt |
| `npm run build` | Đạt; cảnh báo annotation Zod có từ baseline |
| Prettier trên source/script thay đổi; `git diff --check` | Đạt |
| `node scripts/run-acceptance.cjs work-detail-ui` | 16 layout đạt; một composer/form, draft câu trả lời, lỗi lưu chặn đổi tab, IME/selection, lost reply dedup, một continuation, Back/focus/nền inert |
| `node scripts/run-acceptance.cjs reports-ui` | 4 layout đạt; nghiệm thu, export thiếu artifact, verification unknown, XSS, request-fix mất phản hồi không tạo trùng, revision stale sau reload |
| `node scripts/run-acceptance.cjs work-items-ui` | 4 layout đạt; migration fixture cũ, create/archive/restore, ghi chú dedup, optimistic conflict giữ nháp, revision snapshot, queue, export, materialize legacy |
| `node scripts/run-acceptance.cjs git-ui` | 4 layout đạt; diff/history, mở hồ sơ từ mã trong commit, project switch, redaction, không đổi index/HEAD/source |
| `node scripts/run-acceptance.cjs chat-host-ui` | 4 layout đạt; draft/IME/scroll, revision conflict, gửi idempotent, khôi phục context |
| `node scripts/run-acceptance.cjs workspace-shell-ui` | 4 layout đạt; điều hướng, Board cache, nháp/ảnh, lỗi lưu, menu/focus |
| `node scripts/run-acceptance.cjs overview-ui` | 5 layout đạt; attention/report/held queue/stale, run-only inspector fallback |

Không có lỗi renderer trong các fixture đã chạy. Đã xem ảnh Trao đổi ở 150%, Kết quả ở cửa sổ hẹp và Yêu cầu khi lưu câu trả lời thất bại. Các artifact chỉ lưu local, không commit:

- `.cache/work-detail-ui-CQaoen/`
- `.cache/reports-ui-fwvw5t/`
- `.cache/work-items-ui-BGTZth/`
- `.cache/git-ui-Ifo0nz/`
- `.cache/chat-host-ui-uFHNQW/`
- `.cache/workspace-shell-ui-gc9D4a/`
- `.cache/overview-ui-5FdqZl/`

## Giới hạn và bước sau

- **R3 chưa triển khai:** chưa tự link plan Lead thành công việc, chưa có projection trạng thái/hành động chung cho mọi view. R2 giữ admission, policy và giới hạn runtime hiện tại.
- Home/Team toàn app, badge tổng hợp và Kết quả index thuộc R4. Hiện Đội ngũ vẫn theo project; đường mở report qua Tổng quan/hồ sơ đã dùng được.
- Dữ liệu hồ sơ dùng các trang bounded API hiện có. Chưa benchmark 500 item/2.000 run hoặc đo usability với người dùng; chưa khẳng định mục tiêu mở hồ sơ ≤300ms.
- Giữ nháp chỉnh yêu cầu/ghi chú trong hồ sơ đang mở và khi đổi tab/drill-down; lưu bền câu trả lời/chat/ảnh theo cơ chế hiện có. Không bổ sung autosave cho editor yêu cầu/ghi chú khi đóng hồ sơ.
- Các acceptance legacy khác chưa chuyển toàn bộ selector sang shell mới. Không gọi model thật cho đợt UI này; không phải bằng chứng chất lượng nội dung Lead.
- Rollback bằng revert commit source R2; SQLite không cần khôi phục. Bước kế tiếp là R3 theo phạm vi và acceptance transaction/idempotency trong phương án.
