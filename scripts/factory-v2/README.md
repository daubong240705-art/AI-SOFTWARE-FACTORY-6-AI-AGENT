# Factory V2 — Repository inventory

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
