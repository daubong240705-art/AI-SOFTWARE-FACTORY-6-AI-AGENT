# ASF Windows Worker

**Bản phát triển V1.2C (`1.2.0-alpha.3`)** có tùy chọn **Cài đặt → Thực thi nhóm → Hai task độc lập · workspace riêng**. Mặc định vẫn tuần tự. Tối đa hai task có scope không chồng lấn chạy đồng thời trong worktree riêng; kết quả được gộp vào worktree tích hợp rồi mới chạy dependency và TEST. Review cần bằng chứng trên source hợp nhất. Conflict giữ dữ liệu, không tự ghi đè. Trong **Thay đổi/Kết quả**, chọn **Mở bản tích hợp** để tiếp tục bằng tuần tự hoặc một agent. Hàng chờ cũ giữ lại vì vẫn trỏ source gốc. Request/deadline dùng chung, quyền/session/event tách theo execution. Nghiệm thu DeepSeek Flash còn lỗi review ref/giới hạn output; chưa chốt stable hoặc tăng tốc. [Bàn giao V1.2C](../../docs/windows-worker/v1.2c-completion.md), [các đợt V1.2](../../plan/v1.2/README.md).

Tab **Workspace** vẫn hỗ trợ tạo/mở/phục hồi/dọn Git worktree. Repo bẩn, chưa có commit, submodule, Git filter hoặc project nằm trong owned workspace sẽ bị chặn khi tạo task workspace. Dependencies, ignored files và credential không được sao chép; agent cần chuẩn bị dependency trong worktree nếu cần. [Giới hạn worktree](../../docs/windows-worker/v1.2a-completion.md).

V1.1: chat theo project, Lead và sáu vai trò qua OpenCode 1.19.5 + 9Router, Full access, checkpoint và tiếp tục công việc sau gián đoạn, quản lý cây tiến trình Windows, lệnh npm/preview local, xuất báo cáo và dọn lịch sử. Xem [phạm vi V1.1](../../plan/v1.1/VERSION_SCOPE.md) và [báo cáo hoàn thiện](../../docs/windows-worker/v1.1-completion.md).

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
6. Chọn **Cuộc trò chuyện mới** hoặc mở phiên bên trái. Nhập yêu cầu, chọn **Lead** / **Một agent**, role và model trong composer. Lead có thể chào hỏi, giải thích, trao đổi ý tưởng hoặc hỏi phần còn thiếu; khi có yêu cầu thực hiện và đủ ngữ cảnh sẽ phân công. Enter gửi, Shift+Enter xuống dòng; bộ gõ IME không bị gửi ngoài ý muốn. Settings/profile/skill/quyền được snapshot vào run; chỉ một run hoạt động toàn app.
7. Chọn **Hỏi trước khi chạy** hoặc **Full access** ngay dưới ô chat (cũng có trong Cài đặt → Runtime & công cụ). Chế độ hỏi quyền hiển thị **Cho phép/Từ chối**; Full access tự duyệt lệnh và không cần bấm từng lần. Shell chạy bằng tài khoản Windows của bạn; role, scope, deny secret và request/deadline vẫn giữ, shell không phải OS sandbox. Lead/PM/BA vẫn không shell và TEST vẫn chỉ đọc source. Đổi lựa chọn áp dụng cho lượt mới; lượt đang chạy/hàng chờ giữ snapshot, hàng chờ khác cấu hình cần gửi lại. Nút hình vuông dừng runtime và cây tiến trình; nút gửi hoặc Enter thêm yêu cầu vào hàng chờ khi đang chạy. Có **Sửa/Xóa** trước khi thực thi. Sau thành công chạy tiếp tuần tự; lỗi/hủy/mở lại app giữ hàng chờ để chọn **Chạy tiếp**. **Thử lại · lượt mới** dùng yêu cầu cũ và cấu hình hiện tại, giữ nguyên lỗi và kết quả lần trước. Chat hiển thị dần câu trả lời; câu trả lời ngắn có thể chỉ hiện khi kết thúc do bộ lọc giữ đuôi dữ liệu. Nhánh quyết định Lead giữ JSON nội bộ đến khi parse xong, không stream JSON vào chat.
8. Bấm **Hoạt động**, **Thay đổi** dưới phản hồi hoặc nút mở panel ở góc phải. Chọn file để xem diff theo dòng; **Trong lượt/Có sẵn** tách phần sửa sẵn, chọn staged/source để xem Git snapshot. Có sao chép patch và mở vị trí file. **Xem trước khôi phục → Khôi phục file này** trả về nội dung trước run, giữ Git index; thay đổi mới gây xung đột và được giữ nguyên. Panel Kết quả có lệnh/CWD/thời gian/exit code/output; đóng panel để tập trung chat.
9. Bấm tên phiên để đổi tên; tìm kiếm bên trái hỗ trợ tiếng Việt có/không dấu và không phân biệt hoa thường. Bản nháp lưu riêng mỗi phiên. Hội thoại dài có **Xem tin nhắn trước**; lịch sử run cũ vẫn mở được từ **Lịch sử**.
10. Với lượt gián đoạn/thất bại, mở **Kết quả → Kiểm tra để tiếp tục**. App đối chiếu hash source, Git HEAD/index và process còn lại. **Tiếp tục · attempt mới** tạo lượt có liên kết và ngữ cảnh cũ, dùng cấu hình hiện tại; agent kiểm tra lại phần đã làm, không nối lại session hay tự replay lệnh. Source đổi sau bước kiểm tra hoặc snapshot chưa đủ sẽ chặn tiếp tục. Lượt gián đoạn có thể chọn **Kết thúc lượt gián đoạn**, giữ kết quả/source.
11. Mở panel **Chạy local**, chọn script trong `package.json`, xem lệnh rồi bấm **Chạy**. Mỗi lần chỉ một lệnh local; **Dừng lệnh** kết thúc cả cây tiến trình. **Mở preview** chỉ hiện khi output có URL loopback. App không tự thêm host LAN hoặc tự mở trình duyệt. Có thể giữ server khi agent chạy; dừng local command trước khôi phục file/phiên. Đóng app khi còn công việc có lựa chọn tiếp tục hoặc dừng rồi đóng.
12. Trong **Kết quả**, **Xuất báo cáo** lưu JSON đã che credential, kèm task/model/checkpoint/lệnh và toàn bộ event còn lưu (tối đa 2.000/run). **Chi tiết kỹ thuật** có lọc loại sự kiện/tìm task và số event. Trong **Lịch sử → Dọn lịch sử cũ**, xem trước rồi xóa lượt hơn 30 ngày; giữ ít nhất 20 lượt gần nhất, lượt active/gián đoạn/hàng chờ và các lượt còn được tham chiếu. Chỉ dọn lịch sử/evidence/blob trong SQLite; không xóa source hoặc runtime cache của OpenCode.

Đóng cửa sổ bản cũ đang mở rồi chạy `npm start` để nạp main/preload mới.

Bỏ project khỏi danh sách không xóa source hoặc hội thoại. Mở lại lịch sử của project đã bỏ vẫn đọc được; cần chọn lại source trước khi gửi yêu cầu. Không tự init Git, stash, reset, commit hoặc push.

**Một agent** dùng đúng profile, model và quyền của role đã chọn, kể cả khi có lịch sử chat: Lead/PM/BA chỉ đọc, không shell; TEST chỉ đọc source và chạy lệnh theo chế độ quyền; BE/FE/DEVOPS được sửa source trong phạm vi. Chọn BE/FE/DEVOPS hoặc **Lead** khi cần viết code. Lead trong chat trực tiếp trả lời bình thường; JSON quyết định/plan/review chỉ dùng nội bộ khi Controller điều phối. Nếu lượt chỉ đọc có thay đổi source hoặc thiếu snapshot, app báo **Cần bổ sung**, giữ diff để kiểm tra và không chạy tiếp hàng chờ tự động.

## Dữ liệu và credential

- SQLite đặt trong `app.getPath('userData')`, trên Windows thường là `%APPDATA%\ASF Windows Worker\worker.sqlite`.
- Database schema v6 thêm snapshot/blob, bản dự phòng khôi phục và artifact lệnh; giữ conversation/message/run/task/hàng chờ. Trước nâng schema5 có `worker.schema5.backup.sqlite`; backup các phiên bản trước vẫn giữ. Run gián đoạn ghi interrupted, hàng chờ giữ để người dùng chủ động chạy tiếp. Không tự replay khi mở app. Snapshot cấu hình khác hiện tại thì hàng chờ báo cần xóa/gửi lại, không âm thầm chọn model khác.
- Key mới chỉ tồn tại tạm trong ô password để gửi qua IPC, không đưa vào React state, localStorage hoặc trả lại từ main process. Sau lưu/navigate, ô nhập bị xóa. SQLite chỉ giữ ciphertext do Electron safeStorage tạo; không có fallback plaintext.
- Đổi origin gateway yêu cầu nhập key mới hoặc xóa key cũ. Catalog cũ bị xóa khi đổi gateway/CA/key. Không tự theo redirect mang Authorization.
- TLS luôn xác minh. CA PEM được thêm vào trust mặc định cho catalog và model proxy; không sửa trust store Windows.
- Renderer sandbox/context isolation, không Node integration; preload chỉ expose API hẹp. Main kiểm tra sender frame/URL và schema input. Không expose shell/file access tổng quát.
- Catalog không chứng minh model hỗ trợ tool calling. HTTP nội bộ được hỗ trợ theo cấu hình; dùng HTTPS khi truyền key qua mạng.
- Source dùng làm context có thể đi tới gateway/provider. Chỉ dùng repo tin cậy: shell chạy bằng tài khoản Windows, không xem chọn folder là sandbox hệ điều hành. Không cấp admin/SSH/deploy hoặc tự commit/push.
- Mỗi task dùng một OpenCode session/server tuần tự, bind loopback, Basic auth random, config/data/cache riêng. Tắt project config, formatter tự động, plugin/MCP/skills bên ngoài và provider khác; không sửa cấu hình global. Controller là nơi điều phối duy nhất, tắt native delegation.
- API key 9Router giữ ở parent proxy; child chỉ nhận token execution tạm, token vô hiệu khi run kết thúc. Proxy pin model, hạn mức request vật lý, giới hạn output mỗi request và không theo redirect. Không cấp provider key qua argv hoặc environment child.
- Snapshot giới hạn 8.000 entry, 48 MB mỗi lần chụp, 1 MB/file; Git content tối đa 100 file dirty/16 MB. Bỏ dependency, secret file và symlink; source có mẫu credential chỉ giữ hash. UI báo đường dẫn/lý do khi snapshot thiếu, không khôi phục file thiếu snapshot. Source đổi trong lúc Lead chỉ đọc sẽ giữ phản hồi/đề xuất, báo cần kiểm tra và không giao tiếp plan cũ; không gán mọi thay đổi cho agent. Khôi phục dùng hard link tạo mới trên NTFS; không thay thế file mới đang tồn tại. File tạm dự phòng còn lại khi lỗi được giữ để xử lý.
- Windows Job Object bao toàn bộ runtime, npm/test/server con; tạo child suspended rồi gắn job trước khi chạy, đóng pipe khi Stop và kill-on-close khi host/app crash. Metadata dùng tên job ngẫu nhiên, không nhận lại hoặc kill theo PID cũ. Cần Windows PowerShell 5.1 với `Add-Type`; nếu chính sách máy chặn helper, app báo lỗi và không chạy công việc mới. Chưa có installer tự đóng gói helper; dùng checkout hiện tại qua `npm start`.
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
- Handoff chỉ chuyển dependency liên quan, giữ task ID gốc/lần thực thi và lệnh đúng attempt; ưu tiên blocker/lệnh lỗi, ghi rõ phần bị cắt trong packet tối đa 32.000 ký tự. Báo cáo task gồm Trạng thái/Kết quả/Blocker/Chưa xác minh; văn bản cũ vẫn giữ nguyên. Đây là thông tin bàn giao, chưa phải chứng nhận evidence. UI liên kết task, role, model, session, scope, phụ thuộc, kết quả và blocker. TEST không được tính hoàn thành nếu thiếu lệnh có exit 0.
- Deadline và request cap dùng chung toàn run, kể cả lập kế hoạch, sửa JSON và review. JSON sai chỉ được sửa thêm một lần mỗi bước. Tối đa hai vòng sửa code theo cài đặt; chỉ sửa task được Lead chỉ định và chạy lại kiểm tra/phụ thuộc liên quan. Lần thất bại trước được giữ nguyên trong lịch sử.
- DEVOPS hỗ trợ local build/package/cấu hình và cách chạy. Preview chạy lâu dài có quản lý tiến trình thuộc WW-4; ở WW-3 không tách server nền, không SSH/deploy.

Lượt thật **Lead → BE → FE → TEST → Lead** với `ds/deepseek-v4-flash` hoàn thành trong **18 request**, sửa đúng ba file sản phẩm, `npm test` exit 0. [Bằng chứng WW-3](../../docs/windows-worker/ww3-completion.md). Chạy lại có chủ đích bằng `node scripts/run-acceptance.cjs team`, cần `NINE_ROUTER_API_KEY` trong môi trường cha; dùng DB acceptance riêng, có gọi model và sửa source thật. Prompt mặc định tạo helper đã có nên cần thay `ASF_TEAM_PROMPT` bằng công việc mới khi chạy lại.

Thử thật 04/11/2026 qua chính Controller/Electron với **`ds/deepseek-v4-flash`**: tạo `formatDuration.ts` và test trong source sản phẩm, 5 request, `npm test` exit 0. Lượt Dừng kết thúc 4 process thuộc cây runtime, không còn process con. Xem [bằng chứng WW-2](../../docs/windows-worker/ww2-completion.md). Các script `scripts/run-acceptance.cjs` là thao tác live chủ động, có gọi model và sửa hai file nêu trên; không nằm trong `npm test`, không tự chạy khi mở app.

## Phạm vi tiếp theo

[WW-4C đã hoàn thành](../../docs/windows-worker/ww4c-completion.md): diff/history, Git snapshot staged/source, khôi phục từng file và bằng chứng lệnh. Giữ streaming, hàng chờ, retry và context có tham chiếu file/command/AC. Lượt cũ không có snapshot chỉ hiện danh sách file, không lấy source hiện tại thay lịch sử.

V1.1 đã bàn giao preview/phục hồi/retention và ownership AU-4B. WW-5 bộ cài, resize panel nâng cao và benchmark so sánh AU-5 còn lại. [Kế hoạch đầy đủ](../../plan/windows-worker/README.md). App độc lập với ASF web; không cần build image hoặc deploy lại các VM.

[AU-1 hoàn thành](../../docs/windows-worker/au1-completion.md): profile/policy thống nhất direct/team, prompt bàn giao và version/hash theo nội dung; 43/43 test, typecheck/build/format đạt. [Kế hoạch nâng cấp agent](../../plan/agent-upgrade/README.md).

[AU-2A hoàn thành](../../docs/windows-worker/au2a-completion.md): handoff dependency/review có cấu trúc, giới hạn context, không thêm bước gọi model; 48/48 test, typecheck/build/format đạt.

[AU-2B hoàn thành](../../docs/windows-worker/au2b-completion.md): team chỉ completed khi mọi AC có evidence hợp lệ của attempt mới nhất. ID AC phân biệt cả tiêu chí trùng chữ; lệnh cần exit 0, output lưu đúng session và source còn nguyên. File/command mở từ từng AC trong Kết quả, lấy nội dung đã lưu. Thiếu evidence thì Chưa xác minh/Cần bổ sung. Lịch sử cũ giữ nguyên và ghi rõ chưa xác minh; schema vẫn v6. Validator kiểm tra identity/hash/phiên bản, Lead kiểm tra sự liên quan với yêu cầu. Catalog evidence giới hạn 12 ref/task và 24.000 ký tự, có số mục bị lược bỏ. Lệnh chỉ đọc bù từ lịch sử hoặc source thay đổi trong lúc chạy không tự được coi là đã xác minh.

[AU-3 hoàn thành](../../docs/windows-worker/au3-completion.md): profile nền tách khỏi skill; docs/analysis dùng rule nền, triển khai dùng implement-feature/testing, sửa lỗi dùng fix-bug/testing, DEVOPS local dùng local-dev/testing. Lead có thể đề xuất skill ID phù hợp trong catalog bốn skill; Controller kiểm tra role/capability và giới hạn ba skill/task. Direct cũng chọn theo yêu cầu. Catalog và lựa chọn được lưu cùng nội dung/version/hash; sửa file skill sau khi tạo run không đổi task đang chờ. Lịch sử cũ giữ profile đã lưu, không tự gán skill mới. Trong chi tiết task/Kết quả direct có tên và phiên bản skill. Giữ quyền tool/model/scope, external discovery vẫn tắt.

[AU-4A hoàn thành](../../docs/windows-worker/au4a-completion.md): lỗi có nhãn cụ thể, giữ nguyên nhân đầu tiên; từ chối quyền kết thúc lượt chạy. Proxy ngừng gửi request upstream sau lỗi gateway, hết budget hoặc model không khớp; không tự thử lại task hay đổi model. Kết quả và chi tiết task có request, lệnh đạt/lỗi/chưa hoàn tất, token của các bước runtime đã ghi nhận. Token thiếu và chi phí hiện chưa có số liệu; history cũ không bị coi là 0. Thời gian lưu theo run/task khi kết thúc. Reopen giữ interrupted và hàng chờ; [V1.1 bổ sung ownership/recovery AU-4B](../../docs/windows-worker/v1.1-completion.md). Không cần migration schema6.

[Cải thiện Lead, Hoạt động và quyền](../../docs/windows-worker/lead-chat-access-completion.md): Lead có nhánh trả lời ngay trong lần quyết định đầu, không thêm request phân loại; Hoạt động chỉ hiện task thực tế và tối đa năm lệnh gần nhất, log request/session/token nằm trong **Chi tiết kỹ thuật**. Task mở để xem metadata, tab Kết quả giữ đầy đủ bằng chứng. Có Full access theo snapshot. 79/79 test, checks phát triển/native và kiểm tra giao diện Electron với dữ liệu giả lập đạt; chưa gọi model thật trong đợt này. Chạy lại kiểm tra UI sau build bằng `node scripts/run-acceptance.cjs interaction-ui`; ảnh và database thử nằm trong `.cache/asf-research/interaction-ui/`, không dùng DB hoặc key của người dùng.
