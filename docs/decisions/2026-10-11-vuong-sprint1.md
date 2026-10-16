# Decision Log — Vương Sprint 1

Ngày: 11/10/2026. Repo đúng: `TrieuNguyen1704/FLTS_Project`. Base main `cfb92e9`.

1. Làm mới các task VUONG-01..06 trên nhánh cá nhân. Không cherry-pick controller/Quiz/RAG từ repo FLTS cũ, không push/merge main.
2. Bảng phân công hiện tại trong repo yêu cầu 20 MB và course_lecturers; dùng 20 MiB và bảng pivot bên cạnh primary owner `courses.lecturer_id`. Owner được ghi vào pivot trong transaction khi tạo khóa.
3. Tên cột theo ảnh/schema task: `file_name`, `original_name`, `file_path`, `file_size`, `mime_type`, `processing_status`. API thêm alias `status` cho thuật ngữ trong task sheet, không lưu hai trạng thái riêng. Ẩn private file_path khỏi JSON.
4. API theo main `/api`, middleware `auth.token`; không đổi Auth của Khoa sang Sanctum trong task của Vương. Error JSON Laravel hiện có. Những điểm lệch `/api/v1`/Sanctum trong tài liệu tổng quan phải được nhóm chốt khi tích hợp.
5. CourseWorkspace dùng `flts_token`, cùng key nhánh Hưng; route feature cần được ghép với auth UI/guard của Hưng khi PR được review. Main hiện chưa có màn hình Login.
6. Upload chỉ lưu file, trả pending. Processing/download/delete/search thuộc Nguyên, không thực hiện trong nhánh này.
7. List khóa/tài liệu paginate 20 items, eager-load lecturer tránh N+1; ghi file bằng streaming. Tiến trình XHR đo số byte thật, chờ response thành công trước khi báo lưu xong.
8. Kiểm thử Docker trong project `flts-project-vuong`, volume riêng và port 8010/8181/3310/8030 để không thay dữ liệu hoặc container của repo cũ. Không chạy Chroma/LLM local.
