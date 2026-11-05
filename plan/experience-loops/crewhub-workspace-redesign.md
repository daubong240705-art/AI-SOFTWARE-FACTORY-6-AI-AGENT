# Phương án tổ chức lại trải nghiệm ASF theo bộ ảnh CrewHub

Ngày: 05/11/2026. Baseline `5624560`, Worker `1.3.0-alpha.8`, SQLite 14. **R0–R2 đã hoàn thành; R3–R7 là kế hoạch.** [Baseline R0](../../docs/windows-worker/workspace-r0-baseline.md), [bàn giao R1](../../docs/windows-worker/workspace-r1-completion.md), [bàn giao R2](../../docs/windows-worker/workspace-r2-completion.md). Đọc trực tiếp 11 ảnh trong `crewhub/`, source Worker và kế hoạch UX-01–08. Không xác minh runtime CrewHub từ ảnh; ảnh chỉ chứng minh bố cục/nội dung được thể hiện. Các nhận định về ASF dưới đây dựa trên source, chưa phải kết quả usability test với người dùng.

## 1. Quyết định chính

Chuyển từ cách tổ chức theo màn hình kỹ thuật sang **dự án → công việc → trao đổi/thực hiện/kết quả**. Lead là điểm vào thống nhất; một công việc có một nơi để đọc yêu cầu, trả lời câu hỏi, theo dõi agent và xem kết quả. Những view khác chỉ mở đúng hồ sơ này.

Ưu tiên cải tổ bố cục và vòng giao việc trước khi tiếp tục timer/UI của UX-08. Giữ storage lịch hiện có. Không viết lại runtime, thêm orchestrator/service, đổi sang WSL, nối Jira/OpenProject/GitLab Server hoặc tiếp tục 3D. Full access, evidence gate, budget, tối đa hai lane tương thích và một active run toàn app tiếp tục giữ.

Đây là bước sửa trải nghiệm trên nền tính năng đã có, không phải xây lại UX-01–07. `design.md` là định hướng trước đó; tài liệu này thay các quyết định về điều hướng, vị trí Chat/Kết quả và hồ sơ công việc khi triển khai đợt mới. Lịch UX-08 chỉ tiếp tục ở R6 sau khi shell/hồ sơ mới dùng được.

## 2. Những gì bộ ảnh cho thấy

| Ảnh trong `crewhub/` | Quan sát | Áp dụng cho ASF |
|---|---|---|
| `image copy 8.png` | Dashboard, Waiting on you, Team và danh sách project; ô nhập rõ người nhận; việc chờ nằm cạnh hoạt động | Phân biệt phạm vi toàn app và project; đưa Cần xử lý lên vị trí cố định; giao việc có đích rõ |
| `image.png` | Hồ sơ ticket: yêu cầu/câu hỏi ở vùng chính, ngữ cảnh phụ ở cạnh, hành động ở header | Câu hỏi và kết quả phải đọc được ngay trong hồ sơ; inspector kỹ thuật là lớp sâu hơn |
| `image copy.png` | Trao đổi người/Lead theo thời gian, liên kết về ticket | Không để tab Trao đổi chỉ là sổ ghi chú trong khi Lead sống ở màn khác |
| `image copy 5.png` | Board với chat dock và ngữ cảnh project | Giữ Board/List một trang, chỉ một vùng Chat/chi tiết mở tại một thời điểm |
| `image copy 4.png` | Nhóm phiên, Lead/worker con, trạng thái và lý do chờ | Hiện execution thật dưới công việc đang chạy; role rảnh nằm phần phụ |
| `image copy 6.png` | Danh sách report có tiêu đề và nội dung tóm tắt | Thêm điểm vào Kết quả theo project, không bắt tìm report theo run kỹ thuật |
| `image copy 7.png` | Git có overview/history/PR/issues | Dùng Git local đã có; PR/issues chỉ khi có nhu cầu và quyền, không tạo tab rỗng |
| `image copy 2.png`, `image copy 9.png` | Tạo project và setup theo bước | Kiểm tra điều kiện trước yêu cầu đầu tiên; hướng dẫn gắn đúng lỗi, không lặp checklist dài |
| `image copy 3.png` | Automation graph dày đặc | Hoãn graph; lịch dạng danh sách là đủ cho ASF lúc đầu |
| `image copy 10.png` | Tổng hợp chat/report/lịch/Git/setup | Tham khảo sự liên kết tính năng; không coi các ảnh nhỏ là bằng chứng cơ chế đã hoạt động |

Giữ Segoe UI, palette/token và component của ASF. Viết độc lập, không chép source/CSS/ảnh nhận diện CrewHub vào sản phẩm. Khảo sát giấy phép trước đó ở `research.md` ghi classic/World AGPL; không suy ra giấy phép Loops hoặc quyền tái phân phối ảnh. Ảnh do người dùng cung cấp chỉ là tài liệu tham khảo, không gom vào commit của ứng dụng.

## 3. Chẩn đoán từ source hiện tại

| Vấn đề | Bằng chứng hiện tại | Tác động | Cách xử lý |
|---|---|---|---|
| Điều hướng trộn phạm vi | `App.tsx`: Hộp thư toàn app đứng cùng Tổng quan/Chat/Board/Team theo project; project chỉ ở popover header | Dễ hiểu nhầm mọi trang đang theo cùng project | Sidebar toàn app + danh sách project; project có tab riêng |
| Công việc và chat chưa trở thành một vòng | `sendChat` cho phép không có workContext; `submitBoard` đi đường khác | Giao việc từ Chat có thể chỉ là run; thiếu hồ sơ lâu dài/mã để quay lại | Khi quyết định thực thi, tạo/link work item đúng một lần; chat tư vấn vẫn là hội thoại |
| Trao đổi trong hồ sơ chỉ là ghi chú | `WorkItemPanel` lưu comment rồi yêu cầu sang Tổng quan/Gửi Lead; mở hội thoại bằng nút riêng | Gõ trao đổi nhưng không nhận phản hồi dễ bị hiểu là agent không hoạt động | Composer ghi rõ `Nhắn Lead` hoặc `Ghi chú`; Nhắn Lead dùng ChatHost hiện có |
| Câu hỏi không ở hồ sơ chính | `QuestionCards` hiện trong ChatHost; panel chỉ có Tổng quan/Trao đổi/Lần thực hiện | Cần rời hồ sơ để trả lời điều đang chặn chính công việc đó | Render cùng QuestionSet ngay trong hồ sơ và deep link từ Cần xử lý |
| Kết quả khó tìm | `WorkReport` trong Lần thực hiện sau chọn run; Chat có panel Kết quả; inspector riêng | Không rõ đọc đâu là kết quả cuối | Tab Kết quả của hồ sơ + danh sách Kết quả theo project |
| Nhiều đường tới chi tiết | WorkItem dialog, Chat detail panel và TaskInspector có luồng khác nhau | Dễ mất định hướng, nháp/focus/selection khó quản lý | Một detail host, có Back theo ngữ cảnh, không mở nhiều pane cạnh nhau |
| Composer có quá nhiều quyết định | ChatHost luôn có chế độ, model, quyền, cấu hình; direct còn role | Người dùng phải hiểu runtime để giao một việc đơn giản | Mặc định Lead tự điều phối; model/role direct ở Tùy chọn; quyền vẫn thấy ngắn gọn |
| Kết quả/tình trạng chưa dùng chung nhãn | Run completed, board review/done, report verification/acceptance là những trục khác nhau | “Xong” dễ bị hiểu đã test/đã nghiệm thu | Một projection trình bày thống nhất, vẫn bảo toàn từng trục dữ liệu |
| Tổng quan ít lời nhưng chưa phải nơi bắt đầu làm việc | ProjectOverview: readiness, active, attention, kết quả/milestone; không có composer inline | Người dùng phải đổi trang để bắt đầu | Home có ô giao việc dùng cùng ChatHost và việc cần xử lý |
| Hộp thư không giống danh sách thông báo thuần | GlobalInbox chứa quyền/câu hỏi/report/lỗi/queue, có seen riêng | “Đã đọc” có thể bị nhầm đã giải quyết | Đổi tên Cần xử lý, badge đếm actionable; đã xem là dấu phụ |
| Lịch mới là storage | UX-08 U8-01–02, chưa timer/IPC/UI | Không được đưa lên menu như tính năng đã sẵn sàng | Giữ code; hoàn thiện sau shell mới, chưa thêm tab rỗng |
| Team đang xoay quanh bảy role | Monitor dữ liệu thật, role enabled/model/executions; tối đa hai lane | Danh sách role chưa trả lời ngay “ai đang làm việc gì cho tôi” | Công việc → agent đang làm → lý do chờ; các role sẵn sàng gom bên dưới |

Điểm đã có cần giữ: work revision/submission/attempt, câu hỏi có cấu trúc, kết quả bất biến, retry lineage, draft/dedup, ảnh/Mermaid, Git local, retention, kiểm soát workspace, model/profile snapshot. Không viết thêm bản tương đương.

## 4. Kiến trúc điều hướng đề xuất

```text
Sidebar toàn app                 Khi chọn một project
  Trang chính                     Tên project / trạng thái hiện tại
  Cần xử lý [N]                   Công việc | Trao đổi | Kết quả | Khác
  Đội ngũ                         Khác: Git, Lịch (khi hoàn thiện), Thiết lập dự án
  DỰ ÁN
    ASF                           Trong Công việc: Board / Danh sách
    ITCare                        Trong Kết quả: bộ lọc trạng thái, không thêm History ngang cấp
    + Thêm dự án
  Cài đặt                         Header chung: tìm công việc + Tạo công việc
  Công cụ nâng cao
```

`Trang chính`, `Cần xử lý`, `Đội ngũ` có phạm vi toàn app và ghi rõ. Chọn project mở Công việc, giữ view/filter/scroll đã dùng. Project không có việc mở empty state với Giao việc hoặc Trao đổi Lead. Không bắt chọn project trước khi đọc Cần xử lý; bắt chọn đích trước khi gửi công việc mới.

Header chỉ giữ tìm kiếm theo mã/tiêu đề và một nút `Tạo công việc`. V1 tìm trong project hiện tại; ở toàn app chọn project hoặc dùng query tổng hợp bounded, không giả tìm được full-text mọi lịch sử. Không thêm command palette riêng trong đợt đầu.

Chat được giữ làm trang **Trao đổi** trong project và dock theo ngữ cảnh. Danh sách hội thoại chỉ xuất hiện ở trang Trao đổi/menu chọn hội thoại; không cạnh tranh với danh sách project trên toàn sidebar. Dock có thể mở từ công việc/Team/kết quả; chuyển dock ↔ toàn màn hình dùng một ChatHost, giữ nháp/ảnh/IME/vị trí đọc.

Menu cũ `Văn phòng` đưa vào Công cụ nâng cao và tiếp tục ghi thử nghiệm; `Lịch sử` trở thành chi tiết các lần thực hiện/bộ lọc kỹ thuật trong Kết quả. Chạy local và workspace tích hợp nằm trong công cụ project/kết quả có liên quan, không phụ thuộc người dùng tìm trong Chat.

## 5. Bố cục từng nơi

### Trang chính

- Ô nhập gọn: chọn project, nội dung, ảnh, Gửi. Dùng chung lifecycle gửi/draft; không tạo một send service riêng. Bản mặc định cao khoảng 120–160px, không chiếm nửa màn hình.
- Bên cạnh: Cần xử lý, tối đa năm mục; mỗi mục tên công việc + lý do + một action (Trả lời/Xem lỗi/Xem kết quả). Badge tổng lấy query thật, không chỉ độ dài trang đầu.
- Dưới: Đang thực hiện (một active run, tối đa hai agent ở lane) và Kết quả mới (năm mục). Hoạt động nằm sau, chỉ các mốc bàn giao/chờ/lỗi/kết thúc.
- Khi chưa có project: Chọn thư mục → kiểm tra điều kiện bắt buộc → giao việc đầu tiên. Không greeting lớn, biểu đồ năng suất giả hoặc bảy card agent trống.

### Công việc

Giữ sáu cột hiện có để không đổi nghĩa trạng thái và evidence gate. Cột cố định theo viewport, header đứng yên, cuộn từng cột; không kéo cột theo card dài. Chỉ tiêu đề, mã, agent đang phụ trách, trạng thái chặn và số tiêu chí cần thiết xuất hiện trên card. Bộ lọc nâng cao trong một popover, pagination không chiếm hàng riêng nếu chỉ có một trang.

Click card mở hồ sơ. Màn rộng có side panel; từ công việc dài có mở toàn trang. Khi đã mở hồ sơ, dock Chat dùng cùng vùng bên phải, có Back về hồ sơ; không để Board + hồ sơ + Chat + inspector cùng mở.

### Hồ sơ công việc — điểm quan trọng nhất

Header: mã, tiêu đề, trạng thái, một action chính theo tình huống và menu phụ. Mặc định bốn tab:

| Tab | Nội dung chính | Nội dung chỉ mở khi cần |
|---|---|---|
| Yêu cầu | Mô tả, tiêu chí, ảnh tham khảo, câu hỏi đang chờ, thông tin mới ảnh hưởng yêu cầu | Revision history, gợi ý role, ưu tiên nâng cao |
| Trao đổi | Hội thoại Lead đúng work item + revision; ghi chú riêng có nhãn rõ | Hội thoại khác, comment cũ phân trang |
| Tiến độ | Kế hoạch ngắn, task/phụ thuộc, agent hiện tại, lý do chờ và mốc thực hiện | Model/scope/worktree/attempt/chi tiết lệnh |
| Kết quả | Thay đổi đã làm, file, kiểm tra đạt/lỗi/chưa chạy, còn thiếu, bước tiếp | Raw output, provenance, metrics, export |

Câu hỏi open hiện ngay phía trên nội dung Yêu cầu; có thể trả lời tại chỗ bằng QuestionCards dùng cùng API submit/draft. Ở Trao đổi chỉ hiện link/tóm tắt nếu câu hỏi đã được hiển thị ở hồ sơ, tránh hai form cùng mount và tranh draft writer. Quyền tool nằm trong action sheet riêng khi thực sự có request.

Hành động thay theo trạng thái: nháp `Giao Lead`; đang chạy `Xem tiến độ` và Dừng trong vùng rõ ràng; thiếu thông tin `Trả lời`; lỗi `Xem cách tiếp tục`; có kết quả `Xem kết quả`; cần sửa `Yêu cầu sửa`. Chấp nhận chỉ hiện khi policy yêu cầu nghiệm thu. Không có nút Done tùy ý ghi đè technical verification.

### Trao đổi với Lead

Giữ trải nghiệm chat tự nhiên. Mặc định chỉ ô nhập, ảnh, chip ngữ cảnh, chip quyền, nút gửi/dừng. Chọn model hoặc Một agent/role nằm trong menu Tùy chọn và nhớ cấu hình; model đang dùng vẫn xem được, không bắt chọn lại mỗi lần gửi.

Hiển thị rõ `Trao đổi dự án` hay `W-0042`; đổi ngữ cảnh không kéo theo âm thầm nội dung project khác. Dưới phản hồi có một link `Mở công việc` nếu có hồ sơ và menu Sao chép/Chi tiết. Khi model trả kế hoạch hiển thị bản tóm tắt + task đang chạy, không raw JSON. Trạng thái tin: Đã lưu/Chờ lượt/Đang xử lý/Có phản hồi/Lỗi; “Có phản hồi” không có nghĩa công việc đã xác minh.

Giữ Enter gửi/Shift+Enter xuống dòng/IME hiện có; không đổi shortcut chỉ vì ảnh CrewHub dùng Ctrl+Enter. Có thể thêm preference về sau.

### Đội ngũ

Phần trên là cây thực thi thật: project → W-xxxx → Lead → các task BE/FE/TEST đang chạy/chờ. Mỗi dòng trả lời: ai, làm việc gì, đang làm gì, bao lâu và chờ gì. Model nằm một dòng metadata hoặc mở chi tiết. Agent rảnh/tắt/chưa cấu hình vẫn phân biệt, gom ở phần “Có thể nhận việc”.

Không dựng host từ tên role. V1 chỉ máy hiện tại, một Controller; không sidebar máy remote không tồn tại. Không nút dừng từng agent khi API chỉ dừng được cả run. Không gọi role có model là online. Team toàn app dùng summary active run + dữ liệu gần nhất bounded, không monitor fan-out từng project.

### Kết quả, Git và thiết lập

Kết quả có danh sách theo project: tên việc, thời điểm, đã kiểm tra/chưa kiểm tra/lỗi và mở report mới nhất. Lịch sử attempt nằm trong hồ sơ. Run tư vấn không xuất hiện như deliverable phần mềm nhưng vẫn đọc lại trong Trao đổi/lịch sử kỹ thuật.

Git giữ read-only, history/diff đang có. Chưa thêm PR/issues, commit/push button hoặc vẽ branch graph không có dữ liệu. Setup gộp ba nhóm: Model & quyền; Runtime & công cụ; Dữ liệu. Readiness chỉ nổi khi thiếu điều kiện bắt buộc; khi ổn thu về một dòng hoặc không hiện trên nội dung hằng ngày.

## 6. Quy tắc chọn thông tin

| Hiện ngay | Thu gọn/mở khi cần | Chuyển sang kỹ thuật |
|---|---|---|
| Mục tiêu, trạng thái công việc, ai đang làm, lý do bị chặn, yêu cầu cần người dùng | Kế hoạch chi tiết, các lần chạy, file diff, Git branch, model | run/execution/session UUID, schema, profile hash, raw routing |
| Kết quả, kiểm tra pass/fail/not-run, source/revision cũ ảnh hưởng kết quả | Tiêu chí đầy đủ, nguồn bằng chứng, lệnh local, metrics/token | Token streaming/tool chatter/heartbeat, toàn bộ paths/runtime dump |
| Full access đang chọn, lỗi môi trường ngăn gửi, lỗi cần thao tác | Thông tin quyền và cấu hình nâng cao | Debug logs/stack trace |

Không “giấu hết trong dấu ba chấm”: Cần xử lý/Kết quả/Tiến độ phải có tên rõ. Chỉ action hiếm/metadata nằm sâu. Cắt văn bản ở card nhưng giữ đầy đủ lý do quan trọng trong hồ sơ. Thông tin thiếu và thông tin cũ phải có nhãn, không lấp bằng câu khẳng định của model.

## 7. Thống nhất trạng thái và hành động

Thêm selector/projection thuần `WorkStateView` và `AvailableAction[]` từ dữ liệu thật; không tạo bảng trạng thái song song. Ví dụ:

| Điều kiện | Nhãn chính | Action |
|---|---|---|
| Chưa submit | Chưa làm / Sẵn sàng | Giao Lead |
| Follow-up waiting/held | Chờ lượt / Tạm giữ · lý do | Xem hàng chờ / Chạy tiếp khi capability cho phép |
| Có run/task active | Đang làm · agent hiện tại | Xem tiến độ |
| QuestionSet open | Cần bạn trả lời | Trả lời |
| Permission còn chờ theo policy ask | Chờ cấp quyền | Xem yêu cầu |
| Terminal + chưa đủ evidence | Có kết quả · Chưa xác minh | Xem kết quả |
| Technical verified + policy required | Chờ nghiệm thu | Xem và chấp nhận / Yêu cầu sửa |
| Technical verified + không cần nghiệm thu, hoặc decision accept đúng revision | Hoàn thành | Xem kết quả |
| Lỗi/interrupted/integration-pending | Cần xử lý · lý do cụ thể | Xem lỗi / Kiểm tra tiếp tục / Mở bản tích hợp |

Khi revision/source đã đổi, report cũ có nhãn kết quả phiên bản trước và action nghiệm thu đúng policy hiện có. Project đổi/giao diện stale phải chặn thao tác không còn xác thực. Không dùng từ “bị chặn” cho role rảnh hoặc công việc chưa đến lượt.

## 8. Cơ chế agent nên thay đổi

### A. Làm ngay cùng đợt trải nghiệm

1. **Lệnh hội thoại và công việc tách rõ bằng decision hiện có.** Giữ reply/questions/plan của Lead. Khi plan được Controller chấp nhận và chưa có work item, tạo/link hồ sơ idempotent trước dispatch; request/run/submission tham chiếu cùng lineage. Không biến mọi lời chào/câu hỏi thành ticket. Không tạo hồ sơ cho toàn bộ lịch sử cũ.
2. **Một cách gửi cho cùng công việc.** Gửi từ trang chính, Trao đổi, hồ sơ hoặc Board đều đi qua admission của Controller và idempotency đã có. Không handler UI nào tự launch agent. Cần transaction bảo toàn work item/revision/submission/queue; lỗi rollback không có run ma.
3. **Lead nói ngắn nhưng đủ.** Khi nhận yêu cầu thực hiện: kết quả dự định + cách làm ngắn; khi xong: thay đổi + kiểm tra + phần còn thiếu. Model chịu trách nhiệm nội dung, trạng thái chạy/xong lấy Controller. Không gọi model thêm chỉ để viết feed.
4. **Progress dùng event có nghĩa.** Suy ra các mốc: nhận việc, làm rõ, giao task, thực hiện, kiểm tra, sửa, chờ bạn, kết thúc. Lấy tool observation đang có để viết dòng cụ thể như “FE đang sửa màn đăng nhập”; grouping/dedup event thuần. Không hiển thị reasoning/chain of thought hoặc phần trăm suy đoán.
5. **Giao đúng ít role nhất.** Profile Lead đã yêu cầu điều này; bổ sung kiểm tra kế hoạch với tập ca thực tế, không chỉ đổi prompt. PM/BA chỉ khi cần, TEST theo rủi ro/tiêu chí; giữ evidence gate và trần fix/budget hiện tại. Model dựa vào agent settings đã chọn, không tự fallback/đổi credentials.
6. **Bàn giao có cấu trúc.** Task/result summary gồm thay đổi, checks với refs, còn thiếu và blocker. Reuse TeamTask/evidence/report; thêm field tối thiểu/version nếu thật sự thiếu. Người dùng đọc cùng bản tóm tắt trong hồ sơ, không copy lại log vào comments.

### B. Xử lý tin nhắn trong lúc agent đang chạy

Hiện một active run toàn app khiến follow-up chờ; đây là cơ chế thật, không chỉ lỗi UI. Giai đoạn đầu:

- “Đang làm đến đâu?” và “ai đang làm?” hiển thị ngay từ projection thực tế, không cần gọi Lead/model hay chen thêm run.
- “Dừng” dùng action Controller trực tiếp trên run đã xác định, không queue một lời nhắn để mong model dừng.
- Yêu cầu bổ sung/sửa phạm vi được lưu receipt và hiện “Đã ghi nhận · áp dụng ở lượt tiếp theo”. Không nói agent đã đọc hoặc đã đổi code khi chưa thực thi.
- Câu “tiếp tục” gắn work item và queue/attempt phù hợp, tránh lấy ngẫu nhiên run gần nhất ở project khác. Nếu có nhiều đích hợp lệ, hỏi đúng một lựa chọn.

Luồng trò chuyện model riêng trong khi coding đang chạy chỉ nghiên cứu sau nếu bốn hành vi trên vẫn không đủ. Cần read-only, budget riêng, không dispatch/modify/source race, thể hiện rõ context snapshot; không tăng số coding run hoặc thêm orchestrator chỉ để chat nhanh.

### C. Bộ kỹ năng/tool

Đóng gói các quy tắc giao tiếp, triển khai, kiểm chứng, handoff vào profile/skills đang có; không marketplace/framework mới. Nếu Lead cần dữ liệu hồ sơ, dùng context builder bounded: requirement revision, câu trả lời đã gửi, report summary, active task và refs. Không mở SQL/IPC/filesystem tùy ý cho model. Công cụ cần bổ sung chỉ là action allowlist có project/version/idempotency, do Controller kiểm tra.

## 9. Dữ liệu/API và phạm vi sửa

| Phần | Tái sử dụng | Bổ sung tối thiểu |
|---|---|---|
| Shell | `App.tsx`, ui tokens/Select/Popover | Tách AppShell/ProjectShell và state điều hướng có project/work ref; không tạo hệ router phức tạp |
| Work view | board/work revisions/submissions, questions, reports | `WorkStateView`/action capability và detail host chung |
| Chat | ChatHost/sendChat/drafts/chat_requests | Một composer; liên kết work item tự động sau decision plan; chuyển view không remount writer |
| Cần xử lý | Inbox storage + seen token | Actionable counts riêng unread, filter project/type, ref work item/tab để mở đúng nơi |
| Home/Team | RuntimeView, monitor projection, observation | Summary toàn app bounded, active run + danh sách gần nhất; không N monitor/poller |
| Kết quả | Reports immutable + WorkReport | Index list theo project, cursor, summary không trả patch/command output toàn bộ |
| Lịch | Schedule/Delivery schema14 | Tiếp tục U8-03–05 sau core UX; đặt trong Khác của project |

R1 chỉ đổi presentation/navigation, không migration. R2–R4 tái dùng entity; nếu cần thêm link/index phải migration kế tiếp có backup và test. Không reset DB hoặc dọn dữ liệu thật trong đợt này. Không đánh giá khả năng truy vấn toàn app bằng một `runtime.runs` giới hạn 50 rồi gọi đó là đầy đủ.

## 10. Bộ base UI áp dụng xuyên suốt

- Một hệ token; body 14px, meta 12–13px, input/button 14px; heading trang khoảng 22px. Segoe UI có tiếng Việt. Không chữ hoa/microcopy trang trí hoặc text xám quá mờ cho thông tin quan trọng.
- Sidebar 220–240px, header khoảng 52–56px, tab khoảng 40px, control 34–36px; khoảng cách bội 4/8. Một tiêu đề trang, một primary action cho một vùng.
- Từ 1200 CSS px có nội dung + một side panel khoảng 420–480px khi đủ chỗ. Dưới ngưỡng đó hồ sơ/dock chuyển full-content với Back, không ép ba cột. Board tự cuộn ngang, không tràn toàn cửa sổ.
- Menu/dropdown dùng primitive tùy biến hiện có: căn icon/label, focus/Arrow/Escape/outside click, neo không vượt viewport. Dialog/side panel trả focus đúng trigger. Tab có keyboard/ARIA đúng.
- Trạng thái dùng chữ + icon + màu; tương phản chữ mục tiêu ≥4.5:1, control/focus ≥3:1. Số liệu stale có nhãn; loading/error/empty không làm layout nhảy.
- Mỗi pane một scroll owner; header/composer không cuộn mất. Cửa sổ nhỏ/zoom vẫn đọc lý do/câu hỏi, thao tác gửi/dừng không bị che.

## 11. Kế hoạch triển khai và nghiệm thu

| Đợt | Công việc cụ thể | Xong khi | Ước lượng công sức |
|---|---|---|---|
| R1 — Shell | Sidebar toàn app/project, tab project, nhãn/mapping navigation, ẩn tiện ích phụ đúng chỗ | Mọi chức năng cũ truy cập được; project/draft/filter/scroll/focus không mất; chưa đổi runtime/DB | 1–2 ngày |
| R2 — Hồ sơ (đã hoàn thành) | Bốn tab, câu hỏi tại chỗ, ChatHost theo work item, kết quả dễ thấy, detail host chung | Fixture production Electron đạt; chi tiết và giới hạn trong bàn giao R2 | 2–3 ngày (ước lượng ban đầu) |
| R3 — Lead và trạng thái | WorkStateView/capabilities, auto-link hồ sơ khi plan, progress mốc và follow-up rõ đích | Không ticket cho tư vấn; không duplicate khi retry/restart; nhãn đúng evidence; không tăng quyền/budget | 2–3 ngày |
| R4 — Home/Team/Kết quả | Summary toàn app, actionable badge, Team execution tree, report list, Git/tools đúng ngữ cảnh | Mở đúng việc cần xử lý ≤2 thao tác; tìm đúng kết quả không cần biết run ID; không fan-out polling | 2–3 ngày |
| R5 — Tinh gọn composer/setup | Mặc định Lead, menu advanced, một chip quyền, setup chia nhóm/readiness theo lỗi | Repo sẵn sàng giao việc không cần chọn role/model lại; direct vẫn dùng được; Full access không bị Accept lặp | 1–2 ngày |
| R6 — Lịch | Tiếp tục U8-03–05 trong shell mới, lỗi/retention/timer/preview/IPC/UI | Pause/resume/missed/dedup/quota hoạt động; mặc định tắt; không shell/model từ lịch | 2–3 ngày |
| R7 — Hoàn thiện | Layout/keyboard/tiếng Việt/long content, regression/perf, docs/commit | Các luồng chính đạt, không tràn/che control, không false completed, không mất nháp | 1–2 ngày |

Tổng sơ bộ **11–18 ngày công**, không phải thời gian model chạy hoặc lịch cam kết. Có thể bàn giao R1 rồi R2 riêng, không cần chờ tất cả. Checkpoint trước mỗi đợt; commit nhỏ theo kết quả đã kiểm chứng. Không tiếp tục mở rộng UX-08 độc lập trước khi R1–R5 ổn.

Không ép R2 gom cả migration mới và toàn bộ prompt upgrade một commit. Nếu auto-link plan đụng transaction/run lifecycle, làm sau presentation và có regression riêng. Không import dữ liệu hoặc ảnh tham khảo vào production.

## 12. Kiểm chứng cần có

1. Ba bài dùng thử chính: giao yêu cầu mới; trả lời một câu hỏi đang chặn; tìm kết quả và yêu cầu sửa. Mỗi bài có tiêu chí định lượng về thao tác và không mất ngữ cảnh.
2. Ma trận trạng thái: nháp/waiting/held/running/questions/permission/failed/interrupted/integration-pending/completed-unverified/verified/accepted/superseded/stale. Cả project đang chọn và active run thuộc project khác.
3. SQLite thật: migration/link/idempotency/rollback/restart, immutable report, queue claim, revision conflict; giữ tất cả giới hạn runtime hiện hành.
4. UI Electron fixture: 1366×768, 850×700, zoom 125%/150%; bàn phím/IME, tên project dài, câu hỏi dài, bảng/diff/code/ảnh/Mermaid, dialog/menu gần đáy. Screenshot/log chỉ cache local.
5. Typecheck, format, build và test liên quan từng lát cắt. Toàn suite khi thay shared lifecycle/schema. Chỉ gọi DeepSeek Flash thật qua 9Router cho ca thay decision/handoff, ghi kết quả thực tế riêng; không gọi model để kiểm CSS.
6. Hiệu năng: một ChatHost writer/feed, query summary có limit/cursor, output nặng lazy load, không request HTTP ngoài cho ảnh/diagram. Mốc mục tiêu mở hồ sơ local ≤300ms trên fixture 500 work item/2.000 run; đo trước/sau cùng máy, không tuyên bố đã đạt trước khi đo.

## 13. Thứ tự khuyến nghị

**R1 — Shell và điều hướng** và **R2 — Hồ sơ công việc** đã triển khai. Tiếp theo sửa liên kết chat/agent và trạng thái ở R3, rồi kết nối Home/Team/Kết quả. Giữ lịch schema14 nhưng hoãn phần tự chạy đến R6.

Ngoài phạm vi R0–R2 đã ghi trong bàn giao, các màn hình và cơ chế đề xuất còn lại chưa có trong bản build hiện hành.

## 14. Chi tiết để bắt đầu triển khai

### Mapping chức năng hiện tại

| Hiện tại | Đích mới | Phạm vi / quy tắc |
|---|---|---|
| Hộp thư | Cần xử lý | Toàn app; actionable và đã xem là hai trục riêng |
| Tổng quan | Trang chính | Toàn app; không âm thầm dùng project cuối làm phạm vi |
| Chọn project ở header | Danh sách project trong sidebar | Chọn project mở Công việc; giữ filter/scroll theo project |
| Trò chuyện | Trao đổi của project và dock | Dùng một ChatHost; hội thoại dự án và hội thoại công việc có nhãn riêng |
| Board / Danh sách | Hai view trong Công việc | Giữ sáu cột và quy tắc evidence hiện tại |
| WorkItemPanel / Chat detail / TaskInspector | Một detail host | Hồ sơ công việc là lớp đầu; execution/tool là drill-down có Back |
| Đội ngũ theo project | Đội ngũ toàn app | Active run thật trước, role có thể nhận việc sau; không gọi role đã chọn model là online |
| Report trong từng run | Kết quả của project và hồ sơ | Chỉ report thuộc revision hiện hành mới dùng cho action nghiệm thu hiện hành |
| Git / Lịch sử / Văn phòng | Khác / Công cụ nâng cao | Git thuộc project; History vẫn truy cập được; Văn phòng giữ nhãn thử nghiệm |
| Thiết lập | Model & quyền / Runtime & công cụ / Dữ liệu | Readiness đưa tới đúng lỗi; không lặp checklist đã đạt |

### Các trường hợp cần giải quyết trước R3

- **Câu hỏi trước khi có plan:** khi tạo từ `Tạo công việc`, item đã tồn tại nên câu hỏi thuộc item/revision. Khi trao đổi dự án chưa có item, bộ câu hỏi vẫn nằm trong hội thoại và Cần xử lý; entry này mở đúng hội thoại. Chỉ khi có plan thực thi hợp lệ mới link item, source run/questions/continuation theo lineage. Link bổ sung không ghi đè snapshot revision cũ hoặc sao chép đáp án sang một bộ mới không có nguồn.
- **Plan được chấp nhận:** hook phải được Controller gọi và hoàn tất lưu/link trước task coding đầu tiên; không dựa vào renderer nhận event `PLAN_ACCEPTED` rồi tạo hồ sơ. `coordinator.ts` hiện ghi event trước dispatch, nên callback/admission cần có khả năng chờ transaction và trả lỗi. Crash sau lưu nhưng trước dispatch phải có đường recovery idempotent trong Controller hiện có. Nếu thiếu điều kiện, dừng task trước khi sửa source và hiện lỗi cụ thể.
- **Item đã có context:** dùng `chat_requests.work_item_id`, work snapshot và submission/attempt hiện có; không materialize item mới cho cùng request/root lineage. Retry do lỗi kỹ thuật giữ cùng submission; yêu cầu sửa được người dùng gửi là continuation có định danh riêng. Không dùng timestamp hoặc title để dedup.
- **Chưa có item trong lịch sử:** projection run-only vẫn đọc được. Chỉ materialize khi người dùng thật sự cần hồ sơ; không chuyển mọi chat/run cũ thành backlog.
- **Nhắn trong lúc bận:** receipt xác nhận đã lưu, không khẳng định agent đã đọc. UI nêu project/item đích, lý do chờ và action hủy hàng chờ khi API hỗ trợ. Đổi trang không đổi nội dung request đã lưu.
- **Câu hỏi đang chờ + dữ liệu stale:** không chọn một nhãn để che mất cảnh báo còn lại. `WorkStateView` có status chính, blocker/action list và freshness riêng; stale vô hiệu hóa mutation cho tới khi revalidate. Permission, câu hỏi, integration conflict và verification là các trục khác nhau; action luôn do Controller xác thực lại.

### Source và acceptance của R1–R3

| Hạng mục | Source chính | Acceptance quan trọng |
|---|---|---|
| Shell | `src/App.tsx`, `src/styles.css`, `src/ui/*` | Điều hướng toàn app không buộc có project; project đổi không mất nháp; mọi chức năng cũ còn đường vào |
| Detail host | `src/features/WorkItemPanel.tsx`, `TaskInspector.tsx`, `ChatHost.tsx`, `QuestionCards.tsx`, `WorkReport.tsx` | Một panel chính, một composer writer, một question draft writer; đóng trả focus về đúng trigger |
| State view | `shared/board.ts`, `shared/overview.ts`, `shared/inbox.ts`, `electron/controller/board.ts`, `monitor.ts` | Matrix run/revision/evidence/acceptance/stale cho cùng nhãn và capability ở mọi view |
| Admission/link | `electron/controller/runs.ts`, `electron/team/coordinator.ts`, `electron/storage/database.ts`, `board.ts`, `chat-requests.ts` | `reply` không tạo item; `plan` link đúng một lần trước coding; retry/restart/duplicate không tạo item/run thứ hai |
| Lead context/handoff | `agent-profiles/lead.md`, `electron/team/handoff.ts`, `review-context.ts`, `shared/team.ts`, `shared/work-context.ts` | Tận dụng prompt hiện có; context giới hạn theo item/revision; report giữ evidence nguồn; không thêm model call cho feed |

Tên file mới chỉ chốt khi triển khai; không bắt buộc dùng router/dependency mới hoặc đổi các enum nội bộ chỉ để đổi tên hiển thị.

### Bước đầu của R1

1. Kiểm tra Git diff, giữ nguyên file người dùng/ảnh tham khảo; tạo checkpoint cho code đã có và commit kế hoạch riêng nếu cần. Không dùng `git add .` cho workspace đang có tài liệu/ảnh chưa track.
2. Tách state điều hướng toàn app/project và header/sidebar thành component nhỏ; vẫn giữ business handler hiện có. Định nghĩa rõ Back/open item/project/conversation để R2 dùng tiếp.
3. Di chuyển menu theo bảng mapping; chưa thêm query Home/Team toàn app, report index hoặc timer vào commit shell. Nếu một view cần API chưa có, giữ phạm vi hiện hành và ghi rõ cho tới R4 thay vì giả dữ liệu toàn app.
4. Chuyển project/tab/dock sau khi flush draft; preserve ảnh, IME, selection và scroll. Không gắn ChatHost với `key=page` làm remount writer mỗi lần đổi view.
5. Typecheck/build và kiểm tra layout có liên quan; regression hiện có nếu đổi lifecycle. Không gọi model thật để kiểm chứng điều hướng/CSS.

### Tiêu chí trải nghiệm định lượng

Các con số dưới đây là mục tiêu nghiệm thu, chưa phải số đo đã đạt:

| Bài dùng thử | Đích / cách tính |
|---|---|
| Bắt đầu việc trong repo đã sẵn sàng | Chọn project, nhập nội dung, Gửi; không cần chọn lại mode/role/model |
| Xử lý một câu hỏi | Từ Cần xử lý mở đúng item/hội thoại trong một thao tác; trả lời và gửi ngay tại đó |
| Xem kết quả | Project → Kết quả → report; tối đa hai thao tác từ project, không nhập run ID |
| Biết ai đang làm gì | Đội ngũ hiển thị agent, công việc, mốc hiện tại và lý do chờ trên cùng dòng; task chưa bắt đầu không bị báo đang chạy |
| Yêu cầu sửa | Từ report gửi yêu cầu sửa cùng item, giữ report trước và thấy receipt của continuation |
| Trò chuyện khi đang chạy | Trạng thái được đọc từ snapshot; dừng gọi action trực tiếp; yêu cầu bổ sung có receipt chờ lượt rõ ràng |
| Nháp và ngữ cảnh | Đổi view/project rồi quay lại giữ đúng nháp/ảnh; không gửi nhầm project hoặc work revision |

### Trạng thái bàn giao phương án

Đã đối chiếu bộ ảnh trong `crewhub/` với source hiện tại và xác định thay đổi UI/lifecycle tối thiểu. R0 có checkpoint `c8c81f9`; R1 đã triển khai shell; R2 hoàn thành hồ sơ bốn tab/detail host chung và kiểm chứng production Electron, xem bàn giao liên kết đầu trang. Đội ngũ vẫn theo project và Home tối thiểu; summary toàn app và Kết quả index ở R4. Phác thảo trước đó dùng dữ liệu minh họa, không phải bằng chứng runtime.

Kiểm tra riêng bản phác bằng Chromium: các viewport 1024/736/320px ở light/dark không có horizontal overflow hoặc lỗi JavaScript. Đã thử mở hồ sơ, bốn tab, chọn/gửi câu trả lời, cập nhật actionable count, giữ nháp tiếng Việt khi đổi tab và không đưa nháp công việc sang hội thoại dự án. Receipt khi bấm Gửi nêu rõ đây là bản phác, chưa gửi tới agent. Bản phác và kết quả kiểm tra ở `.cache/asf-research/`, đã được Git ignore; không phải bằng chứng các luồng ứng dụng đã hoàn thành. Báo cáo tham chiếu local: `asf-workspace-preview-check.json`.
