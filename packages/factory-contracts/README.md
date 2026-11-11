# Factory V2 contracts · F0-03

Package độc lập, không root workspace và không import V1. Zod 4.6.7 (MIT) là dependency runtime duy nhất; TypeScript 5.9.3 (Apache-2.0) và fast-check 4.10.2 (MIT, chỉ cho property test) là devDependency. Phiên bản khóa trong `package-lock.json`. Không copy source thư viện hay dùng Electron IPC.

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

20 commands được định nghĩa (14 foundation + 6 của 0.2.0), **chưa có HTTP handlers hoặc runtime adapter thật**. `hostCapabilitiesSchema` công bố subset đã implement, UI không suy đoán từ `FOUNDATION_COMMANDS`. Rules/schedules/extensions chưa có schema lệnh, trả unsupported thay vì nhận payload `any`.

`classifyEvent` phân loại duplicate/gap/epoch; consumer chỉ gọi sau parse. `acceptsCallback` kiểm identity/lease trong bộ nhớ; Host vẫn phải kiểm epoch/lease/CAS và dedup inbox trong transaction. `grantMatches` kiểm attestation gắn đúng config; không tự thực thi sandbox. Không đánh đồng các helper với authorization, reconciliation hay exactly-once shell effects.

Đặc tả tích hợp: [ADR F0-03](../../plan/factory-v2/f0-03-contracts.md). SQL [reference](../../schema/factory-v2/001-core.reference.sql) được kiểm bằng SQLite memory; chưa áp dụng migration nào lên dữ liệu thật.

## 0.2.0 · M0-lite (Multi-Team)

Thêm, không xoá: 14 command cũ và mọi schema cũ giữ nguyên (additive). Chỉ contracts, chưa có Host.

| Module | Nội dung |
|---|---|
| `org.ts` | Team, Seat (elastic/dedicated, Lead), Engagement |
| `work.ts` | Task (12 trạng thái nghiệp vụ, holds, origin gồm CTR, placement/sideEffect, mặc định hạn chế nhất), `deriveDisplayStatus` (5 trạng thái hiển thị, chỉ là phép chiếu) |
| `attempt.ts` | Attempt (15 trạng thái thực thi, `unknown` chỉ thoát qua `reconciling`), `canRequeueAfterLeaseExpiry`, effort chỉ low..xhigh |
| `knowledge.ts` | Artifact version bất biến theo hash, vòng đời tài liệu, `staleDependants`, chỉ `approved` mới là execution-grade |
| `approvals.ts` | Approval (question/review/start-gate), kết quả đúng một lần, `isExpired`/`isContextStale` |
| `effects.ts` | Bản ghi effect (`git.push-branch`, không bao giờ vào main/master), `unknown` không tự retry |
| `policy.ts` | Usage ledger (cost `unknown` không bao giờ thành 0), Budget task/day, `evaluateBudget` |
| `nodes.ts` | Node, capability declared/verified/observed có độ tươi, `nodeCanTake` (bộ lọc cứng) |
| `mcp-tools.ts` | 5 tool agent nhìn thấy; input không có trường định danh (relay tự gắn project/task/attempt/epoch) |

**Chồng lấn có chủ đích:** `taskSchema` và `attemptSchema` thay thế `workItemSchema` và `runSchema`, nhưng schema cũ được giữ để không phá tương thích. Ở M1, migration thật bỏ các bảng 001 bị thay (`work_items`, `assignments`, `run_attempts`, `leases`, `reservations`, `callback_inbox`) và các schema cũ.

SQL tham chiếu: [002-multiteam.reference.sql](../../schema/factory-v2/002-multiteam.reference.sql), kiểm bằng `python -I scripts/factory-v2/schema002.test.py`. Các bất biến (vòng đời, một attempt sống mỗi task, hash bất biến, quyết định không sửa lại, không push main) có cả ở Zod lẫn ở SQL.
