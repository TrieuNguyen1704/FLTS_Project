# BẢNG PHÂN CHIA CÔNG VIỆC CHI TIẾT SPRINT 1 (FOUNDATION & CORE MVP)

> **Mục tiêu Sprint 1:** Xây dựng nền tảng hệ thống hoàn chỉnh (Docker, Database, Vue 3, Laravel 12), luồng xác thực đa vai trò (Auth), quản lý khóa học (Courses) và tiếp nhận tài liệu giảng dạy ban đầu (Document Ingestion).

---

## 🧑‍💻 1. TRÀ VĂN MINH KHOA — BACKEND FOUNDATION & AUTHENTICATION
* **Nhánh làm việc:** `feature/sprint1-khoa-auth-backend`
* **Công số dự kiến:** ~32 giờ

| Mã Task | User Story / PB | Mô tả chi tiết & Yêu cầu kỹ thuật | Tiêu chí hoàn thành (Acceptance Criteria) |
|---|---|---|---|
| **KHOA-01** | Hạ tầng | Dựng `docker-compose.yml` nền tảng cho 4 dịch vụ: `web` (Vue 3/Nginx), `api` (PHP 8.4/Laravel 12), `mysql` (MySQL 8.4), `mailpit` (Mailpit). | `docker compose up -d` khởi động 4 container trơn tru, healthcheck MySQL pass. |
| **KHOA-02** | Khung Backend | Cấu hình Laravel 12 trong thư mục `backend/`, kết nối MySQL qua biến môi trường `.env`. | Chạy được `php artisan migrate` từ bên trong container `api`. |
| **KHOA-03** | PB05 (US-05) | Thiết kế migration bảng `users` (hỗ trợ `role`: `lecturer`, `student`, `admin`). Viết API đăng ký `POST /api/auth/register`. | Validate email đúng định dạng, không trùng lặp, mật khẩu tối thiểu 8 ký tự, mật khẩu được băm `Hash::make`. |
| **KHOA-04** | PB06 (US-06) | Cài đặt Laravel Sanctum, viết API đăng nhập `POST /api/auth/login`. | Trả về thông tin `user` và Sanctum token `bearer_token` khi đăng nhập đúng; trả về 422/401 khi sai mật khẩu. |
| **KHOA-05** | PB08 (US-08) | API Đăng xuất `POST /api/auth/logout` và lấy thông tin người dùng hiện tại `GET /api/auth/me`. | Thu hồi token hiện tại trong database khi đăng xuất; route yêu cầu middleware `auth:sanctum`. |
| **KHOA-06** | Testing | Viết Feature Test trong `backend/tests/Feature/AuthTest.php`. | Pass toàn bộ test case đăng ký, đăng nhập thành công và đăng nhập thất bại. |

---

## 🎨 2. LÊ THẾ KHÁNH HƯNG — FRONTEND ARCHITECTURE & AUTH UI
* **Nhánh làm việc:** `feature/sprint1-hung-frontend-ui`
* **Công số dự kiến:** ~32 giờ

| Mã Task | User Story / PB | Mô tả chi tiết & Yêu cầu kỹ thuật | Tiêu chí hoàn thành (Acceptance Criteria) |
|---|---|---|---|
| **HUNG-01** | Khung Frontend | Khởi tạo dự án Vue 3 + Vite trong `frontend/`, tích hợp Pinia, Vue Router và cấu hình Tailwind CSS / CSS chuẩn. | `npm run build` thành công, `npm run dev` hiển thị trang chào đón. |
| **HUNG-02** | Component dùng chung | Xây dựng các components giao diện tái sử dụng: `AppSidebar.vue`, `AppTopbar.vue`, `AppModal.vue`, `StatusBadge.vue`. | Hiển thị responsive, giao diện đồng bộ, chuẩn tiếng Việt. |
| **HUNG-03** | Quản lý State | Xây dựng Pinia store `useAuthStore` và file cấu hình axios/api client (`src/services/api.js`). | Lưu token an toàn vào `localStorage`, tự động đính kèm header `Authorization: Bearer <token>` vào mọi request. |
| **HUNG-04** | PB01 (US-01) | Màn hình Đăng nhập `LoginView.vue`. | Form nhập email, password, hiển thị thông báo lỗi rõ ràng, có nút chuyển sang trang Đăng ký và Quên mật khẩu. |
| **HUNG-05** | PB02 (US-02) | Màn hình Đăng ký `RegisterView.vue`. | Form đăng ký tài khoản đầy đủ trường: Họ tên, Email, Mật khẩu, Xác nhận mật khẩu, Vai trò (Giảng viên/Sinh viên). |
| **HUNG-06** | PB04 (US-04) | Điều hướng & Màn hình Dashboard theo vai trò (`LecturerDashboardView.vue`, `StudentDashboardView.vue`, `AdminDashboardView.vue`). | Route guard chặn người chưa đăng nhập; chuyển hướng đúng Dashboard theo vai trò sau khi đăng nhập. |

---

## 📂 3. ĐẶNG TRUNG VƯƠNG — COURSE MANAGEMENT & DOCUMENT INGESTION
* **Nhánh làm việc:** `feature/sprint1-vuong-courses-documents`
* **Công số dự kiến:** ~32 giờ

| Mã Task | User Story / PB | Mô tả chi tiết & Yêu cầu kỹ thuật | Tiêu chí hoàn thành (Acceptance Criteria) |
|---|---|---|---|
| **VUONG-01** | Data Schema | Tạo Migration & Model cho bảng `courses`, `course_lecturers`. | Khóa ngoại liên kết chặt chẽ với bảng `users`, ràng buộc tính toàn vẹn dữ liệu. |
| **VUONG-02** | PB09 (US-09) | Viết Controller & API Quản lý Khóa học (`POST /api/courses`, `GET /api/courses`, `GET /api/courses/{id}`). | Giảng viên tạo được khóa học mới, danh sách khóa học chỉ hiển thị các khóa học do giảng viên đó phụ trách. |
| **VUONG-03** | PB11 (US-11) | Thiết kế schema bảng `teaching_documents` (lưu `file_name`, `file_path`, `mime_type`, `file_size`, `status`). | Lưu trữ file an toàn trong thư mục `storage/app/documents/`. |
| **VUONG-04** | PB12 (US-12) | API Upload tài liệu `POST /api/courses/{course}/documents`. | Kiểm tra dung lượng tệp $\le 20\text{MB}$; chỉ chấp nhận định dạng `.pdf`, `.docx`, `.doc`. Từ chối tệp không hợp lệ với mã lỗi 422. |
| **VUONG-05** | Component Upload | Xây dựng giao diện kéo thả tệp `FileDropzone.vue` trên Frontend và tích hợp vào màn hình chi tiết khóa học. | Kéo thả mượt mà, hiển thị thanh tiến trình tải lên, thông báo lỗi nếu tệp quá lớn hoặc sai định dạng. |
| **VUONG-06** | Testing | Viết Feature Test cho API Khóa học và Upload tài liệu (`CourseTest.php`, `DocumentUploadTest.php`). | Đảm bảo chặn sinh viên tạo khóa học hoặc upload vào khóa học không thuộc quyền quản lý. |

---

## 🛡️ 4. TRƯƠNG CÔNG TRIỀU NGUYÊN — CORE SECURITY, DOCUMENT LOGIC & SM
* **Nhánh làm việc:** `feature/sprint1-nguyen-document-core`
* **Công số dự kiến:** ~32 giờ

| Mã Task | User Story / PB | Mô tả chi tiết & Yêu cầu kỹ thuật | Tiêu chí hoàn thành (Acceptance Criteria) |
|---|---|---|---|
| **NGUYEN-01** | Quản trị Scrum | Thiết lập GitHub repo `FLTS_Team`, phân quyền Collaborators, cấu hình branch rules cho `main`. Tổ chức Daily Scrum và Sprint Review. | Nhánh `main` được bảo vệ, mọi thay đổi đều thông qua PR. |
| **NGUYEN-02** | PB07 (US-07) | Luồng Quên mật khẩu & Đặt lại mật khẩu bảo mật (`POST /api/auth/password-recovery/request`, `POST /api/auth/password-recovery/reset`). | Sinh token ngẫu nhiên, lưu hash SHA-256 vào database có thời hạn 60 phút, gửi email thông báo kèm liên kết đặt lại mật khẩu. |
| **NGUYEN-03** | Email System | Tích hợp hệ thống Email Mailable (`WelcomeMail`, `PasswordResetMail`) hỗ trợ cả Google Mail SMTP và Mailpit local. | Gửi email chào mừng kích hoạt tài khoản khi đăng ký mới thành công; không làm crash request nếu lỗi mạng. |
| **NGUYEN-04** | PB13 (US-13) | Thiết kế bảng `document_processing_runs` và bộ chuyển trạng thái (State Machine): `uploaded_pending_processing` -> `processing` -> `processed` / `failed`. | Trạng thái tài liệu được cập nhật chính xác và an toàn theo từng bước xử lý. |
| **NGUYEN-05** | PB14 (US-14) | API Tìm kiếm tài liệu, Tải xuống (Download) và Xóa tài liệu (`DELETE /api/documents/{id}`). | Chỉ giảng viên sở hữu khóa học mới được phép xóa file; xóa file thật trong disk khi xóa bản ghi trong database. |
| **NGUYEN-06** | Tổng duyệt Sprint 1 | Review PR của cả 3 thành viên, tích hợp toàn bộ hệ thống, chạy kiểm thử PHPUnit toàn diện. | Toàn bộ các Feature Test và Unit Test của cả 4 mảng đều **Pass 100% (Xanh)**. |
