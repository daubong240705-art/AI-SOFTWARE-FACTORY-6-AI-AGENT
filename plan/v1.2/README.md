# V1.2 — Chạy song song có cô lập source

Baseline V1.1 `fcfac1d`; checkpoint trước thay đổi `checkpoint/v12a-20261104`. Nhánh `feature/windows-worker-v1.2a`. Bỏ qua WW-5 theo yêu cầu, không thay VM hoặc tích hợp backend.

| Đợt | Phạm vi | Trạng thái |
|---|---|---|
| V1.2A | Worktree manager, ownership/provenance, mở thành project, cleanup có preview và recovery | Hoàn thành, `1.2.0-alpha.1` |
| V1.2B | Scheduler dựa dependency, tối đa hai task độc lập; workspace theo task/attempt; budget/process ownership theo execution | Chưa triển khai |
| V1.2C | Tích hợp trên đúng baseline, phát hiện conflict, test source đã hợp nhất; báo cáo throughput so với tuần tự | Chưa triển khai |

V1.2A giữ một Controller và một run đang hoạt động. Workspace là worktree detached tại HEAD đã xác định, không branch tự động hoặc commit source người dùng. Mở worktree qua project hiện có; Controller xác minh ownership trước khi tạo runtime và lưu origin vào run/export. Đây là nền tảng PAR-02/03, chưa có scheduler song song hoặc merge tự động.

Repo cần sạch, có commit, không submodule hoặc Git filter áp dụng lên source. Không sao chép file chưa commit/dependency/credential. Tắt hooks trong thao tác Git do manager thực hiện; chặn filter trước checkout/status, không thay cấu hình Git của người dùng. Source gốc đổi lúc checkout làm worktree bị giữ lại để kiểm tra.

Manifest atomic trong userData/workspaces/UUID, kèm Git lock có tên ownership. Recovery xác minh đường dẫn canonical, registration, marker/backlink và common Git directory; không tự reset/replay/xóa dữ liệu. Cleanup chỉ worktree sạch, HEAD gốc detached, không reference và token xác nhận chưa hết hạn. Không `--force`, không recursive-delete source; Git tự remove đúng worktree được kiểm tra. Thiếu registration nhưng còn directory thì giữ lại.

Tiêu chí V1.2A: Git thật chứng minh source/index độc lập; repo bẩn bị chặn; dirty/ignored/new commit/foreign lock/junction/reference được bảo vệ; interrupted create/unlock có lối phục hồi; UI create/open/preview/remove dùng IPC hẹp; Controller chặn ownership sai trước request model. [Bàn giao và bằng chứng](../../docs/windows-worker/v1.2a-completion.md).

V1.2B chỉ bắt đầu trên nền này: bổ sung task ownership, resource locks và giới hạn concurrency vào Controller hiện có; không tạo orchestrator thứ hai. V1.2C phải xử lý kết quả chưa commit và evidence trên source tích hợp trước khi gọi V1.2 hoàn thành. Không suy ra chạy song song luôn nhanh hơn.
