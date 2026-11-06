# Rà soát source và phần còn lại

Ngày 05/11/2026. Baseline `446bf2a`; checkpoint Git `checkpoint/source-cleanup-20261105`. Phạm vi thực thi: Windows Worker, giữ Factory Lite và Controller hiện có. Không thay database, credentials hay source dự án người dùng.

## Đã xác định từ source

- Màn chat hiện dùng `ChatHost`; `ChatWorkspace.tsx` chỉ re-export và không có import trong ứng dụng. Đã bỏ wrapper, đổi prompt live acceptance sang file thật.
- `acceptance-board-ui.cjs` chỉ gọi lại acceptance Work Items; runner đã ánh xạ `board-ui` tới cùng fixture. Đã bỏ file trùng; alias CLI vẫn dùng được.
- TypeScript phát hiện import không dùng ở Controller/coordinator/App/tests, prop `projectName` không dùng trong Board và setter state quay lại Chat không bao giờ gọi. Đã bỏ; dock tiếp tục quay về Board như trước.
- Sửa thông báo lưu cấu hình bị hỏng dấu thành “Đã lưu cấu hình.”
- Runner acceptance dùng chuỗi điều kiện lồng nhau, tên không khớp mặc định chạy live và có thể sửa source. Thay bằng allowlist, yêu cầu tên rõ ràng, xử lý lỗi spawn. Chỉ `live` chọn fixture live mặc định cũ; không tự gọi model để kiểm thay đổi này.
- Bật `noUnusedLocals` và `noUnusedParameters` trong typecheck để ngăn mã thừa mới. Không thêm dependency.
- Bỏ qua mọi thư mục `.cache/` và checkout tham khảo `/crewhub/` trong Git. Không xóa dữ liệu cache/tham khảo vật lý.

## Việc cần hoàn thành

| Ưu tiên | Hạng mục | Trạng thái và điều kiện hoàn thành |
|---|---|---|
| Đã hoàn thành | R6 / UX-08 lịch | Đã nối timer/resume, IPC, editor/preview/history, lỗi tắt lịch và quota/retention. [Bàn giao R6](workspace-r6-completion.md). |
| 2 | Nghiệm thu bản stable | Cần đo lặp trên repo có dependency/build thật: thời gian, request, review đạt ngay, conflict, phục hồi và chất lượng giao việc. Các fixture hiện có không thay nghiệm thu model thật. Theo [giới hạn review](review-quality-completion.md) và R7 của [kế hoạch trải nghiệm](../archive/plan/experience-loops/crewhub-workspace-redesign.md). |
| Hoãn | WW-5 bộ cài | Chưa đóng gói `.exe`/installer; người dùng đã chọn bỏ qua, không chặn phát triển tính năng. |
| Hoãn | 3D D-05 và E liên quan | Giữ D-01–04 đang có; không phát triển tiếp khi chưa có yêu cầu mới. Không xóa dependency vì màn Văn phòng vẫn import/lazy-load chúng. |
| Đã xử lý riêng | Reset database | Sau đợt dọn source, người dùng đã reset DB và cấu hình gateway/model/runtime đã được thiết lập lại. R6 không reset hay sửa settings/credential người dùng. |

R0–R5, Bash tự động, projection trạng thái, Cần xử lý và mô tả task đã triển khai trong các bàn giao tương ứng; không coi những mục “còn lại” trong tài liệu lịch sử cũ là backlog hiện hành nếu đợt sau đã thay thế.

## Thành phần giữ lại có chủ đích

- Migration/schema cũ và fixture tương thích: phục vụ DB cũ, backup và kiểm tra nâng cấp.
- Tests, acceptance scripts và bằng chứng bàn giao: công việc đã hoàn thành vẫn cần hồi quy; không xóa chỉ vì bài kiểm tra từng đạt.
- Module schedules/storage đã nối UI qua R6, tiếp tục phục vụ lịch công việc.
- API/dashboard/infrastructure self-hosted: có entrypoint và CI riêng; README root phân biệt rõ với Worker. Không có bằng chứng chúng đã được ngừng sử dụng để xóa toàn bộ.
- Tài liệu kế hoạch/nghiên cứu và notices giấy phép: giữ lịch sử quyết định và nguồn tham khảo.

## Kiểm chứng

- `npm test`: **256/256 đạt**. Hai test mới chạy runner trong sandbox VM với spawn giả để kiểm tên sai không khởi chạy live, mọi tên hợp lệ trỏ file tồn tại, alias Board, tham số và môi trường launch.
- `npm run typecheck`: đạt với hai cờ kiểm mã không dùng mới bật.
- `npm run format:check`, `npm run build`, `git diff --check`: đạt. Build còn warning annotation Zod có sẵn.
- `workspace-shell-ui`: **bốn layout đạt**, gồm màn hẹp và zoom 125%/150%; không overflow, không lỗi renderer, không provider call. Fixture kiểm điều hướng, nháp và ảnh qua main/preload/SQLite riêng.

Log nằm ở `.cache/source-cleanup-{tests,build,ui}.log`; ảnh và SQLite fixture ở `apps/windows-worker/.cache/workspace-shell-ui-9uhk85/`. Không đưa cache vào Git, không dùng DB hay model thật cho đợt này. Chưa nghiệm thu live, benchmark lớn hoặc tính năng lịch chưa triển khai.
