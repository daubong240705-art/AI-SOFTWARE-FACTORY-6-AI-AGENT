# Factory V2: scripts

## F1-01 — WSL preflight và setup recipe

```powershell
node scripts/factory-v2/capture-preflight.mjs
node scripts/factory-v2/capture-preflight.mjs --installed
```

Chạy probe bằng Ubuntu Python thật, không CLI Windows; GET 9Router dùng CA repo, API key env hiện có được pipe qua stdin, không persist. Mặc định ghi snapshot baseline `research/factory-v2/f1-01-preflight.json`; `--installed` kiểm workspace Linux được cấp, Node HTTPS và OpenCode loopback health/auth/OpenAPI rồi ghi `research/factory-v2/f1-01-installed.json`. Wrapper không có option install/apply. [Kết quả và phạm vi](../../plan/factory-v2/f1-01-preflight.md).

`verify-linux-runtime.py` chỉ kiểm sau cài: tạo HOME/XDG tạm dưới `~/factory-v2/probes`, start server loopback với password ngẫu nhiên trong memory, không session/model request; gửi SIGTERM/kill đúng process group sở hữu và xác minh đã thoát, xóa probe tạm. Không đọc cấu hình/auth V1.


## F0-03 — Contracts và SQLite reference

```sh
cd packages/factory-contracts
npm ci --ignore-scripts --no-audit --no-fund
cd ../..
node scripts/factory-v2/verify-contracts.mjs
```


## F0-02 — Design baseline

```sh
node scripts/factory-v2/build-style-guide.mjs
python scripts/factory-v2/verify-font.py
node scripts/factory-v2/verify-design.mjs
```

Mở `.cache/factory-v2/style-guide/index.html`; xem [design README](../../design/factory-v2/README.md). Builder chỉ Node built-ins, không cài packages, nối runtime hoặc mở DB. `verify-font.py` cần fontTools; Brotli có fallback built-in Node. Verifier tạo `research/factory-v2/f0-02-validation.json` và syntax.
