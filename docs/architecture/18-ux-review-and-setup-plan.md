# 18 · Kế hoạch rà soát giao diện và chuẩn hóa thiết lập hệ thống

| Mục | Giá trị |
|---|---|
| Trạng thái | **Kế hoạch**, bắt đầu sau khi U4 (engine Workflow v2) và U5 (canvas Quy trình) được gộp |
| Ngày | 19/11/2026 |
| Đề bài | Người dùng (19/11/2026): (1) rà soát chi tiết mọi giao diện, thao tác thêm/sửa/xóa phải rõ ràng; (2) thiết lập cấu hình hệ thống chi tiết, hướng dẫn chạy rõ ràng, theo chuẩn, **không mock**, dùng được trên **mọi máy** chứ không riêng máy của người dùng |
| Liên quan | [17 · Universal Multi-Agent Platform](17-universal-agent-platform.md) |

---

## Phần A · Rà soát giao diện (mã R-xx)

### A.1 Phạm vi

Toàn bộ 222 file màn hình trong `apps/factory-ui/src/screens/`, nhóm theo khu vực:

| Khu vực | Màn hình |
|---|---|
| Toàn hệ thống | Tổng quan, Cần xử lý, Đội (pack), **Thư viện**, Thế giới 3D, Hệ thống, Cài đặt, Đăng nhập |
| Trong project | Tổng quan, **Agent & Đội**, Văn phòng, Bảng việc, Tài liệu, Mã nguồn, **Quy trình** (v2), Quy trình v1, Cài đặt dự án (ngân sách, tự chủ, phê duyệt, tự động hóa, lưu trữ) |
| Hộp thoại | Tạo dự án, Game mới, Việc mới, chi tiết task, quyết định, so sánh, xem trước |

### A.2 Bảng kiểm cho mỗi thao tác thêm/sửa/xóa

| # | Tiêu chí | Đạt khi |
|---|---|---|
| C1 | Tìm thấy được | Nút tạo nằm ở vị trí nhất quán (góc phải tiêu đề khu vực) và dùng động từ rõ ràng ("Tạo agent", không dùng "Thêm" chung chung) |
| C2 | Form rõ | Nhãn tiếng Việt, gợi ý ngắn, đánh dấu trường bắt buộc, giới hạn độ dài hiển thị, giá trị mặc định hợp lý |
| C3 | Kiểm lỗi | Lỗi hiện ngay cạnh trường, trước khi gửi (dùng schema contracts); lỗi từ Host hiện bằng lời dễ hiểu, không phải mã lỗi |
| C4 | Phản hồi | Nút bận trong lúc gửi; thông báo thành công; danh sách cập nhật ngay; hộp thoại đóng sau khi lưu |
| C5 | Xóa an toàn | Xác nhận nêu rõ **cái gì bị xóa và hệ quả**; thao tác không hoàn tác được thì yêu cầu gõ tên; nếu có lựa chọn an toàn hơn (lưu trữ) thì gợi ý nó |
| C6 | Xung đột | Khi dữ liệu bị đổi ở nơi khác (`conflict`): báo rõ, cho tải lại, không mất phần đang nhập |
| C7 | Trạng thái rỗng / đang tải / lỗi | Mỗi danh sách có cả ba trạng thái, kèm hành động tiếp theo |
| C8 | Nhất quán | Cùng một thao tác có cùng tên, vị trí và icon ở mọi màn hình; menu "…" có cùng thứ tự (Sửa, Nhân bản, …, Lưu trữ, Xóa) |
| C9 | Bàn phím và trợ năng | Tab đi đúng thứ tự, Esc đóng hộp thoại, Enter gửi form, có `aria-label`, tương phản WCAG AA |
| C10 | Kích thước | Dùng được ở 1280px và ở cửa sổ hẹp (~800px) |
| C11 | Ngôn ngữ | Không lẫn tiếng Anh trên giao diện tiếng Việt (trừ tên riêng: Codex, Claude Code…); không lộ thuật ngữ nội bộ (seat, engagement, revision → "phiên bản") |
| C12 | Không giả | Không có nút "đang phát triển" bấm được mà không làm gì; tính năng chưa có thì ẩn hoặc ghi rõ |

### A.3 Cách làm (có bằng chứng, không đoán)

1. **R-0 · Kiểm kê tự động.** Viết bộ Playwright (`apps/factory-ui/e2e/audit/`) chạy với Host thật trên state tạm: đi qua mọi màn hình và mọi hộp thoại, chụp ảnh ở 1280px và 800px, giao diện sáng và tối, ghi lỗi console và request ≥ 400. Kết quả là một báo cáo HTML gồm ảnh và lỗi cho từng màn hình.
2. **R-1 · Chấm điểm.** Chấm từng thao tác theo bảng C1–C12 (ma trận màn hình × tiêu chí), xếp lỗi theo mức nặng: chặn thao tác, gây hiểu sai, khó chịu, thẩm mỹ.
3. **R-2..R-n · Sửa theo khu vực.** Mỗi lát sửa một khu vực, kèm test Playwright cho luồng thêm/sửa/xóa chính của khu vực đó. Bộ test này giữ lại để chạy hồi quy.
4. **R-final · Thống nhất thành phần.** Gom các hộp thoại xác nhận xóa, form, menu "…" và trạng thái rỗng thành component dùng chung. Thay `<select>` gốc bằng component Select của UI.
5. **Theo phản hồi trước đây của người dùng:** không xóa và không đổi kiểu màn hình đang dùng (Văn phòng, Bảng việc, Thế giới) khi chưa hỏi. Thay đổi lớn về bố cục phải chụp ảnh trước/sau để người dùng duyệt.

---

## Phần B · Thiết lập hệ thống chuẩn cho mọi máy (mã S-xx)

### B.1 Hiện trạng và vấn đề

| Vấn đề | Bằng chứng |
|---|---|
| Giá trị mặc định gắn với máy của người dùng | `https://ai.lazy.local/v1` trong `apps/factory-host/src/main.ts:96`, `start-host-cli.sh`, `start-host-real.sh`, `ubuntu-factory-machine.sh`; `NO_PROXY ... ai.lazy.local` trong `setup-linux.py` |
| Đường dẫn Windows/WSL cố định | `deploy-host-wsl.sh` mặc định `/mnt/e/GIT/...` |
| Chỉ hỗ trợ Ubuntu | `ubuntu-*-machine.sh` dùng `apt-get` |
| Cấu hình rải rác | Biến môi trường trong nhiều script, `~/.config/factory/env`, cờ dòng lệnh; không có một file cấu hình có tài liệu và có kiểm |
| Không có lệnh kiểm tra tổng | `--check` chỉ có ở launcher; `preflight-linux.py` gắn với F1-01 |
| Tài liệu cũ, rải rác | `docs/factory-v2-real-run.md`, `factory-v2-arch.md`, `m1-runbook`, `scripts/factory-v2/README.md` mô tả các giai đoạn cũ |

### B.2 Mục tiêu

- Một người lạ, trên một máy Linux, macOS hoặc Windows (qua WSL2) mới tinh, làm theo **một** hướng dẫn là có Factory chạy được với nhà cung cấp model của chính họ.
- Mọi bước kiểm tra là **kiểm thật**: chạy thật binary, ghi thật DB, gọi thật API, không trả "ok" giả.
- Không còn giá trị nào của máy người dùng nằm trong code hoặc script. Các cấu hình riêng (9Router, `.12`, Caddy CA) trở thành **một ví dụ cấu hình** trong tài liệu.

### B.3 Thiết kế

| Mã | Thành phần | Nội dung |
|---|---|---|
| **S1** | File cấu hình duy nhất | `$FACTORY_HOME/config/factory.env` (mặc định `~/.factory`), có `factory.env.example` ghi chú từng khóa. Thứ tự ưu tiên: biến môi trường > file cấu hình > mặc định an toàn. Host kiểm toàn bộ cấu hình khi khởi động và báo lỗi theo **mã lỗi + cách sửa**. Không còn URL gateway mặc định: nếu chưa cấu hình nhà cung cấp model thì Host vẫn chạy, nhưng UI báo "chưa có nhà cung cấp model" |
| **S2** | Nhà cung cấp model tổng quát | Kiểu `openai-compatible` (9Router, OpenAI, OpenRouter, LM Studio, Ollama, vLLM), kiểu `anthropic`. Mỗi kiểu có URL, khóa API, danh sách model và một phép thử thật (`GET /models` cộng một request ~1 token, do người dùng bấm). CA riêng khai báo bằng `FACTORY_EXTRA_CA_FILE`, không gắn với Caddy |
| **S3** | Bộ cài `scripts/install.sh` | Nhận diện hệ điều hành (Ubuntu/Debian, Fedora/RHEL, Arch, openSUSE, macOS, WSL2). Cài gói hệ thống bằng đúng trình quản lý gói, và chỉ phần đó cần sudo. Tải Node đã ghim kèm checksum (tái dùng `linux-toolchain.lock.json`). Build cả ba gói, cài vào `$FACTORY_HOME/app`, tạo dịch vụ chạy nền (systemd user trên Linux, launchd trên macOS). Chạy lại được nhiều lần; có `--dry-run` để xem trước |
| **S4** | Lệnh `factory` | `factory setup` (trình hỏi đáp: nhà cung cấp model, khóa API, model, CLI agent, cổng, địa chỉ nghe, mật khẩu đăng nhập khi mở ra LAN), `factory doctor` (kiểm thật từng mục, in mã lỗi và cách sửa, có `--json`), `factory start/stop/restart/status/logs`, `factory upgrade` (sao lưu DB, build, migrate, khởi động lại, tự quay lại bản cũ nếu Host không lên), `factory backup/restore` |
| **S5** | Trang "Hệ thống → Thiết lập" trên UI | Hiện kết quả `doctor` từ Host (`GET /system/doctor`), từng mục có trạng thái và hướng dẫn sửa; cấu hình nhà cung cấp model, khóa API chỉ cho ghi (lưu mã hóa theo §6.3 tài liệu 17); thử kết nối; trạng thái các CLI (đã cài, đã đăng nhập); danh sách runtime khả dụng |
| **S6** | Tài liệu `docs/setup/` (tiếng Việt) | Bắt đầu nhanh theo từng hệ điều hành; cấu hình từng loại nhà cung cấp; cài và đăng nhập Codex/Claude Code; mở truy cập LAN an toàn; nâng cấp, sao lưu, khôi phục; bảng tra lỗi theo mã `doctor`; một trang "ví dụ cấu hình của người dùng" (9Router + `.12`) |
| **S7** | Kiểm thật trên máy sạch | Script `scripts/test-install.sh` chạy `install.sh` trong container sạch (ubuntu:24.04, debian:12, fedora:41, archlinux) bằng Docker. Mỗi bản chạy `factory doctor`, khởi động Host, kiểm `/health`, chạy một quy trình mẫu bằng runtime giả (kiểm toàn bộ đường dispatch) và kiểm đăng nhập. Tùy chọn `--with-model` chạy thêm một task `api-agent` thật nếu có khóa API. macOS và WSL2 kiểm thủ công theo checklist có ghi kết quả |

### B.4 Mã kiểm của `factory doctor` (bản đầu)

| Mã | Kiểm gì (thật) | Mức |
|---|---|---|
| D-NODE | `node --version` ≥ 22.20 và đúng bản đã ghim | Bắt buộc |
| D-STATE | Thư mục state ghi được, không nằm trên `/mnt` hay ổ mạng, SQLite mở được ở chế độ WAL | Bắt buộc |
| D-GIT | `git --version`, có `user.name`/`user.email` cho commit của agent | Bắt buộc |
| D-PORT | Cổng Host còn trống hoặc đang là Factory | Bắt buộc |
| D-UI | Có bản build UI | Bắt buộc |
| D-MODEL | Nhà cung cấp đã cấu hình; `GET /models` trả 200; model đã chọn có trong danh sách | Cần cho Lead và `api-agent` |
| D-CODEX / D-CLAUDE | CLI có trong PATH, chạy `--version`, đã đăng nhập (lệnh trạng thái của CLI) | Tùy chọn |
| D-BWRAP | `bwrap` chạy được một lệnh trong sandbox | Cần cho OpenCode và tài liệu |
| D-LAN | Khi nghe trên địa chỉ mạng: có mật khẩu đăng nhập ≥ 24 ký tự, cảnh báo nếu tường lửa mở toàn bộ | Bắt buộc khi mở LAN |
| D-BACKUP | Thư mục sao lưu ghi được, có bản sao lưu trong 24 giờ qua | Cảnh báo |

### B.5 Thứ tự làm

1. **S1 + S2:** gỡ giá trị riêng, thêm file cấu hình và lớp kiểm cấu hình. Cập nhật `.12` theo cấu hình mới mà không đổi hành vi.
2. **S4 `doctor`** và endpoint `/system/doctor`.
3. **S3** bộ cài, **S7** kiểm trên container. Phải xanh trên 4 bản phân phối thì mới coi S3 là xong.
4. **S5** trang Thiết lập trên UI.
5. **S6** tài liệu. Viết cuối để mô tả đúng cái đã chạy thật; mỗi lệnh trong tài liệu đã được S7 hoặc người kiểm chạy qua.

Các lát chia cho nhiều Codex chạy song song khi vùng file không chồng nhau: S1/S2 (Host), S3/S7 (scripts), S5 (UI) sau khi S4 có API, S6 sau cùng. Mỗi lát được review, chạy lại test và kiểm thật trước khi gộp.
