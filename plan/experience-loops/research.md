# Khảo sát CrewHub Loops và đối chiếu ASF

Ngày 05/11/2026. Đọc cùng [định hướng](README.md), [thiết kế](design.md) và [backlog](implementation.md).

## 1. Nguồn và mức độ kiểm chứng

| Nguồn | Đã xem/đọc | Có thể kết luận |
|---|---|---|
| [Loops](https://crewhub.dev/loops) | Nội dung sản phẩm, luồng công việc, giới hạn và ảnh minh họa | Hướng thiết kế/tính năng được nhà phát triển công bố; trang ghi beta sắp ra mắt, v2026.10.21 |
| [Trang chủ](https://crewhub.dev/) | Phân tách Loops và World | Công việc và phần nhìn 3D được tách thành hai sản phẩm, một nguồn dữ liệu |
| [Two projects, new direction — 25/10/2026](https://crewhub.dev/blog/two-projects-new-direction/) | Lý do tách work core và World | Có cơ sở để ưu tiên luồng công việc 2D; tài liệu Loops mới dự kiến cùng beta |
| [Classic v0.21 — 08/04/2026](https://crewhub.dev/blog/v0-21-0-claude-code-features/) | Ý tưởng terminal, session, timeline và prompt | Tài liệu lịch sử của classic; không dùng để khẳng định Loops đã có toàn bộ chức năng đó |
| [Repo classic](https://github.com/EKINSOL-DEV/crewhub) | Thông tin repo/giấy phép GitHub | Không phải source Loops hiện tại |
| [Repo World tại commit 3a66363](https://github.com/EKINSOL-DEV/crewhub2/tree/3a66363c9e799570887d72b18370d30112cd8e47) | README, LICENSE, design system, tokens.css, kit.css | World đang dùng design system có header dẫn về Loops `79ecfa0`; không phải source ticket/runtime Loops |

Source đã đọc trực tiếp: [DESIGN_SYSTEM.md](https://github.com/EKINSOL-DEV/crewhub2/blob/3a66363c9e799570887d72b18370d30112cd8e47/docs/DESIGN_SYSTEM.md), [tokens.css](https://github.com/EKINSOL-DEV/crewhub2/blob/3a66363c9e799570887d72b18370d30112cd8e47/apps/world/src/styles/tokens.css), [kit.css](https://github.com/EKINSOL-DEV/crewhub2/blob/3a66363c9e799570887d72b18370d30112cd8e47/apps/world/src/styles/kit.css), [LICENSE](https://github.com/EKINSOL-DEV/crewhub2/blob/3a66363c9e799570887d72b18370d30112cd8e47/LICENSE). Không chạy script từ các repo này.

Khảo sát bằng nội dung công khai và ảnh chính thức; không đăng nhập/cài đặt Loops. Công cụ trình duyệt tương tác không kết nối được host trong phiên khảo sát, nên chưa kiểm tra click, responsive hoặc tốc độ thực tế của sản phẩm tham khảo.

## 2. Thiết kế đã quan sát

Các liên kết ảnh dưới đây trỏ về website của tác giả, không phải asset ASF.

| Màn hình | Quan sát từ ảnh | Cách áp dụng phù hợp ASF |
|---|---|---|
| [Dashboard](https://crewhub.dev/images/loops/dashboard.webp) | Sidebar project; ô giao việc lớn; khối chờ trả lời; hoạt động gần đây | Ưu tiên việc cần hành động, giảm lời chào/giải thích; composer nhỏ hơn để còn không gian làm việc |
| [Board trong ảnh Chat](https://crewhub.dev/images/loops/chat.webp) | Cột có header rõ; card có mã, nhãn và liên kết; chat nổi trên Board | Card ASF gọn hơn, ít badge; dock nằm trong layout để không đè cột |
| [Ticket](https://crewhub.dev/images/loops/ticket.webp) | Hành động đầu trang; mô tả bên trái; thông tin phụ bên phải; câu hỏi có lựa chọn | Mở chi tiết công việc bằng panel hoặc toàn trang; tiêu chí, câu hỏi và kết quả cùng một hồ sơ |
| [Thảo luận](https://crewhub.dev/images/loops/ticket-thread.webp) | Lịch sử trao đổi riêng trong công việc | Giữ thread gắn công việc, liên kết hội thoại/run thay vì sao chép toàn bộ chat |
| [Chat](https://crewhub.dev/images/loops/chat.webp) | Chat có ngữ cảnh ticket, trạng thái đã trả lời | Trạng thái dựa trên hàng đợi/run thật; không dùng “Lead đã đọc” khi chỉ mới lưu DB |
| [Team](https://crewhub.dev/images/loops/team.webp) | Nhóm phiên làm việc, quan hệ Lead/worker, lý do bị chặn | ASF nhóm theo run/task; role là profile gọi theo việc, không giả lập agent thường trú |
| [Reports](https://crewhub.dev/images/loops/reports.webp) | Danh sách kết quả để đọc lại, tách khỏi hoạt động | Kết quả có phiên bản và provenance; log kỹ thuật mở theo nhu cầu |
| [Wizard](https://crewhub.dev/images/loops/wizard.webp) | Tạo project theo bước, mã project, kiểu project, thư mục | Giữ chọn thư mục Windows hiện có; mẫu Feature/Bug/Review/Docs; không mở rộng sang Marketing/Personal lúc này |
| [Automations](https://crewhub.dev/images/loops/automations.webp) | Đồ thị sự kiện → quy tắc → người thực hiện; bật/tắt | Chưa cần graph editor; trước hết cho xem task/dependency thật, sau đó mới quy tắc dạng danh sách |

Design system công khai dùng palette ngữ nghĩa, font Archivo, các primitive Button/Card/Menu/Chip/Field, ARIA và reduced motion. Bài học có ích là **dùng thành phần và token nhất quán**. ASF đã có `src/ui/tokens.css`, `base.css`, `Select.tsx`; tiếp tục hoàn thiện bộ này, giữ Segoe UI và palette hiện có. Không cần thêm font package hay chép CSS của CrewHub.

Không áp dụng nguyên trạng mật độ của ảnh tham khảo: hàng tab dài, quá nhiều bộ lọc và card nhiều nhãn sẽ làm cửa sổ Windows nhỏ bị chật. Các màn hình đề xuất chỉ hiện bộ lọc cơ bản, phần còn lại trong menu **Lọc**.

## 3. Chức năng được Loops công bố

Vòng làm việc xoay quanh project/ticket, Lead và review. Trang còn giới thiệu câu hỏi theo nhóm, chat dock, reports, team, mẫu project, quy tắc, lịch chạy, Git/GitHub và thiết lập công cụ. Cơ chế được mô tả gồm webapp/API SQLite, terminal Lead/worker, postman và host watch. Những ý tưởng tổ chức này không đòi hỏi ASF phải mang nguyên mô hình terminal hay thêm dịch vụ tương tự.

Hai khác biệt quyết định:

- Loops nêu hỗ trợ Windows qua WSL, chưa có kế hoạch native Windows. ASF tiếp tục native Windows/Electron; không chuyển sang WSL để theo kiến trúc tham khảo.
- Loops đề cao xác nhận của con người trước hành động/kết thúc. ASF giữ Full access và evidence gate hiện có; nghiệm thu nghiệp vụ chỉ là chính sách tùy chọn, độc lập quyền runtime.

Mobile/remote web, nhiều host, đồng bộ cloud và tích hợp GitHub từ website tham khảo không tự trở thành khả năng có sẵn của ASF. Không đưa chúng vào cam kết của đợt cải thiện này.

## 4. Khoảng trống thực tế của ASF

Baseline source: `34213d7`, Worker alpha.8, schema 7. Đường dẫn dưới đây tương đối với `apps/windows-worker/`.

| Hạng mục | Đang có | Còn thiếu / phương án | Ưu tiên |
|---|---|---|---|
| Điều hướng | `src/App.tsx`: Chat, Board, Team, Office, lịch sử/settings | Ngữ cảnh project và điểm vào hành động cần thống nhất; thêm Tổng quan nhỏ | P0 |
| Theo dõi | `shared/monitor.ts`, monitor Controller/store, inspector và timeline | Tái sử dụng projection, không tạo poller độc lập cho mỗi widget; global inbox cần query tổng hợp mới | P0 |
| Board | `shared/board.ts`, storage/controller board; backlog/ready, link run/follow-up, optimistic version | BoardItem chưa là hồ sơ thảo luận/câu hỏi/kết quả lâu dài. Mở rộng chính thực thể này; tránh thêm ticket store trùng | P0 |
| Chat | Conversation, draft, queue held/waiting, run feed chung; một active run toàn app | Chưa có dock Board và ngữ cảnh công việc bền vững; tách một ChatHost dùng chung | P0 |
| Lead | `shared/team.ts`: trả lời hoặc kế hoạch task; needs-context/needs_input | Chưa có QuestionSet nghiệp vụ có cấu trúc. Bổ sung protocol và lưu DB; không nhầm Permission | P0 |
| Xác minh | Review có evidence refs, task/criteria và attempt; direct run chưa tự xác minh AC | Tóm tắt thành kết quả đọc được; không đổi completed thành “đã xác minh” | P0 |
| Team/model | Bảy role, snapshot model/skills; tuần tự hoặc isolated-pair tối đa hai lane | Hiển thị execution thật, lý do chờ và model thực tế; không tăng concurrency | P1 |
| Mẫu/skills | Bốn skill đóng gói, work types, policy read/edit/shell | Mẫu yêu cầu và checklist sẵn sàng; chưa có discovery/marketplace/hook bên ngoài | P1 |
| Nội dung chat | Markdown GFM, code copy, table scroll; image chỉ hiện alt, chưa Mermaid | Ảnh/diagram cần giới hạn và render an toàn; chưa coi là công việc UI đơn giản | P2 |
| Kết quả/Git | Diff, command/evidence/export từng run; project branch/dirty | Chưa có kho report xuyên run; Git history/GitHub cần query riêng, gh chỉ tùy chọn | P1/P2 |
| Tự động hóa | Queue trong Controller, unique active-run lock | Chưa có scheduler/rule store; chỉ mở rộng Controller khi thực sự triển khai UX-08 | P2 |

`useMonitor` hiện cache theo project/query, không phải nguồn tổng hợp mọi project. `runDetail` dùng shared feed; không nên mount thêm bản ChatWorkspace để tạo dock rồi vô tình nhân draft writer và subscription.

## 5. Quyết định tái sử dụng và giấy phép

Repo classic và `crewhub2` công khai ghi AGPL-3.0; LICENSE của World đã đọc tại commit pin ở trên. Chưa xác định giấy phép/source runtime riêng của Loops. Giấy phép của World không chứng minh toàn bộ website, ảnh hay source Loops được phép nhúng vào ASF.

Phương án hiện tại: học cách bố trí, mô hình tương tác và nguyên tắc component; **viết độc lập trong ASF**, không chép CSS/TSX, icon nhận diện, font bundle hoặc ảnh làm asset sản phẩm. Không cần thêm dependency hay thay giấy phép ASF cho kế hoạch này. Nếu sau này muốn tái sử dụng code AGPL, phải đánh giá nghĩa vụ phân phối/cung cấp source của phần kết hợp trước khi nhập code.

## 6. Kết luận khảo sát

Ưu tiên hồ sơ công việc, chat có ngữ cảnh, câu hỏi và kết quả. Đây là phần giải quyết trực tiếp việc trò chuyện cứng nhắc và feed quá nhiều thông tin. Giữ ưu điểm ASF là bằng chứng thực thi, kiểm soát workspace, model snapshot và Controller hiện có. Hoãn graph automation, nhiều host và World để vòng làm việc hàng ngày dễ sử dụng trước.
