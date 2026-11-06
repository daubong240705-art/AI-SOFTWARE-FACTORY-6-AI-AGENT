# R5 — Hoàn thiện thiết lập

Ngày 05/11/2026. Baseline `10ae348`, checkpoint `0943ed0`. Worker `1.3.0-alpha.8`, SQLite14. [Kế hoạch](workspace-r5-plan.md). Hoàn thành R5; tiếp theo R6 lịch. Không thêm dependency, migration hoặc Controller.

## Hành vi hiện hành

- Cài đặt chia ba nhóm **Model & quyền / Runtime & công cụ / Dữ liệu**, một nút **Lưu cấu hình**. Nhóm hỗ trợ bàn phím mũi tên/Home/End; phần nâng cao thu gọn. Tách presentation khỏi App nhưng giữ state/save/key và IPC hiện có.
- Gateway dùng **Lưu & kiểm tra kết nối**, chỉ GET `/models`. Catalog đã lưu không khẳng định kết nối đang hoạt động. Thành công/rỗng/lỗi có nhãn riêng và thời điểm; sửa URL/CA/key xóa kết quả kiểm tra cũ. Chỉ mở trang không gọi gateway hoặc đọc phiên bản công cụ.
- Chọn một model rồi **Dùng cho agent đang bật** để sửa nháp; không bật role đã tắt, không sửa model của role tắt và không tự lưu. Lead vẫn luôn bật. Model Lead hiện một dòng; thiếu model có nhãn rõ.
- Advanced giữ chọn model/toggle từng vai trò và Fast/Balanced/Quality. Mapping preset như trước, giữ trạng thái bật/tắt; preset vẫn gán model cả role đang tắt như hành vi cũ. Có thể nhập model ID ngoài catalog, tối đa 200 ký tự. App không tự chọn provider hoặc kiểm chứng model đó sinh được nội dung.
- API key giữ mã hóa/guard đổi origin ở main. Chuyển nhóm giữ password đang nhập; rời trang Cài đặt hủy thay/xóa key chưa lưu để tránh gửi chat sau đó vô tình ghi quyết định credential cũ. Nút Xóa key chỉ đổi nháp, lưu mới xóa. Kiểm tra kết nối có nhãn Lưu vì thao tác này lưu toàn bộ nháp trước khi GET catalog.
- **Đọc phiên bản** không ngầm lưu cấu hình khác. Nếu đổi đường dẫn OpenCode chưa lưu, yêu cầu lưu đường dẫn trước; sửa đường dẫn làm kết quả phiên bản cũ hết hiệu lực. Chỉ OpenCode native 1.19.5 được coi đúng phiên bản; đọc phiên bản không chứng minh model chạy được. Execution/giới hạn nâng cao giữ hành vi trước.
- Dữ liệu tái dùng preview/prune cũ: xem trước, giới hạn retention và bảo vệ lượt còn tham chiếu. Không tự dọn dữ liệu hoặc thêm nút reset.
- Readiness trong Tổng quan chỉ kiểm khi mở/bấm nút. Khi đủ, kết quả ngắn và chi tiết thu gọn; khi thiếu, hiện các điều kiện bắt buộc và link đúng nhóm gateway/Lead/CA/key hoặc runtime. Lỗi folder/Git không dẫn sai vào cài model. Chưa kiểm tra, đang tải và lỗi không mang nhãn đủ cấu hình từ lần đọc trước. Đổi cấu hình làm instance readiness cũ hết hiệu lực.
- Chat tiếp tục mặc định Lead; Một agent/role/model ở Tùy chọn trao đổi. Không sửa Controller/runtime/Bash policy trong R5.

## File thay đổi

Trong `apps/windows-worker/`:

- `src/features/SettingsWorkspace.tsx`, `ModelField.tsx`, `src/settings.css`: ba nhóm, model/preset và trạng thái probe.
- `src/App.tsx`, `src/main.tsx`: tách settings, giữ save/credential, nạp CSS, nối điểm vào theo lỗi.
- `src/features/ProjectReadiness.tsx`, `ProjectOverview.tsx`: readiness gọn, error/scope check và nhóm đích.
- `shared/setup.ts`: helper model/preset, mapping lỗi và identity cấu hình không chứa key.
- `tests/setup.test.ts`, `scripts/acceptance-settings-ui.cjs`, `run-acceptance.cjs`: kiểm mapping/bất biến và production Electron fixture.

README Worker và experience-loops cập nhật cách dùng/trạng thái. Không đổi main/preload/DB schema hoặc giao thức gateway.

## Bằng chứng

| Kiểm tra | Kết quả |
|---|---|
| `npm test` | 246/246 đạt, thêm ba test setup |
| `npm run typecheck`, `npm run build` | Đạt; warning annotation Zod baseline |
| Prettier file code thay đổi, `git diff --check` | Đạt |
| `settings-ui` | 12 layout: ba nhóm ở 1366×768, 850×700, zoom 125%/150% |
| `workspace-shell-ui` | 4 layout; điều hướng/nháp/ảnh |
| `lead-access-ui` | 4 layout; Lead/direct, hai Bash ticket tự duyệt |
| `ux06-ui` | 4 layout; readiness/Team/Inbox |
| `chat-host-ui` | 4 layout; ChatHost/draft/context |

Tổng **28 cấu hình UI**, các lần đạt không lỗi renderer. Settings fixture dùng main/preload/IPC/SQLite thật và HTTP loopback giả, có đúng năm GET `/v1/models`, không provider request. Kiểm thành công/401/rỗng/retry; lưu/thay/giữ/xóa key tổng hợp; đổi origin bị chặn trước network; password giữ qua nhóm; hủy xóa key khi rời trang; áp dụng model/preset chỉ sửa nháp; role tắt giữ nguyên; ID custom; đọc phiên bản không lưu timeout chưa ghi; readiness link runtime, thành công gọn và lỗi kiểm lại không còn khẳng định sẵn sàng. Prune không được thực thi.

Probe phiên bản/readiness dùng dữ liệu xác định trong fixture; không chạy OpenCode/model thật. Không dùng DB hoặc credential người dùng. Đã xem ảnh nhóm Model và Runtime, gồm zoom 150%; sửa nhãn CA xuống dòng và khoảng cách label/control từ CSS chung.

Log local tại `.cache/r5-*.log` ở root; fixture cuối Settings: `apps/windows-worker/.cache/settings-ui-MqJMp0/`. Regression: `workspace-shell-ui-UlvQEo/`, `lead-access-ui-YgUbaX/`, `ux06-ui-X6eyxL/`, `chat-host-ui-YcU4jD/`. Ảnh/DB/cache không đưa Git.

## Giới hạn

- Thành công GET catalog chỉ xác nhận endpoint tại thời điểm bấm, không xác nhận model/credential sinh được code. Runtime readiness vẫn là kiểm cấu hình local.
- Kết quả probe thuộc phiên trang hiện tại, không persist chứng nhận kết nối; rời Cài đặt rồi vào lại cần bấm kiểm tra nếu muốn kết quả mới. Chưa thêm wizard hoặc kiểm nền.
- Cấu hình model/runtime chưa lưu vẫn là nháp như trước; việc gửi yêu cầu dùng đường save/snapshot hiện có. Riêng quyết định credential chưa lưu bị hủy khi rời trang.
- Chưa benchmark lớn, chưa test nhà cung cấp/model thật và chưa đổi trải nghiệm lịch. R6 mới nối timer/IPC/UI với storage lịch schema14; 3D vẫn hoãn.

Đóng Worker cũ và chạy `npm start` trong `apps/windows-worker`. Không cần migration; rollback bằng revert source.
