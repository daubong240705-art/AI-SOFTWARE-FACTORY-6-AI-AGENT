# AU-2A — Bàn giao task có cấu trúc

Hoàn thành ngày 04/11/2026 trên nhánh `feature/agent-upgrade-au2a`. Baseline `91cecf4`, checkpoint `checkpoint/au2a-20261104`. [Kế hoạch](../../plan/agent-upgrade/implementation-plan.md).

## Vấn đề và kết quả

Trước đây mỗi dependency gửi summary cắt 6000 ký tự, toàn bộ danh sách file và output tail 2500 ký tự; review gửi các task mới nhất cùng tất cả lệnh của run. Context không có tổng giới hạn hoặc thông tin phần bị cắt. Khi fix/retry, bản “mới nhất” bị đổi ID về task gốc nên không phân biệt rõ ID bàn giao và lần thực thi.

Giờ dependency và Lead review dùng chung `buildHandoff()`. Gói bàn giao có:

- `taskId` gốc để giao fix; `attemptId`, round/kind, role và state của lần thực thi thật. Map latest giữ đối tượng task thực tế thay vì đổi ID; validator review vẫn dùng ID gốc để giữ contract hiện hành.
- Scope, dependency và tham chiếu `{runId, taskId}` đến báo cáo đầy đủ đã lưu trong lịch sử task.
- Báo cáo tự khai tách status, summary, blockers và unverified; luôn ghi `verified:false`.
- File thay đổi và command của đúng `taskId` thực thi. Không chọn command chỉ bằng call ID. Command có exit/status, excerpt và tham chiếu `{runId, taskId, callId}`.
- `truncated`, số mục/command lỗi bị lược bỏ và độ dài excerpt gốc. Excerpt giữ đầu/cuối để không chỉ còn phần đuôi log.

Task triển khai chỉ nhận dependency trực tiếp liên quan; fix nhận bàn giao của lần thực thi trước, TEST retry nhận bản fix mới nhất. Review nhận các task mới nhất và các lệnh thuộc những attempt đó; attempt thất bại cũ vẫn nguyên trong lịch sử, không gửi lặp toàn bộ vào mỗi review.

## Giới hạn context

Gói JSON bàn giao giới hạn **32.000 ký tự sau serialize**, tối đa 10 task. Đây là giới hạn packet, không phải token hoặc toàn bộ request (còn prompt yêu cầu, plan và lịch sử chat).

Mức bình thường: tối đa 1800 ký tự summary/task, 600 ký tự/blocker, 1200 ký tự output lỗi, 6 command và 12 file/task. Khi vượt tổng giới hạn, rút gọn theo các mức xác định, ưu tiên blocker/error và command thất bại trước summary dài, file hoặc lệnh thành công. Luôn báo số phần lược bỏ; ở mức rất gọn có thể không còn output text nhưng vẫn giữ trạng thái lỗi, exit code, số command lỗi và source reference. Ref không bị cắt thành ID giả; reference bất thường quá lớn thì bỏ entry có đánh dấu hoặc dừng nếu vẫn không thể tạo packet hợp lệ.

`source` là reference do ứng dụng quản lý, không phải đường dẫn cấp quyền cho model đọc SQLite/blob. Không có tool truy xuất storage mới. Khi excerpt thiếu bằng chứng cần thiết, Lead phải báo unverified/blocked thay vì đoán phần còn thiếu. Báo cáo và output gốc giữ theo giới hạn lưu trữ WW-4C, không bị builder ghi đè.

## Báo cáo task dễ đọc

Controller yêu cầu work/fix kết thúc bằng bốn mục văn bản, vẫn hiển thị được trong chat:

```text
Trạng thái: done_with_concerns
Kết quả: Đã sửa src/api.ts; npm test exit 0.
Blocker: —
Chưa xác minh: Chưa mở trình duyệt.
```

Parser còn chấp nhận JSON cùng schema, nhưng không ép JSON kỹ thuật lên chat. Nếu báo cáo không đúng định dạng hoặc là văn bản cũ, giữ nguyên summary, đánh dấu `format:legacy`, status chưa biết và `verified:false`. Không gọi model sửa định dạng, không tạo file báo cáo ngoài scope. PM/BA cũng nhận contract task từ Controller; direct vẫn trả lời bình thường.

Lead/BE/FE/TEST/DEVOPS profile lên `1.2.0`; PM/BA và skills giữ version hiện tại. Prompt nhắc phân biệt báo cáo với evidence, kiểm tra spec lẫn quality trong một lượt review và không bỏ qua phần chưa xác minh.

## File đã đổi

- Thêm `apps/windows-worker/electron/team/handoff.ts`: parser, report contract, packet builder và budget.
- Sửa `electron/team/coordinator.ts`: tích hợp handoff cho dependency/review; giữ attempt ID và contract fix bằng task ID gốc.
- Cập nhật năm file `agent-profiles/{lead,be,fe,test,devops}.md`.
- Thêm `tests/handoff.test.ts`; cập nhật `tests/team.test.ts`, `tests/profiles.test.ts`.
- Cập nhật README Worker, trạng thái kế hoạch và báo cáo này. Không đổi IPC, UI layout, storage schema, model policy hoặc dependency.

## Kiểm tra thực tế

| Kiểm tra | Kết quả |
|---|---|
| Nhóm handoff/team/profile | 18/18 đạt |
| `npm test` | **48/48 đạt**, không fail/skip/cancel |
| `npm run typecheck` | Exit 0 |
| `npm run build` | Exit 0; main/preload/renderer thành công |
| `npm run format:check` | Exit 0 |
| `git diff --check` | Không lỗi whitespace |

Năm test mới kiểm tra báo cáo bốn mục/JSON/legacy, ref đúng attempt và chống lấy nhầm command có call ID trùng, ưu tiên failure khi truncation, budget trên dữ liệu dày có ký tự JSON escape, task cap và dependency thiếu. Một ca stress phát hiện blocker text bị rút hết ở mức cuối; đã sửa bằng giới hạn số note theo mức budget, giữ excerpt blocker đầu và số note bị lược bỏ. Ca đó và toàn bộ suite sau sửa đều đạt.

Test điều phối hiện có được bổ sung kiểm tra prompt thực tế: TEST retry nhận `t1-fix-1`, review sau sửa nhận `t3-retry-1`, nhưng fix vẫn trỏ `t1`; luồng vẫn 8 bước như trước. Đây là số lần gọi Step trong test tổng hợp, không phải đo request gateway thật. Test SQLite reopen xác nhận cả báo cáo mới và legacy giữ nguyên văn bản.

Không đổi DB/schema nên không chạy thêm native migration test. Không gọi provider thật, không benchmark tốc độ/token hoặc tuyên bố đã giảm chi phí.

## Giới hạn và bước tiếp theo

AU-2A cải thiện context, **chưa thay completion gate**. Status done/blocked trong báo cáo vẫn là lời agent, không tự đổi task state. Metadata legacy không trích được blocker đáng tin cậy; chỉ có summary excerpt và reference đến văn bản gốc. Review evidence hiện vẫn là chuỗi; gate ref tồn tại, đúng attempt và phù hợp AC thuộc AU-2B.

Schema6 vẫn lưu command artifact theo `(runId, callId)` và controller vẫn quản lý call ID theo contract hiện tại. Builder lọc đúng task nhưng chưa giải quyết lưu trữ artifact khi runtime thực sự phát sinh call ID trùng giữa session; cần đưa identity đó vào AU-2B, không coi source reference AU-2A là chứng nhận artifact đã tồn tại/đầy đủ. Output lưu trữ vẫn chịu giới hạn WW-4C.

Rollback bằng revert commit AU-2A, không downgrade DB hoặc xóa history. WW-4D/WW-5 giữ nguyên. Mốc tiếp theo: **AU-2B — completion gắn evidence thật**.
