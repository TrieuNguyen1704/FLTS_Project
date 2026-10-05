# QUY ƯỚC LÀM VIỆC NHÓM & TIÊU CHUẨN NGHIỆM THU (TEAM AGREEMENT & DOD)

> **Nhóm:** C1SE.32 — Capstone Project 1 (CMU-SE 450)  
> **Dự án:** FLTS (Foreign Language Teaching Support System)  

---

## 1. NGUYÊN TẮC LÀM VIỆC CỐT LÕI (CORE PRINCIPLES)

1. **Minh bạch tiến độ (Transparency):**
   * Mọi task đều phải được cập nhật trạng thái trên bảng công việc chung: `To Do` -> `In Progress` -> `In Review (PR)` -> `Done`.
   * Gặp vướng mắc (blocker) quá **2 giờ** mà không tự giải quyết được phải báo ngay lên nhóm Zalo/Discord để anh Nguyên và đồng đội hỗ trợ.
2. **Không commit trực tiếp vào `main`:**
   * Mọi thay đổi đều phải thông qua Feature Branch và Pull Request (PR).
   * Mỗi PR phải có ít nhất **1 thành viên review và Approve** trước khi merge.
3. **Mã nguồn sạch & Có kiểm thử (Clean Code & Test First):**
   * Không merge code bị lỗi cú pháp hoặc làm hỏng bản build hiện tại.
   * Viết kèm Unit Test hoặc Feature Test cho các chức năng quan trọng (Auth, Upload, State Machine).

---

## 2. QUY CHUẨN MÃ NGUỒN (CODING CONVENTIONS)

* **Backend (PHP / Laravel):**
  * Tuân thủ chuẩn PSR-12.
  * Tên Controller: `PascalCase` (ví dụ: `AuthController.php`, `CourseController.php`).
  * Tên hàm: `camelCase` (ví dụ: `register()`, `uploadDocument()`).
  * Tên bảng trong database: `snake_case`, số nhiều (ví dụ: `users`, `teaching_documents`).
  * Mọi biến môi trường nhạy cảm phải đọc từ `.env` qua hàm `env()`, không hardcode vào code.
* **Frontend (Vue 3 / JavaScript):**
  * Sử dụng Vue 3 `<script setup>` syntax và Composition API.
  * Tên Component: `PascalCase` (ví dụ: `CourseCard.vue`, `FileDropzone.vue`).
  * Tên biến và hàm: `camelCase`.
  * Tên CSS class: Bám theo utility classes của Tailwind CSS.
  * Toàn bộ nhãn, thông báo người dùng phải dùng tiếng Việt chuẩn (`vi-VN`).
* **AI Service (Python):**
  * Tuân thủ chuẩn PEP 8.
  * Type hints đầy đủ cho tham số và giá trị trả về của hàm.
  * Bắt lỗi ngoại lệ tường minh (Explicit Exceptions), không dùng `except Exception: pass`.

---

## 3. TIÊU CHUẨN HOÀN THÀNH (DEFINITION OF DONE - DOD)

Một User Story / Task chỉ được xem là **HOÀN THÀNH (DONE)** khi thỏa mãn tất cả các điều kiện sau:

1. [ ] **Chức năng hoạt động đúng nghiệp vụ:** Chạy thử bằng tay (Manual Test) đạt kết quả như mong đợi trên môi trường local.
2. [ ] **Mã nguồn sạch:** Đã loại bỏ các đoạn code thừa, `console.log`, `dd()`, comment debug tạm thời.
3. [ ] **Test tự động chạy thành công:** 
   * Backend: Chạy `php vendor/bin/phpunit` pass 100% không có lỗi.
   * Frontend: Chạy `npm run build` không có lỗi biên dịch.
4. [ ] **Tài liệu & Comment:** Code có comment giải thích các logic nghiệp vụ phức tạp.
5. [ ] **Pull Request được duyệt:** Đã mở PR, giải quyết toàn bộ góp ý (review comments) và được Scrum Master / Reviewer bấm **Approve**.

---

## 4. LỊCH HỌP DAILY SCRUM (15 PHÚT HÀNG NGÀY)

* **Thời gian:** 21:00 hàng ngày (hoặc trước buổi học).
* **Nền tảng:** Google Meet / Discord / Zalo Call.
* **Mỗi thành viên lần lượt trả lời 3 câu hỏi:**
  1. *Hôm qua tôi đã hoàn thành việc gì? (Gắn với commit/PR nào?)*
  2. *Hôm nay tôi sẽ làm việc gì tiếp theo?*
  3. *Tôi có gặp khó khăn, trở ngại gì cần nhóm hoặc Scrum Master giúp đỡ không?*
