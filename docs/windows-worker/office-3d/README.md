# V1.3D — D-01 và D-02

**Cập nhật alpha.7:** D-03 đã triển khai; xem [bàn giao trạng thái execution](d03/README.md). Nội dung bên dưới giữ bằng chứng D-01/D-02 tại alpha.6. Còn D-04/D-05 và E.

Bàn giao ngày 05/11/2026, Windows Worker `1.3.0-alpha.6`, nhánh `feature/worker-office-v1.3d`. Checkpoint `checkpoint/v13d-start-20261105` giữ trạng thái trước thay đổi. **D-01/D-02 hoàn thành; D-03–05 và E còn lại.**

## Chức năng

- Navigation **Văn phòng** trong Worker; cần chọn project trước khi mở.
- Một phòng isometric với sàn, hai vách thấp, bảy bàn và nhân vật hình học đơn giản. Lead ở đầu phòng, sáu role thành hai hàng. Không dùng asset, texture hoặc screenshot từ dự án tham khảo.
- Camera orthographic, kéo để pan, wheel để zoom; có nút zoom/pan/đặt lại dùng được bằng bàn phím. Giới hạn pan và zoom, tự fit theo vùng hiển thị. Thao tác wheel/pan đồng bộ với nút toolbar.
- Nhãn HTML giữ cỡ chữ theo UI, chiếu theo vị trí 3D. Trạng thái khả dụng lấy từ snapshot monitor hiện có; thiếu/stale dữ liệu không tự hiện Rảnh. Chưa ánh xạ hoạt động/execution lên vật thể.
- Scene tải riêng khi mở trang; không tải Three/R3F vào Chat ban đầu. Render on-demand, DPR tối đa 1.5, không shadow/postprocessing/animation. Rời trang unmount canvas.
- Có điều hướng 2D, error boundary và xử lý context loss cơ bản. Chưa thay thế nghiệm thu fallback/hiệu năng đầy đủ ở D-05/E.
- Sidebar có cuộn khi chiều cao không đủ sau khi thêm mục Văn phòng.

## Thư viện và tương thích

| Dependency | Phiên bản pin | Giấy phép | Ghi chú |
| --- | --- | --- | --- |
| three | 0.187.0 | MIT | Dùng geometry, material, camera và OrbitControls có sẵn |
| @react-three/fiber | 9.8.2 | MIT | Peer React/ReactDOM `>=19 <19.4`, phù hợp 19.3.1 đang dùng |
| @types/three | 0.187.0 | MIT | Development only; có dependency type cho ví dụ khác, không thêm physics vào renderer |

Pin và integrity ở package-lock; `npm ls` không báo peer invalid. Gói cài bằng `--ignore-scripts`, không chạy mã cài đặt từ dependency. Không thêm Drei, game engine, backend hoặc orchestrator. [License notices](../../../apps/windows-worker/THIRD_PARTY_3D_NOTICES.md) gồm MIT của Three, upstream R3F và types. R3F archive không có file LICENSE riêng; npm khai MIT, notice lấy từ upstream master; gitHead npm không resolve được nên chưa tuyên bố kiểm tra source đúng commit upstream.

Production Electron 42.11.18 chạy được WebGL2 với React hiện tại. Build tách chunk OfficeScene khoảng **2.08 MB chưa nén**, entry renderer khoảng **1.48 MB chưa nén** trên build này. Đây là số dung lượng bundle, không phải số đo RAM/FPS. `npm audit` còn một advisory low của esbuild 0.27.7 trong toolchain tsx đã có ở baseline; không do gói 3D mới thêm. Chưa đổi toolchain ngoài phạm vi.

## Kiểm chứng thực tế

| Kiểm tra | Kết quả |
| --- | --- |
| Typecheck, format, production build | Đạt |
| Tests | 154/154: thêm 2 test layout/giới hạn camera |
| Electron office UI | 3/3: 1440×960, 850×700, 1100×800 zoom125% |
| WebGL | WebGL2 thực, không bật software renderer bằng flag |
| Layout | Bảy nhãn nằm trong scene ở góc mặc định, không tràn trang |
| Camera | Nút zoom/pan, wheel, reset làm đổi/khôi phục tọa độ chiếu |
| Lifecycle | Chat chưa tải chunk 3D; rời trang không còn canvas; context loss quay về 2D |
| UI regression hiện có | 5 cấu hình kiểm tra chat/board/agent/settings/inspector |

[JSON office UI](d01-d02-ui.json) ghi viewport, tọa độ nhãn, trạng thái GPU và kết quả. [Layout regression](layout-regression/layout-checks.json) kiểm tra các màn hình hiện có. Fixture dùng SQLite riêng và cấu hình tổng hợp, không gọi model hay dùng credential/database người dùng.

Ảnh `office-desktop.png`, `office-small.png`, `office-zoom125.png` chỉ lưu local và đã xem trực quan. PNG không được commit/push theo yêu cầu. Script chờ phép đo camera thay đổi/khôi phục trước khi khẳng định, không chỉ chờ timeout cố định: React/R3F renderer riêng có thể hoàn tất cập nhật sau click bất đồng bộ.

Chạy từ `apps/windows-worker`:

```powershell
npm run typecheck
npm test
npm run format:check
npm run build
node scripts/run-acceptance.cjs office-ui
```

Script kiểm tra output mặc định tại thư mục tài liệu này; có thể đặt `ASF_UI_ARTIFACT_DIR` sang thư mục khác. Để dùng sản phẩm, đóng cửa sổ cũ rồi `npm start`, chọn project và mở **Văn phòng**.

## Phần tiếp theo

**D-03:** projection hoạt động thật, nhiều execution trên một role, chờ quyền/dependency và tiến độ. **D-04:** chọn bàn/agent/task mở inspector đúng attempt, liên kết Kanban và Chat. **D-05/E:** quality/reduced motion, hidden/minimize, fallback/accessibility đầy đủ, số đo CPU/GPU/RAM và nghiệm thu run thật qua 9Router. D-01/D-02 chưa có click bàn mở task, animation trạng thái hoặc benchmark dài hạn.
