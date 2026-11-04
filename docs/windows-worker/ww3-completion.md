# WW-3 — Lead và sáu vai trò

Ngày 04/11/2026. Nhánh `feature/windows-worker-ww3`.

Ứng dụng có hai chế độ: Lead tự phân công và một agent. Lead tạo plan JSON với role, scope, AC và dependency; Controller kiểm tra rồi chạy tuần tự bằng OpenCode 1.19.5. Mỗi role dùng model đã snapshot, không tự thay model hoặc bật role. Bảy profile và bốn skill cố định có version/hash và nội dung lưu trong lịch sử run.

UI có bảng task, model/session, trạng thái, phạm vi, phụ thuộc, output và báo cáo AC. TEST phải có command evidence exit 0. Review JSON chỉ được sửa định dạng thêm một lần mỗi bước. Vòng sửa code tối đa hai lần toàn run, chỉ giao về BE/FE/DEVOPS gốc; chạy lại TEST/phụ thuộc liên quan, giữ nguyên bằng chứng thất bại trước. Deadline và request cap dùng chung mọi session.

SQLite schema3 chuyển tasks từ một hàng/run thành nhiều hàng với trạng thái độc lập. Nâng schema2 có backup nhất quán, giữ run WW-2; run cũ thiếu trường mới được chuẩn hóa. Run gián đoạn không tự chạy lại. Thiếu điều kiện kết thúc ở `needs_input`, không giữ khóa run. Hủy task ngăn mọi lần giao việc kế tiếp.

## Lượt thực thi thật

[Evidence đầy đủ](ww3-live.json), run `ef1d8625-f60d-4d5c-b6d9-7519f65418d6`:

- Model đúng **`ds/deepseek-v4-flash`** trên `https://ai.lazy.local/v1`, TLS có CA nội bộ.
- Lead lập kế hoạch → BE viết helper/test → FE tích hợp → TEST chạy lệnh → Lead review. Năm session riêng, tổng **18/45 request**, không cần vòng sửa code.
- Source thật của sản phẩm: thêm `src/lib/formatRequestUsage.ts`, `tests/requestUsage.test.ts`; sửa `src/features/RunPanel.tsx`. Scope kiểm tra theo từng task, không có thay đổi khác.
- Lệnh `npm test` được cấp đúng một lần, exit **0**, **22 test đạt** tại thời điểm chạy model. Báo cáo Lead bao phủ nguyên văn mọi AC, kèm file/command refs.
- API key lấy từ environment cha, không ghi vào source/evidence; child chỉ nhận execution token.

Lượt đầu `724d9ec2-1534-46de-8e50-69968c0a8183` không sửa được file: OpenCode kiểm tra quyền edit theo đường dẫn tương đối với **gốc Git**, trong khi project đang là `apps/windows-worker`. Đã dừng cây runtime đúng PID, giữ evidence lỗi và không sửa DB để đổi kết quả. Adapter hiện chuyển scope từ thư mục project về worktree; test bao phủ monorepo và folder không Git. Lượt thành công phía trên xác nhận cách sửa với runtime thật.

## Kiểm tra bàn giao

- `npm run typecheck`: đạt.
- `npm test`: **23/23 đạt** sau khi bổ sung kiểm tra trạng thái task khi hủy. Bao phủ dependency, role/model, scope, thiếu command evidence, sửa chọn lọc, giới hạn vòng/JSON, hủy và migration schema2.
- `npm run test:native`: SQLite và safeStorage trong Electron đạt.
- `npm run build`: bản main/preload/renderer tạo trong `apps/windows-worker/out/`.

## Giới hạn

Runtime chạy tuần tự. Shell vẫn là quyền Windows của người dùng, scope không phải sandbox hệ điều hành. Snapshot bỏ dependency/secret/generated files và có giới hạn dung lượng; team run dừng khi không quét đầy đủ source. File người dùng sửa đồng thời có thể bị phát hiện là lệch scope; không tự hoàn tác.

Native UI chưa được kiểm tra trực quan trong phiên này do helper Windows không khả dụng. Lượt model thật kiểm chứng BE/FE/TEST/Lead; PM/BA/DEVOPS có profile/policy và cùng adapter nhưng chưa chạy acceptance riêng. Vòng sửa dùng kiểm tra điều phối tự động, lượt model thật không phát sinh lỗi code để kích hoạt vòng sửa.

WW-4 sẽ thêm diff từng dòng, phục hồi và local preview có vòng đời riêng. WW-5 đóng gói bộ cài; hiện mở bằng `npm start`. Không thay đổi ASF web hoặc deploy VM.
