# Chạy Factory bằng Docker

Một container chứa Host và UI. Lead và các agent dùng Claude Code CLI và Codex CLI **đã cài trên máy này**. Container gắn các CLI đó vào ở chế độ chỉ-đọc, nên khi bạn cập nhật CLI trên máy, container cũng dùng bản mới.

## Cần có trên máy

- Docker và Docker Compose v2.
- Claude Code đã đăng nhập, cài tại `~/.local/share/claude`.
- Codex (không bắt buộc), cài bằng npm tại `~/.local/npm/lib/node_modules/@openai/codex`.
- `~/.config/factory/env` (quyền 600) chứa `NINE_ROUTER_API_KEY=...` nếu Codex dùng 9router.

Nếu cài CLI ở chỗ khác, đặt `CLAUDE_INSTALL_DIR` hoặc `CODEX_PACKAGE_DIR` trong file `.env` (xem `docker/env.example`).

## Bật, tắt

```bash
docker compose up -d --build      # lần đầu: build rồi chạy; mở http://127.0.0.1:8787
docker compose up -d              # các lần sau
docker compose logs -f factory    # xem log
docker compose down               # tắt; dữ liệu vẫn giữ nguyên
```

Container tự khởi động lại cùng Docker (`restart: unless-stopped`). Không cần token đăng nhập vì Host chỉ nghe trên `127.0.0.1`.

Trên máy chỉ được chạy một Host ở cổng 8787. Nếu đang chạy Host ngoài Docker (`start-host-cli.sh`), hãy tắt nó trước, hoặc đổi `FACTORY_PORT`.

## Dữ liệu ở đâu

| Trên máy | Nội dung |
|---|---|
| `~/factory-docker/state` | CSDL của Host: dự án, task, tài liệu, chat |
| `~/factory-docker/workspaces` | mã nguồn các dự án (mở bằng VS Code được) |
| `~/factory-docker/worktrees` | worktree của từng lượt chạy task |
| volume Docker `factory_cli-home` | thông tin đăng nhập và phiên làm việc của CLI bên trong container |

Đổi thư mục dữ liệu bằng `FACTORY_DATA_DIR`. File trong đó thuộc user 1000 của máy (`FACTORY_UID`, `FACTORY_GID`).

## Đăng nhập CLI

Ở lần chạy đầu, container chép những file sau từ máy vào volume `factory_cli-home`:
- `~/.claude/.credentials.json`, `~/.claude/settings.json`, `~/.claude.json`;
- `~/.codex/auth.json`, `~/.codex/config.toml`.

Bản gốc trên máy được gắn chỉ-đọc, container không ghi ngược lại.

- Sau khi đăng nhập lại hoặc đổi cấu hình trên máy: `docker compose run --rm factory reseed`, rồi `docker compose restart`.
- Claude có thể làm mới token trong container, làm bản trên máy hết hiệu lực và ngược lại. Nếu bị đăng xuất, có hai cách:
  - chạy lại lệnh `reseed` ở trên;
  - tạo token dài hạn bằng `claude setup-token`, rồi thêm `CLAUDE_CODE_OAUTH_TOKEN=...` vào `~/.config/factory/env`.

## Lệnh kiểm tra

```bash
docker compose run --rm factory check    # node, git, claude, codex, đăng nhập, khóa 9router (không in giá trị)
docker compose run --rm factory shell    # vào shell với quyền user 1000
```

## Lưu ý an toàn

- **Mạng.** Container dùng chung mạng với máy (`network_mode: host`):
  - Host vẫn chỉ nghe trên `127.0.0.1`;
  - agent gọi được 9router và các dev server chạy tại máy;
  - mở game agent đang chạy ngay trên trình duyệt của máy.
- **Quyền của agent.** Agent có toàn quyền bên trong container, nhưng chỉ ghi được vào thư mục dữ liệu và volume CLI. Agent không thấy các thư mục khác của máy.
- **Đọc tài liệu.** Docker chặn bubblewrap, nên bộ đọc PDF/Office chạy trực tiếp trong container, giới hạn 2 GiB bộ nhớ. Tắt hẳn bằng `FACTORY_DOC_WORKER=off`.
- **Chứng chỉ.** Danh sách chứng chỉ tin cậy của máy được gắn vào container, nên các gateway dùng CA nội bộ (ví dụ Caddy) vẫn hoạt động.
- **Khóa API.** `NINE_ROUTER_API_KEY` chỉ được đọc từ file env. Khóa này không nằm trong image và không xuất hiện trong log.

Image bản gọn không có Blender hay Chromium. Team `game-studio` vẫn lập kế hoạch và viết code được, nhưng không dựng model 3D hay chụp ảnh trình duyệt trong container.
