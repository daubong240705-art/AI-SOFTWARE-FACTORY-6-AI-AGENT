# V1.3D — D-04: chọn agent và tác vụ

Ngày 05/11/2026, Windows Worker `1.3.0-alpha.8`, nhánh `feature/worker-office-v1.3d`. Checkpoint `checkpoint/v13d04-start-20261105` tại `3157538`. **D-04 hoàn thành; còn D-05 và E.** Giữ schema 7, dependency và Controller hiện có.

## Hành vi

- Click bàn/nhân vật hoặc nhãn HTML để chọn role; thảm và nhãn cùng highlight, mục Hoạt động mở danh sách riêng của role đó. Không tự chọn execution đầu tiên khi có nhiều tác vụ. Hover/focus có một dòng thông tin, không thêm popup dài. Kéo để pan vẫn dùng OrbitControls, click di chuyển quá 5px không chọn bàn.
- Từng execution mở inspector chung với đúng projectId/runId/taskId/executionId. Model và workspace đọc từ task đã lưu, không dùng settings hiện tại. Task queued mở theo taskId, direct giữ taskId null. `officeTarget` kiểm tra lại nguồn state ở thời điểm click, từ chối stale/error/khác project hoặc execution đã mất.
- **Mở trên Kanban** trong inspector giữ card của lượt chạy và task cụ thể khi mở lại. Kanban vẫn là card cha theo run, không sinh card con giả. **Văn phòng** trong inspector chọn đúng role và đánh dấu task/execution nếu còn hoạt động. Lựa chọn theo project được giữ khi chuyển Chat/Board/Office trong phiên app và xóa khi đổi project; không lưu selection vào DB.
- Nhãn và task dùng HTML button có focus, aria-pressed/aria-current. Native inspector giữ focus khi đóng; có đường HTML để chọn tác vụ ngoài canvas. Agent rảnh không mở task lịch sử tự động. Nếu task đã kết thúc, office không gán lại selection vào execution khác; có thể xem lịch sử qua Đội ngũ/Board.
- **Công việc** ở header văn phòng mở board tổng; bộ đếm trong Hoạt động phản ánh agent đang lọc, thanh trạng thái phía trên vẫn phản ánh toàn project.

## Kiểm chứng thực tế

| Kiểm tra | Kết quả |
| --- | --- |
| Typecheck, format, production build | Đạt |
| Test suite | 161/161; thêm kiểm tra selection chính xác, chờ/direct, sai role/project, stale/error và execution biến mất |
| Electron D-04 | Chọn hai task BE riêng biệt, đúng model/workspace/execution; task FE chờ dependency và direct run mở đúng inspector |
| Điều hướng | Office → inspector → Kanban đúng card; mở lại giữ task; trở về Office highlight task; Mở Chat giữ role; đổi project xóa selection |
| Input | Native Enter qua Chromium input, focus trở lại nút task; canvas hover/click qua raycasting thật |
| Layout inspector | 1440×960, 850×700, 1100×800 zoom125%; dialog nằm trong viewport và không tràn ngang |
| State regression D-03 | Ba layout; hai lane, permission, stop, offline/reconnect, progress và revision unchanged |
| Camera regression D-01/D-02 | Ba layout; pan/zoom/wheel/reset, WebGL2, lazy load/unmount/context loss |

[D-04 JSON](d04-ui.json), [state regression](state-regression/d03-ui.json), [camera regression](camera-regression/d01-d02-ui.json). Ảnh đã xem trực quan và chỉ lưu local, không commit/push.

Fixture chạy main/preload/renderer production với SQLite riêng. Script lưu observation tổng hợp và task/model/workspace vào DB thử; sau startup chỉ phục hồi một run synthetic active tại một thời điểm để giữ unique-active constraint. `runDetail` và inspector qua IPC/SQLite thật. Riêng monitor dùng `projectMonitor`/`MonitorProjection`/`projectBoard` với active run tổng hợp sau validation IPC. Không có runtime/model thật hoặc tool được khởi chạy; `providerCalls=0`. Keyboard/mouse đi qua Chromium DevTools input vì cửa sổ kiểm thử ẩn không có OS focus. Script đợi frame/nhãn thực sau resize; chỉ kích hoạt hit qua canvas, không dùng nhãn HTML thay cho raycast.

Chạy từ `apps/windows-worker`:

```powershell
npm run typecheck
npm test
npm run format:check
npm run build
node scripts/run-acceptance.cjs office-selection-ui
```

Mở lại app bằng `npm start`, chọn dự án → Văn phòng → chọn agent → chọn task. Với nhiều task cùng role, mỗi dòng là một execution riêng.

## Còn lại

D-05 bổ sung quality/reduced motion/lifecycle render; E nghiệm thu fallback/accessibility tổng thể, số đo hiệu năng và model thật qua 9Router. Chưa phát hành installer hoặc tuyên bố V1.3 stable. Không thêm scheduler hoặc nút dừng riêng agent.
