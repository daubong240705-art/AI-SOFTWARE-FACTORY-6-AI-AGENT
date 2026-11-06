# Worker V2 — Trải nghiệm sử dụng

> **Thiết kế lịch sử:** yêu cầu mới được hợp nhất tại [Factory V2 — design reference](../../../../plan/factory-v2/design-reference.md). Giữ palette/Segoe UI hoặc giản lược tab bên dưới không còn là quyết định hiện hành; dùng chín ảnh thực tế, màu CrewHub và rubric trên 90%.

Thiết kế đề xuất. Mục tiêu: người dùng hiểu việc đang diễn ra, biết ai đang xử lý và chỉ thấy hành động cần thiết. Tham khảo luồng CrewHub Loops; dùng component/token riêng của ASF, không đưa 3D vào đợt này.

Mở rộng đa lĩnh vực trong [multidomain.md](multidomain.md): phần dưới dùng nhãn **Đầu ra** thay cho tab **Tài liệu**; tài liệu là một bộ lọc đầu ra. Project có Git hoặc không; agent state và job render state được hiển thị riêng.

Chuẩn Loops mới trong [loops-parity.md](loops-parity.md) mở rộng project navigation: Tổng quan / Công việc / Đầu ra / Tự động hóa / Khác; Chat Lead ở dock hoặc full view khi cần. Tự động hóa có Rules [List/Graph], Lịch và History, theo [thiết kế automation](automations.md). Sơ đồ điều hướng tối giản bên dưới là nền, không bỏ các nghiệp vụ mở rộng.

## 1. Điều hướng

```text
Sidebar toàn app                   Project đang mở
  Tổng quan                       [Tên dự án]          [+ Công việc]
  Cần xử lý [số việc]              Công việc | Chat | Đầu ra
  Đội ngũ                         Khác: Git, Lịch, Thiết lập dự án
  Dự án
    Project A                     Công việc: Board / Danh sách
    Project B                     Chat: Lead + liên kết task
    + Thêm dự án                  Đầu ra: tài liệu / ảnh / âm thanh / video / source
  Cài đặt
    Kết nối runtime
    Skills & Tools
    Quyền & dữ liệu
```

“Kết nối” và “Skills & Tools” là trang con Cài đặt có deep link từ Agent editor. Không đặt cùng một nút điều hướng ở sidebar, header, card và thanh tab. Đội ngũ toàn app cho quản lý agent; trong dự án chỉ có bộ lọc/thành viên liên quan.

Tổng quan hiển thị việc đang chạy, việc cần quyết định, dự án gần đây và composer giao việc cho Lead của dự án đã chọn. Không đẩy log/tool trace hoặc các card số liệu kỹ thuật lên đầu trang.

## 2. Thiết lập lần đầu

1. **Thêm kết nối**: chọn Codex/Claude Code/OpenCode; phát hiện executable và version; cấu hình xác thực bằng cơ chế runtime hỗ trợ; hiển thị trạng thái từng bước.
2. **Tạo đội**: dùng mẫu hoặc tạo agent; chọn tên, nhiệm vụ, connection/model. Một agent hợp lệ đủ để bắt đầu; không bắt tạo đủ đội.
3. **Chọn project/workspace**: chọn mẫu lĩnh vực hoặc Tự do, gắn repo nếu cần hoặc chọn thư mục/artifact-only; chọn Lead và thành viên, bộ quyền và concurrency.
4. **Giao việc**: nhập mục tiêu; Lead trả lời và tạo task có liên kết khi cần thực thi.

Không dồn toàn bộ cấu hình nâng cao thành một form dài. Skill/tool là tùy chọn có thể bổ sung sau; lỗi thiếu model/auth phải chỉ tới đúng connection. Không hiện “Sẵn sàng” chỉ vì CLI có trong PATH.

## 3. Đội ngũ và agent editor

Mỗi card: tên, nhiệm vụ ngắn, runtime/model, trạng thái thực tế, task hiện tại hoặc lần hoạt động gần nhất. Thao tác chính “Mở”; menu phụ cho sửa/nhân bản/tạm ngưng/lưu trữ. Không làm cả card thành một bảng cấu hình nhiều nút.

| Trạng thái | Căn cứ | Nội dung người dùng thấy |
|---|---|---|
| Chưa sẵn sàng | Thiếu CLI/auth/config | Lý do và đường dẫn sửa |
| Sẵn sàng | Agent bật, connection dùng được, chưa giữ task | Có thể nhận việc |
| Đang làm | Claim hợp lệ và execution được xác nhận | Task + bước gần nhất |
| Đang chờ | Có task nhưng chờ dependency/quota/câu trả lời | Chờ gì, ai có thể xử lý |
| Bị chặn | Có lỗi cần quyết định/sửa cấu hình | Lỗi cụ thể và một hành động phù hợp |
| Đã tắt | Agent disabled/archived | Không nhận việc mới |

Không gọi mọi agent “online” khi không có process. Trong V2 session thường tạo theo nhu cầu; “Sẵn sàng” không nghĩa một model đang chạy nền. Có freshness timestamp khi trạng thái kết nối chưa được đối chiếu lại.

Agent editor chia **Thông tin**, **Runtime & model**, **Skills & tools**, **Quyền & giới hạn**. Role là text/tags; model là custom dropdown theo connection, cho nhập ID khi catalog không hỗ trợ discovery và có nhãn chưa xác minh. Có preview cấu hình sẽ áp dụng cho lượt mới; lượt đang chạy giữ snapshot.

## 4. Công việc và Board

Một card đại diện một task thực, không phải một role chung chung. Card có mã, tiêu đề, agent nhận việc, trạng thái/lý do chờ, dependency ngắn và số đầu ra. Task con được nhóm dưới mục tiêu cha nhưng vẫn mở được riêng. Bộ lọc agent cho thấy chính xác các task của agent đó.

Các cột gợi ý: **Chưa làm / Sẵn sàng / Đang làm / Chờ / Kiểm tra / Hoàn thành**; lỗi/cancel có bộ lọc riêng. Cột cao theo viewport, cuộn nội dung trong cột; header cố định, không kéo dài toàn trang vì một cột nhiều task. Kéo card không được bỏ qua điều kiện dependency hoặc giả task đã Done; server trả action hợp lệ và reason.

Task detail có một vùng chính và sidebar ngắn:

```text
[Mã + tiêu đề]                    [Trạng thái] [menu]
Yêu cầu | Trao đổi | Đầu ra        Agent / runtime
                                  Dependency / đang chờ gì
Nội dung đang chọn                Contract/source đang dùng
                                  Tiêu chí hoàn thành

Hoạt động kỹ thuật [thu gọn]
```

Yêu cầu có đầu vào, phạm vi và acceptance rõ, không in nguyên JSON kế hoạch. Đầu ra gom tài liệu, file/commit và test report. Technical inspector có run ID, tool call, stream và timing khi cần debug. Không mở nhiều panel chi tiết/chat chồng cạnh nhau; ở màn nhỏ dùng full detail view.

## 5. Chat với Lead và trao đổi agent

Chat mặc định nói chuyện với Lead của dự án. Câu hỏi tư vấn được trả lời tự nhiên; chỉ tạo task khi có ý định thực thi. Thiếu thông tin mới cần hỏi, không biến mọi yêu cầu thành một biểu mẫu cứng.

Sau khi giao việc, Lead trả ngắn: đã tạo những task nào, ai làm, điều kiện chạy và cần người dùng quyết định gì. Task cards trong chat mở đúng hồ sơ công việc. Streaming trạng thái chỉ hiện một dòng gọn; command output không tràn vào hội thoại.

Agent-to-agent messages hiện trong task thread hoặc timeline chuyên dụng, có người gửi/nhận và contract liên quan. Không trộn mọi tin nội bộ thành lượt Chat của người dùng. Mở thread từ badge “Cần trao đổi”; có thể đọc đầy đủ khi cần.

Hủy một tin đang gửi, dừng execution và hủy task là ba hành động khác nhau, nhãn và kết quả phải rõ. UI không hiển thị “Đã dừng” khi process vẫn chưa được xác nhận đã kết thúc.

## 6. Đầu ra, tài liệu BA và kết quả

Trang Đầu ra nhóm theo loại và công việc: tài liệu, ảnh, âm thanh, video, dữ liệu và source. Nhóm tài liệu gồm yêu cầu, data model/ERD, API contract, quyết định và báo cáo kiểm thử. Mỗi đầu ra có version, tác giả agent, thời gian, source/input/task liên quan, danh sách task đang dùng và nút xuất.

Xem Markdown/Mermaid/JSON/OpenAPI với renderer phù hợp và tùy chọn source. Không cắt nội dung thiết kế chỉ còn summary. Version history/diff là thao tác phụ; contract stale có thông báo cụ thể về task bị ảnh hưởng.

Media preview dùng poster/proxy/player và metadata thay vì mở binary vào editor text. Review notes có timestamp cho video/audio; job progress ở task detail, tách trạng thái agent. Không xây NLE đầy đủ trong Worker. Quyết định approved chỉ áp dụng version cụ thể; sửa đầu ra cần đối chiếu lại review.

“Kết quả cần xem” chỉ xuất hiện khi cần review/ra quyết định. Tài liệu thông thường vẫn tìm được trong Đầu ra, không tự trở thành việc cần xử lý.

## 7. Cần xử lý

Chỉ có item mà người dùng có thể hành động: câu hỏi chưa trả lời, thiếu cấu hình/quyền, conflict cần quyết định, kết quả chờ review, hoặc lỗi không tự khắc phục được. Mỗi item trả lời ba điều: **việc gì đang kẹt, vì sao, cần làm gì**.

Dedup theo task/attempt/reason; retry không tạo hàng loạt lỗi giống nhau. Đã đọc không phải đã giải quyết. Hết blocker thì item tự đóng theo state; xem lại lịch sử ở hồ sơ task. Không đưa lệnh Bash đã được policy cho phép thành item Accept.

## 8. Extensions và runtime connections

Connections: danh sách theo runtime, version, trạng thái auth, provider/model và số execution đang dùng. Nút Kiểm tra chỉ làm probe theo phạm vi hiển thị; gọi model có chi phí là bước kiểm tra riêng có nội dung rõ.

Skills & Tools: hai tab, bộ lọc Installed/Enabled/Needs setup; nguồn, version/commit, giấy phép và agent đang dùng. Import wizard: chọn nguồn → preview → cấu hình → kiểm tra → cài/gắn. Dependencies/hook không tự chạy khi vừa dán URL. Không hiển thị một kho hàng nghìn tool chưa thể dùng như thể đã được cài.

Bộ mẫu lĩnh vực ở bước tạo project và trong thư viện Extensions, không thêm một trang cấu hình bắt buộc. Pack cho biết agent/workflow/tool cần có; thiếu FFmpeg/API auth/encoder thì hiện đúng phần chưa sẵn sàng. Lịch cho biết host cần hoạt động; budget hiện unknown/pending rõ ràng khi chưa đối chiếu chi phí.

Quyền là cấu hình theo profile và capability, không bảng hàng trăm toggle ngay lần đầu. Full access có mô tả phạm vi thực tế ngắn gọn; ranh giới enforced/unsupported truy cập được ở chi tiết.

## 9. Bộ nền giao diện và nghiệm thu

Tái sử dụng Segoe UI và tokens hiện có; chuẩn hóa spacing, typography, line-height, field height, card header, badges, empty/error/loading state. Dùng dropdown/menu riêng, focus/keyboard và vị trí popover đúng viewport. Nội dung chữ căn trái, số liệu/tabular khi cần; không để class của button làm text card căn giữa.

- Board/card: `min-width: 0`, wrap tên dài, badge không chèn lên nội dung; column viewport height và scroll container đúng.
- Agent grid: hàng/card cân đối, task dài không phá cột; số action cố định, overflow vào menu.
- Task detail: độ rộng đọc hợp lý, side panel không ép text; màn nhỏ chuyển một cột.
- Composer: không bị che bởi panel/footer; giữ draft khi đổi tab; send/stop trạng thái tách rõ.
- Kiểm tra thực tế tại 1366×768, 1920×1080, 850×700 và Windows zoom 150%; keyboard, contrast, screen-reader labels và dữ liệu dài/rỗng/lỗi.

Không thêm acceptance test chỉ để xác nhận class CSS. Dùng geometry và user flow thật cho overflow/alignment, cùng component tests cần thiết cho hành vi. Ảnh QA giữ ngoài Git theo quy tắc hiện có.

## 10. Automations List/Graph và loại dự án

Project type editor cho sửa ticket fields/templates, workflow labels/transitions, skills, review policy và rule presets; preview/import/export trước áp dụng. Mapping status IDs/categories và version migration có validation, không đổi label UI rồi bỏ qua host logic.

Rule List là đường cấu hình dễ đọc; Graph thể hiện moment/rule/agent/label, trạng thái Draft/Proposed/On/Off và các liên kết có ý nghĩa. Project switch tắt toàn bộ automation hiệu lực nhưng giữ On/Off riêng. Layout zoom/fit/minimap có scroll bounds; kéo node không đổi logic rule. Có inspector condition/action, simulation read-only và lịch sử vì sao rule chạy. Cạnh chưa được hỗ trợ editor chỉ đọc, không save làm mất logic.

Human-final và policy-auto hiển thị theo project/template; final review khác tool permission. Scheduled và rules có liên kết nhưng không cùng kiểu định nghĩa. Search, saved filters, parked/snoozed/archive/restore và report comments dùng cùng hồ sơ, tránh tạo trang dữ liệu riêng lẻ không liên thông.
