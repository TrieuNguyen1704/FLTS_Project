# Kiểm tra task Vương tại FLTS_Project

Ngày: 11/10/2026. Nhánh `feature/sprint1-vuong-courses-documents`, base main `cfb92e9`.

## Kết quả ban đầu

- PHPUnit native PHP 8.4.24, SQLite in-memory và storage fake: **16 tests / 95 assertions passed**, 46 MB báo bởi PHPUnit.
- Frontend `npm ci` theo lockfile, `npm run build`: passed, 33 modules.
- Component tests `npm test`: **7/7 passed** — chọn file, sai đuôi, quá dung lượng, file rỗng, drop một/nhiều file, chặn drop lúc đang tải, render progress 37% và chờ xác nhận ở 100%. CI frontend đã thêm bước npm test.
- Hợp đồng API và điểm tích hợp frontend của Hưng: `VUONG_SPRINT1_API_CONTRACT.md`.

## Chạy Docker không ảnh hưởng repo cũ

```powershell
$env:MYSQL_PORT='3310'
$env:API_PORT='8010'
$env:APP_PORT='8181'
$env:MAILPIT_PORT='8030'
docker compose -p flts-project-vuong up --build -d mysql mailpit api web
docker compose -p flts-project-vuong exec -T api php vendor/bin/phpunit
```

Volume/database riêng, không `migrate:fresh` trên dữ liệu nhóm. Không chạy service AI hoặc vector database local để xác minh phần upload.

## Giải thích code bình dân

- Migration tạo bảng và ràng buộc: mã khóa chống trùng, user/course có khóa ngoại và chỉ mục cho danh sách theo chủ sở hữu.
- Model nối các bảng để Laravel biết giảng viên và tài liệu thuộc khóa nào.
- Form Request kiểm tra quyền và dữ liệu trước khi controller ghi file/database. Sinh viên hoặc giảng viên khác bị chặn ở backend.
- Upload đổi tên lưu thành UUID để file cùng tên không ghi đè. Nếu ghi database thất bại, file vừa lưu được dọn. API chưa khởi động AI.
- FileDropzone cho xem tên/dung lượng trước khi gửi; XHR báo tiến trình theo byte thật. Sau khi gửi 100%, vẫn chờ xác nhận Laravel đã lưu.
- Phân trang lấy tối đa 20 bản ghi mỗi lần, giảm RAM và I/O trên HDD.

PR/review và Approve của thành viên nhóm chưa hoàn tất; không gọi task là Done theo DOD của nhóm trước khi được review.

## Kết quả Docker và MySQL thật

- Chạy riêng project Docker `flts-project-vuong`: MySQL, Mailpit, API và Web đã khởi động; health API qua Nginx trả 200 `status=ok` ở `http://localhost:8181/api/health`.
- PHPUnit trong API container PHP 8.4.26: **16 tests / 95 assertions passed**, 44.50 MB. PHPUnit vẫn dùng SQLite in-memory để không xóa dữ liệu demo.
- MySQL thật: sáu migration đều Ran. Kiểm tra HTTP qua Nginx tạo tài khoản lecturer giả, tạo khóa (201), đọc khóa (200), mã trùng (422), upload PDF (201, pending), EXE (422), anonymous list (401), student create/upload (403).
- Dữ liệu giả giữ lại ở database riêng: khóa ID 1 và tài liệu ID 1. Không gọi AI xử lý file này.
- Frontend main hiện chưa có Login của Hưng. Chưa xác minh tương tác browser đăng nhập/upload end-to-end trên UI chính; component tests và API smoke không thay thế lần kiểm tra sau khi ghép nhánh Hưng. Không lấy giao diện Auth từ repo FLTS cũ để làm giả việc tích hợp.
- Kiểm tra main remote vẫn tại `cfb92e960fb6281968c43b54f698cfbad5a9cedb` trước khi push nhánh tính năng. Local hook chặn push main/master hoặc repo khác.
