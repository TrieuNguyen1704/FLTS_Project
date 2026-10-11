# Vương — Courses & Teaching Documents API

Repo: `TrieuNguyen1704/FLTS_Project`. Branch: `feature/sprint1-vuong-courses-documents`.

Theo bảng phân công hiện tại: PDF/DOC/DOCX tối đa **20 MiB (20 × 1024 × 1024 bytes)**. Bộ ảnh trước cho phép 10 hoặc 20 MB; bảng trong repo chốt 20 MB. PHP 20M, multipart PHP/Nginx 21M.

## VUONG-01 đến VUONG-06

- `courses`: primary owner `lecturer_id`, name/code/description, unique code, index `(lecturer_id,id)`.
- `course_lecturers`: FK tới users/courses và unique `(course_id,lecturer_id)`; API tạo khóa đồng thời ghi người sở hữu vào bảng này trong transaction. Quyền quản lý Sprint 1 dùng primary owner; không cung cấp API cấp quyền đồng giảng viên.
- `course_enrollments`: FK student/course, unique cặp, quan hệ students. Chưa cung cấp enrollment API vì không thuộc 6 task Vương trong bảng phân công.
- `teaching_documents`: `file_name` là UUID basename, `original_name` là tên người dùng, `file_path` là vị trí private trong `storage/app/documents/{course_id}`, `file_size` tính bằng bytes. Trạng thái lưu là `processing_status`; `status` là alias JSON, không lưu hai trạng thái riêng.
- Course API tạo/list/show, document API upload và list để màn hình chi tiết hiển thị tài liệu. Chỉ Lecturer primary owner truy cập; không tự cấp quyền Student hoặc Admin.
- FileDropzone hiển thị tên, dung lượng, nút tải lên, lỗi file và thanh tiến trình XHR. 100% chỉ có nghĩa browser đã gửi xong; vẫn chờ backend xác nhận lưu. Không gọi AI hoặc giả vờ tài liệu đã xử lý.
- Các file test: `CourseTest.php`, `DocumentUploadTest.php`, `CourseAndDocumentTest.php`.

## Hợp đồng HTTP cho Hưng tích hợp

Dùng middleware `auth.token` đã có trên main; không sửa Auth của Khoa hay đưa code Auth từ repo FLTS cũ sang. UI dùng localStorage key `flts_token`, đúng như nhánh frontend của Hưng. Main chưa có Login/Pinia UI; cần tích hợp nhánh Hưng qua PR trước khi người dùng đăng nhập qua giao diện chính.

| Method / endpoint | Input | Result |
|---|---|---|
| POST `/api/courses` | JSON `name`, `code`, optional `description` | 201 `{course}` |
| GET `/api/courses?page=1` | Bearer token | 200 `{courses:[], meta:{current_page,last_page,total}}` |
| GET `/api/courses/{id}` | Bearer token | 200 `{course}` với `lecturer`, `documents_count` |
| GET `/api/courses/{id}/documents?page=1` | Bearer token | 200 `{documents:[],meta:{current_page,last_page,total}}` |
| POST `/api/courses/{id}/documents` | Multipart key `document` | 201 `{document}` |

Mỗi trang tối đa 20 bản ghi, newest id trước. Lỗi: 401 chưa đăng nhập, 403 sai role/ownership, 404 ID không tồn tại, 422 đầu vào sai, 503 không ghi được file. Format lỗi hiện tại Laravel `{message,errors}`; giữ tương thích main, không chuyển toàn hệ thống sang contract khác trong nhánh cá nhân.

`file_path` không được gửi ra browser. Frontend route feature `/lecturer/courses` dùng `CourseWorkspaceView.vue`; khi merge frontend của Hưng, giữ route này trước catch-all và thêm meta role/guard theo router nhóm.

## Scope của Nguyên được giữ riêng

Chưa triển khai search/download/delete, processing runs hoặc thay đổi trạng thái AI; đó là NGUYEN-04/05. Không sao chép chức năng Quiz/RAG/Sprint 2/3 từ repo FLTS cũ.

## Git

Không push/merge main. Chỉ push nhánh Vương tới `FLTS_Project`. Clone local có pre-push guard từ chối `main/master` và remote khác; hook local không tự đi theo clone của đồng đội. Review và Approve của một người thật vẫn còn pending.
