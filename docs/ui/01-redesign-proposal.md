# Factory UI: đề xuất thiết kế lại (bản nháp 11/11/2026, chờ duyệt)

Nguồn yêu cầu: 9 ảnh tham khảo trong `crewhub/` và các yêu cầu của bạn: **ít dữ kiện trùng lặp, không dồn nhiều thứ vào một chỗ, dùng được hằng ngày, bỏ mô tả không cần thiết, phần nội dung chính phải thật lớn.**
Chưa viết dòng code nào. Skill thiết kế dùng khi làm: [skills/README.md](skills/README.md).

## 1. Học gì từ ảnh tham khảo, bỏ gì

| Giữ (đúng ý bạn) | Bỏ hoặc sửa (vi phạm yêu cầu của bạn) |
|---|---|
| Thanh bên trái: việc toàn cục ở trên, danh sách Project ở dưới, thu gọn được | Các đoạn giải thích cố định dưới tiêu đề (trang Scheduled, Team, Automations có 2–4 dòng mô tả) |
| Thanh trên cùng: tìm kiếm + một nút hành động chính | "Waiting on you" hiện **3 lần** (thanh bên, thẻ ở Dashboard, thẻ "Needs attention") |
| Tab theo Project, nội dung chiếm toàn bộ chiều rộng | 8 tab mỗi Project (Overview, Board, Reports, List, Archive, Automations, Scheduled, Git): quá nhiều, List/Archive chỉ là cách xem của Board |
| Dashboard có ô nhập lớn: "Hỏi hoặc mô tả việc cần làm", chọn nơi gửi | Bộ đếm hai chữ số bên cạnh từng Project trên thanh bên mà không rõ nghĩa |
| Bảng Kanban + khung chat với agent gắn bên phải, có thể phóng to/đóng | Wizard 6 bước cho Setup, trang Settings có 10 tab |
| Trang Team nhóm agent theo phiên làm việc, mỗi dòng một trạng thái | Nhắc cùng một trạng thái ở cả nhãn, màu và đếm tổng |
| Danh sách hoạt động có bộ lọc | Cụm "Needs attention" tách riêng khi nó trùng với danh sách chờ duyệt |

## 2. Nguyên tắc chống trùng lặp và dồn chỗ (áp dụng cho mọi màn)

1. **Mỗi dữ kiện có đúng một nơi chính.** Số việc chờ bạn: một huy hiệu ở thanh bên và một danh sách trên trang "Cần xử lý". Không lặp ở thẻ Dashboard thứ hai hay tiêu đề trang.
2. **Một việc chỉ có một chỉ báo trạng thái** (một chấm + một chữ), không vừa màu vừa nhãn vừa đếm.
3. **Màu nóng (đỏ cam) chỉ dùng cho "cần người quyết định".** Mọi thứ còn lại trung tính. Nhìn lướt là thấy ngay chỗ cần bạn.
4. **Không có đoạn mô tả cố định.** Giải thích chỉ xuất hiện ở trạng thái rỗng (một câu, kèm nút hành động) hoặc trong dấu `?` mở ra khi cần. Tiêu đề trang không kèm phụ đề.
5. **Nội dung chính chiếm trên 70% chiều rộng.** Thanh bên thu gọn được; khung phụ (chat agent, chi tiết) mặc định đóng, mở khi cần.
6. **Một màn, một việc chính.** Màn có danh sách thì chi tiết mở ở khung lớn bên cạnh (master-detail), không nhồi chi tiết vào hàng.
7. **Chi tiết kỹ thuật ẩn mặc định** (id, digest, epoch, đường dẫn). Có nút "Chi tiết kỹ thuật" gập lại cho người cần.
8. **Văn bản giao diện theo người dùng:** động từ rõ ràng ("Duyệt", "Yêu cầu sửa", không "Submit"), cùng một hành động giữ một tên xuyên suốt, lỗi nói rõ nguyên nhân và cách sửa.

## 3. Cấu trúc điều hướng

```
Thanh bên (cố định, thu gọn được)        Thanh trên
 ├ Tổng quan                              [ Tìm việc theo mã hoặc từ khóa ]  [ + Việc mới ]  [chuông]
 ├ Cần xử lý  (huy hiệu đỏ)
 ├ Đội                                    Trang Project: tên + 6 tab
 │                                         Tổng quan │ Bảng việc │ Quy trình │ Tự động │ Tri thức │ Mã nguồn
 ├ DỰ ÁN
 │   Cardroom      (chấm đỏ nếu có việc chờ bạn)
 │   Ledger
 └ Cài đặt, Trợ giúp, tài khoản (cuối)
```

| Mục | Gồm những gì của Factory | Ghi chú |
|---|---|---|
| **Tổng quan** (toàn cục) | Ô nhập việc, danh sách "Cần xử lý" tối đa 5 dòng, dòng hoạt động | Trang mở đầu mỗi ngày |
| **Cần xử lý** | Mọi thứ cần quyết định, một danh sách duy nhất: duyệt kết quả, câu hỏi của agent, cổng bắt đầu, yêu cầu giữa các Team, Plan Patch, xung đột gộp nhánh, Team bị tạm dừng, workflow bị kẹt, cầu dao | Hiện là 7 nhóm Inbox riêng; gom lại cùng một mẫu dòng |
| **Đội** | Team, Seat, trạng thái agent; sau này thêm máy (Node) cho M4 | Một nơi cho "ai đang làm gì, ở đâu" |
| **Tổng quan** (Project) | Tiến độ, việc đang chạy, ngân sách dự án, dòng hoạt động của Project | Không lặp lại bảng việc |
| **Bảng việc** | Kanban, chuyển sang Danh sách bằng công tắc, Lưu trữ là bộ lọc | Bỏ 2 tab riêng |
| **Quy trình** | Workflow instance, stage, rework, Plan Patch | Mới: hiện chưa có giao diện |
| **Tự động** | Lịch, Rule, Monitor, Watchdog, trạng thái quarantine | Mới. Dạng danh sách trước; dạng đồ thị cần thư viện xyflow (O9), để sau |
| **Tri thức** | Dossier, Artifact, báo cáo ngày, tri thức đã cũ | Gộp "Reports" và Knowledge hiện có |
| **Mã nguồn** | Nhánh tích hợp, các nhánh Task, đẩy lên remote | Không có PR/Issue của GitHub vì Factory chưa có tích hợp này |
| **Cài đặt** (ít dùng) | Ngân sách, mức tự chủ, Standing Approval, thông báo, model, Pack, máy (M4) | Một danh sách dọc ở bên trái, không phải thanh 10 tab |

## 4. Luồng thao tác hằng ngày

**Mở ứng dụng → Tổng quan → xử lý → quay lại.** Việc chính của bạn là duyệt kết quả và trả lời agent, nên màn quan trọng nhất là **Cần xử lý**.

```
Cần xử lý                                                           ┌─────────────────────────────────────────────────┐
┌──────────────────────┬──────────────────────────────────────────┐ │ Ví dụ: màn duyệt kết quả (khung phải rất lớn)  │
│ ● TSK-003 Review     │  TSK-003  Viết unit test cho thư viện     │ └─────────────────────────────────────────────────┘
│   Cardroom · 3 phút  │  ───────────────────────────────────────  │
│ ● Hỏi: định dạng?    │  Kết quả   Hoạt động   Bối cảnh           │   Trái: danh sách hẹp, mỗi dòng 2 dòng chữ.
│   Ledger · 1 giờ     │  ┌ test/stats.test.js ──────────────────┐ │   Phải: nội dung chính chiếm hết chỗ còn lại.
│ ○ Xung đột gộp       │  │  diff lớn, cuộn được                 │ │   Dưới: Duyệt (Enter) │ Yêu cầu sửa │ Hỏi agent
│   TSK-005            │  └──────────────────────────────────────┘ │   Phím tắt: J/K đổi dòng, A duyệt, R yêu cầu sửa.
│                      │  Tiêu chí: ✓ phủ mọi hàm  ✓ test đạt      │
│                      │  [ Duyệt ]  [ Yêu cầu sửa ]               │
└──────────────────────┴──────────────────────────────────────────┘
```

- **Tổng quan:** ô nhập lớn ở đầu (chọn Project, "Hỏi" hoặc "Giao việc" cho Lead). Bên phải: tối đa 5 việc chờ bạn. Bên dưới: dòng hoạt động có lọc theo Project, loại, người.
- **Bảng việc:** thẻ chỉ có mã, tiêu đề, một chỉ báo trạng thái, người làm. Bấm vào thẻ mở **khung chi tiết lớn** (kết quả, diff, bằng chứng test, tiêu chí). Chat với agent là khung gắn bên phải, mở bằng nút, không chiếm chỗ mặc định.
- **Việc mới:** một hộp thoại với một ô; Lead hỏi thêm nếu thiếu. Không có biểu mẫu nhiều ô.
- **Thiết lập lần đầu:** tối đa 3 bước (kết nối khóa model, tạo Project, mời agent chạy thử), có thể bỏ qua. Không có bước hướng dẫn riêng.

## 5. Phong cách (theo quy trình của skill `frontend-design`)

Mặc định nền tối như ảnh, giữ cơ chế chủ đề hiện có. Mục tiêu: dịu mắt khi dùng cả ngày, **một màu nhấn duy nhất có nghĩa**.

| Vai trò | Màu | Dùng cho |
|---|---|---|
| Nền | `#1E1E20` | Khung ngoài |
| Bề mặt | `#262629` | Thẻ, bảng |
| Nổi | `#2E2E32` | Hàng đang chọn, popover |
| Đường kẻ | `#3A3A40` | Chỉ khi có nghĩa phân tách |
| Chữ / chữ phụ | `#EDEDEF` / `#A0A0A8` | Nội dung / thông tin phụ |
| **Cần bạn** | `#FF6B5E` | Duy nhất cho thứ cần quyết định (huy hiệu, chấm, nút Duyệt cần chú ý) |
| Đang chạy / Xong / Thông tin | `#F0A53A` / `#4CC38A` / `#6EA8FE` | Chỉ báo trạng thái, không dùng làm nền lớn |

- **Chữ (đã chọn sau khi xem mock):** Be Vietnam Pro cho nội dung (thiết kế riêng cho tiếng Việt), Bricolage Grotesque cho tiêu đề (chỗ cá tính duy nhất về chữ), JetBrains Mono cho mã việc, mã nhánh, diff. Cả ba theo giấy phép OFL và có đủ dấu tiếng Việt. Bản thật tự lưu phông cùng ứng dụng, không tải từ Internet; việc thêm tệp phông cần bạn duyệt như một thành phần mới.
- **Điểm nhấn (mỗi cái có lý do):** màu nhận diện cho từng dự án (tông lạnh: lục lam, tím, hồng, không trùng màu trạng thái); vạch đỏ cam bên trái khung "Cần xử lý"; chấm "Đang chạy" nhấp nháy nhẹ (chuyển động duy nhất liên tục, chỉ cho việc đang chạy); các việc cần xử lý trượt vào một lần khi mở trang; diff có số dòng và vạch xanh cho dòng thêm; ô nhập có vòng sáng khi đang gõ; tên người dùng trong lời chào có màu.
- Nút chính: nền sáng trên nền tối (như ảnh), một nút chính mỗi vùng.
- Chuyển động: chỉ phản hồi thao tác (mở khung, di chuyển thẻ), có hỗ trợ giảm chuyển động.
- Chất lượng tối thiểu: hiển thị tốt đến màn hình điện thoại, focus nhìn rõ, tương phản WCAG AA, điều khiển bằng bàn phím (xem `ecc-frontend-a11y`, `ecc-accessibility`).

## 6. Hiện trạng, và việc phải làm

Giao diện hiện có 21 màn, chỉ dùng API của ngân sách, team, request, dossier, inbox. **Chưa dùng API nào của M5** (workflow, lịch, rule, monitor, thông báo, Standing Approval, nhánh tích hợp, cầu dao, mức tự chủ). Phần lớn việc của đợt này là thêm giao diện cho các thứ đó, không chỉ đổi vỏ.

| Lát | Nội dung | Phụ thuộc |
|---|---|---|
| U-A | Khung mới: token, thanh bên, thanh trên, tìm kiếm, thành phần dùng chung, trang Tổng quan | — |
| U-B | Cần xử lý: một danh sách, màn duyệt chia đôi, phím tắt | U-A |
| U-C | Bảng việc + khung chi tiết Task + khung chat agent | U-A |
| U-D | Đội (có chỗ cho Máy của M4) | U-A |
| U-E | Quy trình, Tự động (lịch, rule, monitor), thông báo | U-A, U-B |
| U-F | Tri thức (Dossier, báo cáo), Mã nguồn (nhánh tích hợp) | U-A |
| U-G | Cài đặt: ngân sách, mức tự chủ, Standing Approval, thông báo | U-A |

Mỗi lát được kiểm tra kiểu và build trước khi bàn giao.

## 7. Cần bạn quyết định

| ID | Câu hỏi | Đề xuất |
|---|---|---|
| UI-D1 | Ngôn ngữ mặc định | Tiếng Việt, có sẵn tiếng Anh |
| UI-D2 | Nền tối mặc định | Có |
| UI-D3 | Màu nhấn: chỉ dùng đỏ cam cho "cần bạn" | Có |
| UI-D4 | 6 tab mỗi Project như §3 (Tổng quan, Bảng việc, Quy trình, Tự động, Tri thức, Mã nguồn) | Có |
| UI-D5 | Gom toàn bộ việc cần quyết định vào một danh sách "Cần xử lý" | Có |
| UI-D6 | Dạng đồ thị cho Tự động (cần thư viện xyflow) | Hoãn, làm danh sách trước |
| UI-D7 | Thứ tự làm | U-A → U-B → U-C trước, vì đó là việc dùng hằng ngày |
| UI-D8 | Có muốn xem bản mock tĩnh (HTML) của Tổng quan và màn duyệt trước khi làm không | Đề xuất có |
