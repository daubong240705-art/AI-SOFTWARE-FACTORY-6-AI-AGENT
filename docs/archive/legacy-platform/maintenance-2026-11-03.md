# Nhật ký bảo trì .14 và .13 — 03/11/2026

Thực hiện theo yêu cầu người dùng: xử lý dung lượng `.14`, được phép xóa hoàn toàn stack `btl-httt`; xử lý CA trên `.13`; bổ sung worker máy cá nhân. Thời gian theo Asia/Saigon.

## 1. Dung lượng .14 — hoàn tất

Trước xóa đã đối chiếu Compose project label, mount, image reference và đường dẫn thật:

- Stack `btl-httt`: frontend, backend, MySQL, cả ba đã dừng 5 ngày.
- Hai volume `btl-httt_mysql_data`, `btl-httt_uploads` chỉ được stack này dùng.
- Image `btl-httt-frontend:latest`, `btl-httt-backend:latest`, `mysql:8.4` không được container stack khác tham chiếu tại thời điểm xóa.
- `/opt/apps/btl-httt` là đường dẫn thật, không symlink hoặc chứa mount con; không thấy systemd/cron/nginx tham chiếu tên stack trong các vị trí đã kiểm tra.

Đã thực hiện Compose down đúng project với volumes, orphan containers và image; xóa thư mục `/opt/apps/btl-httt`. Không xóa repository trên GitLab/GitHub. Đây là xóa dữ liệu vĩnh viễn theo phạm vi người dùng cho phép, không tạo backup mới của database cũ.

Cache build được dọn bằng Docker API, không xóa thẳng `/var/lib/docker` hoặc containerd:

1. `docker builder prune --all --force --filter until=72h --keep-storage 8GB`: Docker báo 7.446 GB.
2. Bộ lọc `until=24h`, cùng budget: 269 MB.
3. Cache chưa dùng, cùng `--keep-storage 8GB`, bỏ giới hạn tuổi: Docker báo 13.93 GB.

Đây chỉ là cache; giữ image/container/volume của các stack khác, kể cả container đã dừng. Không chạy `docker system prune` hoặc volume prune tổng thể. Cache có thể phải build lại khi dự án khác build lần tiếp theo. `--keep-storage` là mục tiêu GC, không bảo đảm tổng con số trong `docker system df` bằng 8 GB do accounting/shared references.

| Chỉ số | Trước | Sau |
|---|---:|---:|
| Dung lượng trống đo bằng byte | 23,740,882,944 | 45,630,357,504 |
| Dung lượng trống GiB | 22.11 | **42.50** |
| Sử dụng filesystem (`df -h`) | 70% | **42%** |
| Container tổng / đang chạy | 22 / 12 | 19 / 12 |
| Named + anonymous volume tổng | 9 | 7 |
| Image tổng | 31 | 28 |
| Build cache Docker báo | 33.44 GB | 11.79 GB |

Giải phóng thực tế trên filesystem **20.39 GiB**. Đã vượt điều kiện còn trống ≥35 GiB để bootstrap ASF. Đối chiếu ID, running state và StartedAt của 19 container còn lại: không thay đổi do thao tác bảo trì. Safe School/ITCare vẫn có trạng thái healthy như trước.

Chưa cài lịch auto-prune, thay runner hoặc deploy ứng dụng mới. Theo dõi disk còn trống 20 GiB và chọn retention cache dựa trên tần suất build.

## 2. CA và DNS .13 — hoàn tất

CA công khai từ workspace có SHA-256 khớp Caddy server:

`364fc6615c952a558360a13f8cf09fa991d87792b5bec91e69952de5c3643aa4`

Đã cài file permission 0644 tại:

- `/usr/local/share/ca-certificates/caddy-local.crt`, chạy `update-ca-certificates` để cập nhật system store.
- `/etc/gitlab/trusted-certs/caddy-local.crt`, chạy embedded OpenSSL rehash.
- Hash link `/opt/gitlab/embedded/ssl/certs/fe4a7346.0` → CA trong trusted-certs. Layout này khớp `CertificateHelper` của Omnibus đang cài. Không sửa bundle CA gốc hoặc private key, không cần chạy full reconfigure/restart GitLab.

Để verify bằng hostname thật, bổ sung route DNS cho `.local` hiện hữu qua file:

`/etc/systemd/network/10-netplan-ens18.network.d/60-asf-private-dns.conf`

```ini
[Network]
Domains=~lazy.local
DNSDefaultRoute=yes
```

Giữ DNS server từ netplan đang có (`192.168.1.50`, `1.1.1.1`), không sửa địa chỉ/gateway. Reload networkd và flush resolver cache; không down/up interface hoặc reboot.

Một cấu hình trung gian dùng duy nhất AdGuard và route domain làm resolver bỏ default DNS route, khiến kiểm tra domain public lỗi. Đã phát hiện trong verification và sửa thành cấu hình trên, bật DNS default route tường minh, giữ DNS server có sẵn. Chỉ cấu hình cuối được chấp nhận.

Kiểm chứng cuối:

- `gitlab.lazy.local`, `ai.lazy.local` → `.51`; `gitlab-ssh.lazy.local` → `.13`.
- `getent` resolve được `github.com`, `developers.openai.com`, không làm mất DNS public.
- curl hệ thống GitLab sign-in và 9Router health: **HTTP 200**, không `-k`, không `--resolve`.
- Ruby embedded GitLab gọi hai URL trên: **200, TLS verified**. Gọi 9Router bằng service user `git` cũng trả **200**.
- curl domain public OpenAI trả redirect **308** với TLS được xác thực; không coi redirect là health endpoint 200.
- `networkctl status` hiển thị drop-in persistent đang áp dụng; GitLab puma/sidekiq/nginx và các service giữ nguyên PID, không restart do thay CA.

Chưa reboot để nghiệm thu persistence qua reboot; file systemd drop-in và trusted-certs đã ghi bền. Sau upgrade/reconfigure GitLab, kiểm tra lại hash link và thử TLS bằng embedded Ruby.

Rollback khi có nhu cầu: xóa đúng drop-in mới rồi reload networkd và khôi phục resolver theo netplan; xóa đúng CA/hash link đã thêm rồi chạy lại system CA update. Không xóa các CA khác. Xóa stack `btl-httt` không có rollback dữ liệu mới tạo trong đợt này.

## 3. Worker — quyết định cập nhật

Cho phép worker Linux cô lập trên máy cá nhân, bật khi cần; không bắt buộc VM server cố định. Chi tiết cấu hình, network, queue khi offline và gate nghiệm thu nằm ở [worker-options.md](worker-options.md), đồng bộ [ADR-002](../../adr/ADR-002-phan-bo-ha-tang.md).

Chưa cài VM/WSL/Docker/runner vào máy cá nhân trong đợt bảo trì. Việc chọn một slot hay hai slot cần dựa trên RAM/CPU/disk thực tế của PC và bài test trên Linux.
