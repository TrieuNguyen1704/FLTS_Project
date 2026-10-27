# Sprint 3 — Kiểm chứng phần Đặng Trung Vương

Ngày kiểm tra: 2026-10-27, Asia/Saigon. Repo `FLTS_Project`, nhánh `feature/sprint3-vuong-quiz-attempts`. Không chạy/reset database thật, không sửa `.env`, không sửa repo FLTS hoặc code frontend.

## Kết quả đã chạy

| Kiểm tra | Kết quả |
| --- | --- |
| Backend toàn bộ feature tests | **45 tests, 270 assertions — PASS**, PHP 8.4.24, SQLite in-memory, peak 52 MB |
| Tests riêng Sprint 3 | 14 tests trong `backend/tests/Feature/SprintThreeQuizApiTest.php`, nằm trong tổng số trên |
| PHP lint | 10 file PHP mới/sửa đều không lỗi cú pháp |
| Route registration | 6 endpoints quiz-attempts/quiz-results được Laravel đăng ký |
| Frontend build | PASS sau `npm ci --no-audit --no-fund`, không thay package/lockfile |
| Frontend tests hiện có | **11 tests — PASS**, không viết/sửa frontend thuộc Hưng |

Lệnh chạy ở `backend/` (DLL SQLite có sẵn nhưng chưa bật trong PHP CLI của máy; `-d` chỉ bật cho process này):

```powershell
php -d extension=pdo_sqlite -d extension=sqlite3 vendor/bin/phpunit
php artisan route:list --path=quiz-
```

Lệnh frontend: `npm ci --no-audit --no-fund`, `npm run build`, `npm test`.

## Ca kiểm thử Sprint 3

1. Start/resume không tạo hai bài liên tiếp và không lộ key/explanation/snapshot.
2. Autosave, resume bản nháp, từ chối version cũ (409).
3. Chấm đúng/sai tại server, không tin score client, tính duration và lưu thời gian theo câu.
4. Submit lặp idempotent; draft sau completed bị từ chối.
5. Bỏ trống câu được 0 điểm; quiz không giới hạn giờ.
6. Nộp sau hạn chỉ lấy bản nháp server đã lưu, không lấy đáp án đến muộn.
7. Request đúng deadline được auto-submit; start tiếp là retake.
8. Start bài hết hạn finalize trước khi tạo bài mới.
9. Từ chối câu hỏi trùng, option sai câu, câu lạ, thời gian âm, thiếu draft_version.
10. Kiểm tra token, role, enrollment, quyền sở hữu attempt và lecturer.
11. Chặn object draft hoặc object sai course.
12. Snapshot cố định đáp án khi nội dung hiện tại bị sửa.
13. Quiz không có đúng một đáp án đúng không được bắt đầu.
14. Phân trang history không lộ snapshot; thống kê participants/retakes/average/pass-rate/distribution, lecturer xem chi tiết completed.

## Chưa được xác nhận — không đánh dấu Done tích hợp

- Migration/model Quiz production của Khoa chưa có ở main `5323d13`. Tests dùng contract fixture có ghi chú rõ; không tuyên bố fixture là schema thật của Khoa.
- Chưa chạy MySQL với migrations 15–22 hoặc test request đồng thời trên MySQL. Row lock được triển khai, SQLite không chứng minh hiệu lực khóa của MySQL.
- Chưa chạy giao diện player/editor của Hưng hoặc queue/generation của Khoa/Nguyên.
- Cần nhóm thống nhất cột khóa ngoại/tên trường theo Notion và published-version selector trước merge. Không tự merge nhánh của thành viên khác để thử.
- Không có scheduler auto-submit nền; chỉ finalize deadline khi start/draft/submit được gọi. Nếu mở rộng scope phải cập nhật quyết định và test.
- Chưa có review/Approve của leader; tuyệt đối không tự merge hoặc push main.

Chi tiết giao tiếp: `docs/VUONG_SPRINT3_API_CONTRACT.md`. Quyết định và AI usage: contract + `docs/decisions/2026-10-27-vuong-sprint3.md`.
