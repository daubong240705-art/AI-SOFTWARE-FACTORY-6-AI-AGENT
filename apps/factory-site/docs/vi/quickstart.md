---
title: Bắt đầu nhanh
section: start
order: 3
---

Tạo dự án từ **Software Team** và đưa một thay đổi nhỏ qua các bước làm rõ yêu cầu, triển khai, kiểm thử và duyệt. Ví dụ thêm thông báo khi danh sách trống trong một ứng dụng mẫu, không deploy.

## Khi nào nên dùng

Dùng hướng dẫn này khi [Host](./install.md) đã chạy, bạn có sẵn repo Git cục bộ của ứng dụng mẫu, và model cho Lead cùng runtime của agent đã sẵn sàng. Nếu chưa có model, thử [bài tập với mock agent](./create-workflow.md).

## Tạo dự án và publish workflow

1. Chọn **Tạo** → **Dự án mới**. Đặt tên `Recipe Box`, chọn **Dự án Git** và **Software Team** ở **Team template**. Đặt **Đường dẫn làm việc** trỏ tới repo mẫu trên Host, rồi chọn **Tạo dự án**.
2. Mở **Agent & Team** và kiểm tra vai trò, runtime được sao chép. [Tạo thêm agent kiểm tra](./create-agent.md) để thực hành, nhưng giữ nguyên gán vai trò của workflow mẫu.
3. Mở **Workflow** → **Nhập từ template**. Chọn **Software Team** ở **Pack nguồn** và **Software Delivery** ở **Workflow template**. Kiểm tra đầu vào `brief` và nhánh duyệt, rồi chọn **Publish**.

![Hộp thoại tạo dự án có phần chọn workspace và team template](/images/docs/create-project.png)

*Hộp thoại tạo workspace hoặc gắn repo và sao chép đội; workflow được nhập riêng.*

## Chốt rồi chạy, theo dõi và duyệt

1. Mở **Hỏi Lead**. Yêu cầu lập kế hoạch hiện “Chưa có công thức” khi danh sách trống, giữ nguyên danh sách có dữ liệu và kiểm thử cả hai trường hợp. Dặn chưa chạy.
2. Xem kế hoạch rồi xác nhận: “Tôi đồng ý. Chạy Software Delivery theo các tiêu chí vừa thống nhất. Không deploy.” Kiểm tra **Bản chốt** và liên kết run trong chat.
3. Theo dõi run trong **Monitor**. Khi mục **Operator sign-off** xuất hiện ở **Cần xử lý**, kiểm tra bằng chứng của cả hai trường hợp và chỉ duyệt nếu đáp ứng brief.
4. Mở lại **Software Delivery**, chọn **Hiệu quả** và xem số liệu từng node. Tìm node chờ lâu nhất trước khi đề xuất thay đổi.

![Run hiển thị sơ đồ workflow và khung thông tin thực thi của node](/images/docs/workflow-run.png)

*Theo dõi từng bước từ Trigger đến kết quả cuối, kể cả thời gian chờ duyệt.*

> **Cảnh báo:** Chạy thật có thể sửa workspace và dùng ngân sách model. Hãy thực hành trên repo mẫu có thể bỏ đi.

## Lỗi thường gặp

- Yêu cầu Lead chạy workflow mới nhập mà chưa publish.
- Chạy thủ công lần nữa trước khi kiểm tra xem chat đã trả về liên kết run chưa.

## Bước tiếp theo

[Tìm hiểu chat với Lead](./lead-chat.md), [xử lý phê duyệt](./run-approve.md) hoặc [cải tiến workflow](./improve-workflow.md).
