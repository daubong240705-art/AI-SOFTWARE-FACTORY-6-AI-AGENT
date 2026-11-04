# Phase 5: nghiệm thu tích hợp và giao diện

Ngày 04/11/2026, Asia/Saigon. Nền tảng hoạt động tại <https://asf.lazy.local>. Phạm vi Phase 5 đã được kiểm chứng: sáu role, coding worker thật, GitLab/OpenProject, phê duyệt spec/release, TEST, staging, migration/restore/rollback và quản trị worker. Dự án sản phẩm mẫu/template thuộc mốc tiếp theo đã được người dùng hoãn.

## Chức năng và giao diện

- PM/BA tạo plan/spec thật và đồng bộ work package; BE/FE dùng OpenCode 1.19.5 trong container riêng. Kỹ năng, model và giới hạn được cố định theo run.
- Worker outbound trên VM60 chạy bằng systemd, đã enable và thử restart khi idle. Admin đăng ký/rotate/revoke, xem heartbeat, model và kỹ năng trong dashboard.
- Coding dùng read/edit/glob/grep; TEST chạy baseline tin cậy read-only, network none. Provider key chỉ ở parent; sandbox nhận token proxy theo execution. DEVOPS kiểm tra CI/artifact/approval/health thay vì tin báo cáo deploy từ worker.
- Retry tiếp tục đúng công đoạn trên candidate cố định, kiểm tra spec và kết quả công đoạn trước; không lặp lại BE từ main khi FE/TEST lỗi. Lịch sử và charge của lần lỗi được giữ nguyên.
- Giao diện tham khảo ảnh 9Router do người dùng cung cấp: Segoe UI, nền tối, nhấn cam, sidebar hẹp, chữ và form gọn; tab Worker/Model/Kỹ năng. Tài liệu, kết quả chi tiết và lịch sử mở khi cần. Phần thu gọn lịch sử và ẩn form khi run kết thúc đã merge ở fb58901, chưa deploy.

## Luồng live trên bản phát hành

API và worker source `851a05312eaeeedb280e6fe60277faae48f7877d`, [release pipeline149](https://gitlab.lazy.local/ai-factory/ai-software-factory/-/pipelines/149), deploy386 đạt. Schema production `0004_agents`. Phần UI bổ sung `fb5890154e16bf4217ce6a93c93261eaaa9b6b3c` chỉ thay dashboard, đã merge nhưng chưa deploy. Pipeline157 được dừng theo yêu cầu kết thúc của người dùng; production giữ851a053. [Evidence](phase-5-production-evidence.json) ghi đúng bản đã kiểm chứng.

[Run774ebe41](https://asf.lazy.local/runs/774ebe41-32d1-4067-81c4-8ecf1cf060ab) completed, không retry:

1. PM/BA gọi gateway thật; [work package1869](https://openproject.lazy247.space/work_packages/1869). Operator đọc và duyệt spec hash `509fd5598846a94d404b0a6a1e94d6c52cac4f5bb79aab94d52c198bee6896a2` ngay trên giao diện production.
2. BE6 request, FE8 request; sửa hai file `src/app.py`, `src/ui.py` thành phép cộng và nhãn `Result: `, giữ khoảng trắng khi input rỗng. [Draft MR6](https://gitlab.lazy.local/ai-factory/asf-agent-validation/-/merge_requests/6) giữ riêng, chưa merge main của repo tổng hợp.
3. TEST container chạy thật 5/5 đạt trên candidate `d14e01c3247dceeeb24d353876d5291031b54046`. [Pipeline154](https://gitlab.lazy.local/ai-factory/asf-agent-validation/-/pipelines/154): test398, package399, deploy400 đều đạt.
4. Operator đọc source/job, thử SHA sai nhận409, rồi duyệt tuple đúng bằng giao diện. Host xác minh approval đã lưu trước deploy. DEVOPS đọc artifact và [HTTPS health](https://asf.lazy.local/validation/healthz), đối chiếu project/SHA/pipeline/digest rồi mới complete.

Run dùng4 lượt cấp model, charge74.788/200.000 theo usage gateway. Không báo giá tiền hoặc upstream model khi gateway không cung cấp. Đây là smoke tổng hợp hạ tầng, không phải nghiệm thu sản phẩm người dùng. Vòng TEST fail → Bug → sửa → pass đã có [bằng chứng staging trước đó](phase-5-staging.md); không nói rằng lần cuối này có lỗi được chèn.

## Kiểm tra vận hành

- **62 backend tests** với PostgreSQL/Redis disposable; Ruff, mypy 37 files và Alembic drift check đạt. Sáu regression case mới kiểm tra retry BE/FE/TEST và từ chối dùng lại khi spec thay đổi.
- Frontend lint/typecheck/production build đạt. Chromium kiểm tra project/model, worker register/rotate/revoke và mock spec approval ở DB riêng. Production kiểm tra login, worker online, model/kỹ năng, phê duyệt spec/hash và release tuple, SSE, desktop 1440/mobile 390 không tràn ngang hoặc page error. [Ảnh](ui-refresh/README.md).
- Restore dump production schema 0004 vào DB riêng: đối chiếu4 project,5 run,12 artifact,5 spec approval,12 execution và1 release approval; restore constraints đạt. Xóa DB/dump tạm, không restore đè live.
- Rollback thực tế `851a053 → a2d7d16 bridge → 851a053`, giữ schema 0004 và5 run. Bridge readiness200, ghi503, auth hoạt động; dispatcher/workflow-worker dừng. Quay lại Phase 5 các service chạy lại. Mỗi chiều có backup off-host; không downgrade DB. Operator chọn bridge đã lưu để thử và trả previous marker về `3fac785` sau đó.
- Worker code khớp manifest; idle restart đổi PID, enable theo boot. Chưa thử reboot toàn VM hoặc thiết bị cá nhân. Hai container ITCare vẫn giữ dừng theo yêu cầu; các stack khác giữ nguyên.

## Các lần thử không dùng để nghiệm thu

Run `d284e997` dừng vì grant60.000 không đủ dự phòng request khi context tăng; giữ nguyên lỗi và usage. Run `656a60de` gặp lỗi upstream và quota8 request, rồi bộc lộ retry FE lặp BE. Run này giữ failed, không phát hành. Sau khi bổ sung regression tests và sửa retry, run774ebe41 đi trọn chuỗi trên source851a053.

Production cấu hình mới: run 200.000, grant 90.000, tối đa 12 request/lượt, output 1.000/request,6 lượt cấp/run. Các giới hạn vẫn hữu hạn; không sửa snapshot hay tăng ngân sách run cũ. Không coi mọi lỗi gateway là lỗi mã sản phẩm hoặc bảo đảm model luôn hoàn thành trong giới hạn.

## Phạm vi còn lại

Phase 6 gồm template/Mini Helpdesk, benchmark và acceptance theo sản phẩm. Profile Node/build/lint/browser chuyên biệt, UI quản trị integration profile, adapter Codex và kiểm chứng worker cá nhân/NetBird cần mốc riêng; chưa gán bằng chứng smoke Python này cho những phần đó. Hướng dẫn dùng và thêm dự án ở [vận hành Phase 5](operations-v0.2.md).
