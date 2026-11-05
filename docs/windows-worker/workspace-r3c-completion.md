# R3C — Hoàn thiện trạng thái kết quả và thao tác

Ngày 05/11/2026. Baseline `1e834b5`, checkpoint `e2c5168`. Worker `1.3.0-alpha.8`, SQLite14. [Kế hoạch](workspace-r3c-plan.md). **Hoàn thành phạm vi R3** qua R3A, R3B, Bash tự động và R3C; R4/R6 và 3D ngoài phạm vi.

## Kết quả

- Board, Tổng quan, Đội ngũ, chat lượt hiện tại và Tiến độ nhận cùng facts báo cáo: verification đã lưu, revision/attempt/archive, policy nghiệm thu và quyết định. Main truy vấn metadata SQLite theo project, không tải toàn bộ report/output hoặc quét source trong poll. Detail chỉ lấy metadata của đúng run.
- `ReportState`/`reportStateLabel` dùng chung nhãn báo cáo. Không có report không suy ra đã xác minh; revision mới, công việc lưu trữ hoặc attempt mới làm report cũ hết hiệu lực. Feed chưa đồng bộ không bị coi là source phiên bản trước.
- Summary hiện **Đã xác minh · Chưa đối chiếu source** khi bằng chứng đã lưu đạt nhưng chưa đối chiếu source ở lần đọc này. Mở report/Đối chiếu lại mới hash source và kiểm artifact; không giữ kết luận source current trong một cache không có watcher.
- Board **Xong** cần báo cáo đã lưu đạt, task/review hợp lệ và không còn yêu cầu nghiệm thu bắt buộc hoặc yêu cầu sửa. Chờ nghiệm thu ở Chờ review. Số task/tiêu chí xác minh vẫn thể hiện bằng chứng kỹ thuật, không bị xóa chỉ vì chưa nghiệm thu nghiệp vụ. Yêu cầu mới chưa gửi Lead trở về Sẵn sàng, không mang kết quả cũ thành Xong.
- `reportCapabilities` thống nhất điều kiện Nghiệm thu/Yêu cầu sửa/đổi policy. Nghiệm thu cần source current, không thiếu artifact được tham chiếu, chưa có quyết định và không còn active run/hàng chờ. Chưa đối chiếu source vẫn được yêu cầu sửa theo hành vi cũ; report hết hiệu lực hoặc integration không được tạo continuation nhầm. Controller và storage tiếp tục xác thực lại khi ghi, không dựa vào nút disabled.
- Policy đổi từ report gửi kèm run ID và kiểm tra revision/attempt/item trong transaction. API policy cũ không có run ID giữ tương thích như thao tác cấu hình của item; không đổi lịch sử report. Màn report khóa policy khi đang xem báo cáo hết hiệu lực.
- Chuyển run/project tạo vùng report riêng, xóa dữ liệu/nháp/diff của report trước; bỏ reply tải muộn sau unmount. Tải báo cáo lỗi có nút thử lại; tải lại thất bại khóa mutation cho tới khi đọc thành công. Giữ request ID khi mất reply quyết định để gửi lại không tạo continuation trùng.
- Không thêm dependency, migration, model call hoặc đổi DB/settings/credential người dùng. Bash tự động theo vai trò tiếp tục giữ nguyên.

## File thay đổi

Trong `apps/windows-worker/`:

- `shared/reports.ts`, `work-state.ts`, `runs.ts`, `board.ts`: facts, nhãn, capability và contract detail.
- `electron/storage/reports.ts`, `database.ts`: projection metadata, kiểm hết hiệu lực/policy/artifact khi nghiệm thu.
- `electron/controller/board.ts`, `monitor.ts`, `runs.ts`, `electron/main.ts`: đưa facts vào các view, cột Board, trạng thái runtime/local command và revalidation.
- `src/features/WorkReport.tsx`, `WorkProgress.tsx`, `ChatHost.tsx`, `ProjectOverview.tsx`: hiển thị và thao tác theo dữ liệu chung, lifecycle report.
- `tests/reports.test.ts`, `board.test.ts`, `monitor.test.ts`, `overview.test.ts`, `scripts/acceptance-reports-ui.cjs`, `acceptance-work-items-ui.cjs`: regression và fixture UI.

README Worker, experience-loops, phương án workspace và các bàn giao R3 được cập nhật điểm nối hiện hành.

## Kiểm chứng

| Kiểm tra | Kết quả |
|---|---|
| `npm test` | 239/239 đạt |
| Bộ tập trung sau thay đổi cuối: board/overview/monitor/reports | 42/42 đạt |
| `npm run typecheck`, `npm run build` | Đạt; cảnh báo annotation Zod baseline |
| Prettier các file thay đổi, `git diff --check` | Đạt |
| `reports-ui` | 4 layout; policy/accept/fix, mất reply gửi lại, hàng chờ khóa accept nhưng cho fix, report cũ khóa policy |
| `work-detail-ui` | 16 layout; hồ sơ/câu hỏi/tiến độ/kết quả |
| `overview-ui` | 5 layout |
| `work-items-ui` | 4 layout |
| `ux06-ui` | 4 layout; Team/Inbox/template/readiness |

Tổng **33 cấu hình UI**, không lỗi renderer ở các lần đạt. Đã xem ảnh report tại zoom 150%. Một assertion mới ban đầu đọc nút khi Đối chiếu lại còn busy; sửa fixture chờ kết thúc cập nhật rồi chạy lại đạt. Một lần Board fixture click tab khi gửi submission chưa kết thúc nên tab còn disabled; đã đối chiếu ảnh lỗi và thêm chờ UI hoàn tất trước click. Không coi lần lỗi fixture là bằng chứng sản phẩm đạt.

Log trong `apps/windows-worker/.cache/`: `r3c-unit-tests.log`, `r3c-focused.log`, `r3c-build.log`, `r3c-*-ui.log`. Các thư mục fixture gồm `reports-ui-P8rTh4/` (lần cuối; ảnh 150% đã xem ở lần đạt trước `reports-ui-G0Sio9/`), `work-detail-ui-PjQEzt/`, `overview-ui-UrCuE0/`, `work-items-ui-M9N5Ow/`, `ux06-ui-AThYZH/`. Artifact ảnh/DB chỉ local, không đưa lên Git.

## Giới hạn và tiếp theo

- Bằng chứng của đợt này là unit/SQLite và production Electron fixture, **không gọi model/OpenCode thật**, không kiểm usability hoặc benchmark 500 item/2.000 run.
- Summary xác nhận bằng chứng đã lưu, không cam kết source/artifact còn nguyên ở thời điểm poll; report detail kiểm tra lại khi mở và mutation đối chiếu lại. Các nhãn unknown diễn đạt đúng giới hạn này. `Xong` trên Board không phải chứng nhận source hiện tại chưa đổi.
- Màn hình mở lâu có thể giữ capability lần đọc trước cho tới khi Đối chiếu lại; Controller vẫn chặn quyết định không hợp lệ khi bấm. Chưa thêm watcher/timer hash source hoặc model tạo progress.
- Nghiệm thu nghiệp vụ không nâng verification kỹ thuật của direct/legacy report. Chức năng integration giữ đường mở workspace riêng. Không tự sửa dữ liệu lịch sử để đạt nhãn hoàn thành.
- Tiếp theo **R4**: summary/Team toàn app và index Kết quả theo project. Lịch UX-08 tiếp tục ở R6, 3D vẫn tạm dừng.

Đóng Worker cũ và chạy `npm start` trong `apps/windows-worker` để nạp bản mới. Rollback bằng revert source, không phục hồi schema.
