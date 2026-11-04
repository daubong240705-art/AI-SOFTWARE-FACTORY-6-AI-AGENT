# AU-2B — Nghiệm thu gắn bằng chứng

Ngày: 04/11/2026. Baseline `f251dde` (AU-2A); checkpoint `checkpoint/au2b-20261104`; nhánh `feature/agent-upgrade-au2b`.

Hoàn thành AU2B-01–04 trên Factory Lite + Windows Worker. Giữ một Controller, một run, task tuần tự, runtime OpenCode 1.19.5, model do người dùng chọn và hai vòng fix tối đa. Không thêm dependency, orchestrator hoặc dịch vụ ngoài.

## Vấn đề và thay đổi

Trước đây review nhận evidence dạng chuỗi và đối chiếu AC bằng nội dung. Hai tiêu chí giống chữ có thể bị tính thành một, và cùng call ID ở hai session có thể ghi đè cả command metadata lẫn output.

- Controller cấp ID AC theo task gốc + index, ví dụ `t1:ac1`, `t1:ac2`. Fix/retry vẫn dùng bộ tiêu chí gốc. Review v2 bắt buộc mỗi ID xuất hiện đúng một lần, đúng nội dung; thiếu/trùng/ID lạ bị từ chối trong giới hạn một lần schema repair hiện có.
- Refs có kiểu `command`, `file`, `artifact`, có run/task gốc/attempt/session/source version. Artifact ở đây là file đã được snapshot và lưu blob, không có tool upload/report mới. Controller cung cấp catalog refs thật, tối đa 12 ref/task và 24.000 ký tự cho danh sách; mọi phần bị lược bỏ được đếm. Handoff 32.000 ký tự vẫn độc lập.
- Gate kiểm tra task completed, attempt mới nhất, session, artifact tồn tại, SHA-256 và source. Evidence chỉ thuộc task có AC đó; command TEST có thể chứng minh task upstream qua graph dependency, hoặc TEST chung không có dependency. Không lấy file của task không liên quan để bù AC.
- Command cần completed/exit 0, output artifact đúng hash và snapshot source chưa đổi. Source được quan sát trước khi prompt chạy, sau tool có khả năng sửa file, và khi lệnh kết thúc. Chỉ gắn sourceVersion khi quan sát trước có trước thời điểm lệnh chạy, hash trước/sau giống nhau, snapshot hoàn chỉnh và mtime không cho thấy source bị đổi trong lúc chạy. Kiểm tra hash trước/sau còn phát hiện xóa file, điều timestamp đơn lẻ không làm được. Final-message reconciliation vẫn lưu output nhưng không tự suy ra source version cho lệnh chưa quan sát trực tiếp.
- `artifactId` mới là SHA-256 của tuple run/attempt/session/call, có prefix `cmd-v1-`. Giữ call ID gốc để truy vết. Capture, dedup event, upsert command, SQLite output lookup và React key cùng phân biệt session. Đến giới hạn 100 command thì dừng để tránh bỏ mất lệnh lỗi; không xóa failed command hoặc nới verification rule.
- File evidence chụp sau task, lưu metadata trong JSON task và nội dung vào blob sẵn có, chỉ trong scope. Validator kiểm tra hash file hiện tại; file ở task khác có thể đổi mà không làm mất tính hợp lệ của file này. Command kiểm tra hash toàn bộ source được snapshot, nên mọi thay đổi source đều làm command evidence cũ hết hiệu lực. File xóa có ref hash null và trạng thái xóa rõ ràng. File secret/không có nội dung không được dùng làm evidence hợp lệ.
- TEST và AC có từ khóa test/build/lint/typecheck/compile/kiểm thử/kiểm tra tự động/biên dịch cần command evidence; Lead còn chọn method command/source cho từng AC. File diff không thay test. Đây là nhận diện bảo thủ kết hợp review của Lead, không phải bộ phân tích ngữ nghĩa mọi cách diễn đạt.
- Nếu model nói completed nhưng evidence không hợp lệ, AC passed chuyển unverified, review chuyển blocked và summary ghi chưa đủ bằng chứng. Lý do giữ trong verification/issues và UI; run kết thúc Cần bổ sung qua Controller. Không thêm model call để sửa thiếu evidence. Raw review vẫn còn trong summary của task Lead.
- Kết quả có nút mở file/lệnh của từng AC. IPC schema chặt, chỉ lấy snapshot/output đã lưu của đúng task/session; không đọc file hiện tại, mở shell hay cấp thêm quyền. Hiển thị nội dung tối đa 256.000 ký tự. Lượt cũ có nhãn báo cáo cũ/bằng chứng chưa được xác minh.

## Lưu trữ và tương thích

Kỹ thuật áp dụng tiếp từ nghiên cứu AU-0: OpenCode 1.19.5 cho identity session/tool và final-message reconciliation; Superpowers cho nguyên tắc không báo hoàn thành khi thiếu bằng chứng mới; Open SWE cho kết quả kiểm tra gắn lần thực thi. Source và revision/license đã ghi trong [research findings](../../plan/agent-upgrade/research-findings.md) và [manifest](../../research/agent-upgrade/sources.json). Các repository có giấy phép MIT ở gốc được khảo sát; đợt này viết code tích hợp trên ứng dụng hiện có, không sao chép mã/prompt hay chạy script bên ngoài. ECC/Paperclip không cần thêm thành phần trong AU-2B.

Không cần migration: schema6 đã có JSON run/task, `workspace_blobs` và `command_artifacts`. Key mới nằm trong cột call_id dạng chuỗi của bảng hiện có, với prefix riêng; metadata lưu cả artifactId lẫn call ID gốc. Các hàng legacy giữ nguyên, không tự đoán ownership hoặc gán verified. Review có version2 cho lượt mới, union legacy chỉ để đọc lịch sử. Không đổi credentials/cấu hình global hoặc mở dữ liệu app đang dùng trong các kiểm tra.

Các giới hạn snapshot hiện có giữ nguyên: 8.000 entry, 48 MB/lần, 1 MB/file; blob khử trùng theo hash. AU-2B thêm I/O chụp source và blob task theo scope, chưa đo benchmark tác động latency. Retention thuộc WW-4D.

Rollback code bằng revert commit AU-2B hoặc checkout checkpoint; không downgrade/xóa DB. Không có schema migration cần rollback. Bản cũ vẫn đọc JSON lịch sử nhưng chưa hiểu nút refs và artifactId mới, nên extended output của lượt mới cần mở bằng bản hỗ trợ AU-2B; snippet lệnh vẫn nằm trong run. Nếu cần quay lại trọn trạng thái dữ liệu trước nâng cấp, dùng bản sao userData do người vận hành lưu khi app đã đóng; không tự ghi đè DB đang dùng.

## File thay đổi

- Mới `electron/team/evidence.ts`: ID, catalog, verification gate, đọc evidence lịch sử.
- `shared/{evidence,team,runs,contracts,channels}.ts`: contract v2/legacy, metadata và API hẹp.
- `electron/team/coordinator.ts`: chụp evidence task, AC/catalog prompt và gate trước completion.
- `electron/controller/runs.ts`, `runtime/opencode.ts`, `workspace/snapshot.ts`: source observation, async event capture và identity command/session.
- `electron/storage/evidence.ts`: blob task theo scope, kiểm tra hash nội dung.
- `electron/{main,preload}.ts`: IPC evidence và lookup command theo artifactId.
- Mới `src/features/AcceptanceEvidence.tsx`; sửa `RunPanel.tsx`, `CommandEvidence.tsx`: mở refs và nhãn legacy.
- Mới `tests/completion-evidence.test.ts`; sửa `tests/team.test.ts`; cập nhật README Worker và tài liệu kế hoạch/trạng thái.

## Kiểm tra thực tế

| Kiểm tra | Kết quả |
|---|---|
| Completion evidence + team | 15/15 đạt |
| `npm test` | 55/55 đạt, không fail/skip/cancel |
| `npm run typecheck` | Exit 0 |
| `npm run build` | Exit 0, main/preload/renderer |
| `npm run format:check` | Exit 0 |
| `npm run test:native` | Exit 0, Electron SQLite + safeStorage; key tổng hợp không plaintext trong DB/WAL |
| `git diff --check` | Không lỗi whitespace |

Bảy test mới bao phủ AC trùng chữ/ID giả; ref thiếu/sai run/session/attempt; command thất bại/exit thiếu/artifact thiếu/output bị sửa; source đổi; cùng call ID giữa session; attribution đọc bù; xóa file sau source observation; đọc file/artifact/output bất biến sau reopen; chặn completed thiếu evidence; render action evidence và nhãn legacy. Luồng fix tổng hợp vẫn tám Step, latest TEST/BE dùng đúng attempt mới; lịch sử lệnh lỗi còn nguyên. Tests migration schema2/3/4/5 sẵn có tiếp tục đạt, không có migration mới để chạy.

UI được kiểm tra render tĩnh và bộ resolver IPC dùng chung; chưa kiểm tra click tương tác bằng cửa sổ Electron. Không chạy provider thật hoặc tuyên bố runtime/model đã nghiệm thu. Repo không có lint script; dùng typecheck/format và các test sẵn có, không cài thêm linter.

## Giới hạn và mốc tiếp theo

Validator chứng minh identity/integrity/source của evidence; không chứng minh ý nghĩa của mọi command. `echo unrelated` exit0 vẫn có thể hợp lệ về cấu trúc, nên Lead bắt buộc đọc lệnh/output và đánh giá sự liên quan với AC. Test cố ý ghi rõ giới hạn này, không khẳng định đã loại được mọi kết luận sai của model. Shell vẫn không phải OS sandbox; filesystem không bị khóa trước thay đổi đồng thời, các snapshot là các lần quan sát có giới hạn. Quan sát source không đủ hoặc catalog bị cắt thì phải unverified/blocked; không tự tạo vòng chạy lại test để làm xanh kết quả.

Direct mode chưa có AC review, vẫn giữ quy tắc kết thúc direct hiện có; identity/artifact command mới áp dụng cả direct. WW-4D lifecycle/retention, WW-5 installer và AU-5 acceptance thật còn riêng. Mốc code tiếp theo: **AU-3 — catalog skill nhỏ, chọn theo task, snapshot version/hash, không mở thêm quyền tool**.
