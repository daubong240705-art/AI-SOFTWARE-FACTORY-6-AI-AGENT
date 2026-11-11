# 14 · Giao thức cộng tác giữa các agent: chia việc, bàn giao, trao đổi (quyết định AP-6)

| Mục | Nội dung |
|---|---|
| Trạng thái | **Đã chốt 12/11/2026** theo ủy quyền của người dùng ("chốt theo phương án bạn thấy tối ưu trong việc phân chia công việc, bàn giao task, trò chuyện với nhau") |
| Phạm vi | Ba Team Pack mới: `research-team`, `architecture-team`, `design-team` (mỗi profile và mỗi skill, kèm một skill mới `team-coordination` cho mỗi gói). `software-team` **không đổi** vì mã băm nội dung được ghim bằng test |
| Liên quan | [10 (M3, AP-6)](10-m3-slice-plan.md), [12 Context Engineering](12-context-engineering.md) §13 (kết quả chạy thật E1b), [04 workflow](04-workflow-and-governance.md), [06 §11](06-implementation-roadmap.md) |

## 1. Quyết định

**Các agent không trò chuyện tự do với nhau.** Chúng phối hợp chỉ qua năm kênh có cấu trúc, mỗi kênh đã có sẵn trong Host. Đây là lựa chọn, không phải giới hạn tạm thời.

| # | Quyết định | Kênh / cơ chế Host | Lý do |
|---|---|---|---|
| C1 | **Chỉ Lead lập kế hoạch.** Chuyên viên không tạo việc, không lập lại kế hoạch, không giao lại việc | `task.propose` (Lead, tối đa 10 việc, phụ thuộc chỉ trỏ ngược); chuyên viên đề xuất đổi kế hoạch qua `workflow.patch` khi có workflow, nếu không thì báo BLOCKED cho Lead | Một nguồn sự thật cho kế hoạch; tránh hai agent cùng đổi hướng |
| C2 | **Hình dạng một việc cố định:** mục tiêu một câu; tiêu chí nghiệm thu kiểm chứng được; loại đầu ra; phạm vi file; phụ thuộc; seat duyệt. Một seat chủ mỗi việc, kích thước vừa một phiên; **tác giả và người duyệt là hai seat khác nhau** | `task.propose`, kiểm phạm vi trước review | Lỗi F6 ở E1b: hai việc song song cùng viết một file |
| C3 | **Song song chỉ khi phạm vi file tách rời nhau** | Lead xếp việc | Tránh xung đột gộp nhánh |
| C4 | **Không có kênh chat giữa agent.** Kênh duy nhất: (1) tài liệu (artifact), (2) báo cáo tiến độ, (3) yêu cầu có kiểu giữa các Team, (4) yêu cầu quyết định gửi người vận hành, (5) bàn giao cuối việc | `output.register`, `task.progress`, `request.create/reply/get`, `decision.request` | E1b F7: mỗi lời gọi gửi lại cả system prompt (95k–961k token vào cho vài chục lời gọi); trò chuyện nhân chi phí và dễ lặp vòng, khó kiểm toán |
| C5 | **Bàn giao có trường cố định** trong báo cáo tiến độ cuối và trong `abstractL1` của mỗi đầu ra: đã làm gì; đầu ra (mã tài liệu); quyết định kèm lý do; giả định; câu hỏi mở; bước tiếp theo và người nhận | Báo cáo tiến độ cuối; L1 của đầu ra (Host đã kiểm độ dài và cấu trúc) | E1b F4/F5/G2: bàn giao dựng lại từ dòng tiến độ nên agent sau phải đào git hoặc bịa |
| C6 | **Đọc đầu vào trước khi làm:** lấy tóm tắt L1 của đầu ra phụ thuộc bằng `knowledge.get`, rồi chỉ đọc đúng phần cần bằng `knowledge.outline/read/find`. Mỗi lần chạy là phiên mới, không dựa vào trí nhớ | `knowledge.*` | Ngữ cảnh nhỏ; tránh bịa (README bịa ở E1b TSK-005 lần 1) |
| C7 | **Vòng review:** người duyệt chấm đạt / không đạt / chưa kiểm chứng cho từng tiêu chí, kèm bằng chứng và phát hiện đánh số, **không viết lại sản phẩm**. Sửa là chạy lại **cùng một việc** bởi tác giả. Tối đa **2 vòng sửa**, sau đó hỏi người vận hành | Review của Host; `reviewPolicy human-final`; `decision.request` | E1b F8: phản hồi review đến được lần chạy sau và agent làm theo |
| C8 | **Thang leo thang:** kẹt trong Team → báo `BLOCKED` kèm lý do rồi dừng (Lead quyết); cần Team khác → `request.create` chỉ sau khi tìm tri thức không thấy, không dùng như hội thoại; quyết định kinh doanh, phạm vi, ngân sách, quyền hạn → Lead hỏi người vận hành; **không tự nâng quyền hay ngân sách** | `decision.request`, giới hạn hop ≤ 3 và vòng ≤ 3 của Host | Quy tắc nền của Factory |

## 2. Chỗ áp dụng

- **Đoạn "Collaborate only through artifacts…" (khoảng 90 từ)** được thêm nguyên văn vào cuối khối "Factory conventions" của **mọi profile và mọi skill** của ba gói (26 file). Test gói giữ khối này giống nhau từng chữ, nên mọi seat đọc đúng cùng một luật.
- **Skill `team-coordination`** (một cho mỗi gói, khoảng 690 từ) chứa phần chi tiết cho Lead: tách việc, mẫu một việc, mẫu bàn giao, vòng review, thang leo thang, được điều chỉnh theo seat và loại đầu ra của từng gói. Skill chỉ vào prompt dưới dạng danh mục mô tả, và đọc đầy đủ qua `skill.get` khi cần, nên không tốn token mỗi lần chạy.
- Giới hạn của gói vẫn giữ: profile ≤ 450 từ (lớn nhất 435), skill ≤ 700 từ (lớn nhất 690).

## 3. Chưa làm và ghi nhận

- `software-team` giữ nguyên (mã băm nội dung ghim bằng test). Nếu muốn áp dụng giao thức cho gói này, cần đổi giá trị ghim ở hai test, một việc nhỏ nhưng thay đổi mã băm của Team đã tạo.
- Chưa có lần chạy thật với model cho ba gói này (E1b chỉ chạy `software-team`). Cần một lần chạy thử để kiểm xem agent có làm theo bàn giao có trường hay không.
- Host chưa kiểm cứng tính đầy đủ của bàn giao (chỉ kiểm độ dài và cấu trúc L1 khi đăng ký). Việc kiểm trường bắt buộc có thể thêm sau nếu lần chạy thật cho thấy agent bỏ sót.
- Nội dung vai trò và skill cũ không đổi. Người dùng có thể sửa bất kỳ lúc nào; mỗi lần sửa đổi mã băm của gói (Team mới tạo dùng bản mới, Team cũ giữ bản đã ghim).

## 4. Kiểm chứng

`pack:check` đạt cho ba gói (research 4 seat 5 skill, architecture 5 seat 6 skill, design 4 seat 5 skill); toàn bộ test Host đạt trên Windows (7305 test, 0 lỗi).
