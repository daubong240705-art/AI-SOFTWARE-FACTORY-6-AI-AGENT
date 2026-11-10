# Factory V2 · Hướng dẫn tạo hai máy ảo cho M4 (AP-7)

Tài liệu này dành cho bạn (Operator) tự làm trên laptop. **Tôi không tạo VM thay bạn**
và chưa viết dòng code M4 nào. Nguồn: `docs/architecture/05-target-architecture.md` §21 và
`06-implementation-roadmap.md` (M4). Các con số dưới đây là giá trị gợi ý đã ghi trong tài liệu
kiến trúc, **chưa đo trên máy bạn**.

## Trạng thái đã cấu hình (10/11/2026)

Hai VM đã được tạo và cấu hình xong; phần còn lại của tài liệu giữ làm quy trình dựng lại.

| Hạng mục | `factory-cp` | `factory-node-1` |
|---|---|---|
| Tệp VM | `D:\vm\ubun1\factory-cp.vmx` | `D:\vm\ubun2\factory-node-1.vmx` |
| Địa chỉ tĩnh (VMnet8) | `192.168.187.10` | `192.168.187.11` |
| CPU / RAM / đĩa gốc | 2 / ~3,5 GB / 28 GB | 4 / ~7,5 GB / 57 GB |
| Hệ điều hành | Ubuntu Server **26.04.1** LTS (không phải 24.04) | như cột trái |
| SSH từ laptop | `ssh factory-cp` | `ssh factory-node-1` |
| Docker | không | Docker 29.1.3 (gói `docker.io` của Ubuntu) |

- Địa chỉ tĩnh nằm **ngoài** dải DHCP của VMnet8 (`192.168.187.128–254`) để không bị cấp trùng. Gateway và DNS
  `192.168.187.2`, dự phòng `1.1.1.1`.
- Tên miền `*.lazy.local` được định tuyến tới DNS nội bộ `192.168.1.50` bằng
  `/etc/systemd/resolved.conf.d/factory-lazy-local.conf`; `ai.lazy.local` phân giải ra `192.168.1.51` và TLS tin cậy
  CA Caddy (không dùng `-k`). Khi laptop rời mạng nhà thì 9Router không tới được.
- SSH chỉ dùng khóa `~/.ssh/factory_ed25519` (laptop), khóa host đã xác minh nằm trong `~/.ssh/known_hosts_factory`.
  Tài khoản `lazy` có `sudo` không cần mật khẩu (`/etc/sudoers.d/90-lazy-factory`).
- Công cụ: Node 22.23.4 và OpenCode 1.19.5 (bản ghim) trong `~/factory-v2`, đã chạy `preflight-linux.py` và
  `verify-linux-runtime.py` đạt trên cả hai VM (chưa gọi model).
- Snapshot `clean-base` tạo bằng `vmrun` sau khi mọi thứ trên đã xong.
- Chưa làm (thuộc M4): enrollment token, node Windows, ảnh Docker worker, Litestream, khóa API 9Router.

## 0. Đích đến

| Thành phần | Chạy ở đâu | Vai trò |
|---|---|---|
| `factory-cp` | VM Ubuntu Server 24.04 (VMware) | Control plane: Host (Fastify + SQLite), không chạy code agent |
| `factory-node-1` | VM Ubuntu Server 24.04 (VMware) | Node Linux: runtime agent trong sandbox/Docker |
| Node Windows | Chính laptop | Node có Codex/OpenCode/Claude Code, GPU cho job (về sau) |
| WSL Ubuntu | Laptop | Môi trường viết code và chạy test (như hiện nay) |

Hạn chế đã chấp nhận: laptop tắt hoặc ngủ thì hệ thống dừng (chưa đạt 24/7, E-01). Chuyển sang
máy luôn bật là việc của M2b, hiện hoãn.

## 1. Kiểm tra trước khi bắt đầu

- [ ] RAM laptop 31,7 GB: đóng bớt ứng dụng nặng khi chạy cả hai VM.
- [ ] Ổ **D:** còn ít nhất 100 GB trống (cần khoảng 90 GB thin-provisioned cho hai VM).
- [ ] VMware Workstation 25.0.1 chạy được (dịch vụ NAT/DHCP của VMnet8 đang chạy).
- [ ] File ISO **Ubuntu Server 24.04 LTS** (tải từ trang chính thức của Ubuntu, kiểm SHA256 theo trang tải).
- [ ] Thư mục VM **không** nằm trong OneDrive. Hai bản clone Kali hiện nằm trong OneDrive: đừng dùng chúng cho Factory.
- [ ] File CA của Caddy (`caddy-root.crt`, sha256 `364fc6615c952a558360a13f8cf09fa991d87792b5bec91e69952de5c3643aa4`
      theo `scripts/factory-v2/linux-toolchain.lock.json`): cần để VM tin chứng chỉ `ai.lazy.local` (9Router).

## 2. Giới hạn bộ nhớ WSL (làm trước)

Tạo hoặc sửa `C:\Users\ADMIN\.wslconfig`:

```ini
[wsl2]
memory=8GB
processors=6
```

Sau đó chạy `wsl --shutdown` rồi mở lại WSL. Con số 8 GB là gợi ý: tổng RAM dự kiến khoảng
25–28 GB trên 31,7 GB, nên đo lại khi chạy thật.

## 3. Tạo VM `factory-cp`

Trong VMware Workstation: **File → New Virtual Machine → Custom**.

| Mục | Giá trị |
|---|---|
| Tên | `factory-cp` |
| Vị trí | `D:\VMs\factory-cp` (không dùng OneDrive) |
| Hệ điều hành | Linux → Ubuntu 64-bit, ISO Ubuntu Server 24.04 |
| CPU / RAM | 2 vCPU / 4 GB |
| Mạng | **NAT (VMnet8)** |
| Đĩa | 30 GB, thin provisioning, **không** chọn "Allocate all disk space now" |

Cài Ubuntu Server: ngôn ngữ English, bật **OpenSSH server**, không chọn snap thêm. Tài khoản ví dụ
`factory`, hostname `factory-cp`.

## 4. Tạo VM `factory-node-1`

Giống mục 3 với: tên `factory-node-1`, thư mục `D:\VMs\factory-node-1`, **4 vCPU / 8 GB RAM**,
đĩa **60 GB** thin. Hostname `factory-node-1`.

## 5. Mạng và địa chỉ

1. Trong **Virtual Network Editor** giữ VMnet8 (NAT), ghi lại dải mạng (ví dụ `192.168.xx.0/24`).
2. Đặt **địa chỉ cố định** cho hai VM (chọn một trong hai cách):
   - Cách đơn giản: cấu hình netplan tĩnh trong VM (ngoài dải DHCP của VMnet8), hoặc
   - Dùng DHCP reservation trong `vmnetdhcp.conf` của VMware.
3. Ghi ba địa chỉ vào một chỗ (ví dụ ghi chú riêng, **không** commit): IP của `factory-cp`,
   IP của `factory-node-1`, IP của laptop trên VMnet8.
4. Kiểm tra từ laptop: `ping <IP factory-cp>`; từ mỗi VM: `ping <IP laptop trên VMnet8>`.
5. Đồng bộ giờ trong VM (`timedatectl status` phải báo `System clock synchronized: yes`). M4 dùng
   lease 60 s nên lệch giờ giữa các máy sẽ gây lỗi khó hiểu.

Control plane chỉ nên nhận kết nối từ mạng ảo của laptop. Không mở cổng ra Internet.

## 6. Cài công cụ trong từng VM

Làm trong **cả hai** VM (control plane cần Node, node cần thêm Docker):

```bash
sudo apt update && sudo apt -y upgrade
sudo apt -y install git curl ca-certificates python3 build-essential
```

### 6.1 CA của Caddy (để tin `ai.lazy.local`)

Sao chép `caddy-root.crt` vào VM, kiểm sha256 khớp giá trị ở mục 1, rồi:

```bash
sha256sum caddy-root.crt
sudo cp caddy-root.crt /usr/local/share/ca-certificates/caddy-root.crt
sudo update-ca-certificates
```

Không tắt kiểm tra TLS để "cho chạy được".

### 6.2 Node và OpenCode theo bản đã ghim

Repo có recipe đã dùng cho WSL; nó chỉ cài binary có checksum ghim vào `~/factory-v2`.
Trong VM, sau khi có bản sao repo (hoặc chỉ thư mục `scripts/factory-v2`):

```bash
python3 scripts/factory-v2/setup-linux.py            # chỉ in kế hoạch, không cài gì
python3 scripts/factory-v2/setup-linux.py --apply    # cài thật vào ~/factory-v2
python3 scripts/factory-v2/preflight-linux.py        # kiểm tra, chỉ đọc
```

Bản ghim hiện tại: Node 22.23.4, OpenCode 1.19.5. Đọc kế hoạch in ra trước khi `--apply`.

### 6.3 Docker (chỉ `factory-node-1`)

Cài Docker Engine theo hướng dẫn chính thức của Docker cho Ubuntu 24.04, thêm user vào nhóm
`docker`. Chưa cần cấu hình thêm: ảnh worker (`infrastructure/worker/Dockerfile`) sẽ được dùng ở M4.

## 7. Snapshot (bắt buộc)

Sau khi mục 3–6 xong và các lệnh kiểm tra đều đạt, **tắt VM sạch** rồi tạo snapshot:

| VM | Tên snapshot |
|---|---|
| `factory-cp` | `clean-base` |
| `factory-node-1` | `clean-base` |

Snapshot dùng để làm kịch bản sự cố K1–K7 ở M4 (tạm dừng VM, ngắt card mạng, khôi phục).
Snapshot **không thay** sao lưu dữ liệu: control plane vẫn dùng Litestream.

## 8. Việc cần làm trên Windows (node Windows)

Chưa làm gì bây giờ. Ở M4 node Windows chạy bằng WinSW dưới tài khoản người dùng (AP-R15). Chỉ cần
chắc rằng Node 22 và các CLI bạn muốn dùng (Codex, OpenCode) chạy được từ PowerShell thường.

## 9. Báo cho tôi khi xong

Gửi cho tôi, không kèm mật khẩu hay khóa:

1. Địa chỉ IP của `factory-cp`, `factory-node-1`, laptop trên VMnet8.
2. Kết quả (đạt/không đạt) của `preflight-linux.py` trong từng VM.
3. Xác nhận đã tạo snapshot `clean-base` ở cả hai VM.
4. Bất kỳ bước nào không làm được, kèm thông báo lỗi.

## 10. Không làm

- Không đặt VM trong OneDrive; không dùng VM Kali cũ.
- Không cài code agent hay chạy build nặng trong `factory-cp`.
- Không bật chuyển tiếp cổng ra Internet.
- Không đặt API key (ví dụ `NINE_ROUTER_API_KEY`) vào file trong repo; ở M4 key được cấp qua biến
  môi trường hoặc kho bí mật của node, tôi sẽ hướng dẫn riêng.
