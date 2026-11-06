# ADR-002 — Phân bố hạ tầng

Ngày: 03/11/2026; cập nhật 04/11/2026. Trạng thái: VM worker **`.60` đã bootstrap**, đồng thời giữ phương án worker máy cá nhân linh hoạt. Xem [kết quả](../worker-bootstrap-2026-11-04.md).

- `.12`: OpenProject hiện hữu. `.13`: GitLab và Registry dự kiến. `.51`: Caddy/TLS hiện hữu. Giữ nguyên NetBird subnet routing.
- `.14`: Compose `asf-control` (dashboard, API, orchestrator worker, PostgreSQL, Redis), Compose `asf-helpdesk-staging` độc lập. Tổng limit mới tối đa 4 GiB lúc đầu; không chạy coding/test build trên host này.
- **Worker là tài nguyên đăng ký linh hoạt**, có thể chạy trên máy cá nhân qua môi trường Linux cô lập hoặc trên VM server. Không cần host/IP cố định hay bật 24/7. Khuyến nghị 4 vCPU, 8 GiB RAM, SSD 80 GiB cho tối đa hai job nhẹ; coding và CI chia chung concurrency budget.
- Máy cá nhân Windows: ưu tiên VM Linux riêng trên Hyper-V/VMware/VirtualBox; phương án nhẹ hơn là WSL2 distro riêng + container Linux với ngân sách CPU/RAM. Không dùng môi trường WSL đang có project/credential cá nhân. Tắt automount ổ Windows và interop nếu dùng WSL cho sandbox; không mount `/mnt/c`, home cá nhân hay Docker socket vào coding/job container.
- VM server luôn bật là lựa chọn tăng tính sẵn sàng khi cần job chạy lúc máy cá nhân tắt; không phải điều kiện bắt buộc của MVP. Người dùng đã cấp VM `.60`; chưa khảo sát tài nguyên còn lại của hypervisor để cam kết khả năng nâng cấp.
- VM thực tế người dùng cấp: `192.168.1.60`, hostname `worker`, 2 vCPU, RAM OS thấy 5408 MiB, disk 60 GiB. Đã mở root LV lên 58 GiB và pass Linux coding smoke. Khởi điểm concurrency 1; Runner đã cài nhưng chưa register, chưa nhận job CI. Cấu hình 4 vCPU/8 GiB/80 GiB bên trên là mức nâng cấp khuyến nghị, không phải điều kiện chặn bắt đầu Phase 1.
- Worker không mount Docker socket vào coding/job container; không privileged; workspace riêng mỗi role/run; credential ngắn hạn; giới hạn egress tới gateway/GitLab và package mirrors cần thiết. Test code phát sinh chạy ở VM này.
- Docker executor/rootless build không tự bảo đảm cách ly nếu cấu hình sai; S4/S7 phải chứng minh không thấy host socket, secret deploy, volume control plane và không thoát workspace.
- Deploy từ protected CI qua key riêng và forced-command wrapper root-owned trên `.14`, chỉ nhận stack/image manifest đã kiểm tra, không nhận shell command hay compose file tùy ý từ Agent. User deploy không thuộc docker/sudo tổng quát. Wrapper dùng đặc quyền hẹp để đổi đúng hai stack.
- Không sửa runner global hiện có vì phục vụ dự án khác; tạo runner CI riêng cho ASF, disable instance runners trên hai repo ASF, limit deploy nối tiếp bằng resource group. Build không được rơi xuống runner shell cũ.

Worker máy cá nhân kết nối LAN hoặc NetBird subnet; dùng kết nối ra ngoài tới Orchestrator/GitLab/9Router, không cần NAT port forwarding vào máy cá nhân. Orchestrator cấp job qua API HTTPS có lease/heartbeat, không mở Redis/PostgreSQL cho máy cá nhân; GitLab Runner tự poll GitLab. Đây là thiết kế cần triển khai và kiểm chứng, chưa có các endpoint worker trong repo.

Khi worker tắt/sleep/mất NetBird, ngừng cấp job mới; lease hết hạn thì chuyển interrupted và chỉ retry sau đối chiếu checkpoint/commit/idempotency. Không tự replay bước deploy/merge. BE/FE có branch/workspace riêng, có thể chạy trên hai worker khác máy; worker có một slot chỉ phù hợp bootstrap và chưa đáp ứng demo BE/FE chạy song song.

Nếu chưa có **worker đã nghiệm thu**, chỉ thực hiện control-plane/mock workflow và phát triển local; **giữ gate coding/build đóng**. Không chạy code không tin cậy trên `.12/.13/.14/.51`.

Sau bảo trì ngày 03/11/2026, `.14` còn **42.50 GiB** trống, đạt ngưỡng tối thiểu 35 GiB để bootstrap. Đã xóa stack `btl-httt` theo yêu cầu và dọn cache build không dùng; không thay container các stack khác. Xem [nhật ký bảo trì](../archive/legacy-platform/maintenance-2026-11-03.md). Theo dõi ngưỡng còn 20 GiB; giữ image release rollback khi bảo trì tiếp.
