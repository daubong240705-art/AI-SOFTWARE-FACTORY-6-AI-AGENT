# Thiết kế trải nghiệm 2D cho ASF

Trạng thái: đề xuất. Các tên component mới dưới đây chưa tồn tại trong sản phẩm. [Nguồn và đối chiếu](research.md), [backlog](implementation.md).

## 1. Điều hướng và bố cục chung

Giữ giao diện tối, chữ Segoe UI rõ ràng và accent ấm hiện có. Áp dụng sự phân cấp của Loops: project rõ ràng, nội dung chính nổi bật, thông tin phụ mở khi cần. Không thêm banner mô tả dài.

**Sidebar:** bộ chọn project/tìm project → Tổng quan → Chat → Công việc → Đội ngũ. Phần dưới: Lịch sử, Cài đặt; Văn phòng 3D nằm ở nhóm phụ, giữ chức năng đã có nhưng dừng phát triển. Chưa thêm menu Git/Lịch/Quy tắc trước khi các chức năng này thực sự triển khai.

**Header project:** tên project, branch, trạng thái thực thi ngắn; bên phải có **Tạo công việc** và **Hỏi Lead**. Full access hiển thị một chip có thể mở cấu hình, không lặp trên mọi card. Nếu run hiện tại thuộc project khác, hiện đúng project và lý do chờ slot.

**Công việc:** Board và Danh sách là hai chế độ của cùng dữ liệu, không phải hai menu chính. Tìm tiêu đề/mã, lọc trạng thái/role trước; priority, archived và các bộ lọc khác nằm trong menu Lọc. Giữ sáu cột hiện tại và ý nghĩa evidence gate; không chuyển sang năm cột chỉ để giống ảnh tham khảo.

## 2. Tổng quan: biết việc cần làm trong vài giây

Thứ tự hiển thị:

1. **Cần bạn xử lý:** quyền runtime còn chờ theo policy, câu hỏi nghiệp vụ còn mở, công việc cần bổ sung ngữ cảnh, lỗi cần quyết định khôi phục. Mỗi mục có một lý do và một hành động đúng khả năng hiện có.
2. **Đang làm:** công việc hiện tại, tối đa hai execution tương thích, hoạt động gần nhất, số tiêu chí đã xác minh. Không dùng phần trăm giả.
3. **Kết quả mới:** tối đa năm kết quả, trạng thái kiểm tra và liên kết đọc đầy đủ.
4. **Hoạt động gần đây:** start/handoff/blocked/error/finish và thay đổi đáng kể. Đọc file/token/heartbeat không xuất hiện mặc định; **Chi tiết kỹ thuật** mở feed sẵn có.

Mỗi hàng inbox: icon + loại → tên công việc → một câu lý do → tuổi yêu cầu → hành động. Badge đếm **mục cần hành động**, không đếm từng dòng log. Chỉ xóa khỏi inbox khi trạng thái đã giải quyết; “đã xem” không phải “đã trả lời”.

UX-01 chỉ tổng hợp project đang chọn từ dữ liệu sẵn có; chưa hiện giả câu hỏi/report có cấu trúc. UX-04/05 bổ sung các loại tương ứng. Inbox mọi project làm sau bằng query summary từ Controller/DB, không mở monitor cho mọi project.

Empty state gọn: “Không có việc cần bạn xử lý”. Khi mất feed: giữ snapshot cũ có nhãn “Chưa đồng bộ”, tắt hành động không còn xác thực; không biến tất cả agent thành rảnh. Loading skeleton giữ chiều cao; lỗi có Retry, không hiện stack trace mặc định.

## 3. Công việc và chi tiết

**Một công việc = yêu cầu bền vững; run = một lần thực hiện; task/attempt = phần việc của agent.** Mở rộng BoardItem hiện tại thành hồ sơ công việc, giữ UUID và links cũ. Mã dễ đọc `ASF-42` chỉ để hiển thị/tìm kiếm; không dùng thay UUID trong API.

Card mặc định chỉ gồm mã, tiêu đề tối đa hai dòng, role đang làm, trạng thái/lý do ngắn và tiến độ `3/5 tiêu chí`. Không đổ description, log, toàn bộ model hoặc nhiều badge vào card. Nhãn dư gộp `+N`; tooltip không là cách duy nhất để đọc dữ liệu quan trọng.

Panel công việc có:

- Header: mã, tiêu đề, trạng thái kỹ thuật, menu, **Hỏi Lead** và hành động chính hợp lệ.
- Tab **Tổng quan:** mô tả, tiêu chí, lý do chặn/câu hỏi nổi bật, kết quả mới nhất.
- Tab **Trao đổi:** ghi chú người dùng và quyết định nghiệp vụ; liên kết hội thoại, không nhân bản toàn bộ tool log.
- Tab **Lần thực hiện:** các run/attempt, model/workspace và link inspector hiện có.
- Tab **Kết quả:** phiên bản report, evidence/diff/test và phần còn thiếu.

Mở panel từ Board giữ nguyên filter, scroll, selected card; mở rộng toàn trang nếu cần đọc dài. Escape đóng panel về đúng card. Mở inspector kỹ thuật là chế độ chi tiết của cùng vùng bên phải, có Back về công việc; tránh chồng nhiều modal.

Không sửa tiêu chí đang áp dụng cho run cũ bằng cách ghi đè. Thay đổi tạo revision mới và snapshot cho lần chạy sau. Run cũ vẫn hiển thị bộ tiêu chí đã dùng. Retry/send back liên kết vào cùng hồ sơ, không tạo thêm card tiến độ trùng.

## 4. Chat với Lead theo ngữ cảnh

Chat toàn màn hình tiếp tục là cách làm việc chính khi cần trao đổi dài. Trong Board/công việc, nút **Hỏi Lead** mở dock bên phải, kèm chip project + công việc; có thể bỏ chip để chuyển sang trao đổi chung trước khi gửi.

Một `ChatHost` giữ conversation, draft, selection và shared feed. Dock/fullscreen chỉ thay presentation; **mỗi conversation chỉ có một composer và một draft writer được mount**. Đổi trang không làm mất draft, gửi kép hoặc mở hai phiên Lead độc lập.

Tin nhắn hiển thị trạng thái theo dữ liệu thật:

| Nhãn | Điều kiện |
|---|---|
| Đã lưu | Giao dịch lưu message thành công |
| Đang chờ | Follow-up đã nằm trong queue, chỉ rõ chờ run/project nào |
| Tạm giữ | Queue held và lý do; có hành động tiếp tục khi được phép |
| Đang xử lý | Controller đã bắt đầu run tương ứng |
| Có phản hồi | Đã lưu assistant response của run, không đồng nghĩa công việc đã hoàn thành |
| Lỗi / Đã dừng | Trạng thái thật, kèm cách thử lại/khôi phục hợp lệ |

Lead trả lời tự nhiên: kết quả/chủ đích trước, giải thích ngắn khi cần. Thông tin task JSON, schema, routing và tool call ở phần kỹ thuật. Câu hỏi tư vấn không tự trở thành công việc; yêu cầu thực hiện dùng cơ chế phân loại hiện có và hồ sơ công việc khi được tạo. Không gọi thêm model chỉ để trang trí timeline hoặc viết lời chào.

Ngữ cảnh gửi gồm ticket ID/revision, tiêu chí, quyết định đã trả lời và liên kết kết quả gần nhất, có giới hạn kích thước. Không tự đưa toàn bộ lịch sử/file/credentials vào prompt. Hiển thị ngữ cảnh người dùng đang gửi để tránh vô tình hỏi sai công việc.

## 5. Câu hỏi của Lead

Chỉ hỏi khi thiếu thông tin ảnh hưởng đáng kể đến yêu cầu, giới hạn quyền hoặc lựa chọn khó đảo ngược. Lựa chọn triển khai thông thường do Lead tự quyết trong phạm vi được giao.

Một bộ tối đa năm câu; mỗi câu có nội dung, một câu giải thích tác động, 2–4 lựa chọn nếu phù hợp, lựa chọn đề xuất và ô nhập tự do. Khuyến nghị hiển thị rõ nhưng **không tự coi là câu trả lời đã gửi**. Câu không phù hợp lựa chọn dùng text. Cho lưu draft, gửi toàn bộ khi đã trả lời câu bắt buộc.

Sau gửi: lưu answers và ý định tiếp tục trong một transaction, cấp idempotency key, đưa vào queue hiện có. Hiển thị “Đã lưu câu trả lời · Đang chờ chạy tiếp” cho đến khi Controller nhận run. Nếu run trước đã `needs_input`/kết thúc, tạo run tiếp theo liên kết cùng công việc; không hiện “Đã resume” một native process không còn tồn tại.

Bộ câu hỏi có version và trạng thái open/answered/superseded/cancelled. Trả lời bộ cũ bị từ chối có hướng dẫn tải bản mới; restart không mất câu trả lời hoặc gửi lại run. Permission runtime tiếp tục giao diện/policy riêng. Full access không tự trả lời câu hỏi nghiệp vụ, nhưng cũng không yêu cầu Accept cho mọi tool đã được cho phép.

## 6. Kết quả và nghiệm thu

Report mặc định: **Kết quả → File thay đổi → Kiểm tra thực tế → Chưa hoàn thành → Bước tiếp theo**. Mỗi test có trạng thái pass/fail/not-run và liên kết command/evidence; “không chạy” không là pass. Report tổng hợp dữ liệu đã lưu, không bịa kết quả từ prose của model.

Hai trục độc lập:

- **Kỹ thuật:** chưa chạy / đang chạy / đã thực thi chưa xác minh / đã xác minh / lỗi hoặc bị chặn. Chỉ evidence gate hiện có được xác nhận tiêu chí.
- **Nghiệp vụ:** không yêu cầu / chờ nghiệm thu / đã chấp nhận / yêu cầu sửa. Mặc định không yêu cầu. Nếu bật, trạng thái cần nghiệm thu có badge riêng; không đổi sự thật run hoặc bỏ qua test.

Nút **Yêu cầu sửa** luôn nhận ghi chú và tạo lần thực hiện mới trong queue. Kết quả cũ immutable; không sửa lịch sử để trông như pass. Khi source/criteria revision thay đổi, đánh dấu kết quả cũ thuộc revision cũ. Human acceptance chỉ áp dụng đúng revision đã xem.

## 7. Team và chuẩn bị project

Team mặc định là danh sách gọn: role/avatar → công việc hiện tại → model thực tế → hoạt động gần nhất → trạng thái. Role rảnh/tắt/chưa cấu hình tách rõ. Role có hai execution hiện hai hàng con; không gọi chúng là hai máy hay hai agent thường trú.

Click mở task/attempt chính xác trong inspector. Lý do chờ phân biệt dependency, slot, quyền, ngữ cảnh và tích hợp source. Nút dừng ghi **Dừng lượt chạy**, không giả có stop từng agent. Không show “online” chỉ vì role có model.

Chuẩn bị project dùng ba phần nhỏ: chọn repo/thư mục → xác nhận tool/model có sẵn → chọn mẫu công việc đầu tiên. Mẫu Feature/Bug/Review/Docs tái sử dụng work type và skills đóng gói. Không tự cài tool, thay model hay ghi config hệ thống. Có thể bỏ qua mẫu và chat ngay khi điều kiện bắt buộc đủ.

## 8. Base UI và kích thước

Mở rộng `src/ui/tokens.css`/`base.css`/`Select.tsx`, không tạo bộ theme thứ hai.

| Thành phần | Quy tắc đề xuất |
|---|---|
| Chữ | Body 14px/1.55; control 13px; meta 12px/1.4; heading trang 22–24px; không dùng 11px cho nội dung cần đọc thường xuyên |
| Nhịp cách | Bội 4px; gap hàng 8–12px; padding card 12–16px; khối lớn 20–24px |
| Sidebar | 216–240px; thu gọn khoảng 64px khi không đủ chỗ |
| Toolbar | Control cao 36px; icon 16px, không co; label baseline thống nhất; tối đa hai hàng khi cửa sổ hẹp |
| Board | Container bằng phần chiều cao viewport còn lại; `min-height:0`; header cột đứng yên, nội dung cột scroll riêng; scroll ngang trong Board |
| Cột/card | Cột 280–320px, không cố nhét sáu cột vào 1366px; card giới hạn nội dung khoảng 128–176px, phần dài xem trong panel |
| Vùng chi tiết | Desktop 440–520px; dock Chat 360–440px; chỉ một vùng bên phải hoạt động tại một thời điểm |
| Dropdown/menu | Dùng Select tùy biến hiện có, trigger/icon căn giữa, min-width theo trigger, max-height và scroll; action menu dùng primitive riêng cùng token, không native select |
| Tràn chữ | `min-width:0`, tiêu đề clamp, mã/path wrap có kiểm soát; không đặt ellipsis lên nội dung câu hỏi bắt buộc |
| Trạng thái | Icon + chữ + màu; focus rõ; tương phản chữ thường mục tiêu ≥4.5:1 và control/focus ≥3:1, phải đo khi code |

Các primitive cần hoàn thiện: Button variants, Field, StatusBadge, Card, ActionMenu, Tabs, EmptyState, SidePanel. Tái sử dụng trước khi thêm. Menu có focus/Arrow/Escape/outside click, trả focus về trigger, không khuất đáy màn hình; dùng đúng ARIA menu cho hành động và listbox cho lựa chọn.

**Responsive Windows:** tại 1440×900/1366×768, sidebar + Board và một dock dùng được bằng scroll Board; không che composer. Dưới 1100 CSS px, chi tiết/chat chuyển sang một panel overlay có Back; không ép ba vùng cạnh nhau. Tại 850×700 và Windows scaling 125–150%, collapse sidebar, toolbar wrap, panel đầy chiều rộng vùng nội dung; không tràn ngang toàn app. Đây là mục tiêu Electron, chưa phải cam kết ứng dụng điện thoại.

Chỉ một vùng sở hữu scroll ở mỗi pane, không ba scrollbar lồng nhau cho cùng nội dung. Hỗ trợ Tab/Shift+Tab/Escape, nhãn screen reader, reduced motion; không auto-scroll chat khi người dùng đang đọc phía trên. Giữ hành vi gửi phím hiện tại; hiển thị shortcut đúng cấu hình, tránh gửi ngoài ý muốn khi nhập tiếng Việt/IME.

## 9. Tiêu chí chất lượng trải nghiệm

- Từ Tổng quan mở đúng việc cần hành động trong tối đa hai thao tác; từ card mở chat đúng ngữ cảnh trong tối đa hai thao tác.
- Đổi Board ↔ Chat ↔ Team giữ project, draft và selection phù hợp; đổi project không lộ nội dung project trước.
- Không thêm poller runDetail trùng, không mount hai composer cho cùng conversation, không gọi model để làm UI summary.
- Timeline mặc định chỉ sự kiện cần hiểu; không hiện hàng nghìn token/tool events. Detail lazy load/phân trang.
- Card dài, đường dẫn Windows dài, bảng Markdown, câu hỏi tiếng Việt dài và lỗi API đều có layout sử dụng được.
- Luôn phân biệt “đã thực thi”, “đã xác minh” và “đã chấp nhận”. Số liệu mới đo khi triển khai; không coi mục tiêu ở đây là kết quả đã đạt.
