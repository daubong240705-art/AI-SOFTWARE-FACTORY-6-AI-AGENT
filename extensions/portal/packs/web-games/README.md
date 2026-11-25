# Web Games

Đội làm game trình duyệt theo lượt từ bản sao starter `turn-based` của Game Portal. Bắt đầu bằng một cơ chế chơi, ít màn hình, số lượt hữu hạn và đồ họa gốc. Không lấy tên, nhân vật hay hình ảnh thương mại. `game.json.id` phải trùng tên thư mục dự án gốc, không phải tên worktree tạm; chỉ sửa `name` khi đổi tên hiển thị.

## Đội và quan hệ

| Vai trò | Trách nhiệm |
| --- | --- |
| Game Lead | Thảo luận, đưa lựa chọn và khuyến nghị; chờ chốt brief rồi khởi chạy đúng workflow. Điều phối và phân loại lỗi, không sửa mã. |
| Game Designer | Viết `docs/design.md`, manifest và tiêu chí nghiệm thu; phân tích cân bằng. |
| Rules Engineer | Viết luật thuần có seed, bot hợp lệ và test luật. |
| Client Engineer | Nối SDK, trạng thái chỗ ngồi, chơi lại, bàn phím/chạm và hiệu ứng trong iframe. |
| UI Artist | Phụ trách CSS, SVG và thumbnail; mặc định sữa/kem/be với điểm nhấn pastel. |
| QA Engineer | Tái hiện, bổ sung test hồi quy, chơi thử, báo verdict và ghi task lỗi. |
| Code Reviewer | Phản biện diff của Rules và Client; không chỉnh mã thay họ. |
| Release Manager | Kiểm tra ứng viên phát hành, viết `CHANGELOG.md` và ghi chú; không tự publish. |

Pack không lưu khai báo quan hệ. Khi thiết lập đội, đặt Lead quản lý tất cả (`manages`); Code Reviewer phản biện Rules và Client, Designer phản biện Artist, QA kiểm thử Client. Workflow ràng buộc các phản biện bắt buộc theo vai trò. Cho phép QA giao task lỗi nếu muốn dùng chức năng này; mặc định QA có thể ghi lỗi vào verdict và chuyển Lead. Lead dùng `api-agent`; các ghế còn lại dùng `native-opencode`, có thể được dự án/nhóm ghi đè bằng adapter đã cấu hình.

## Workflow

Các workflow thay đổi game nhận `brief` Markdown đã được người vận hành chốt. Có thể gửi thêm `briefArtifactId` của tài liệu thuộc dự án; nếu chưa có, bỏ trường này. Không thay brief bằng ID. Chỉ gửi `portalIntegrationId` của tích hợp Portal đã gắn phạm vi dự án; không đưa khóa truy cập vào brief hoặc input.

| Workflow | Đầu vào | Đường chạy và cổng kiểm soát |
| --- | --- | --- |
| `game-new` | `title`, `players` (ví dụ `2-4`), `brief`, `portalIntegrationId` | Designer → Lead đối chiếu brief → Rules / Code Reviewer → Art / Designer → Client / Code Reviewer → QA → kiểm tra phát hành → duyệt publish. Không hỏi duyệt thiết kế lần nữa. |
| `game-change` | `brief`, `portalIntegrationId` | Lead điều phối tối đa 4 task con, một cấp → Code Reviewer → QA hồi quy → kiểm tra phát hành → duyệt publish. |
| `game-bugfix` | `brief`, `area` (`rules`, `client`, `unknown`), `portalIntegrationId` | QA thêm test thất bại → chọn vùng sửa (Lead phân loại nếu `unknown`) → Rules hoặc Client / Code Reviewer → QA xác minh, tối đa 2 vòng sửa → kiểm tra phát hành → duyệt publish. Chưa tái hiện hoặc chưa phân loại được thì dừng, không publish. |
| `game-playtest` | `matches` (mặc định 50; số nguyên từ 1 đến 500) | QA chạy bot có seed → Designer phân tích → lưu báo cáo thành artifact. Không chỉnh game, không publish. |
| `game-publish` | `portalIntegrationId` | Kiểm tra bản tích hợp hiện tại → duyệt publish → đóng gói và trả đường dẫn chơi, phiên bản và commit. Không thay thiết kế. |
| `game-rollback` | `gameId`, `version` (số nguyên dương), `portalIntegrationId` | Xác nhận đúng ID và phiên bản → gọi `rollback` → trả kết quả. Không dựng bundle mới. |

Với `game-new` và `game-change`, nếu QA không đạt, Lead phân loại lỗi chính, sau đó tối đa 3 vòng sửa đúng nhóm → phản biện → QA lại. Chưa xác định được vùng lỗi thì trả bằng chứng để phân loại thủ công. Sau 3 vòng chưa đạt, **Duyệt** chỉ yêu cầu Lead soạn brief sửa tiếp; người vận hành chốt và bắt đầu lượt mới nếu muốn. **Từ chối** hoặc hết hạn thì dừng. Không vượt cổng QA bằng lựa chọn này.

Cổng **Publish lên Portal?** chỉ xuất hiện khi checklist báo sẵn sàng (và QA đã đạt nếu workflow có QA). Chỉ duyệt khi commit tích hợp vẫn khớp ghi chú ứng viên; tránh chạy song song các workflow chỉnh cùng dự án. Cổng publish và rollback chỉ thực thi khi duyệt; từ chối hoặc hết hạn không gửi yêu cầu. Nếu có lỗi hoặc kết quả chưa rõ, đối chiếu phiên bản trong Portal trước khi thử lại; không có retry tự động. Action `bundle.publish` lấy nhánh tích hợp và chạy check/test/build trước khi gửi tar.gz của `dist/`.

## Kỹ năng

- Thiết kế: `game-design-doc`, `game-art-direction`, `game-juice`, `motion-source`.
- Hợp đồng và phát hành: `game-contract`, `turn-based-rules-contract`, `portal-bundle-contract`, `game-release-checklist`.
- Xác minh: `browser-game-testing`, `local-preview`, `game-qa-verdict`, `game-code-review`, `game-playtest`.

Workflow v2 và action publish cần phần Host của P1. Các block chốt brief và khởi chạy từ chat cần P3; nếu chưa có, người vận hành có thể nhập brief và khởi chạy thủ công sau khi workflow đã được cài vào dự án.
