# Kiểm chứng hạ tầng

Các script không sửa cấu hình dịch vụ, không tạo work package/repository/pipeline. Gateway và CLI probe có sử dụng token model. CLI chỉ chỉnh file mẫu trong thư mục tạm; quyền tool không thay thế sandbox hệ điều hành.

```powershell
python -m pip install -r spikes/requirements-infra.txt
# Nạp OPENPROJECT_API_TOKEN và NINE_ROUTER_API_KEY từ môi trường bảo mật.
python spikes/openproject_readonly.py --output docs/evidence/openproject-current.json
python spikes/router9_readonly.py
python spikes/cli_smoke.py
```

`openproject_readonly.py` hỏi mật khẩu SSH bằng prompt, hoặc nhận `ASF_AUDIT_SSH_PASSWORD`; có thể dùng `--ssh-key <path>`. Kết nối MCP qua SSH tới proxy loopback `.12:8080` để tránh đường public chập chờn; Host canonical được giữ nguyên. Fingerprint trong script là giá trị quan sát trong lần khảo sát đầu tiên, cần đối chiếu qua kênh tin cậy khi chuyển môi trường.

Snapshot chỉ lưu ID, tên, hierarchy và trạng thái; không lưu token, email, người được giao việc hay toàn bộ mô tả của dự án mẫu. Chạy ngoài giờ cập nhật backlog để tránh thay đổi thứ tự giữa các trang; script phát hiện thiếu hoặc trùng ID.

Kết quả Windows không chứng minh container Linux đã sẵn sàng. S7 chỉ hoàn tất khi chạy lại CLI trong sandbox worker Linux, kiểm tra file diff và build/test thật.

Cập nhật 04/11/2026: [worker_linux_smoke.py](worker_linux_smoke.py) đã chạy trên `.60`, xác nhận test fail trước sửa, OpenCode sửa file và ba test pass trong container Linux. Đây là probe coding, chưa nghiệm thu GitLab CI hoặc egress/recovery; xem [kết quả worker](../docs/worker-bootstrap-2026-11-04.md).
