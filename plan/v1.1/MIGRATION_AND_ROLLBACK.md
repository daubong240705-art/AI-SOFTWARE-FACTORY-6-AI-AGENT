# Dữ liệu và rollback V1.1

Ưu tiên field JSON optional, đọc được history schema6. Chỉ thêm schema khi cần; backup trước migration nếu có. Không thay DB đang dùng trong kiểm tra, chỉ dữ liệu thử riêng trong workspace/cache.

Không tự stash/reset/commit source người dùng. Snapshot/checkpoint không phải Git commit; giữ HEAD/index và file người dùng. Restore vẫn từng file có preview/hash guard; không tự rollback cả repo.

Trước rollback app, dừng runtime/local command, giữ backup DB cùng runtime metadata. Dữ liệu mới phải được đọc bởi parser tương thích; không tự downgrade/xóa DB. Rollback chức năng theo commit, giữ parser nếu schema/settings mới cần nó.
