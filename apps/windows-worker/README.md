# ASF Windows Worker

WW-1: desktop local với project picker, bản nháp, cài đặt 9Router/model và đội agent. Chưa nối OpenCode execution; nút Chạy bị vô hiệu hóa và không sinh kết quả giả.

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

## Sử dụng WW-1

1. **Chọn dự án**: chọn thư mục source. App ghi đường dẫn canonical, danh sách gần đây và trạng thái Git đọc-only. Có thể mở thư mục chưa có Git.
2. **Cài đặt → 9Router**: nhập Gateway URL có API prefix (ví dụ `https://router.example/v1`), API key và CA nội bộ nếu cần.
3. Bấm **Lưu & tải model**: lưu cấu hình rồi GET `<gateway>/models`. Không gọi model sinh code. UI hiển thị lỗi auth, URL, TLS, format hoặc giới hạn request.
4. **Đội agent**: chọn model, bật/tắt sáu role phụ; Lead luôn bật. **Preset** cho phép tự ánh xạ model thật vào Fast/Balanced/Quality, giữ toggle hiện tại. Bấm **Lưu** để lưu lựa chọn.
5. **Runtime & công cụ**: chọn `opencode.exe` nếu không có trong PATH. **Đọc phiên bản** chỉ gọi `--version` cho runtime được chọn, Git/Node/Python; không cài thêm công cụ.
6. Nhập yêu cầu để lưu bản nháp theo project. Hoạt động/Thay đổi/Kết quả và Lịch sử có empty state thật, chưa tạo run ở WW-1.

Bỏ project khỏi danh sách chỉ xóa metadata/bản nháp local của app, không xóa thư mục source. Không tự init Git, stash, reset, commit hoặc push. Thiếu Git hoặc không phải repo có thông báo rõ.

## Dữ liệu và credential

- SQLite đặt trong `app.getPath('userData')`, trên Windows thường là `%APPDATA%\ASF Windows Worker\worker.sqlite`.
- Database schema v1 lưu project/draft, settings với bảy role, catalog và credential **đã mã hóa**. Bảng `runs` sẽ thêm bằng migration ở WW-2, không dùng fake history.
- Key mới chỉ tồn tại tạm trong ô password để gửi qua IPC, không đưa vào React state, localStorage hoặc trả lại từ main process. Sau lưu/navigate, ô nhập bị xóa. SQLite chỉ giữ ciphertext do Electron safeStorage tạo; không có fallback plaintext.
- Đổi origin gateway yêu cầu nhập key mới hoặc xóa key cũ. Catalog cũ bị xóa khi đổi gateway/CA/key. Không tự theo redirect mang Authorization.
- TLS luôn xác minh. CA PEM được thêm vào trust mặc định cho request catalog; không sửa trust store Windows.
- Renderer sandbox/context isolation, không Node integration; preload chỉ expose API hẹp. Main kiểm tra sender frame/URL và schema input. Không expose shell/file access tổng quát.
- Catalog không chứng minh model hỗ trợ tool calling. HTTP nội bộ được hỗ trợ theo cấu hình; dùng HTTPS khi truyền key qua mạng.
- Source dùng làm context sau khi nối runtime có thể đi tới gateway/provider. Native shell chưa được cấp ở WW-1; không xem chọn folder là sandbox hệ điều hành.

## Kiểm tra phát triển

```powershell
npm run typecheck
npm test
npm run test:native
npm run build
```

Các test dùng SQLite/thư mục tạm và gateway HTTP loopback tổng hợp, không dùng API key thật hoặc gọi model. Kiểm tra: input IPC sai, migration/persistence/draft, catalog model ID, redirect không theo, phản hồi sai định dạng và lỗi auth không lộ credential. `test:native` chạy Electron main không mở cửa sổ để kiểm tra SQLite binary, mã hóa/giải mã safeStorage và xác nhận key tổng hợp không xuất hiện plaintext trong file DB/WAL.

## Phạm vi tiếp theo

[WW-2](../../plan/windows-worker/phase-2-execution.md) nối runtime/session/event/Run/Stop. [Kế hoạch đầy đủ](../../plan/windows-worker/README.md) gồm WW-1 đến WW-5. App này độc lập với ASF web; không cần build image hoặc deploy lại các VM.
