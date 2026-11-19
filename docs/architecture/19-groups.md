# 19 · Group kiểu GitLab (U9)

| Mục | Giá trị |
|---|---|
| Trạng thái | **Đã duyệt 19/11/2026**: lồng nhiều cấp, có kế thừa, làm ngay |
| Contracts | `packages/factory-contracts/src/groups.ts` |

## Mô hình

- **Group** lồng nhau tối đa **5 cấp**; mỗi group có `slug`, đường dẫn đầy đủ (`khach-hang-a/website`) duy nhất. Project thuộc **tối đa một** group (hoặc ở gốc) và chuyển được.
- **Group chia sẻ cấu hình, không chia sẻ trạng thái chạy:**
  - Mẫu agent và skill có thể **thuộc một group**: chỉ group đó và các group con nhìn thấy (bên cạnh Thư viện toàn hệ thống).
  - Cài đặt kế thừa: `defaultModel`, `defaultAdapter`, `defaultEffort`, `budgetTokens30d`. Giá trị gần nhất thắng: project → group cha gần nhất → … → mặc định của Host. Read model trả giá trị hiệu lực kèm nguồn.
  - Ngân sách 30 ngày của group chặn việc mới của mọi project trong cây khi chạm mức. Chi phí chưa báo vẫn tính theo ước tính và không bao giờ là 0.
  - Integration và credential theo group sẽ có khi làm phần U2 còn lại (Integration), cùng quy tắc kế thừa.
- Agent, phiên, bộ nhớ và workspace **vẫn thuộc từng project** (D-05, 17 §5.3).
- Tổng quan group gộp số liệu toàn cây: task theo trạng thái, phê duyệt chờ, lượt chạy quy trình, attempt đang chạy, token 30 ngày.
- Lệnh group dùng `SYSTEM_SCOPE_ID` làm `projectId`, giống Thư viện. `projects.set-group` là lệnh theo project.
- Khi có nhiều người dùng: group là nơi gán thành viên và quyền (để sau).

## Ràng buộc

- Không có chu trình; chuyển group kéo theo cả cây con và không vượt 5 cấp.
- Chỉ xóa được group rỗng (không có group con, project, mẫu hay skill thuộc group). Group có nội dung thì lưu trữ.
- Lưu trữ group không lưu trữ project bên trong. UI ẩn group đã lưu trữ nhưng project vẫn mở được qua tìm kiếm.
