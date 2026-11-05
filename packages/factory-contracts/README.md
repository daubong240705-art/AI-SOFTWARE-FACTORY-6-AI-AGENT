# Factory V2 contracts · F0-03

Package độc lập, không root workspace và không import V1. Zod 4.6.7 (MIT) là dependency runtime duy nhất; TypeScript 5.9.3 (Apache-2.0) dùng khi build. Phiên bản khóa trong `package-lock.json`. Không copy source thư viện hay dùng Electron IPC.

```powershell
cd packages/factory-contracts
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm test
```

`npm test` build declarations/ESM rồi chạy Node boundary tests. Package chưa được publish; Host/UI tương lai khai báo local dependency `file:../../packages/factory-contracts` và build contracts trước consumer. Không import từ `apps/windows-worker/node_modules`.

| Entry | Dùng cho |
|---|---|
| `@factory/contracts` | Browser-safe schemas, DTOs, commands, errors/receipts, events/cursor, profiles và preferences |
| `@factory/contracts/adapter` | Interface nội bộ Host: probe/grants/start/stop/reconcile và callback fencing guard |

Tất cả wire objects strict; IDs là UUID chuẩn hóa lowercase, revisions là số nguyên dương. Tạo agent/draft/output mới dùng `expectedRevision: null`, cập nhật dùng revision hiện có; không dùng `0` để lẫn hai thao tác. `projects.create` dùng envelope projectId làm ID mới. Entity refs được Host kiểm tồn tại/quyền/cùng project; schema không biết DB.

14 commands được định nghĩa cho foundation, **chưa có HTTP handlers hoặc runtime adapter thật**. `hostCapabilitiesSchema` công bố subset đã implement, UI không suy đoán từ `FOUNDATION_COMMANDS`. Rules/schedules/extensions chưa có schema lệnh, trả unsupported thay vì nhận payload `any`.

`classifyEvent` phân loại duplicate/gap/epoch; consumer chỉ gọi sau parse. `acceptsCallback` kiểm identity/lease trong bộ nhớ; Host vẫn phải kiểm epoch/lease/CAS và dedup inbox trong transaction. `grantMatches` kiểm attestation gắn đúng config; không tự thực thi sandbox. Không đánh đồng các helper với authorization, reconciliation hay exactly-once shell effects.

Đặc tả tích hợp: [ADR F0-03](../../plan/factory-v2/f0-03-contracts.md). SQL [reference](../../schema/factory-v2/001-core.reference.sql) được kiểm bằng SQLite memory; chưa áp dụng migration nào lên dữ liệu thật.
