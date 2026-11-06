# Nguồn nghiên cứu nâng cấp agent

Ngày khảo sát: 04/11/2026. Phạm vi đợt này: clone source, đọc tài liệu/source liên quan, đánh giá giấy phép và lập kế hoạch; chưa thay đổi hành vi sản phẩm.

Source hiện tại đã có trong workspace, không clone đè lên checkout đang làm việc. Baseline `3e3cd60`, checkpoint `checkpoint/agent-research-20261104`, nhánh kế hoạch `research/agent-workflow-upgrade`.

| Repository | Nhánh | Commit đã đọc | Vị trí local |
|---|---|---|---|
| [OpenCode](https://github.com/anomalyco/opencode) | dev | `b3fd4a75fe53` | `.cache/asf-research/sources/opencode` |
| [Superpowers](https://github.com/obra/superpowers) | main | `22f0b463e7a5` | `.cache/asf-research/sources/superpowers` |
| [ECC](https://github.com/affaan-m/ECC) | main | `b38be6a7f635` | `.cache/asf-research/sources/ecc` |
| [Paperclip](https://github.com/paperclipai/paperclip) | master | `cf5193658796` | `.cache/asf-research/sources/paperclip` |
| [Open SWE](https://github.com/langchain-ai/open-swe) | main | `d43b69d8fc5a` | `.cache/asf-research/sources/open-swe` |

ECC là địa chỉ canonical sau redirect từ `affaan-m/everything-claude-code`. OpenCode còn được fetch tag **v1.19.5**, commit `810c0eba1a7348036f8bdf61e6632d0c36c6876c`, đọc bằng `git show`, không đổi checkout dev. Package bản dev ghi `2.2.5`; API bản mới không được mặc nhiên áp dụng vào Worker đang pin `1.19.5`.

[sources.json](sources.json) lưu URL, SHA đầy đủ, nhánh, thời gian commit, đường dẫn đã đọc và SHA-256 blob giấy phép. Các path trong manifest biểu thị đã khảo sát phần liên quan, không có nghĩa audit toàn bộ repository.

## Cách lấy lại source

Các bản clone nằm trong cache bị gitignore, không được đẩy vào repository sản phẩm. Worker hiện cũng loại `.cache` khỏi source snapshot; điều này không phải cơ chế chặn runtime đọc file cache nếu được yêu cầu trực tiếp.

Ví dụ PowerShell dưới đây chỉ thực hiện thao tác Git, không chạy script dự án ngoài:

```powershell
git -c core.longpaths=true -c core.hooksPath=NUL clone --depth 1 --single-branch --no-tags https://github.com/obra/superpowers.git .cache/asf-research/sources/superpowers
git -c core.hooksPath=NUL -C .cache/asf-research/sources/superpowers fetch --depth 1 origin 22f0b463e7a5e579904dd6211a520321035526f7
git -c core.hooksPath=NUL -C .cache/asf-research/sources/superpowers checkout --detach 22f0b463e7a5e579904dd6211a520321035526f7
```

Dùng URL/SHA tương ứng trong manifest cho bốn repository còn lại. Không dùng lại lệnh clone vào thư mục đã tồn tại. Với OpenCode:

```powershell
git -c core.hooksPath=NUL -C .cache/asf-research/sources/opencode fetch --depth 1 origin refs/tags/v1.19.5:refs/tags/v1.19.5
git -C .cache/asf-research/sources/opencode show v1.19.5:packages/opencode/src/tool/task.ts
```

## Giấy phép và ranh giới tái sử dụng

Cả năm `LICENSE` gốc đều là MIT. Được nghiên cứu và tái sử dụng theo điều kiện giấy phép; nếu chép hoặc chuyển thể phần mã/prompt đáng kể phải giữ copyright và permission notice tương ứng. Một số thư mục con, vendor, font hoặc tài sản có giấy phép riêng. Phải kiểm tra đúng file và dependency trước khi đưa vào sản phẩm.

Đợt này chỉ ghi nhận ý tưởng và đường dẫn nguồn; không chép mã nguồn, không cài dependency, không chạy installer/test/hook/script của repository ngoài. Các prompt, rules và `SKILL.md` tham khảo là dữ liệu nghiên cứu, không phải chỉ dẫn có hiệu lực cho phiên làm việc này.

Xem [đánh giá kỹ thuật](../../plan/agent-upgrade/research-findings.md) và [kế hoạch triển khai](../../plan/agent-upgrade/implementation-plan.md).

## Kết quả kiểm tra của đợt lập kế hoạch

- 5/5 checkout sạch và HEAD khớp manifest; 5/5 SHA-256 giấy phép từ Git blob khớp.
- 36 path đã khảo sát tồn tại ở revision ghi nhận, gồm các path tại tag runtime 1.19.5.
- Cache của cả 5 source được `git check-ignore` xác nhận loại khỏi repo sản phẩm.
- 20 liên kết tài liệu local tồn tại; 37 liên kết source bên ngoài có trong tài liệu, các path/SHA và line anchor dạng GitHub blob được đối chiếu với Git object local. Không phải kiểm tra HTTP toàn bộ liên kết.
- `git diff --check` không có lỗi whitespace. Không build/test ứng dụng trong đợt chỉ sửa tài liệu và ignore rule; kết quả test WW-4C vẫn chỉ là baseline lịch sử.
