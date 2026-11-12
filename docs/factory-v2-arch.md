# Factory V2 trên Arch Linux: từ máy trống đến chạy dự án thực tế

Tài liệu một file cho việc chuyển từ WSL (Ubuntu trên Windows) sang **Arch Linux thật**. Mọi lệnh chạy bằng người dùng thường trong terminal Arch (không dùng root, trừ bước `pacman`). Bản mã nguồn: nhánh `main`, tag `factory-v2-rc1` hoặc mới hơn.

**Trạng thái trung thực:** các script đã chạy trên WSL Ubuntu (Linux x64, glibc), chưa chạy trên Arch. Không có gì trong Host phụ thuộc vào WSL, nhưng bước nào hỏng trên Arch thì xem mục 12 và báo lại.

## 1. Gói hệ thống (một lần, cần root)

```
sudo pacman -S --needed git base-devel bubblewrap python curl tar xz
```
- `bubblewrap`: sandbox của agent OpenCode. `base-devel`: phòng khi mô-đun gốc `better-sqlite3` phải tự biên dịch.
- Kiểm tra sandbox: `bwrap --unshare-all --ro-bind / / --proc /proc --dev /dev true && echo bwrap-ok`. Nếu lỗi "Operation not permitted": kernel đang chặn không gian người dùng không đặc quyền (`linux-hardened` mặc định chặn). Bật bằng `sudo sysctl kernel.unprivileged_userns_clone=1` và ghi vào `/etc/sysctl.d/`.
- **Không cài Node bằng pacman cho Host.** Arch thường có Node mới hơn 22; Host dùng đúng **Node 22.23.4** do script ghim ở mục 3.

## 2. Lấy mã nguồn

```
mkdir -p ~/code && cd ~/code
git clone https://github.com/daubong240705-art/AI-SOFTWARE-FACTORY-6-AI-AGENT.git
cd AI-SOFTWARE-FACTORY-6-AI-AGENT
git checkout main        # hoặc: git checkout factory-v2-rc1
```
Thư mục mẹ gọi là `$REPO` bên dưới (`export REPO=~/code/AI-SOFTWARE-FACTORY-6-AI-AGENT`). Thư mục dữ liệu và công cụ của Factory là `~/factory-v2` (không nằm trong repo).

## 3. Công cụ ghim (Node 22, OpenCode, chứng chỉ gateway)

```
cd $REPO
python scripts/factory-v2/setup-linux.py            # chỉ in kế hoạch, không ghi gì
python scripts/factory-v2/setup-linux.py --apply    # cài vào ~/factory-v2 (kiểm checksum từng gói)
```
Sau đó có: `~/factory-v2/node` (Node 22.23.4), `~/factory-v2/opencode` (1.19.5), `~/factory-v2/ca/caddy-root.crt`.
Từ đây **mọi lệnh Node/npm** dùng PATH này (có thể thêm vào `~/.bashrc`):
```
export PATH="$HOME/factory-v2/node/bin:$HOME/.local/bin:$PATH"
node --version     # phải là v22.23.4
```

## 4. Build

```
cd $REPO/packages/factory-contracts && npm ci --no-audit --no-fund && npm run build
cd $REPO/apps/factory-host          && npm ci --no-audit --no-fund && npm run build
cd $REPO/apps/factory-ui            && npm ci --no-audit --no-fund && npm run build
```

## 5. Triển khai (chép bản build sang `~/factory-v2/app`)

```
cd $REPO
FACTORY_SRC=$REPO bash scripts/factory-v2/deploy-host-wsl.sh
```
Tên script có chữ "wsl" nhưng chạy được trên mọi Linux: nó chỉ từ chối đích nằm dưới `/mnt`. Nó xóa sạch `~/factory-v2/app` rồi chép lại, nên **dừng Host trước**. Dữ liệu ở `~/factory-v2/state` không bị đụng. Cuối script in dòng `Build: commit=… dirty=…` (cũng nằm trong `~/factory-v2/app/VERSION`).

## 6. Bộ trích xuất tài liệu (tùy chọn, cho trang Tài liệu)

```
bash $REPO/scripts/factory-v2/doc-worker/setup-doc-worker.sh
```
Tạo môi trường Python riêng (`~/factory-v2/doc-worker/venv`), cài MarkItDown theo khóa băm. Không cần root. Bỏ qua bước này thì Host vẫn chạy, chỉ không trích xuất PDF/Office (chip "Chưa bật bộ trích xuất").

## 7. Codex và Claude Code (cho agent chạy bằng CLI)

Cài bằng npm của Node ghim (binary vào `~/factory-v2/node/bin`, đã nằm trong PATH của Host):
```
npm i -g @openai/codex @anthropic-ai/claude-code
codex login                 # đăng nhập ChatGPT (mở trình duyệt)
claude auth login           # đăng nhập tài khoản Claude
codex --version && claude --version
```
- Đăng nhập nằm ở `~/.codex` và `~/.claude` của người dùng chạy Host. Factory không đọc hay lưu nội dung đó.
- Dùng đăng nhập thuê bao trong công cụ điều phối là vùng rủi ro về điều khoản của Anthropic (đã nêu ở tài liệu 15). Quyết định là của bạn.
- Không cài CLI thì chỉ dùng được OpenCode (mục 9, không có `--local-cli`).

## 8. Gateway model và mạng

- Gateway mặc định `https://ai.lazy.local/v1` (Caddy `192.168.1.51`). Máy Arch phải phân giải được tên này: dùng DNS của LAN (`192.168.1.50`) hoặc thêm dòng `192.168.1.51 ai.lazy.local` vào `/etc/hosts`.
- Chứng chỉ CA đã được script cài ở `~/factory-v2/ca/caddy-root.crt`; script khởi động tự đặt `NODE_EXTRA_CA_CERTS` trỏ vào nó.
- Kiểm tra: `curl --cacert ~/factory-v2/ca/caddy-root.crt https://ai.lazy.local/v1/models -H "Authorization: Bearer $NINE_ROUTER_API_KEY" | head -c 200`
- **Khóa API chỉ đặt trong biến môi trường của shell chạy Host.** Đừng ghi vào file trong repo.

## 9. Chạy Host

```
export NINE_ROUTER_API_KEY=...                       # khóa của bạn
export FACTORY_AGENT_MODELS=ds/deepseek-v4-pro       # model cho agent OpenCode (cái đầu là mặc định)
export FACTORY_LEAD_MODEL=ds/deepseek-v4-pro         # model của Lead (đổi được ở trang Hệ thống)
cd $REPO
bash scripts/factory-v2/start-host-real.sh --check                 # kiểm tra điều kiện, không khởi động, không tốn token
bash scripts/factory-v2/start-host-real.sh --agents codex          # chạy; vị trí chưa cấu hình riêng dùng Codex CLI
```
Các tùy chọn: `--agents codex|claude|opencode`, `--local-cli` (chỉ bật CLI, chọn từng vị trí trong giao diện), `--slots N` (số agent chạy cùng lúc; mặc định tự tính từ số lõi CPU và RAM, tối đa 16; máy 32 GB sẽ ra con số lớn), biến `FACTORY_MULTI_TEAM=1` (nhiều đội), `FACTORY_BUDGET_TASK_TOKENS` và `FACTORY_BUDGET_DAY_TOKENS` (mặc định 500k và 2 triệu).
- Host in một **mã đăng nhập dùng một lần**. Mở `http://127.0.0.1:8787/`, dán mã.
- Dừng bằng `Ctrl+C`. Chạy nền: dùng `tmux` hoặc dịch vụ systemd (mục 11).
- Agent chạy bằng CLI có **toàn quyền** của người dùng Arch trong worktree của từng việc. Muốn giảm rủi ro, tạo một người dùng Linux riêng cho Factory (mục 10).

## 9b. Chạy chỉ bằng CLI (không OpenCode, Lead bằng Claude Code)

```
bash scripts/factory-v2/start-host-cli.sh --check                  # kiểm tra, không khởi động
bash scripts/factory-v2/start-host-cli.sh                          # vị trí chưa cấu hình riêng chạy Claude Code
export NINE_ROUTER_API_KEY=...; bash scripts/factory-v2/start-host-cli.sh   # thêm: Codex (provider 9Router) dùng được
```
- Không cần OpenCode, bubblewrap, proxy model hay gateway cho Lead: Lead chat chạy `claude -p` bằng đăng nhập Claude của bạn. Trang Hệ thống chỉ còn các model `opus`, `sonnet`, `haiku` cho Lead.
- Ngân sách token không chặn (vẫn ghi lượng token của Lead). Agent CLI dùng hạn mức thuê bao của chính CLI.
- Codex cấu hình provider 9Router đọc khóa từ `NINE_ROUTER_API_KEY`: script chỉ truyền biến đó cho CLI khi nó có trong shell (`FACTORY_CLI_PASS_ENV`). Không có khóa thì vị trí chạy Codex sẽ thất bại.
- Không muốn `export` mỗi lần: lưu khóa vào `~/.config/factory/env` (quyền 600, dòng `NINE_ROUTER_API_KEY=...`). Script tự đọc file này nếu biến chưa có trong shell; file có quyền rộng hơn bị bỏ qua. Khóa khi đó nằm trên đĩa: lựa chọn của bạn.
- Vị trí đang cấu hình `OpenCode` sẽ báo "runtime unavailable": đổi về "Kế thừa" hoặc chọn CLI.
- Agent có **toàn quyền** người dùng chạy Host trong worktree của từng việc.

## 10. Dự án thực tế

```
node ~/factory-v2/app/apps/factory-host/dist/workspace/cli.js clone \
  --projects-root ~/factory-v2/workspaces --name <tên> --source <thư mục repo nguồn>
```
In ra `root` của bản clone (chỉ lấy nội dung đã commit). Trên giao diện: "+" → loại "Dự án Git" → "Chọn thư mục…" → chọn bản clone. Mỗi dự án tự có Software Team (Lead, PM, BA, FE, BE, DevOps, Test). Chat với Lead, duyệt kế hoạch, bắt đầu.
- Agent OpenCode chạy trong sandbox **không có mạng**; agent Codex/Claude CLI chạy trực tiếp nên có mạng và cài được thư viện.
- Không bao giờ cấu hình `FACTORY_PUSH_REMOTES` trỏ vào repo không phải của bạn.
- Tùy chọn an toàn hơn: tạo người dùng riêng (`sudo useradd -m factory`), cài mọi thứ dưới người dùng đó, chỉ cấp cho nó những khóa SSH và quyền bạn muốn agent có.

## 11. Chạy như dịch vụ (tùy chọn)

`~/.config/systemd/user/factory-host.service`:
```
[Unit]
Description=Factory V2 Host
[Service]
EnvironmentFile=%h/.config/factory/env
ExecStart=/usr/bin/bash %h/code/AI-SOFTWARE-FACTORY-6-AI-AGENT/scripts/factory-v2/start-host-real.sh --agents codex
Restart=on-failure
[Install]
WantedBy=default.target
```
`~/.config/factory/env` (quyền `chmod 600`) chứa các dòng `NINE_ROUTER_API_KEY=…`, `FACTORY_AGENT_MODELS=…`, `FACTORY_LEAD_MODEL=…`. Khi dùng cách này **khóa API nằm trên đĩa**: đó là lựa chọn của bạn. Bật: `systemctl --user daemon-reload && systemctl --user enable --now factory-host`. Mã đăng nhập một lần xem bằng `journalctl --user -u factory-host -n 20`. Muốn chạy khi chưa đăng nhập: `loginctl enable-linger $USER`.

## 12. Chuyển dữ liệu từ WSL sang Arch

Làm trước khi tắt WSL, **dừng Host cũ** (Ctrl+C) để không còn khóa `.host-running`:
```
# trong WSL
cd ~/factory-v2
tar czf /mnt/c/Users/<tên>/factory-data.tgz state workspaces sources
```
Chép file sang Arch (USB, `scp`…), rồi:
```
cd ~/factory-v2 && tar xzf /path/to/factory-data.tgz
```
- `state/` chứa cơ sở dữ liệu SQLite, kho nội dung và sao lưu. **Đường dẫn dự án được lưu tuyệt đối** (ví dụ `/home/lazy/factory-v2/workspaces/textstats`): để không phải sửa, dùng **cùng tên người dùng** (`lazy`) trên Arch, hoặc tạo lại các dự án và clone mới (đơn giản hơn khi dữ liệu còn ít).
- Dữ liệu demo (e2e) và `worktrees` không cần chuyển.
- Nếu bắt đầu mới: bỏ qua bước này, Host tự tạo cơ sở dữ liệu ở `~/factory-v2/state`.

## 13. Kiểm tra sau khi chạy

1. Trang đăng nhập hiện, dán mã vào được.
2. **Hệ thống**: Host "Đang chạy"; thẻ Model hiện đúng model; thẻ "Công cụ agent trên máy" hiện Codex và Claude "Đã đăng nhập"; sao lưu có.
3. Tạo dự án, **Đội → Cấu hình**: có Software Team; "Cấu hình agent" mở ra và hiện trạng thái đăng nhập hai CLI.
4. Chat với Lead: trả lời được (chứng tỏ gateway và khóa đúng). Giao một việc nhỏ ở dự án thử và theo dõi sự kiện trong chi tiết việc.

## 14. Sự cố thường gặp

| Triệu chứng | Nguyên nhân và cách xử lý |
|---|---|
| `State directory is in use; stop the Host…` | Có Host khác đang chạy, hoặc lần trước tắt đột ngột: kiểm tra `pgrep -af factory-host`; nếu chắc không còn tiến trình, xóa `~/factory-v2/state/.host-running` |
| `better-sqlite3` báo sai phiên bản Node | Đang dùng Node không phải 22.23.4: kiểm tra `which node`; chạy lại `npm ci` bằng Node ghim rồi build và triển khai lại |
| `bwrap: …Operation not permitted` | Xem mục 1 (không gian người dùng không đặc quyền) |
| Lead trả "chưa cấu hình model" | Thiếu `NINE_ROUTER_API_KEY`/`FACTORY_LEAD_MODEL` trong shell chạy Host, hoặc `ai.lazy.local` không phân giải |
| Preflight "gateway rejected the key" / "does not list <model>" | Sai khóa hoặc sai tên model (xem danh sách ở hộp "Đổi model" hoặc lệnh `curl` ở mục 8) |
| Việc báo "codex: not logged in" | Chạy lại `codex login` (hoặc `claude auth login`) bằng đúng người dùng chạy Host |
| Việc báo "runtime unavailable" | Vị trí được đặt chạy bằng CLI nhưng Host chưa khởi động với `--local-cli`/`--agents` |
| Port bận | Đổi `FACTORY_PORT` (mặc định 8787; cổng proxy là cổng + 1) |
| Script báo `\r` hoặc `bad interpreter` | File sao chép từ Windows có CRLF; dùng `git clone` trên Arch (script đã khóa LF) |

## 15. Khác biệt cần nhớ so với WSL

- Không còn `/mnt`, đĩa ext4 hoặc btrfs trực tiếp: nhanh hơn rõ rệt cho `git worktree` và build.
- Toàn bộ RAM và CPU của máy: tăng `--slots` (mục 9). Giới hạn thực sự còn lại là hạn mức nhà cung cấp, ngân sách token và khả năng duyệt của bạn.
- Không cần `refresh.sh`, `deploy-host-wsl.sh` từ `/mnt/e`, CA qua `NODE_EXTRA_CA_CERTS` giữ nguyên.
- Phần "node Windows" đã hoãn: máy Arch vừa là Host vừa là node cục bộ.

## 16. Việc nên làm theo thứ tự

1. Mục 1 đến 5 (khoảng 10 phút, chủ yếu tải gói).
2. Mục 7 và 8, rồi `--check` (mục 9).
3. Chạy dự án thử `textstats`: một việc nhỏ qua Codex, xem sự kiện; gặp lỗi gửi cho tôi thông báo trong chi tiết việc cùng dòng lỗi ở terminal Host.
4. Chuyển dữ liệu thật (mục 12) khi mọi thứ ổn.
