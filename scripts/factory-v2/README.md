# Factory V2 — Repository inventory

## F1-01 — WSL preflight và setup recipe

```powershell
node scripts/factory-v2/capture-preflight.mjs
```

Chạy probe bằng Ubuntu Python thật, không CLI Windows; GET 9Router dùng CA repo, API key env hiện có được pipe qua stdin, không persist. Ghi snapshot `research/factory-v2/f1-01-preflight.json`. Có 10 tests probe/setup chạy trong WSL; wrapper chỉ capture baseline trước cài, không có option apply. [Kết quả và phạm vi](../../plan/factory-v2/f1-01-preflight.md).

`preflight-linux.py` hỗ trợ Linux root riêng và API key stdin; `setup-linux.py` mặc định chỉ in plan. Recipe `--apply` cần quyền ghi `~/factory-v2` và chỉ cài binaries checksum-pinned vào root đó, không sudo/system trust/auth changes. [Recipe](setup-linux.py), [toolchain lock](linux-toolchain.lock.json). Chạy unit tests: `python scripts/factory-v2/preflight.test.py`. Không gọi model trong preflight.

## F0-03 — Contracts và SQLite reference

```sh
cd packages/factory-contracts
npm ci --ignore-scripts --no-audit --no-fund
cd ../..
node scripts/factory-v2/verify-contracts.mjs
```

Verifier chạy typecheck/build package độc lập, 15 boundary tests và 11 SQLite tests trong memory, kiểm doc links/dependency boundary/source V1/checkpoint rồi ghi `research/factory-v2/f0-03-validation.json`. Cần Node ≥22.20.0 và Python SQLite hỗ trợ STRICT/JSON. Không khởi động V1 hoặc mở DB thật; không cài packages hệ thống. [ADR và giới hạn](../../plan/factory-v2/f0-03-contracts.md), [package README](../../packages/factory-contracts/README.md). Chạy riêng SQL: `python scripts/factory-v2/schema.test.py`.

## F0-02 — Design baseline

```sh
node scripts/factory-v2/build-style-guide.mjs
python scripts/factory-v2/verify-font.py
node scripts/factory-v2/verify-design.mjs
```

Mở `.cache/factory-v2/style-guide/index.html`; xem [design README](../../design/factory-v2/README.md). Builder chỉ Node built-ins, không cài packages, nối runtime hoặc mở DB. `verify-font.py` cần fontTools; Brotli có fallback built-in Node. Verifier tạo `research/factory-v2/f0-02-validation.json` và chạy geometry/render smoke tests; không phải browser visual hoặc app/runtime tests. Chạy riêng logic tests sau khi build:

```sh
node --test scripts/factory-v2/window-state.test.mjs scripts/factory-v2/preview.test.mjs
```

## F0-01 — Inventory

`inventory.mjs` là công cụ F0-01 chạy bằng Node built-ins và Git. Không cần npm install, không import app code, không chạy scripts/test dự án, không mở SQLite hoặc đọc credentials.

In inventory ra stdout:

```sh
node scripts/factory-v2/inventory.mjs --baseline 968d446
```

Ghi snapshot mới vào file trong repo (từ chối ghi đè file có sẵn):

```sh
node scripts/factory-v2/inventory.mjs --baseline 968d446 --output .cache/factory-v2-inventory.json
```

Trên Windows có thể thêm `--local-data-metadata` để `stat` đúng các tên DB/WAL/SHM và thư mục runtime/workspaces/owned-jobs của V1. Chỉ lấy existence/size/mtime, không đọc file; không ghi absolute home path vào snapshot. Không dùng option này trên Linux để suy ra data path Windows.

Baseline chốt thành full commit hash trước đọc source. Source/test paths lấy từ [reuse map](../../research/factory-v2/reuse-map.json); ghi SHA-256 từng blob, version Worker, số file/tree hash và trạng thái Git tại thời điểm capture. `sourceSchemaMaximum` là thông tin source V1 đã khảo sát, không phải query schema DB live. Snapshot có thể chứa tên dirty files: xem trước khi commit để không ghi tên riêng tư ngoài phạm vi.

Hai option `--baseline` và `--output` cần giá trị; không có option install/migrate/cleanup/recover. Công cụ có thể chạy lại vào stdout hoặc file output mới. Bản bàn giao: [F0-01 baseline](../../plan/factory-v2/f0-01-baseline.md).
