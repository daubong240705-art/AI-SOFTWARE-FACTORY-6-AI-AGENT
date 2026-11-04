# ASF Windows Worker

WW-4B: chat theo project, phản hồi trực tiếp, hàng chờ có thể sửa/xóa và thử lại có liên kết lịch sử. Lead phân công sáu vai trò, model riêng theo role và vòng sửa lỗi giới hạn qua OpenCode 1.19.5 + 9Router. Hỗ trợ chạy một agent, quyền shell từng lần và Dừng.

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
6. Chọn **Cuộc trò chuyện mới** hoặc mở phiên bên trái. Nhập yêu cầu, chọn **Lead tự phân công** / **Một agent**, role và model trong composer. Enter gửi, Shift+Enter xuống dòng; bộ gõ IME không bị gửi ngoài ý muốn. Settings/profile/skill được snapshot vào run; chỉ một run hoạt động toàn app.
7. Shell cần **Cho phép** hoặc **Từ chối** trên thẻ trong chat. Nút hình vuông dừng runtime và cây tiến trình; nút gửi hoặc Enter thêm yêu cầu vào hàng chờ khi đang chạy. Có **Sửa/Xóa** trước khi thực thi. Sau thành công chạy tiếp tuần tự; lỗi/hủy/mở lại app giữ hàng chờ để chọn **Chạy tiếp**. **Thử lại · lượt mới** dùng yêu cầu cũ và cấu hình hiện tại, giữ nguyên lỗi và kết quả lần trước. Chat hiển thị dần câu trả lời; câu trả lời ngắn có thể chỉ hiện khi kết thúc do bộ lọc giữ đuôi dữ liệu.
8. Bấm **Hoạt động**, **Thay đổi** dưới phản hồi hoặc nút mở panel ở góc phải. Panel chứa task/role/model/session, file thay đổi, lệnh và AC; đóng panel để tập trung chat. Diff từng dòng và local preview còn thuộc WW-4C/4D.
9. Bấm tên phiên để đổi tên; tìm kiếm bên trái hỗ trợ tiếng Việt có/không dấu và không phân biệt hoa thường. Bản nháp lưu riêng mỗi phiên. Hội thoại dài có **Xem tin nhắn trước**; lịch sử run cũ vẫn mở được từ **Lịch sử**.

Đóng cửa sổ bản cũ đang mở rồi chạy `npm start` để nạp main/preload mới.

Bỏ project khỏi danh sách không xóa source hoặc hội thoại. Mở lại lịch sử của project đã bỏ vẫn đọc được; cần chọn lại source trước khi gửi yêu cầu. Không tự init Git, stash, reset, commit hoặc push.

## Dữ liệu và credential

- SQLite đặt trong `app.getPath('userData')`, trên Windows thường là `%APPDATA%\ASF Windows Worker\worker.sqlite`.
- Database schema v5 thêm `follow_ups`, giữ conversation/message/run/task/evidence. Trước nâng schema4 có `worker.schema4.backup.sqlite`; backup các phiên bản trước vẫn giữ. Run gián đoạn ghi interrupted, hàng chờ giữ để người dùng chủ động chạy tiếp. Không tự replay khi mở app. Snapshot cấu hình khác hiện tại thì hàng chờ báo cần xóa/gửi lại, không âm thầm chọn model khác.
- Key mới chỉ tồn tại tạm trong ô password để gửi qua IPC, không đưa vào React state, localStorage hoặc trả lại từ main process. Sau lưu/navigate, ô nhập bị xóa. SQLite chỉ giữ ciphertext do Electron safeStorage tạo; không có fallback plaintext.
- Đổi origin gateway yêu cầu nhập key mới hoặc xóa key cũ. Catalog cũ bị xóa khi đổi gateway/CA/key. Không tự theo redirect mang Authorization.
- TLS luôn xác minh. CA PEM được thêm vào trust mặc định cho catalog và model proxy; không sửa trust store Windows.
- Renderer sandbox/context isolation, không Node integration; preload chỉ expose API hẹp. Main kiểm tra sender frame/URL và schema input. Không expose shell/file access tổng quát.
- Catalog không chứng minh model hỗ trợ tool calling. HTTP nội bộ được hỗ trợ theo cấu hình; dùng HTTPS khi truyền key qua mạng.
- Source dùng làm context có thể đi tới gateway/provider. Chỉ dùng repo tin cậy: shell chạy bằng tài khoản Windows, không xem chọn folder là sandbox hệ điều hành. Không cấp admin/SSH/deploy hoặc tự commit/push.
- Mỗi task dùng một OpenCode session/server tuần tự, bind loopback, Basic auth random, config/data/cache riêng. Tắt project config, formatter tự động, plugin/MCP/skills bên ngoài và provider khác; không sửa cấu hình global. Controller là nơi điều phối duy nhất, tắt native delegation.
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

## Điều phối WW-3

- Lead chọn ít role cần thiết; không tự gọi đủ sáu role. Task có AC, scope, dependency và model được kiểm tra trước khi thực thi. Không có TEST phải ghi lý do; thiếu thông tin/role/model thì kết thúc ở **Cần bổ sung**, không giữ khóa run hay tự đổi model.
- Lead/PM/BA chỉ đọc, không shell; TEST chỉ đọc và shell cần quyền; BE/FE/DEVOPS được sửa trong scope và shell cần quyền. Scope edit được chuyển về gốc Git để hỗ trợ thư mục con trong monorepo. Controller kiểm tra thay đổi source sau mỗi task; lệch scope thì dừng và giữ diff cho người dùng.
- Handoff chỉ chuyển AC, tóm tắt, file và lệnh liên quan. UI liên kết task, role, model, session, scope, phụ thuộc, kết quả và blocker. TEST không được tính hoàn thành nếu thiếu lệnh có exit 0.
- Deadline và request cap dùng chung toàn run, kể cả lập kế hoạch, sửa JSON và review. JSON sai chỉ được sửa thêm một lần mỗi bước. Tối đa hai vòng sửa code theo cài đặt; chỉ sửa task được Lead chỉ định và chạy lại kiểm tra/phụ thuộc liên quan. Lần thất bại trước được giữ nguyên trong lịch sử.
- DEVOPS hỗ trợ local build/package/cấu hình và cách chạy. Preview chạy lâu dài có quản lý tiến trình thuộc WW-4; ở WW-3 không tách server nền, không SSH/deploy.

Lượt thật **Lead → BE → FE → TEST → Lead** với `ds/deepseek-v4-flash` hoàn thành trong **18 request**, sửa đúng ba file sản phẩm, `npm test` exit 0. [Bằng chứng WW-3](../../docs/windows-worker/ww3-completion.md). Chạy lại có chủ đích bằng `node scripts/run-acceptance.cjs team`, cần `NINE_ROUTER_API_KEY` trong môi trường cha; dùng DB acceptance riêng, có gọi model và sửa source thật. Prompt mặc định tạo helper đã có nên cần thay `ASF_TEAM_PROMPT` bằng công việc mới khi chạy lại.

Thử thật 04/11/2026 qua chính Controller/Electron với **`ds/deepseek-v4-flash`**: tạo `formatDuration.ts` và test trong source sản phẩm, 5 request, `npm test` exit 0. Lượt Dừng kết thúc 4 process thuộc cây runtime, không còn process con. Xem [bằng chứng WW-2](../../docs/windows-worker/ww2-completion.md). Các script `scripts/run-acceptance.cjs` là thao tác live chủ động, có gọi model và sửa hai file nêu trên; không nằm trong `npm test`, không tự chạy khi mở app.

## Phạm vi tiếp theo

[WW-4B đã hoàn thành](../../docs/windows-worker/ww4b-completion.md): streaming, hàng chờ bền vững, retry liên kết và context tối đa bốn lượt với tham chiếu file/command/AC. Mỗi lần gửi tạo run/baseline/budget mới. Hủy/gián đoạn giữ nội dung đã nhận với trạng thái rõ. Chỉ assistant text được hiển thị; reasoning và JSON nội bộ của Lead không đưa vào chat.

WW-4C tiếp tục diff/restore; WW-4D preview/phục hồi; WW-5 bộ cài. [Kế hoạch đầy đủ](../../plan/windows-worker/README.md). App độc lập với ASF web; không cần build image hoặc deploy lại các VM.
