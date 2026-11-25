---
title: Cài đặt
section: start
order: 2
---

## Chuẩn bị

Dùng Linux x64 với `git`; `sudo` chỉ dùng để cài gói hệ thống. WSL2 có trong bộ cài nhưng chưa được kiểm đầy đủ; không cài dưới `/mnt`. Bộ cài tải Node.js 22 đã ghim và kiểm SHA-256. Host không cần model provider để khởi động, nhưng Lead chat dùng model đã cấu hình.

## Cài và chạy

```bash
git clone https://github.com/daubong240705-art/AI-SOFTWARE-FACTORY-6-AI-AGENT.git factory
cd factory
bash scripts/install.sh --yes
export PATH="$HOME/.local/bin:$PATH"
factory setup
factory doctor
factory start
```

Mở [Factory trên máy bạn](http://127.0.0.1:8787/). `factory setup` hỏi về model provider, API key, model, cổng, địa chỉ nghe và agent CLI. `factory doctor` kiểm các mục đó và chỉ cách sửa. Nếu gặp lỗi, tra [mã doctor](./doctor.md).

> `--dry-run` chỉ mô tả các bước, `--no-service` bỏ đăng ký dịch vụ người dùng. Bộ cài không ghi đè `factory.env` có sẵn.
