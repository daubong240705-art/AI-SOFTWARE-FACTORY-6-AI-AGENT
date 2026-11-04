# Lead review — context gọn và bằng chứng theo tiêu chí

Phiên bản `1.2.0-alpha.4`, baseline `d30b0d2`, checkpoint `checkpoint/review-20261104`, nhánh `feature/windows-worker-review-quality`.

## Vấn đề và thay đổi

Review trước đây nhận plan, handoff, tiêu chí và catalog chứa nhiều ID/hash lặp; model phải chép lại toàn bộ tham chiếu trong JSON. Model có thể đính kèm file ref TEST cho tiêu chí BE/FE, hoặc hết 8.192 token output do reasoning trước khi có câu trả lời.

`electron/team/review-context.ts` tạo một packet có giới hạn 32.000 ký tự sau JSON escaping: task/attempt/scope/phụ thuộc, thay đổi, báo cáo tự khai, lỗi, lệnh lỗi, tiêu chí và nội dung evidence. Có cờ truncation/omission; vượt giới hạn sau rút gọn sẽ chặn và yêu cầu chia nhỏ công việc. Packet không lặp plan và handoff đầy đủ. Lệnh cũ, file đổi hash, output lệnh sai hash hoặc task chưa đạt bị loại khỏi danh sách bằng chứng khả dụng.

Model trả wire format V3: criterionId, trạng thái, method, lý do và mã ngắn `eN`. Mỗi tiêu chí có danh sách mã được phép dùng; tiêu chí bắt buộc command chỉ nhận mã command. Adapter từ chối mã lạ/trùng/sai tiêu chí và khôi phục nguyên văn AC cùng toàn bộ ref từ mapping của packet. Review lưu trong SQLite/UI/export vẫn là V2, với kiểm tra run/task/attempt/session/hash/source/artifact như cũ. Không nhận kết luận verification do model tự cấp, không nới gate hoàn tất.

Giữ một lần sửa schema tối đa như trước; không thêm retry runtime hoặc tăng request/output/deadline. Không đổi model, dependency, orchestrator, VM hoặc credential.

Trong lúc nghiệm thu phát hiện hai lệnh TEST có thể chạy chồng thời gian trong cùng OpenCode session. Mốc source dùng chung bị cập nhật khi lệnh đầu kết thúc, làm lệnh sau mất evidence hợp lệ. Controller nay lưu pre-start observation theo task/session/call ID tại sự kiện running, kiểm tra với snapshot sau lệnh và xóa mapping khi kết thúc. Lệnh thay đổi source, xóa file hoặc chỉ xuất hiện khi reconciliation vẫn không được gán sourceVersion bằng phỏng đoán.

## Kết quả thực tế

- **129/129 test**; typecheck, build production, Prettier, Git diff check và native Electron/SQLite/secure storage đạt.
- Kiểm tra mới bao gồm adapter refs giả/trùng/sai task, phục hồi ref nguyên vẹn, source đổi sau packet, stale/corrupt command, budget với JSON escaping, lỗi/truncation, và các lệnh cùng session chồng thời gian. Luồng fix và TEST sau tích hợp vẫn đạt.
- Trên **cùng một run đã lưu**, prompt review từ 20.116 xuống 9.167 ký tự (**54,4%**). Đây là đo ký tự, không phải đo tiết kiệm token hoặc chi phí.
- DeepSeek Flash `ds/deepseek-v4-flash` qua 9Router/OpenCode 1.19.5: hai lượt song song thành công trong đợt này. Lượt đầu 80,5 giây/21 request; lượt cuối 86,9 giây/20 request. Kết quả được tích hợp, TEST đúng source, Lead review verified, và source/index gốc nguyên vẹn. Hai file test còn được thực thi độc lập ngoài agent.
- Lượt tuần tự sau sửa observation hoàn tất trong 79,7 giây/19 request. Trước đó có một lượt tuần tự bị chặn đúng vì mất sourceVersion của lệnh chồng thời gian; dữ liệu giữ lại, không tính vào cặp hoàn tất.
- Cặp cuối cùng cùng fixture, model, prompt người dùng, request limit 40, deadline 4 phút, output limit 8.192 và Full access. Thời gian gồm plan, tạo/seed worktree, sửa code, tích hợp, test, review và sửa schema. Song song cần một lần sửa schema do chọn mã evidence không hợp lệ, sau đó review đạt; tuần tự đạt ngay. Không có runtime tự retry.
- **Song song chậm hơn khoảng 9% trên cặp mẫu nhỏ này.** Chỉ một cặp đo, plan/tool call/source formatting có biến thiên từ model, chưa có căn cứ tuyên bố tăng throughput trên dự án lớn. Mặc định tiếp tục là tuần tự.
- Electron thật qua renderer/IPC hiển thị **Bản tích hợp đã xác minh**, xem byte file bất biến và mở bản tích hợp làm project. Đã xem ảnh kết quả; không mock UI hoặc gán verified cho fixture.

Tóm tắt [observations.json](review-quality/observations.json), [checks.json](review-quality/checks.json), [ui.json](review-quality/ui.json). Full report/runtime/source fixture trong `.cache/asf-research/` được Git bỏ qua. Production SQLite chỉ được đọc settings/key phục vụ live acceptance, không sửa dữ liệu người dùng.

## Giới hạn và bước tiếp theo

Đã xử lý và nghiệm thu blocker review của mẫu V1.2C; vẫn giữ nhãn alpha vì đây chưa phải nghiệm thu đa dạng repo thực tế. Model vẫn có thể trả schema/ref sai; một lần sửa có giới hạn giúp phục hồi nhưng có thể tăng thời gian. Yêu cầu lớn có thể vượt context/output budget và sẽ dừng rõ ràng, không được tự đánh dấu hoàn tất.

Trước stable nên đo lặp trên repo nhiều dependency và build thực tế, bao gồm tỷ lệ review đạt ngay, thời gian tích hợp, số request và số lần sửa. Giữ cơ chế conflict toàn file, giới hạn worktree/snapshot và các giới hạn của [V1.2C](v1.2c-completion.md). Không tích hợp source gốc hoặc đóng gói WW-5 trong đợt này.
