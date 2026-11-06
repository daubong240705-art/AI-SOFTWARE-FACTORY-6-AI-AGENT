# Bàn giao Bash tự động theo vai trò

Ngày 05/11/2026. Windows Worker `1.3.0-alpha.8`, SQLite 14. Checkpoint trước thay đổi: `4ca727f`. Triển khai theo [đề xuất](bash-autonomy-proposal.md); giữ Factory Lite + Windows Worker, một Controller, không thêm dependency hoặc migration.

## Hành vi hiện hành

- BE/FE/TEST/DEVOPS được chạy Bash tự động, không cần Accept từng lệnh. Lead/PM/BA không Bash; Lead tiếp tục là điểm vào trao đổi công việc và giao task qua Controller.
- Runtime khai báo Bash theo quyền role. Nếu vẫn nhận ticket Bash hợp lệ, Controller tự trả lời và ghi audit, chống xử lý trùng theo execution. Ticket cũ, lane đã đóng hoặc lượt đang dừng không được xử lý tiếp.
- Bash từ role bị cấm bị từ chối và dừng lượt. `doom_loop` được runtime gửi về Controller như tín hiệu phát hiện lặp; Controller từ chối, dừng cây tiến trình với mã `tool-loop`, không đưa ra nút Accept. Dừng không chờ native reply hoàn thành.
- Bỏ bộ chọn Ask/Full access, nút Full access cho lượt và API nâng quyền. Chat/inspector không hiện phiếu Bash hoặc doom-loop. Câu hỏi nghiệp vụ, quyền công cụ khác và nghiệm thu vẫn giữ quy trình riêng.
- Giữ role gate, quy tắc tool edit/secret, kiểm tra scope sau thực thi, request cap/deadline/fix round, nút Dừng, snapshot/diff/evidence và log lệnh.

## Tương thích và cách sử dụng

Đóng cửa sổ Worker cũ, chạy `npm start` tại `apps/windows-worker` để nạp main/preload/renderer mới. Không cần đổi cấu hình quyền.

Trường lịch sử `permissionMode`, `permissionUpgrade` và nhãn audit nâng quyền cũ tiếp tục đọc được. Giá trị Ask còn lưu không quyết định quyền Bash của bản mới. Run mới có `shellPolicy: "role-auto-v1"`; hàng chờ cũ bắt đầu trên bản mới cũng dùng chính sách này. Retry tạo lượt mới; không sửa kết quả cũ, tự chạy lại lịch sử hay tự khởi động hàng chờ khi nâng cấp. Settings và dữ liệu người dùng không bị migration hay viết lại bởi đợt triển khai.

Shell chạy bằng tài khoản Windows hiện tại. Quy tắc giới hạn từng tool và kiểm tra source sau task **không tạo sandbox OS cho Bash**; shell có thể tác động ngoài workspace hoặc truy cập mạng theo quyền tài khoản. Prompt giữ giới hạn commit/push/deploy nhưng không phải cưỡng chế ở OS. Có thể dùng tài khoản không admin hoặc VM riêng khi cần cách ly mạnh hơn.

## Thành phần thay đổi

- `electron/runtime/permissions.ts`, `opencode.ts`, `team/policy.ts`: quyền và prompt thống nhất theo role.
- `electron/controller/runs.ts`: fallback tự duyệt, từ chối/dừng, dedup và đánh dấu policy; xóa nâng quyền thủ công.
- `shared/{channels,contracts,defaults,runs,execution,inspector}.ts`, `electron/{main,preload}.ts`: bỏ API nâng quyền, giữ dữ liệu cũ và bổ sung mã lỗi/audit.
- `src/App.tsx`, `features/{ChatHost,RunPanel,TaskInspector}.tsx`: làm gọn UI quyền.
- `agent-profiles/test.md`: TEST 1.3.1, shell tự động, vẫn chỉ đọc source.
- `tests/{execution,interaction,parallel,profiles}.test.ts` và ba script acceptance interaction/lead-access/questions: kiểm tra chính sách mới và tương thích.

## Bằng chứng kiểm chứng

- `npm test`: **237/237 đạt**, gồm role matrix, snapshot Ask cũ, Bash liên tiếp, ticket trùng/khác execution, lane đóng, lỗi trả quyền, doom-loop và định tuyến quyền khác Bash.
- `npm run typecheck`, `npm run build`: đạt. Build còn cảnh báo annotation Zod đã có.
- Production Electron fixture: `lead-access-ui` **4**, `work-detail-ui` **16**, `workspace-shell-ui` **4**, `ux06-ui` **4** cấu hình cửa sổ/zoom; tổng **28**, không lỗi renderer hoặc tràn layout. Lead-access xác nhận hai ticket Bash liên tiếp tự duyệt dù snapshot vẫn Ask, không bộ chọn/nút Accept Bash và không API nâng quyền.
- Fixture dùng main/preload/IPC sản phẩm, thay bước execute bằng dữ liệu xác định; **không gọi model/OpenCode thật**, không dùng DB/key người dùng. Các script interaction/questions được cập nhật kỳ vọng selector nhưng chưa chạy riêng trong đợt này.
- Log/ảnh/DB thử chỉ ở `.cache/`, không đưa lên Git. Không coi fixture là bằng chứng runtime/provider thật.

## Phần còn lại

Đã hoàn thành phạm vi bỏ duyệt Bash thủ công. Chưa đánh dấu toàn bộ R3 hoàn thành: report freshness/capability ở mọi view tiếp tục theo [bàn giao R3B](workspace-r3b-completion.md). Các đợt lịch tự động và cải tiến workspace tiếp theo giữ kế hoạch riêng.
