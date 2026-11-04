# UX-05 — Kết quả, báo cáo và nghiệm thu tùy chọn

Ngày: 05/11/2026. Baseline `00bea6f`; checkpoint `checkpoint/ux05-start-20261105`. Worker giữ `1.3.0-alpha.8`; SQLite nâng từ schema 10 lên **11**. Không gọi model mới để tạo báo cáo.

## Đã triển khai

- `Reports` tạo một snapshot bất biến cho mỗi lượt terminal. Snapshot gắn `runId`, attempt root, work item/revision/submission, summary/error, task, command, review, file changes, source version và provenance model/runtime. Trigger SQLite từ chối sửa report đã lưu.
- Kết quả command phân biệt `Đạt / Chưa đạt / Chưa chạy / Chưa xác định`. Artifact output được kiểm tra hash; thiếu artifact hoặc blob hiện rõ, không đọc lại source hiện tại để dựng bằng chứng cũ.
- Review v2 chỉ thành `pass` khi acceptance có refs hợp lệ, review đã verified, task cuối hoàn tất và workspace integration đạt. Direct completed hoặc review legacy vẫn là chưa xác minh.
- Chính sách nghiệm thu nằm riêng theo work item, mặc định `required=false`, có version optimistic. Quyết định lưu một lần theo report; source/revision/lần chạy mới làm báo cáo cũ stale và khóa nút quyết định. Nghiệm thu không thay đổi evidence gate.
- **Yêu cầu sửa** ghi comment work item và tạo ChatSend continuation trong cùng transaction, dùng request UUID idempotent. Mất phản hồi, reload, restart, double click và queue removal không tạo run/comment trùng hoặc hồi sinh continuation.
- Export JSON có manifest/provenance/report hash, decision, command attachments và file diff đã lưu. Artifact thiếu được ghi `missing`; nội dung file chỉ lấy từ SQLite snapshot, có giới hạn hiển thị. Nội dung Markdown dùng renderer an toàn hiện có.
- UI `WorkReport` dùng trong RunPanel và Lần thực hiện của hồ sơ công việc. Tổng quan đưa các report có policy bắt buộc vào **Chờ nghiệm thu**. Bố cục giữ panel cuộn và hỗ trợ bảng/code dài, không raw HTML.

## Dữ liệu và migration

Schema 11 thêm `reports`, `report_policies`, `report_decisions`, index theo work item và trigger bất biến. Khi nâng từ schema 10, DB được backup thành `worker.schema10.pre-reports.backup.sqlite`. Các fixture migration cũ đã drop bảng schema 11 trước khi hạ user_version. Report terminal được tạo trong `Store.updateRun`; report cũ không được backfill tự động từ run history khi migrate.

Retention bảo vệ report gắn work item hoặc report đã có quyết định, cùng continuation receipt. Report run-only chưa được quyết định có thể đi cùng run khi đủ điều kiện prune. Prune xóa report trước khi garbage collect blob và kiểm tra lại refs/foreign keys.

Không nâng DB chính đang do app cũ mở trong đợt này. Khi đóng và mở bằng build mới, migration chạy tự động; không đổi settings/credentials. Rollback cần đóng app, giữ bản sao dữ liệu mới, phục hồi backup schema 10 và dùng binary tương thích backup.

## Kiểm chứng

- `npm run typecheck` đạt.
- `npm run format:check` đạt.
- `npm test`: **192/192 pass**.
- `npm run test:native` đạt, gồm SQLite reopen và Windows secure storage.
- `npm run build` đạt. Warning annotation từ Zod đã có, không phải lỗi build.
- `node scripts/run-acceptance.cjs reports-ui`: đạt, 4 viewport/zoom, không lỗi renderer, export/missing artifact/stale revision/acceptance/request-fix đã kiểm tra.
- Hồi quy `questions-ui`, `overview-ui`, `work-items-ui`: đều đạt; work-items đã cập nhật nút mở báo cáo cho attempt terminal.
- Hồi quy ChatHost đạt 4 viewport/zoom. Sau phần chỉnh cuối, chạy lại 30 bài report/evidence/lifecycle và acceptance report đều đạt; không chạy provider trong các fixture.

## File chính

- Mới: `shared/reports.ts`, `electron/storage/reports.ts`, `src/features/WorkReport.tsx`, `tests/reports.test.ts`, `scripts/acceptance-reports-ui.cjs`.
- Storage/IPC: `database.ts`, Controller `runs.ts`, `main.ts`, `preload.ts`, contracts/channels; sửa fixture migration để nhận schema 11.
- UI: `RunPanel`, `TaskInspector`, `WorkItemPanel`, `ProjectOverview`, `App`, styles và overview/inspector DTO; thêm đường mở thẳng tab Kết quả, không thêm trang điều hướng.
- README và kế hoạch experience-loops chuyển trạng thái sang UX-05 hoàn thành, tiếp theo UX-06.

## Giới hạn còn lại

Report chỉ hiển thị output/artifact đã được runtime lưu; run cũ thiếu snapshot vẫn được giữ ở trạng thái unknown. Chi phí luôn `Chưa xác định` vì gateway chưa cung cấp bảng giá. Policy hiện ở mức work item, chưa có nhiều policy theo tổ chức. UI hiện tải lịch sử report trong export hồ sơ, chưa có bảng riêng để duyệt hàng trăm report.

Đối chiếu source chạy khi mở báo cáo, bấm **Đối chiếu lại** và trước khi ghi quyết định; không thêm filesystem watcher. Nhãn có thời gian đối chiếu, không phải trạng thái source theo thời gian thực. Nghiệm thu chỉ ghi khi không còn active run/hàng chờ/lệnh local. Không có source snapshot đầy đủ thì nút nghiệm thu bị khóa; yêu cầu sửa chỉ cần đúng revision và không stale.

Một report có một quyết định cuối cùng. Muốn đổi yêu cầu sau khi đã nghiệm thu, dùng hồ sơ/Chat để tạo lượt mới. Work item/revision chỉ lấy từ liên kết có lúc chụp; report run-only đã chụp trước khi **Lưu thành công việc** không bị viết lại. Workspace tích hợp tiếp tục dùng hành vi **Mở bản tích hợp** hiện có trước khi chạy tiếp; chưa bật acceptance/fix trực tiếp trên báo cáo đó. Giới hạn vòng sửa/ngân sách trong mỗi lượt mới vẫn theo Controller; một yêu cầu sửa do người dùng gửi là một lượt mới.

Các bài kiểm tra đợt này không gọi provider. DeepSeek Flash/9Router đã được nghiệm thu ở UX-04; không tuyên bố có thêm bằng chứng model thật cho UX-05. Không xóa dữ liệu live hoặc đưa ảnh/DB vào commit. Tiếp theo **UX-06 — Mẫu công việc, readiness và Team**; 3D vẫn tạm dừng.

## Chạy lại

Từ `apps/windows-worker`:

```powershell
npm run typecheck
npm run format:check
npm test
npm run test:native
npm run build
node scripts/run-acceptance.cjs reports-ui
```

Ảnh, DB và log acceptance chỉ nằm trong `.cache` đã ignore; không đưa vào Git.
