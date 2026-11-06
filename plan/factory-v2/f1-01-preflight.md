# F1-01 · WSL preflight và recipe cài đặt

Ngày **06/11/2026**. Trạng thái **Done** ở mức môi trường F1-01: đã cài và kiểm Node/OpenCode Linux trong workspace người dùng cho phép. Checkpoint khảo sát `checkpoint/factory-v2-f1-01-20261106` tại `cad247b`; checkpoint apply `checkpoint/factory-v2-f1-01-apply-20261106` tại `15ffd0a`. Source, DB, credentials và deployment V1 giữ nguyên. Host/adapter/model turn V2 chưa triển khai.

## Kết quả thực tế

| Hạng mục | Đã xác minh trong Ubuntu WSL2 |
|---|---|
| Distro/user | Ubuntu 24.04.4 LTS; kernel 6.6.87.2-microsoft-standard-WSL2; `lazy`, UID 1000 |
| Tài nguyên | 20 logical CPUs; RAM khoảng 15,5 GiB; swap 4 GiB |
| Filesystem | Linux home ext4; checkout `E:` mount `/mnt/e` là 9p |
| Dung lượng | ext4 báo VHD ảo khoảng 1 TiB; **không phải ổ vật lý còn 1 TiB**. Windows C: khoảng 32,8 GiB, E: khoảng 42 GiB còn trống tại lúc đo; chưa xác định chắc VHD backing volume |
| Tool sẵn có | Bash 5.2.21, Git 2.43.0, Python 3.12.3, curl 8.5.0, OpenSSL 3.0.13 |
| SQLite | Python SQLite 3.45.1 có sẵn; SQLite CLI không phải prerequisite Host |
| Node/npm Linux | Đã cài Node 22.23.4, npm 10.9.9; binary Linux trong `/home/lazy/factory-v2/node/bin` |
| Agent CLI Linux | OpenCode 1.19.5 ELF chạy được, server health/OpenAPI đạt. Codex/Claude Linux chưa cài |
| DNS LAN | `ai.lazy.local` phân giải `192.168.1.51` |
| TLS | System trust chưa tin Caddy CA; CA repo đúng SHA-256 `364fc6615c952a558360a13f8cf09fa991d87792b5bec91e69952de5c3643aa4`, HTTPS verified khi chỉ định CA |
| 9Router | `/api/health` 200; `/v1/models` không key 401, key có sẵn 200; snapshot có 62 models |
| Model chọn ban đầu | `ds/deepseek-v4-flash` tồn tại trong danh sách; **chưa gọi inference trong WSL** |

[Evidence JSON](../../research/factory-v2/f1-01-preflight.json) chứa timestamp/probe riêng từng hạng mục. API key chỉ qua stdin giữa Windows và WSL, không ghi file, args, URL, log hoặc report. Chỉ GET health/models, không đổi credential, không đọc DB V1 hay sao chép auth home. Provider auth thành công không đồng nghĩa runtime CLI đã đăng nhập hoặc adapter tương thích; report tách các trạng thái này.

[Evidence sau cài](../../research/factory-v2/f1-01-installed.json) là hiện trạng mới; baseline trước cài giữ lại để đối chiếu. Node `fetch` tới health HTTPS đạt bằng `NODE_EXTRA_CA_CERTS`, không tắt TLS verification. OpenCode server chỉ bind `127.0.0.1` port động: anonymous health 401, authenticated health 200, OpenAPI có event/session/prompt_async/abort. Chỉ kiểm API surface, chưa thực hiện các phương thức session/abort/stream/model đó. Probe không tạo model session, không gửi request inference. Process group probe đã thoát và HOME/XDG tạm đã xóa; đây không phải evidence production adapter stop/recovery.

PATH mặc định Ubuntu vẫn có Windows shims (`windowsPathContamination` trong report); env V2 chọn native executables bằng PATH riêng. Không đổi cấu hình WSL/global PATH. Bật shell V2 bằng env.sh khi phát triển Host.

## Phương án chuẩn bị đã rà soát

Workspace đã được người dùng cấp: **`/home/lazy/factory-v2`**, với yêu cầu “giữ nguyên V1 và credentials hiện có”. Việc cài đã thực hiện trong phạm vi này, không cần hỏi lại quyền cho các bước phát triển V2 ở đây.

```text
/home/lazy/factory-v2/
  node/         Node Linux 22.23.4 + npm đi kèm
  opencode/     OpenCode Linux 1.19.5
  downloads/    archives đã kiểm checksum + staging tạm
  ca/           CA Caddy công khai, chỉ dùng cho tiến trình V2
  home/         HOME riêng cho tiến trình V2
  config/       XDG_CONFIG_HOME riêng
  data/         XDG_DATA_HOME riêng
  state/        XDG_STATE_HOME riêng, DB V2 sẽ ở state/factory-v2/
  cache/        XDG_CACHE_HOME riêng
  workspaces/   workspace công việc V2 về sau
  probes/       parent cho HOME/XDG probe tạm; từng probe được xóa sau khi dừng process
  env.sh        PATH/XDG/CA, không credential
```

[Recipe](../../scripts/factory-v2/setup-linux.py) mặc định **plan-only**. `--apply` chỉ chấp nhận literal `~/factory-v2`, Linux x64/non-root, native filesystem, không symlink ancestor, tối thiểu 2 GiB virtual free; backing Windows disk cũng cần đủ dung lượng. Root đã có dữ liệu mà thiếu marker thì từ chối. Bản chạy lại chỉ chấp nhận marker/artifacts/config giống nhau; khác cấu hình từ chối overwrite, không tự xóa/cập nhật. Nếu bị gián đoạn giữa rename artifact và ghi stamp thì báo để kiểm tra thủ công, không tự xóa directory.

Binary tải HTTPS từ Node distribution/npm registry, pin SHA-256/SHA-512 trong [toolchain lock](../../scripts/factory-v2/linux-toolchain.lock.json), kiểm trước giải nén, kiểm traversal/symlink/device/size và dùng Python tar data filter. Không chạy `curl | sh`, npm lifecycle scripts hay installer từ GitHub. Phiên bản Node 22.23.4 thỏa Node ≥22.20.0 của contracts, có runtime Linux riêng. OpenCode giữ 1.19.5 phù hợp SDK đã khảo sát, không tự nâng CLI mới nhất trước kiểm protocol F1-03.

Hash Node lấy từ official SHASUMS qua HTTPS; SRI OpenCode lấy npm version metadata. Đây là kiểm integrity từ kênh TLS/lock được rà soát, chưa xác minh chữ ký release độc lập hoặc audit toàn bộ binary. Node bundle có LICENSE/notices, OpenCode package cha `opencode-ai@1.19.5` khai báo MIT; native subpackage không có trường license. Không copy source thư viện vào sản phẩm.

`env.sh` chỉ source trong shell/process V2, giữ PATH thuần Linux và HOME/XDG riêng. Không sửa `.bashrc`, `/etc/wsl.conf`, DNS, `/etc/ssl`, global Node, sudo hoặc auth hiện có. CA riêng dùng `NODE_EXTRA_CA_CERTS`; không tắt TLS verify. F1-02 phải kiểm node fetch thật qua CA và local API/browser routing trước đánh sẵn dùng.

## Cách chạy

Trong PowerShell, capture baseline an toàn (dùng key env hiện có nếu có):

```powershell
node scripts/factory-v2/capture-preflight.mjs
node scripts/factory-v2/capture-preflight.mjs --installed
```

Trong WSL, chỉ xem recipe:

```sh
python3 /mnt/e/GIT/AI-SOFTWARE-FACTORY-6-AI-AGENT/scripts/factory-v2/setup-linux.py
```

Workspace Linux đã được cấp và recipe đã chạy; có thể chạy lại cùng phiên bản để kiểm không overwrite:

```sh
python3 /mnt/e/GIT/AI-SOFTWARE-FACTORY-6-AI-AGENT/scripts/factory-v2/setup-linux.py --apply
. /home/lazy/factory-v2/env.sh
node --version
npm --version
opencode --version
python3 /mnt/e/GIT/AI-SOFTWARE-FACTORY-6-AI-AGENT/scripts/factory-v2/preflight-linux.py --runtime-root /home/lazy/factory-v2
```

Lệnh cuối không tự cấp key; dùng stdin/env secret bridge khi cần authenticated models. Không copy API key vào env.sh hay đưa vào shell history. Probe runtime `--version` có thể khởi tạo cache/tool state trong HOME/XDG mới; phần preflight OS/mạng chỉ đọc. Chưa clone sang Linux hoặc chạy npm install trên checkout Windows bằng Linux. F1-02 chuẩn bị checkout Linux riêng trong phạm vi được cấp, cài dependency Linux từ lockfile và giữ Windows node_modules độc lập.

## Kiểm tra và phần chưa đạt

Đã chạy 10 bài kiểm probe/setup trên Windows và Ubuntu; chạy lại 10 tests Ubuntu sau cài, Ruff lint/format, syntax capture, `--apply` thật và lặp lại cùng recipe thành công. Cases: lỗi auth/network không lộ secret/body, origin không nhận credentials, checksum, archive traversal/links/size, config không overwrite, install root không escape, default không apply. Native Node/npm/OpenCode versions, Node CA, OpenCode server health/auth/schema và owned probe exit đều đạt. Không cài bằng sudo, không copy credentials Windows vào Linux, không mở DB V1.

Tiếp theo **F1-02**: checkout Linux riêng + Host/API/SQLite/outbox/auth/origin và recipe chạy/dừng. Model turn, streaming, session mapping và stop/reconcile của adapter thật thuộc F1-03; permissions hiệu lực thuộc F1-04. Runtime provider auth GET đã xác minh, nhưng không đánh đồng với một turn model thành công. Environment sẵn để xây Host; chưa phải sản phẩm V2 chạy được.

Nguồn chính thức đã đọc: [OpenAI Docs về WSL](https://learn.chatgpt.com/docs/windows/wsl), [OpenAI Docs về auth](https://learn.chatgpt.com/docs/auth), [OpenCode WSL](https://opencode.ai/docs/windows-wsl/), [CLI](https://opencode.ai/docs/cli/), [custom CA](https://opencode.ai/docs/network/), [Node 22.23.4 archive](https://nodejs.org/en/download/archive/v22.23.4). Chỉ dùng các phần phù hợp ranh giới Host local; không áp dụng hướng mở server `0.0.0.0` trong recipe này.
