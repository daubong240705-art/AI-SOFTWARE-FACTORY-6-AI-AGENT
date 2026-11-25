# Cài đặt và cấu hình Factory

Tài liệu cho người cài Factory lên một máy Linux. Mọi lệnh dưới đây đã được chạy thật. Bộ kiểm `scripts/test-install.sh` chạy chúng trong container sạch Ubuntu 24.04, Debian 12 và Fedora 41. Arch, macOS và WSL2 có trong bộ cài nhưng **chưa kiểm xong**, xem mục "Giới hạn hiện tại".

## 1. Cần gì

| Thứ | Ghi chú |
|---|---|
| Linux x64 (Ubuntu/Debian, Fedora/RHEL, Arch, openSUSE) | Hoặc WSL2. Không đặt thư mục cài dưới `/mnt` |
| `git`, quyền `sudo` | `sudo` chỉ dùng cho bước cài gói hệ thống |
| Một nhà cung cấp model tương thích OpenAI | Không bắt buộc để Host chạy. Cần cho Lead chat và agent `api-agent`. Xem mục 4 |
| Codex CLI hoặc Claude Code CLI (tùy chọn) | Cho agent cần shell và sửa file. Cài và đăng nhập theo hướng dẫn của từng CLI |

Node.js 22 được bộ cài tự tải đúng bản đã ghim và kiểm SHA-256.

## 2. Cài

```bash
git clone <địa chỉ repo Factory> factory-src
cd factory-src
bash scripts/install.sh --yes
export PATH="$HOME/.local/bin:$PATH"   # thêm vào ~/.bashrc nếu chưa có
```

Bộ cài làm 8 bước, chạy lại nhiều lần vẫn an toàn:
1. Nhận diện hệ điều hành.
2. Cài gói hệ thống.
3. Chuẩn bị Node.
4. Build contracts → Host → UI.
5. Cài vào `~/.factory/app`, giữ bản cũ ở `app.prev`.
6. Tạo file cấu hình `~/.factory/config/factory.env` (quyền 600), không bao giờ ghi đè file đã có.
7. Cài lệnh `factory` và dịch vụ người dùng (systemd).
8. Chạy `factory doctor`.

Tùy chọn hay dùng:

| Tùy chọn | Tác dụng |
|---|---|
| `--dry-run` | In từng bước sẽ làm, không thay đổi gì |
| `--prefix DIR` | Cài vào thư mục khác `~/.factory` |
| `--no-service` | Không đăng ký dịch vụ; tự chạy bằng `factory start` |

## 3. Cấu hình lần đầu

```bash
factory setup      # hỏi đáp: nhà cung cấp model, khóa API, model, cổng, địa chỉ nghe, CLI agent
factory doctor     # kiểm thật từng mục
factory start
```

Mở `http://127.0.0.1:8787/`. Trên giao diện, **Hệ thống → Thiết lập** hiện cùng các mục kiểm như `factory doctor`, kèm cách sửa từng mục.

File cấu hình là `~/.factory/config/factory.env`, dạng `KEY=VALUE`. File không được chạy như script shell. Biến môi trường thật ghi đè giá trị trong file. Xem giá trị đang có hiệu lực và nguồn của từng giá trị (khóa bí mật bị che):

```bash
factory config show
```

## 4. Nhà cung cấp model

Factory dùng mọi nhà cung cấp có API tương thích OpenAI (`GET /models`, `POST /chat/completions`).

| Nhà cung cấp | `FACTORY_MODEL_BASE_URL` | Ghi chú |
|---|---|---|
| Gateway nội bộ (9Router, LiteLLM…) | `https://<máy chủ>/v1` | Nếu gateway dùng chứng chỉ nội bộ, đặt `NODE_EXTRA_CA_CERTS` tới file CA gốc |
| OpenAI | `https://api.openai.com/v1` | |
| OpenRouter | `https://openrouter.ai/api/v1` | |
| Ollama | `http://127.0.0.1:11434/v1` | HTTP chỉ chấp nhận trên localhost |
| LM Studio | `http://127.0.0.1:1234/v1` | |
| Anthropic | Endpoint tương thích OpenAI của Anthropic | |

Các khóa liên quan:
- `FACTORY_MODEL_API_KEY`: khóa API.
- `FACTORY_LEAD_MODEL`: model cho Lead chat.
- `FACTORY_AGENT_MODELS`: tối đa 8 model cho agent `api-agent`, ngăn cách bằng dấu phẩy.

Có gateway phục vụ được model không có trong `GET /models`. Khi đó `doctor` chỉ cảnh báo; chạy `factory doctor --model` để gọi thử thật một request rất nhỏ.

## 5. Mở truy cập trong mạng LAN

Mặc định Host chỉ nghe `127.0.0.1`. Để máy khác trong LAN vào được:

```
FACTORY_LISTEN_HOST="<IP LAN của máy này>"
FACTORY_LOGIN_TOKEN="<chuỗi ngẫu nhiên từ 24 ký tự>"   # factory setup tạo giúp
```

Khi nghe trên địa chỉ mạng, đăng nhập mở (`FACTORY_OPEN_LOGIN`) bị tắt. Mở tường lửa chỉ cho dải mạng của bạn.

## 6. Vận hành hằng ngày

| Lệnh | Tác dụng |
|---|---|
| `factory status` / `factory logs -f` | Trạng thái và log |
| `factory stop` / `factory restart` | Dừng / khởi động lại |
| `factory backup` / `factory restore FILE` | Sao lưu và khôi phục DB |
| `factory doctor --json` | Kết quả kiểm dạng JSON, dùng cho script |

## 7. Tra lỗi theo mã `doctor`

| Mã | Ý nghĩa | Cách sửa |
|---|---|---|
| D-NODE | Node.js dưới 22.20 | Chạy lại `install.sh` (tự tải Node đã ghim) |
| D-STATE | Thư mục state không ghi được hoặc SQLite không dùng được WAL | Dùng ổ cục bộ (không phải ổ mạng hay `/mnt`), cấp quyền cho tài khoản chạy Host |
| D-GIT | Chưa cài git | Cài git. Không cần đặt `user.name` vì Host tự commit với tên "Factory" |
| D-PORT | Cổng đang bị tiến trình khác dùng | `factory stop`, hoặc đặt `FACTORY_PORT` khác |
| D-UI | Thiếu bản build giao diện | Chạy lại `install.sh` |
| D-MODEL | Chưa cấu hình hoặc không gọi được model | `doctor` nói rõ nguyên nhân: chứng chỉ TLS (đặt `NODE_EXTRA_CA_CERTS`), DNS, mạng, khóa API bị từ chối, hết hạn mức |
| D-CODEX / D-CLAUDE | CLI chưa cài hoặc chưa đăng nhập | Cài CLI và đăng nhập. Tùy chọn |
| D-BWRAP | Không chạy được sandbox bubblewrap | Cài gói `bubblewrap`. Chỉ cần cho OpenCode và xử lý tài liệu |
| D-LAN | Nghe trên LAN mà thiếu mật khẩu đăng nhập | Đặt `FACTORY_LOGIN_TOKEN` từ 24 ký tự |
| D-BACKUP | Chưa có bản sao lưu trong 24 giờ | `factory backup`; kiểm tra lịch sao lưu |
| D-CA | File CA bổ sung không đọc được | Sửa đường dẫn `NODE_EXTRA_CA_CERTS` |

Khi Host không khởi động được, dòng lỗi nêu nguyên nhân (ví dụ "cổng 8787 đã có tiến trình khác dùng") và không lộ giá trị bí mật.

## 8. Giới hạn hiện tại (25/11/2026)

- `factory upgrade` sao lưu DB, build và đổi sang bản mới. Nhưng bước kiểm sức khỏe đang báo nhầm "bản mới không khỏe" nên nó tự quay về bản trước. Phần quay về hoạt động đúng. Trong lúc chờ sửa, nâng cấp bằng `factory stop`, chạy lại `bash scripts/install.sh --yes` từ mã nguồn mới, rồi `factory start`.
- Cài với `--prefix` khác vẫn ghi đè lệnh `factory` chung ở `~/.local/bin`.
- Arch (mirror chập chờn khi kiểm), macOS và WSL2 chưa kiểm xong.

## 9. Ví dụ: cấu hình máy chủ hiện tại của dự án

Máy `.12` chạy bằng launcher cũ `scripts/factory-v2/start-host-cli.sh --agents codex --lead 9router` với `~/.config/factory/env`. Launcher này vẫn được hỗ trợ: khi chỉ có `NINE_ROUTER_API_KEY` mà không có địa chỉ gateway, Host dùng địa chỉ 9Router cũ và in cảnh báo nhắc đặt `FACTORY_MODEL_BASE_URL`.
