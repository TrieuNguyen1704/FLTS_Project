# 2026-10-27 — Vương Sprint 3: Attempt engine

- Phạm vi: phần Đặng Trung Vương trong Notion Sprint 3; không mở rộng sang generation/job/frontend.
- Cơ sở: FLTS_Project main 5323d13, tham khảo FLTS main b90ea0d.
- Giữ tên cột Notion (`question_id`, `passing_percentage`, `order_index`, `citation_metadata`), không sao chép schema mẫu FLTS khác tên. Phụ thuộc migrations/models Quiz của Khoa, hiện chưa có trong main.
- Bổ sung trạng thái, attempt_number, deadline, draft_version, JSON draft/snapshot vào hai migration được giao để hỗ trợ resume, autosave chống ghi đè, deadline server và chấm điểm cố định theo nội dung lúc bắt đầu. Snapshot không lộ trong response đang làm bài.
- Form Request validate payload; service tách chấm điểm; transaction/row-lock và unique index; submit idempotent. Score 0–100, max_score tổng số câu.
- Deadline xử lý lazy khi có start/draft/submit, không tự thêm scheduler thuộc phần queue của người khác.
- Thống kê SQL + phân trang, không load tất cả attempts; thời gian client chỉ mang tính chỉ báo, không kết luận hành vi/khả năng học.
- FK restrict để không mất lịch sử nguồn; cần thống nhất version pointer và quy trình thay câu hỏi khi tích hợp.
- Tests contract fixture được ghi rõ, không tạo production bảng Khoa. Chỉ nghiệm thu end-to-end/MySQL sau khi phụ thuộc có thật. Chi tiết routes/payload ở `docs/VUONG_SPRINT3_API_CONTRACT.md`.
