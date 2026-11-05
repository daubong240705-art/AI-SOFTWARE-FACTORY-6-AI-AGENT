# ASF Windows Worker

**Giao diện hiện hành:** sidebar chọn dự án, tab **Công việc / Trao đổi / Kết quả / Khác**; một hồ sơ gồm **Yêu cầu / Trao đổi / Tiến độ / Kết quả**. Chat mặc định trao đổi với Lead; role/model ở **Tùy chọn trao đổi**. Tư vấn/câu hỏi không tạo submission; kế hoạch thực thi hợp lệ mới liên kết công việc trước khi giao agent. **Bash tự động theo vai trò**, không cần Accept từng lệnh. [Bàn giao Bash tự động](../../docs/windows-worker/bash-autonomy-completion.md), [R3A](../../docs/windows-worker/workspace-r3a-completion.md), [hồ sơ R2](../../docs/windows-worker/workspace-r2-completion.md). Các mục UX bên dưới ghi lại những đợt triển khai trước; hướng dẫn quyền hiện hành thay thế Ask/Full access trong các bàn giao cũ.

**R3 đã hoàn thành:** R3B đồng nhất trạng thái chờ/tiến độ; R3C nối trạng thái báo cáo, revision/attempt và policy vào Board/Tổng quan/Đội ngũ/chat/Tiến độ. Summary ghi rõ source chưa đối chiếu; mở báo cáo để kiểm tra source và bằng chứng trước khi nghiệm thu. Board Xong cần report có bằng chứng đạt và đủ điều kiện nghiệm thu; nghiệm thu nghiệp vụ không thay kết quả kiểm chứng kỹ thuật. [Bàn giao R3C và giới hạn](../../docs/windows-worker/workspace-r3c-completion.md), [R3B](../../docs/windows-worker/workspace-r3b-completion.md). Bash tự động đã triển khai riêng.

**R4 đã hoàn thành:** Trang chính có cần xử lý/kết quả mới và chọn dự án để nhắn Lead qua ChatHost chung; sidebar có Đội ngũ toàn app và badge actionable chính xác kể cả đã xem. Tab Kết quả tìm tiếng Việt không dấu, lọc kiểm chứng, phân trang và mở đúng hồ sơ/report. Một summary feed, không polling từng project. [Bàn giao R4, kiểm chứng và giới hạn](../../docs/windows-worker/workspace-r4-completion.md).

**R5 đã hoàn thành:** Cài đặt chia **Model & quyền / Runtime & công cụ / Dữ liệu**, một nút Lưu, model dùng chung hoặc riêng từng role, nhập ID ngoài catalog. Kết nối/catalog và phiên bản công cụ chỉ kiểm theo yêu cầu, phân biệt nháp/đã lưu/đã kiểm; readiness đưa tới đúng nhóm lỗi. [Bàn giao R5](../../docs/windows-worker/workspace-r5-completion.md). Tiếp theo R6 lịch.

**UX-02** bổ sung hồ sơ công việc với mã `W-0001` theo project, yêu cầu có phiên bản, tiêu chí hoàn thành, trao đổi và lịch sử các lần thực hiện. Bấm tiêu đề thẻ để mở panel **Tổng quan / Trao đổi / Lần thực hiện**, mở rộng khi cần; **Board / Danh sách** dùng chung bộ lọc và dữ liệu. Sửa yêu cầu giữ nguyên snapshot đã gửi và các run cũ. Run-only cũ chỉ tạo hồ sơ khi chọn **Lưu thành công việc**. [Bàn giao UX-02](../../docs/windows-worker/ux02-completion.md).

**UX-03** thêm ChatHost dùng chung ở dạng thu gọn cạnh Board và toàn màn hình: giữ nháp/IME/cuộn, mã công việc + revision trước khi gửi, chống gửi trùng qua lỗi kết nối và khởi động lại. Lead nhận yêu cầu/tiêu chí/ghi chú có giới hạn; lịch sử không tự trở thành lệnh mới. [Bàn giao UX-03 và bảo trì DB](../../docs/windows-worker/ux03-completion.md).

**UX-04** thêm câu hỏi nghiệp vụ với lựa chọn/nhập tự do, required/optional và nháp lưu bền; mục **Cần trả lời** ở Tổng quan mở thẳng Chat. Gửi đáp án tạo đúng một lượt tiếp nối qua Controller/hàng chờ hiện có, revision cũ bị vô hiệu hóa. Full access không tự chọn đáp án nghiệp vụ. Đã kiểm chứng hai lượt DeepSeek Flash thật qua 9Router. [Bàn giao UX-04](../../docs/windows-worker/ux04-completion.md).

Worker giữ `1.3.0-alpha.8`, SQLite lên **14**; tự backup schema 9 thành `worker.schema9.pre-questions.backup.sqlite` và schema 10 thành `worker.schema10.pre-reports.backup.sqlite` trước migration. UX-05 đã thêm báo cáo bất biến, bằng chứng lệnh/file, nghiệm thu tùy chọn và yêu cầu sửa nối vào hàng chờ. UX-06 bổ sung bốn mẫu công việc, kiểm tra môi trường theo yêu cầu, Team dạng danh sách và hộp thư nhiều dự án có trạng thái đã đọc riêng. UX-07 bổ sung Git local chỉ đọc, diff và lịch sử bounded; không commit/push. Nâng từ schema 11 tạo `worker.schema11.pre-inbox.backup.sqlite`. [Bàn giao UX-06](../../docs/windows-worker/ux06-completion.md), [UX-07](../../docs/windows-worker/ux07-completion.md). **Tạm dừng phát triển 3D**. Sau build chạy các acceptance UI bằng fixture; không gọi model, ảnh chỉ lưu cache local. [Bàn giao UX-05](../../docs/windows-worker/ux05-completion.md).

**V1.3C (`1.3.0-alpha.3`)** thêm inspector chung: click thẻ runtime, task/execution trong Đội ngũ hoặc **Chi tiết** dưới phản hồi Chat. Chọn task/attempt để xem model thực tế, dependency, scope, workspace, tiêu chí, timeline, diff và kết quả. Timeline mặc định gọn; mở Chi tiết kỹ thuật khi cần log. Diff/output tải khi mở; nháp Chat giữ qua điều hướng. Chat/panel/inspector dùng chung feed chi tiết run. Tác vụ tuần tự mới lưu baseline trước task; lượt cũ thiếu baseline vẫn có nội dung evidence. [Bàn giao V1.3C](../../docs/windows-worker/v1.3c-completion.md). Văn phòng 3D và nghiệm thu tổng thể tiếp tục ở D–E.

**V1.3B (`1.3.0-alpha.2`)** thêm màn **Công việc**: Kanban sáu cột, backlog lưu local, tạo/sửa/lưu trữ thẻ, tìm kiếm/lọc và gửi Lead qua hàng chờ hiện có. Chỉ kéo thẻ giữa Chưa làm ↔ Sẵn sàng; thẻ thực thi tự chuyển theo Controller và bằng chứng review. Bấm thẻ để xem tiến độ và mở kết quả. Thẻ đã gửi không sửa riêng; xóa yêu cầu khỏi hàng chờ để sửa lại. Run liên kết được giữ khi dọn lịch sử; project còn thẻ chưa được bỏ khỏi danh sách. [Bàn giao V1.3B](../../docs/windows-worker/v1.3b-completion.md).

**V1.3A (`1.3.0-alpha.1`)** thêm màn **Đội ngũ** và liên kết từ Chat: xem role rảnh/đang làm/đã tắt/chưa cấu hình; task, model thực tế, thời lượng và hoạt động đọc/sửa/chạy lệnh/chờ model/chờ quyền. Hai execution cùng role được hiển thị riêng. Tiến độ xác minh tách khỏi task chỉ mới chạy xong. Snapshot dùng chung có version và cảnh báo khi chưa đồng bộ. Inspector nâng cao, timeline và 3D tiếp tục ở C–E. [Bàn giao V1.3A](../../docs/windows-worker/v1.3a-completion.md), [kế hoạch V1.3](../../plan/v1.3/README.md).

Lần mở đầu sẽ nâng SQLite từ schema 6 lên 7, giữ bản backup `worker.schema6.pre-monitor.backup.sqlite` trong thư mục dữ liệu ứng dụng trước migration. Bản app cũ không mở được schema mới; muốn quay lại cần đóng app và phục hồi backup có chủ đích. Chưa thêm bộ cài WW-5.

**Bản phát triển V1.2C (`1.2.0-alpha.4`)** có tùy chọn **Cài đặt → Thực thi nhóm → Hai task độc lập · workspace riêng**. Mặc định vẫn tuần tự. Tối đa hai task có scope không chồng lấn chạy đồng thời trong worktree riêng; kết quả được gộp vào worktree tích hợp rồi mới chạy dependency và TEST. Review dùng context gọn, bằng chứng theo từng tiêu chí và đã nghiệm thu mẫu với DeepSeek Flash ở cả hai chế độ. Conflict giữ dữ liệu, không tự ghi đè. Trong **Thay đổi/Kết quả**, chọn **Mở bản tích hợp** để tiếp tục bằng tuần tự hoặc một agent. Hàng chờ cũ giữ lại vì vẫn trỏ source gốc. Request/deadline dùng chung, quyền/session/event tách theo execution. Mẫu nhỏ chưa cho thấy song song nhanh hơn; chưa chốt stable trên repo lớn. [Báo cáo review alpha.4](../../docs/windows-worker/review-quality-completion.md), [V1.2C](../../docs/windows-worker/v1.2c-completion.md), [các đợt V1.2](../../plan/v1.2/README.md).

Tab **Workspace** vẫn hỗ trợ tạo/mở/phục hồi/dọn Git worktree. Repo bẩn, chưa có commit, submodule, Git filter hoặc project nằm trong owned workspace sẽ bị chặn khi tạo task workspace. Dependencies, ignored files và credential không được sao chép; agent cần chuẩn bị dependency trong worktree nếu cần. [Giới hạn worktree](../../docs/windows-worker/v1.2a-completion.md).

V1.1: chat theo project, Lead và sáu vai trò qua OpenCode 1.19.5 + 9Router, Full access, checkpoint và tiếp tục công việc sau gián đoạn, quản lý cây tiến trình Windows, lệnh npm/preview local, xuất báo cáo và dọn lịch sử. Xem [phạm vi V1.1](../../plan/v1.1/VERSION_SCOPE.md) và [báo cáo hoàn thiện](../../docs/windows-worker/v1.1-completion.md).

**UX-08 (đang phát triển):** đã có contract/preview và store lịch trong SQLite 14 với backup schema 13, delivery tạo backlog nguyên tử và chống tạo trùng. Chưa có timer/IPC/UI nên lịch chưa tự chạy trong app. [Bàn giao U8-01–02](../../docs/windows-worker/ux08-storage-completion.md), [kế hoạch](../../plan/experience-loops/ux08-schedules.md).

## Điều hướng hiện hành — R4

**Trang chính / Cần xử lý / Đội ngũ** thuộc toàn ứng dụng; chọn dự án trong sidebar để mở **Công việc**. Dự án có tab **Công việc / Trao đổi / Kết quả / Khác**; Khác chứa Tổng quan, Đội ngũ dự án, Git local và Văn phòng thử nghiệm. **Tạo công việc** ở header; danh sách hội thoại trong Trao đổi. Lịch sử nằm trong **Công cụ nâng cao**. Đổi tab/project giữ nháp và trạng thái Board trong phiên; lỗi lưu nháp chặn chuyển trang. [Bàn giao R0–R1](../../docs/windows-worker/workspace-r1-completion.md), [R4](../../docs/windows-worker/workspace-r4-completion.md).

Mở công việc từ Board/Git/Kết quả hoặc lượt có liên kết để xem chung hồ sơ bốn tab. Đổi tab và quay lại từ inspector giữ composer/câu trả lời; Kết quả giữ report theo revision và hỗ trợ nghiệm thu/yêu cầu sửa. Chạy `node scripts/run-acceptance.cjs workspace-summary-ui`, `work-detail-ui` hoặc `lead-access-ui` sau build để kiểm bằng fixture. R3 thống nhất projection trạng thái; R4 đưa summary toàn app và index Kết quả vào cùng luồng mở hồ sơ.

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
2. **Cài đặt → Model & quyền → Gateway**: nhập Gateway URL có API prefix (ví dụ `https://router.example/v1`), API key nếu gateway yêu cầu; CA nội bộ trong **Chứng chỉ & kết nối nâng cao**.
3. Bấm **Lưu & kiểm tra kết nối**: lưu toàn bộ nháp cấu hình rồi GET `<gateway>/models`. Không gọi model sinh code. Catalog đã lưu không chứng minh kết nối hiện tại; lỗi/rỗng/thành công có nhãn riêng. Rời trang hủy thay/xóa key chưa lưu.
4. **Model cho agent**: chọn model dùng chung rồi áp dụng cho agent đang bật, hoặc mở **Model & trạng thái từng vai trò**; Lead luôn bật. Có thể nhập model ID ngoài catalog. **Preset theo nhiệm vụ** giữ Fast/Balanced/Quality và toggle hiện tại. Áp dụng chỉ sửa nháp; bấm **Lưu cấu hình** để ghi.
5. **Runtime & công cụ**: dùng OpenCode **1.19.5**. App tìm native executable trong PATH hoặc bản cài npm global; có thể chọn `opencode.exe` thủ công. Bản khác bị từ chối để tránh sai API. Lưu đường dẫn mới trước **Đọc phiên bản**; nút này không cài công cụ hay ngầm lưu cấu hình khác. Giới hạn lượt trong phần nâng cao; dọn lịch sử có xem trước ở nhóm **Dữ liệu**.
6. Mở **Trao đổi → Danh sách hội thoại**, chọn **Cuộc trò chuyện mới** hoặc phiên đã có. Nhập yêu cầu cho **Lead**; mở **Tùy chọn trao đổi** để đổi model hoặc chọn **Một agent**. Lead có thể giải thích, trao đổi ý tưởng hoặc hỏi phần còn thiếu; các trao đổi mới này không tạo submission hay yêu cầu nghiệm thu. Khi nhận kế hoạch thực thi hợp lệ, Controller lưu/liên kết công việc trước khi giao agent. Enter gửi, Shift+Enter xuống dòng; bộ gõ IME không bị gửi ngoài ý muốn. Settings/profile/skill/quyền được snapshot vào run; chỉ một run hoạt động toàn app.
7. **Bash tự động theo vai trò**: BE/FE/TEST/DEVOPS chạy lệnh không cần Accept; Lead/PM/BA không được chạy Bash. Không còn bộ chọn Ask/Full access. Phát hiện lặp công cụ (`doom_loop`) sẽ dừng lượt và ghi lý do. Shell chạy bằng tài khoản Windows của bạn, không có OS sandbox; giới hạn tool edit/secret không giới hạn mọi tác động của shell. Request/deadline, log lệnh và nút Dừng vẫn hoạt động. Hàng chờ cũ khi bắt đầu trên bản mới cũng dùng chính sách Bash này; app không tự replay lệnh lịch sử. Nút hình vuông dừng runtime và cây tiến trình; nút gửi hoặc Enter thêm yêu cầu vào hàng chờ khi đang chạy, Lead nhận sau khi lượt hiện tại kết thúc. Có **Sửa/Xóa** trước khi thực thi. Sau thành công chạy tiếp tuần tự; lỗi/hủy/mở lại app giữ hàng chờ để chọn **Chạy tiếp**. **Thử lại · lượt mới** dùng yêu cầu cũ và cấu hình hiện tại, giữ nguyên lỗi và kết quả lần trước. Chat hiển thị dần câu trả lời; câu trả lời ngắn có thể chỉ hiện khi kết thúc do bộ lọc giữ đuôi dữ liệu. Nhánh quyết định Lead giữ JSON nội bộ đến khi parse xong, không stream JSON vào chat.
8. Bấm **Hoạt động**, **Thay đổi** dưới phản hồi hoặc nút mở panel ở góc phải. Chọn file để xem diff theo dòng; **Trong lượt/Có sẵn** tách phần sửa sẵn, chọn staged/source để xem Git snapshot. Có sao chép patch và mở vị trí file. **Xem trước khôi phục → Khôi phục file này** trả về nội dung trước run, giữ Git index; thay đổi mới gây xung đột và được giữ nguyên. Panel Kết quả có lệnh/CWD/thời gian/exit code/output; đóng panel để tập trung chat.
9. Bấm tên phiên để đổi tên; tìm kiếm trong danh sách hội thoại hỗ trợ tiếng Việt có/không dấu và không phân biệt hoa thường. Bản nháp lưu riêng mỗi phiên. Hội thoại dài có **Xem tin nhắn trước**; lịch sử run cũ vẫn mở được từ **Công cụ nâng cao → Lịch sử thực hiện**.
10. Với lượt gián đoạn/thất bại, mở **Kết quả → Kiểm tra để tiếp tục**. App đối chiếu hash source, Git HEAD/index và process còn lại. **Tiếp tục · attempt mới** tạo lượt có liên kết và ngữ cảnh cũ, dùng cấu hình hiện tại; agent kiểm tra lại phần đã làm, không nối lại session hay tự replay lệnh. Source đổi sau bước kiểm tra hoặc snapshot chưa đủ sẽ chặn tiếp tục. Lượt gián đoạn có thể chọn **Kết thúc lượt gián đoạn**, giữ kết quả/source.
11. Mở panel **Chạy local**, chọn script trong `package.json`, xem lệnh rồi bấm **Chạy**. Mỗi lần chỉ một lệnh local; **Dừng lệnh** kết thúc cả cây tiến trình. **Mở preview** chỉ hiện khi output có URL loopback. App không tự thêm host LAN hoặc tự mở trình duyệt. Có thể giữ server khi agent chạy; dừng local command trước khôi phục file/phiên. Đóng app khi còn công việc có lựa chọn tiếp tục hoặc dừng rồi đóng.
12. Trong **Kết quả**, **Xuất báo cáo** lưu JSON đã che credential, kèm task/model/checkpoint/lệnh và toàn bộ event còn lưu (tối đa 2.000/run). **Chi tiết kỹ thuật** có lọc loại sự kiện/tìm task và số event. Trong **Lịch sử → Dọn lịch sử cũ**, xem trước rồi xóa lượt hơn 30 ngày; giữ ít nhất 20 lượt gần nhất, lượt active/gián đoạn/hàng chờ và các lượt còn được tham chiếu. Chỉ dọn lịch sử/evidence/blob trong SQLite; không xóa source hoặc runtime cache của OpenCode.

Đóng cửa sổ bản cũ đang mở rồi chạy `npm start` để nạp main/preload mới.

Bỏ project khỏi danh sách không xóa source hoặc hội thoại. Mở lại lịch sử của project đã bỏ vẫn đọc được; cần chọn lại source trước khi gửi yêu cầu. Không tự init Git, stash, reset, commit hoặc push.

**Một agent** dùng đúng profile, model và quyền của role đã chọn, kể cả khi có lịch sử chat: Lead/PM/BA chỉ đọc, không shell; TEST chỉ đọc source và Bash tự động; BE/FE/DEVOPS được sửa source trong phạm vi và Bash tự động. Chọn BE/FE/DEVOPS hoặc **Lead** khi cần viết code. Lead trong chat trực tiếp trả lời bình thường; JSON quyết định/plan/review chỉ dùng nội bộ khi Controller điều phối. Nếu lượt chỉ đọc có thay đổi source hoặc thiếu snapshot, app báo **Cần bổ sung**, giữ diff để kiểm tra và không chạy tiếp hàng chờ tự động.

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

## Ảnh trong chat (UX-07)

[Bàn giao ảnh đính kèm: migration, giới hạn và kiểm chứng](../../docs/windows-worker/ux07-images-completion.md). SQLite 13; nâng từ 12 tạo `worker.schema12.pre-images.backup.sqlite`. Chọn file hoặc dán PNG/JPEG, lưu nháp, xem ảnh lớn, giữ ảnh khi xếp hàng/chạy lại và xuất báo cáo. Tối đa 4 ảnh kèm yêu cầu bằng chữ; gateway/model được chọn phải hỗ trợ đọc ảnh. Sau build chạy `node scripts/run-acceptance.cjs images-ui`.

[Mermaid](../../docs/windows-worker/ux07-mermaid-completion.md): khối mã `mermaid` có `Xem sơ đồ`, mã nguồn, sao chép và phóng to. Hỗ trợ flow/sequence/class/state/ER, nạp thư viện local khi cần, không tài nguyên bên ngoài hoặc cấu hình tùy ý. Sau build chạy `node scripts/run-acceptance.cjs mermaid-ui`. [Giấy phép](THIRD_PARTY_MERMAID_NOTICE.md).

## Kiểm tra phát triển

`1.3.0-alpha.8` hoàn thành **D-04**: click bàn hoặc nhãn để chọn agent; chọn từng task trong **Hoạt động** để mở inspector đúng execution/model/workspace. Task chờ và direct run dùng cùng inspector. **Mở trên Kanban** giữ card cha và task đang xem; nút **Văn phòng** trong inspector quay lại agent/task được đánh dấu. Hover một dòng, các nhãn/task là nút dùng được bằng bàn phím. Đổi project xóa lựa chọn. [Bàn giao D-04](../../docs/windows-worker/office-3d/d04/README.md). Sau build: `node scripts/run-acceptance.cjs office-selection-ui`; ảnh chỉ lưu local. Còn D-05 và E.

`1.3.0-alpha.7` thêm trạng thái hoạt động trong **Văn phòng**: màn hình và nhãn theo monitor chung, nhiều tác vụ cùng role, chờ quyền/phụ thuộc và số task đã xác minh. Mở **Hoạt động** để xem từng tác vụ/model; dữ liệu lỗi hoặc stale hiện Chưa đồng bộ. Nhãn tránh chồng chữ khi vùng 3D thấp. Phòng bảy vị trí vẫn có camera kéo/zoom/reset, tải riêng và đường về **Đội ngũ 2D**. D-04 chọn bàn mở inspector, D-05 animation/quality và E còn lại. [D-01/D-02](../../docs/windows-worker/office-3d/README.md), [D-03](../../docs/windows-worker/office-3d/d03/README.md), [license](THIRD_PARTY_3D_NOTICES.md). Kiểm tra sau build: `node scripts/run-acceptance.cjs office-ui` và `node scripts/run-acceptance.cjs office-state-ui`; ảnh chỉ lưu local.

Bộ nền giao diện `1.3.0-alpha.5`: [quy chuẩn typography, spacing, layout, bảng/Kanban, dropdown và checklist](../../docs/windows-worker/ui-foundation/README.md). Sau build, chạy `node scripts/run-acceptance.cjs ui-foundation` để kiểm tra bố cục production Electron ở năm cấu hình cửa sổ/zoom; không gọi model. Đặt `ASF_UI_ARTIFACT_DIR` khi cần xuất bằng chứng sang thư mục mới. [Cập nhật card/Board/dropdown](../../docs/windows-worker/ui-controls/README.md); [mốc nền alpha.4](../../docs/windows-worker/ui-foundation/completion.md).

```powershell
npm run typecheck
npm test
npm run test:native
npm run build
```

Các test mặc định dùng SQLite/thư mục tạm và gateway HTTP loopback tổng hợp, không dùng API key thật hoặc gọi model. Kiểm tra thêm run lock/cancel/reopen, redaction và model proxy pin/quota/redirect. `test:native` chạy Electron main không mở cửa sổ để kiểm tra SQLite binary, mã hóa/giải mã safeStorage và xác nhận key tổng hợp không xuất hiện plaintext trong file DB/WAL.

## Điều phối WW-3

- Lead chọn ít role cần thiết; không tự gọi đủ sáu role. Task có AC, scope, dependency và model được kiểm tra trước khi thực thi. Không có TEST phải ghi lý do; thiếu thông tin/role/model thì kết thúc ở **Cần bổ sung**, không giữ khóa run hay tự đổi model.
- Lead/PM/BA chỉ đọc, không shell; TEST chỉ đọc source và Bash tự động; BE/FE/DEVOPS được sửa trong scope và Bash tự động. Scope edit được chuyển về gốc Git để hỗ trợ thư mục con trong monorepo. Controller kiểm tra thay đổi source sau mỗi task; lệch scope thì dừng và giữ diff cho người dùng. Scope không tạo sandbox cho shell.
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
