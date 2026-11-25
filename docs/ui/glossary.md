# Bảng thuật ngữ giao diện (vi)

Người dùng yêu cầu (25/11/2026): thuật ngữ mà người làm phần mềm ở Việt Nam thường nói bằng tiếng Anh thì giao diện dùng **tiếng Anh**. Không dịch gượng các từ này. Câu chữ xung quanh vẫn là tiếng Việt.

## Quy tắc

1. Thuật ngữ tiếng Anh viết đúng chính tả gốc. Ở đầu nhãn hay tiêu đề thì viết hoa chữ đầu ("Secret", "Workflow"). Trong câu thì viết thường ("tạo secret mới"), trừ tên riêng ("Codex", "Claude Code", "MCP", "API").
2. Không thêm "s" số nhiều: "3 agent", "các workflow".
3. Ghép với tiếng Việt bình thường: "Tạo agent", "Chạy thử workflow", "Xóa secret này?".
4. Tên màn hình người dùng đã chọn thì giữ nguyên tiếng Việt: **Bảng việc, Văn phòng, Thế giới, Cần xử lý, Thư viện, Hệ thống, Cài đặt, Tổng quan, Tài liệu, Mã nguồn**.
5. Hành động và trạng thái thông thường vẫn dùng tiếng Việt: Tạo, Sửa, Xóa, Lưu, Hủy, Duyệt, Từ chối, Đang chạy, Thành công, Thất bại, Tạm dừng, Lưu trữ.

## Dùng tiếng Anh

**Bản chốt** (decision brief): tài liệu ghi lại phương án đã chốt với Lead; dùng nhãn **Bản chốt v<n>** cho từng version.

| Thay cho | Dùng |
|---|---|
| Thông tin bí mật | **Secret** |
| Khóa API | **API key** |
| Mã thông báo | **Token** |
| Tích hợp | **Integration** (trang: "Integration") |
| Quy trình | **Workflow** |
| Nút (trên canvas) | **Node** |
| Khởi động, Hành động, Điều kiện, Song song, Gộp, Phê duyệt (node), Lặp, Chờ, Quy trình con, Điều phối, Kết quả (tên loại node) | **Trigger, Action, Condition, Parallel, Join, Approval, Loop, Wait, Sub-workflow, Orchestrate, Output** |
| Lượt chạy (của workflow) | **Run** |
| Lượt thực thi (một lần agent làm task) | **Attempt** |
| Bản nháp / Xuất bản | **Draft / Publish** |
| Phiên bản | **Version** |
| Mẫu agent / Mẫu đội / Mẫu quy trình | **Agent template / Team template / Workflow template** |
| Kỹ năng | **Skill** |
| Công cụ | **Tool** |
| Đội | **Team** ("Agent & Team") |
| Nhóm (nhóm kiểu GitLab chứa dự án) | **Group** |
| Mô hình | **Model** |
| Nhà cung cấp model | **Model provider** |
| Trình chạy | **Runtime** |
| Mức suy luận | **Effort** |
| Dữ liệu ghim | **Pinned data** |
| Agent giả | **Mock agent** |
| Phiên | **Session** |
| Thử lại | **Retry** |
| Sao lưu | **Backup** |
| Truy vết / Giám sát | **Trace / Monitor** |
| Nhánh | **Branch** (cũng giữ: commit, merge, repo, worktree, workspace, log, prompt, deploy) |
| Việc / Công việc (đơn vị công việc của agent) | **Task** ("Task mới", "Tạo task"). Tên màn hình "Bảng việc" giữ nguyên |

## Giữ tiếng Việt

Dự án, Ngân sách, Kế thừa, Kết nối, Phê duyệt/Duyệt (hành động), Lead (đã là tiếng Anh), Văn phòng, Thế giới, Bảng việc, Cần xử lý, Thư viện, Hệ thống, Cài đặt, Tổng quan, Tài liệu, Mã nguồn.
