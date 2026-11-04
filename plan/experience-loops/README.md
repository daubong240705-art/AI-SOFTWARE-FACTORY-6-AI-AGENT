# ASF — Cải thiện trải nghiệm từ CrewHub Loops

Ngày khảo sát: **05/11/2026**. Trạng thái: **UX-01–05 đã triển khai; tiếp theo UX-06**. [Bàn giao UX-01](../../docs/windows-worker/ux01-completion.md), [UX-02](../../docs/windows-worker/ux02-completion.md), [UX-03](../../docs/windows-worker/ux03-completion.md), [UX-04](../../docs/windows-worker/ux04-completion.md), [UX-05](../../docs/windows-worker/ux05-completion.md).

Đã bổ sung [đợt làm gọn giao diện](../../docs/windows-worker/ux01-ui-refinement.md) theo ảnh phản hồi: bốn trang chính, menu dự án tập trung, hội thoại theo ngữ cảnh và Tổng quan giới hạn nội dung mặc định. Đây là bố cục hiện hành thay cho header có nhiều nút trong UX-01 đầu tiên.

## Quyết định định hướng

Tạm dừng phát triển 3D theo yêu cầu người dùng. Giữ phần D-01–04 đã có; hoãn D-05 và các hạng mục E phụ thuộc 3D. Chuyển ưu tiên sang trải nghiệm làm việc 2D: **giao việc tự nhiên → theo dõi công việc → trả lời khi thật sự cần → đọc kết quả có bằng chứng**.

Áp dụng cách tổ chức thông tin của [CrewHub Loops](https://crewhub.dev/loops), phát triển bằng source ASF hiện tại. Giữ Factory Lite + Windows Worker native, OpenCode/9Router, SQLite và một Controller. Không cần VM mới, backend mới hoặc orchestrator mới cho các đợt UX-01–06.

## Những phần nên áp dụng

| Ưu tiên | Cải tiến | Giá trị sử dụng |
|---|---|---|
| P0 | Tổng quan với mục **Cần bạn xử lý** | Biết ngay việc đang chạy, việc cần trả lời và hành động tiếp theo |
| P0 | Chat với Lead ngay trong ngữ cảnh Board/công việc | Không đổi trang rồi phải kể lại yêu cầu; vẫn có Chat toàn màn hình |
| P0 | Một hồ sơ công việc xuyên suốt các lần chạy | Mô tả, tiêu chí, câu hỏi, kết quả và lịch sử không rải rác theo run |
| P0 | Câu hỏi có lựa chọn và đề xuất | Trả lời một lần cho nhóm quyết định; Lead tự xử lý lựa chọn thông thường |
| P0 | Kết quả dễ đọc, liên kết diff/test/attempt | Phân biệt đã chạy, đã xác minh và nghiệm thu nghiệp vụ |
| P1 | Team gọn, hiển thị execution thật | Biết ai đang làm gì, chờ ai, dùng model nào; mở sâu khi cần |
| P1 | Mẫu công việc và kiểm tra sẵn sàng | Bắt đầu dự án mới nhanh với cấu hình hiện có |
| P2 | Git đọc thông tin, lịch chạy, quy tắc đơn giản | Chỉ làm sau khi vòng giao việc–kết quả đã ổn định |

## Trải nghiệm mục tiêu

1. Chọn project, thấy **Đang làm**, **Cần bạn xử lý**, **Kết quả mới**. Không có lời chào lớn hay đoạn giới thiệu dài.
2. Gõ “sửa lỗi đăng nhập trên mobile” cho Lead. Câu hỏi thông thường vẫn là chat; yêu cầu phát triển có thể lưu thành công việc. Luôn thấy project đích trước khi gửi.
3. Khi thực hiện, Board và Team phản ánh cùng run/task/attempt. Mở card thấy mô tả, tiêu chí và tiến độ thật. Nút **Hỏi Lead** mở chat kèm đúng công việc.
4. Nếu thiếu quyết định quan trọng, Lead gửi bộ câu hỏi có đề xuất; trả lời xong được đưa vào hàng đợi tiếp tục công việc. Không hứa tiếp tục native process tại đúng câu lệnh đã dừng.
5. Khi xong, đọc tóm tắt thay đổi, kiểm tra thực tế và phần còn thiếu. Có thể yêu cầu sửa tiếp ngay tại kết quả mà không mất liên kết lần chạy trước.

**Full access giữ policy hiện có.** Câu hỏi nghiệp vụ, quyền runtime và nghiệm thu là ba khái niệm khác nhau. Không thêm nút Accept sau mọi bước; không chuyển sang Done chỉ vì người dùng bấm đồng ý.

## Bộ tài liệu

| Tài liệu | Nội dung |
|---|---|
| [Khảo sát và đối chiếu](research.md) | Nguồn chính thức, thiết kế đã xem, tính năng quảng bá, khoảng trống ASF, giấy phép |
| [Thiết kế trải nghiệm](design.md) | Điều hướng, bố cục, Chat dock, card, câu hỏi, trạng thái, component, kích thước |
| [Kế hoạch triển khai](implementation.md) | UX-01–08, dữ liệu/migration, source cần sửa, phụ thuộc, nghiệm thu và rủi ro |
| [Phác thảo màn hình](workspace-proposal.svg) | Bản vẽ SVG gốc cho ASF, dữ liệu minh họa, chưa nối runtime |

## Thứ tự đề xuất

**UX-01 Tổng quan/điều hướng → UX-02 Hồ sơ công việc → UX-03 Chat theo ngữ cảnh → UX-04 Câu hỏi → UX-05 Kết quả → UX-06 Mẫu công việc/Team.** UX-07 Git và UX-08 lịch/quy tắc là mở rộng sau, không chặn vòng làm việc chính.

UX-01 thêm Tổng quan/điều hướng gọn; UX-02 thêm hồ sơ công việc; UX-03 thêm chat theo ngữ cảnh; UX-04 thêm câu hỏi nghiệp vụ và continuation idempotent; UX-05 thêm báo cáo bất biến, bằng chứng và nghiệm thu tùy chọn. Worker vẫn `1.3.0-alpha.8`, SQLite 11; chưa phát hành stable. [Bàn giao UX-05](../../docs/windows-worker/ux05-completion.md).

## Phạm vi khảo sát và giới hạn

Đã đọc trang sản phẩm, bài giải thích hướng phát triển, các ảnh giao diện chính thức và source design system công khai của CrewHub World có ghi xuất xứ từ Loops. Trang Loops đang ghi **beta coming soon**; chưa xác minh bằng cách cài và chạy Loops. Không coi ảnh giới thiệu là bằng chứng tính năng đã chạy ổn định. Chưa tìm thấy source runtime Loops công khai từ các nguồn đã kiểm tra; không suy diễn kiến trúc nội bộ từ repo CrewHub classic/World.

Khảo sát ban đầu đối chiếu ASF tại commit `34213d7`, nhánh `feature/worker-office-v1.3d`, Windows Worker `1.3.0-alpha.8`, SQLite schema 7. Kết quả triển khai UX-01 được ghi riêng trong bàn giao. Ảnh tham khảo và ảnh kiểm tra chỉ lưu cache local, không đưa vào Git.
