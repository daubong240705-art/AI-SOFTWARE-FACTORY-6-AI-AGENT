# ASF Windows Worker

WW-2: desktop local chạy một coding agent thật qua OpenCode 1.19.5 và 9Router. Có Run/Stop, quyền shell theo từng lần, hoạt động, file thay đổi, kết quả lệnh và lịch sử SQLite. Lead tự phân công nhiều role thuộc WW-3.

## Chạy ứng dụng

Windows x64, Node.js >=22.12 (khuyến nghị Node 22 LTS) và npm:

```powershell
cd E:\GIT\AI-SOFTWARE-FACTORY-6-AI-AGENT\apps\windows-worker
npm ci
npm run dev
```

Chạy giao diện từ production build:

```powershell
npm start
```

`npm start` build main/preload/renderer rồi mở cửa sổ Electron. `npm run build` chỉ tạo `out/`; chưa tạo bộ cài `.exe`. Đóng cửa sổ để thoát. Script launcher loại bỏ `ELECTRON_RUN_AS_NODE` nếu editor/agent shell đã đặt biến này.

better-sqlite3 13 cung cấp binary Node-API dùng chung Node/Electron; không cần electron-rebuild hoặc Visual Studio Build Tools trên Windows x64. Lockfile pin dependencies. Nếu Electron binary chưa được tải đầy đủ sau một lần npm install bị gián đoạn, chạy `node node_modules/electron/install.js` rồi mở lại app.

## Sử dụng

1. **Chọn dự án**: chọn thư mục source. App ghi đường dẫn canonical, danh sách gần đây và trạng thái Git đọc-only. Có thể mở thư mục chưa có Git.
2. **Cài đặt → 9Router**: nhập Gateway URL có API prefix (ví dụ `https://router.example/v1`), API key và CA nội bộ nếu cần.
3. Bấm **Lưu & tải model**: lưu cấu hình rồi GET `<gateway>/models`. Không gọi model sinh code. UI hiển thị lỗi auth, URL, TLS, format hoặc giới hạn request.
4. **Đội agent**: chọn model, bật/tắt sáu role phụ; Lead luôn bật. **Preset** cho phép tự ánh xạ model thật vào Fast/Balanced/Quality, giữ toggle hiện tại. Bấm **Lưu** để lưu lựa chọn.
5. **Runtime & công cụ**: dùng OpenCode **1.19.5**. App tìm native executable trong PATH hoặc bản cài npm global; có thể chọn `opencode.exe` thủ công. Bản khác bị từ chối để tránh sai API. **Đọc phiên bản** không cài thêm công cụ.
6. Nhập yêu cầu, chọn một agent (mặc định BE), rồi **Chạy yêu cầu**. Settings được lưu và snapshot vào run; thay đổi sau đó chỉ áp dụng run mới. Chỉ có một run hoạt động toàn app.
7. Theo dõi **Hoạt động**. Shell cần **Cho phép một lần** hoặc **Từ chối**; app không cấp quyền luôn luôn. Đọc lệnh trước khi cho phép. Bấm **Dừng** để abort session và kết thúc cây tiến trình thuộc run.
8. **Thay đổi** liệt kê source khác trước/sau run; **Kết quả** có báo cáo, output/exit code lệnh và usage được runtime báo. **Lịch sử** hiển thị 50 run gần nhất, giữ lại cả lỗi/hủy. Diff từng dòng thuộc WW-4.

Đóng cửa sổ bản WW-1 đang mở rồi chạy `npm start` để nạp main/preload mới. Không tự reload main process đang dùng.

Bỏ project khỏi danh sách chỉ xóa metadata/bản nháp local của app, không xóa thư mục source. Không tự init Git, stash, reset, commit hoặc push. Thiếu Git hoặc không phải repo có thông báo rõ.

## Dữ liệu và credential

- SQLite đặt trong `app.getPath('userData')`, trên Windows thường là `%APPDATA%\ASF Windows Worker\worker.sqlite`.
- Database schema v2 thêm `runs`, `tasks`, `events`; unique index và Controller khóa một run hoạt động. Trước nâng schema v1, app tạo bản SQLite nhất quán qua `VACUUM INTO`, giữ `worker.schema1.backup.sqlite`. Run bị gián đoạn được ghi interrupted khi mở lại; không tự replay task.
- Key mới chỉ tồn tại tạm trong ô password để gửi qua IPC, không đưa vào React state, localStorage hoặc trả lại từ main process. Sau lưu/navigate, ô nhập bị xóa. SQLite chỉ giữ ciphertext do Electron safeStorage tạo; không có fallback plaintext.
- Đổi origin gateway yêu cầu nhập key mới hoặc xóa key cũ. Catalog cũ bị xóa khi đổi gateway/CA/key. Không tự theo redirect mang Authorization.
- TLS luôn xác minh. CA PEM được thêm vào trust mặc định cho catalog và model proxy; không sửa trust store Windows.
- Renderer sandbox/context isolation, không Node integration; preload chỉ expose API hẹp. Main kiểm tra sender frame/URL và schema input. Không expose shell/file access tổng quát.
- Catalog không chứng minh model hỗ trợ tool calling. HTTP nội bộ được hỗ trợ theo cấu hình; dùng HTTPS khi truyền key qua mạng.
- Source dùng làm context có thể đi tới gateway/provider. Chỉ dùng repo tin cậy: shell chạy bằng tài khoản Windows, không xem chọn folder là sandbox hệ điều hành. Không cấp admin/SSH/deploy hoặc tự commit/push.
- Mỗi run dùng OpenCode headless server chỉ bind loopback, Basic auth random, config/data/cache riêng trong app data. Tắt project config, plugin/MCP/skills bên ngoài và provider khác; không sửa OpenCode global của người dùng. Runtime được cấu hình một primary agent, không có delegation ở WW-2.
- API key 9Router giữ ở parent proxy; child chỉ nhận token execution tạm, token vô hiệu khi run kết thúc. Proxy pin model, hạn mức request vật lý, giới hạn output mỗi request và không theo redirect. Không cấp provider key qua argv hoặc environment child.
- Snapshot giới hạn 8.000 entry, 48 MB tổng, 1 MB/file, bỏ dependency, secret file và symlink; UI báo nếu không đầy đủ. Những file thay đổi đồng thời bởi người dùng cũng có thể xuất hiện, không gán tuyệt đối mọi thay đổi cho agent.
- App không lưu reasoning vào bảng events/báo cáo UI. OpenCode vẫn quản lý session/metadata riêng trong thư mục runtime local. Giới hạn request không cam kết chi phí tuyệt đối nếu gateway tự retry/route.

## Kiểm tra phát triển

```powershell
npm run typecheck
npm test
npm run test:native
npm run build
```

Các test mặc định dùng SQLite/thư mục tạm và gateway HTTP loopback tổng hợp, không dùng API key thật hoặc gọi model. Kiểm tra thêm run lock/cancel/reopen, redaction và model proxy pin/quota/redirect. `test:native` chạy Electron main không mở cửa sổ để kiểm tra SQLite binary, mã hóa/giải mã safeStorage và xác nhận key tổng hợp không xuất hiện plaintext trong file DB/WAL.

Thử thật 04/11/2026 qua chính Controller/Electron với **`ds/deepseek-v4-flash`**: tạo `formatDuration.ts` và test trong source sản phẩm, 5 request, `npm test` exit 0. Lượt Dừng kết thúc 4 process thuộc cây runtime, không còn process con. Xem [bằng chứng WW-2](../../docs/windows-worker/ww2-completion.md). Các script `scripts/run-acceptance.cjs` là thao tác live chủ động, có gọi model và sửa hai file nêu trên; không nằm trong `npm test`, không tự chạy khi mở app.

## Phạm vi tiếp theo

[WW-3](../../plan/windows-worker/phase-3-team.md) thêm Lead điều phối và vòng sửa lỗi. [Kế hoạch đầy đủ](../../plan/windows-worker/README.md) gồm WW-1 đến WW-5. App này độc lập với ASF web; không cần build image hoặc deploy lại các VM.
