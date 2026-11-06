# V1.3D — D-03: hoạt động thật trong văn phòng

Bàn giao 05/11/2026, Windows Worker `1.3.0-alpha.7`, nhánh `feature/worker-office-v1.3d`. Checkpoint `checkpoint/v13d03-start-20261105` tại `602b04e`. **D-03 hoàn thành; D-04/D-05 và E còn lại.** SQLite schema vẫn 7, không thêm dependency, service, poller hoặc cơ chế điều phối.

## Thay đổi

- Selector `office/state.ts` dùng cùng `MonitorState` với Đội ngũ/Board. Bảy nhãn và màu màn hình 3D theo activity/availability thật; phân biệt rảnh, tắt, chưa cấu hình, chờ quyền, chờ phụ thuộc, chờ tích hợp và đang dừng. Role tắt giữa run vẫn hiển thị execution thực tế.
- Nhiều execution cùng role hiển thị số tác vụ và ưu tiên cảnh báo chờ quyền/dừng; mục **Hoạt động** thu gọn giữ từng identity, title, activity và model thực thi. Hoàn thành một lane không đóng lane còn lại. Direct run giữ taskId null.
- Thanh trạng thái có số agent bận, execution, task chờ và task đã xác minh/tổng. Không suy ra verified từ task completed hoặc agent rảnh.
- Null/stale/error/snapshot sai project hiển thị Chưa đồng bộ, ẩn số liệu và công việc cũ; kết nối lại tự cập nhật. Active run ở project khác được nêu riêng, không gán việc đó vào bàn của project đang chọn.
- Nhãn HTML giữ cỡ chữ, tránh chồng nhau và giới hạn trong vùng scene; phần chi tiết tối đa 210px và cuộn riêng. Scene vẫn render on-demand, không có animation chạy liên tục. Ở vùng quá hẹp không đủ chỗ, nhãn không xếp được sẽ ẩn; chi tiết HTML và Đội ngũ 2D vẫn có sẵn.

## Kiểm chứng

| Kiểm tra | Kết quả |
| --- | --- |
| Typecheck, Prettier, production build | Đạt |
| Test suite | 160/160; thêm 5 test selector và 1 test tránh chồng nhãn |
| Electron D-03 | Ba layout: 1440×960, 850×700, 1100×800 zoom125%; nhãn không chồng, không tràn ngang |
| Cập nhật state | Hai BE sửa/test, FE chờ dependency; permission chỉ lane A; A xong, B vẫn test; dừng rồi rảnh; progress vẫn 0/3 |
| Feed | Active project khác, offline ẩn dữ liệu cũ, reconnect, revision unchanged; tối đa một monitor request đang bay |
| Hồi quy camera | Ba layout; WebGL2, zoom/pan/wheel/reset, lazy load, unmount và context loss về 2D |

[D-03 JSON](d03-ui.json) ghi phép đo và phạm vi fixture; [camera regression](camera-regression/d01-d02-ui.json) ghi kiểm tra renderer. Ảnh local đã xem trực quan, không commit/push.

Electron chạy main/preload/renderer production với SQLite riêng. Script chặn **riêng phản hồi monitor** sau kiểm tra sender/input thật, dùng `projectMonitor` + `MonitorProjection` production để chuyển observation tổng hợp qua IPC và monitor store thật. Không seed active run vào DB vì startup đúng ra phải chuyển lượt đó thành interrupted. **Không gọi provider; đây không phải nghiệm thu runtime/model thật.** Các test selector còn kiểm tra direct taskId null, toàn bộ activity, stale/error/foreign snapshot và progress verified.

Chạy từ `apps/windows-worker`:

```powershell
npm run typecheck
npm test
npm run format:check
npm run build
node scripts/run-acceptance.cjs office-state-ui
$env:ASF_UI_ARTIFACT_DIR = '../../docs/windows-worker/office-3d/d03/camera-regression'
node scripts/run-acceptance.cjs office-ui
```

Đóng cửa sổ cũ rồi `npm start`, chọn project → **Văn phòng**. Mở **Hoạt động** khi cần từng task/model.

## Còn lại

- **D-04:** chọn bàn/agent và chọn đúng execution để mở inspector, liên kết Kanban/Chat.
- **D-05:** reduced motion, quality controls, lifecycle hidden/minimize và hoạt ảnh nhẹ nếu phù hợp.
- **E:** fallback/accessibility tổng thể, đo CPU/GPU/RAM/độ trễ và nghiệm thu model thật qua 9Router. Chưa có benchmark dài hạn hoặc installer.
