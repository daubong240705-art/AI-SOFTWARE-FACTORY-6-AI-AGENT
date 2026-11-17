# Thế giới studio 3D

## 1. Kiến trúc hiện tại

UI dùng Vite, React 19, TypeScript strict, Tailwind 4 và shadcn/ui; giao tiếp HTTP với Host.
Store hiện tại scoped theo dự án đang chọn: tasks, workflow, interactions và SSE đều theo dự án.
Điều hướng dùng hash (`#/team`, `#/project/<id>/office`); `#/world` là trang toàn cục bổ sung.
Văn phòng hiện tại là màn hình 2D, vẫn là lối vào đầy đủ khi không dùng được WebGL2.
Mascot có bộ art SVG “original” riêng và ánh xạ `artCode`; có thể tái dùng ngôn ngữ hình ảnh này.
Đội thật là đội dùng chung “Web Games”, gồm 6 ghế, cộng Quản trị Portal (Portal Manager).
Không tạo một đội giả cho mỗi game. Không có SSE toàn cục nên thế giới phải polling.
Văn bản từ server được hiển thị dưới dạng plain text.

## 2. Thành phần tái sử dụng

- `AgentOverview`: nội dung chi tiết ghế/agent và công việc hiện tại.
- `DockedPane`: bảng chi tiết có quản lý đóng/mở và focus.
- `StatusPill`: trạng thái hoạt động; `meaningfulOfficeItems` lọc tương tác có nghĩa, `toneOf` thống nhất màu trạng thái.
- `Mascot` và ánh xạ `artCode`: nhận diện nhân vật từ ghế thật, không tự sinh danh tính.
- `NewGameDialog`: luồng tạo game hiện có; World chỉ mở luồng này khi các giai đoạn sau cần.
- Mẫu `LazyWorkflowGraph`: dùng React lazy/Suspense để cô lập dependency nặng.

Không sửa hoặc sao chép logic màn hình office/teams trong chunk 1.

## 3. Thành phần cần bổ sung

Chunk 1 cung cấp route, capability gate, preferences có đồng bộ tab, fallback, toolbar,
error boundary, canvas tải lười, camera isometric, nền studio và debug getter chỉ đọc.
Nền slab/rug là khung kiến trúc trống, không biểu diễn người, game hay hoạt động giả.
Các chunk sau bổ sung adapter dữ liệu toàn cục, layout, nhân vật, tương tác, nhãn và bảng chi tiết.
Mọi hình ảnh biểu diễn trạng thái, nhân vật, game và hoạt động đều lấy từ dữ liệu thật;
không dựng dữ liệu giả, không giả hoạt động hoặc lượng người chơi.

## 4. Rủi ro kỹ thuật

- Bundle: three/R3F phải nằm ngoài entry và modulepreload; guard đo gzip sau build.
- GPU yếu: nhận diện software renderer và giảm chất lượng khi fps live dưới 24 liên tục 3 giây.
- Headless WebGL: có thể không có WebGL2 hoặc dùng SwiftShader; cần kiểm tra fallback và mất context trong Chrome.
- Strict TS + R3F: tuân thủ noUncheckedIndexedAccess, exactOptionalPropertyTypes và noUnused*; cleanup tài nguyên khi unmount.
- CSP chỉ self/data cho ảnh: không drei, CDN font, HDR, môi trường từ xa hoặc ảnh blob.
- Nhãn có thể chồng nhau: cần ưu tiên nhãn theo focus, gom nhãn và kiểm tra nhiều kích thước màn hình.
- Replay lịch sử: bản polling đầu chỉ tạo baseline, không phát lại toàn bộ tương tác cũ thành hoạt cảnh mới.

## 5. Kiến trúc 3D đề xuất

Hai lớp tải lười: AppShell → WorldPage → scene/WorldCanvas.
Chỉ scene/** và characters/** được import giá trị từ three hoặc @react-three/*.
Canvas orthographic, flat, demand frameloop, không shadow map hoặc failIfMajorPerformanceCaveat.
Camera nhìn theo vector chuẩn hóa (1,1,1), zoom theo kích thước vùng vẽ; nền ngày ấm.
Ticker dùng requestAnimationFrame và bộ đếm yêu cầu live/ambient, tự dừng khi tab ẩn.
Live 60 fps (low 30), ambient 30 (low 12), chế độ tĩnh 0; invalidate khi dữ liệu thay đổi.
Mọi hoạt cảnh dùng thời gian đã trôi qua, không cộng dồn delta từng frame.
Low dùng DPR 1, tắt antialias; auto xét renderer và fps live đo được.
Capability gate ưu tiên bản 2D khi người dùng chọn, thiếu WebGL2, màn hình hẹp hoặc giảm chuyển động.
Người dùng giảm chuyển động có thể chủ động mở 3D tĩnh; lỗi scene/context chuyển về fallback có thử lại.
Debug `window.__factoryWorld` chỉ trả snapshot đóng băng, tối đa một lần dựng mỗi 250 ms.

Adapter `deriveWorld` tạo mô hình từ dữ liệu thật; `diffWorld` so với baseline để phát ra thay đổi mới.
Baseline được thiết lập lại đúng scope/phiên dữ liệu, không đổi selectedProject của store để lấy dữ liệu toàn cục.
Polling dùng API đã validate, hủy yêu cầu khi unmount, không polling chồng nhau và dừng khi tab ẩn.
Các nhịp dưới đây là kế hoạch cho chunk dữ liệu, chưa bật trong chunk vỏ giao diện.

| Nguồn dữ liệu | Nhịp polling |
| --- | --- |
| `/org/activity` | 5 giây |
| `/games` | 10 giây |
| `/teams` | 60 giây |
| Interactions | 6 giây, tối đa 3 game đang hoạt động |
| Tasks + workflow | 15 giây, chỉ game đang focus |
| Game-report | 15 giây |
| Releases | Khi phiên bản thay đổi |
| Portal | 15–60 giây |

## 6. Kế hoạch triển khai theo giai đoạn

| Giai đoạn | Chunk | Kết quả |
| --- | --- | --- |
| Phase 1 | 1 | Route, gate, fallback, lazy canvas, Ticker, quality, debug và bundle guard |
| Phase 1 | 2 | Adapter deriveWorld/diffWorld, baseline và polling dữ liệu thật |
| Phase 2 | 3 | Layout studio, khu đội dùng chung và khu game từ danh sách thật |
| Phase 2 | 4 | Nhân vật theo 6 ghế thật và Portal Manager, ánh xạ artCode |
| Phase 3 | 5 | Hoạt cảnh theo thay đổi dữ liệu, nhãn trạng thái và chế độ tĩnh |
| Phase 3–4 | 6 | Focus, chọn đối tượng, bảng chi tiết tái sử dụng và điều hướng về 2D |
| Phase 4 | 7 | Kiểm thử tích hợp, accessibility, hiệu năng và kiểm tra headless |

Phase 5 bổ sung quảng trường Portal: người chơi ẩn danh lấy từ số online thật,
không bịa danh tính hoặc cộng thêm số người. Phase 6 hoàn thiện hình ảnh, chuyển động,
bố trí nhãn và hiệu năng theo thiết bị thực tế. Mọi hình ảnh dữ liệu đều có nguồn thật, không giả lập.
