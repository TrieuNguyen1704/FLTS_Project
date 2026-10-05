# FLTS — Foreign Language / Teaching Support System
## A RAG-Based Learning Content Generation Platform for Flipped Learning

> **Dự án tốt nghiệp:** Capstone Project 1 (CMU-SE 450)  
> **Nhóm thực hiện:** C1SE.32 — Viện Đào tạo & Nghiên cứu Du Lịch / Trường Quốc Tế, Đại học Duy Tân  
> **Giảng viên hướng dẫn:** ThS. Trương Đình Huy  

---

## 👥 1. Danh sách thành viên nhóm C1SE.32

| STT | Họ và tên | Vai trò chính | Email liên hệ | Phụ trách chính Sprint 1 |
|:---:|---|---|---|---|
| 1 | **Trương Công Triều Nguyên** | Scrum Master & Dev | Shellingofficial@gmail.com | Quản lý Git, Core Document Logic, Security & Sprint Review |
| 2 | **Trà Văn Minh Khoa** | Developer (Backend Lead) | minhkhoa131103@gmail.com | Docker Compose, Laravel 12 Skeleton, Auth API (Register/Login) |
| 3 | **Lê Thế Khánh Hưng** | Developer (Frontend Lead) | lethekhanhhung1808@gmail.com | Vue 3 + Vite, UI Component Library, Auth & Dashboard Screens |
| 4 | **Đặng Trung Vương** | Developer (Core Feature) | Dangtrungvuong2020@gmail.com | Course Management, Teaching Document Upload & Dropzone |

---

## 🏗️ 2. Kiến trúc hệ thống tổng quan (System Architecture)

Hệ thống được thiết kế theo kiến trúc Microservices-friendly đóng gói bằng **Docker Compose**:

* **Frontend (`frontend/`):** Vue 3, Vite, Pinia, Vue Router, Tailwind/CSS.
* **Backend API (`backend/`):** Laravel 12, PHP 8.4, Laravel Sanctum, MySQL 8.4.
* **AI Service (`ai-service/`):** Python 3.12, FastAPI, LangChain / PyPDF / Python-docx, ChromaDB (Vector Store), Google Gemini API.
* **Hạ tầng bổ trợ:** MySQL 8.4 (Database chính), Mailpit (Local SMTP server kiểm thử email).

---

## 🚀 3. Quy trình phát triển (Git & Scrum Workflow)

1. **Nhánh chính (`main`):** Nhánh production/release ổn định. Mọi thay đổi phải đi qua **Pull Request (PR)** và có ít nhất 1 thành viên review trước khi merge.
2. **Quy tắc đặt tên nhánh (Branch naming convention):**
   * Tính năng mới: `feature/sprint<số>-<tên-thành-viên>-<tên-tính-năng>`
   * Sửa lỗi: `fix/<tên-thành-viên>-<mô-tả-lỗi>`
   * Ví dụ: `feature/sprint1-khoa-auth-backend`, `feature/sprint1-hung-frontend-ui`
3. **Quy tắc commit (Conventional Commits):**
   * `feat: ...` (Tính năng mới)
   * `fix: ...` (Sửa lỗi)
   * `docs: ...` (Tài liệu)
   * `test: ...` (Viết kiểm thử tự động)
   * `refactor: ...` (Tối ưu mã nguồn)

---

## 📚 4. Tài liệu chi tiết nội bộ

* [Quy trình Git & Hướng dẫn phối hợp nhóm](docs/GIT_WORKFLOW.md)
* [Bảng phân chia công việc Sprint 1 chi tiết](docs/SPRINT_1_TASK_BREAKDOWN.md)
* [Quy ước kỹ thuật & Tiêu chuẩn nghiệm thu (Definition of Done)](docs/TEAM_AGREEMENT.md)
