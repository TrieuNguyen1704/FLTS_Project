# FLTS Project — Quy tắc AI Agent

## Thông tin dự án
- **Dự án:** FLTS (Flipped Learning Teaching System) — Capstone Project 1 (CMU-SE 450)
- **Nhóm:** C1SE.32 — Đại học Duy Tân
- **Stack:** Vue 3 + Vite + Pinia + Vue Router + Tailwind CSS (Frontend) / Laravel 12 + PHP 8.4 + Sanctum + MySQL (Backend)

## Người dùng hiện tại
- **Tên:** Lê Thế Khánh Hưng — Developer (Frontend Lead)
- **MSSV:** 29211143657
- **Nhánh làm việc:** `feature/sprint1-hung-frontend-ui`
- **Phụ trách:** Vue 3 Frontend — Auth UI, Components, Dashboard (HUNG-01 → HUNG-06)

## Quy tắc bắt buộc

1. **Chỉ code trong thư mục `frontend/`** — không chỉnh sửa `backend/`, `ai-service/` trừ khi được yêu cầu rõ ràng
2. **Không thay đổi code ở nhánh FLTS** — chỉ xem tham khảo
3. **Mọi text hiển thị cho người dùng phải là tiếng Việt** (`vi-VN`)
4. **Luôn dùng `<script setup>` + Composition API** — không dùng Options API
5. **Luôn dùng `@/services/api.js`** cho mọi HTTP request — không tạo axios instance mới
6. **Tên component: PascalCase** (ví dụ: `AppSidebar.vue`, `LoginView.vue`)
7. **Commit theo Conventional Commits** (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`)
8. **Mở web bằng Cốc Cốc** — không dùng Chrome

## Cấu trúc thư mục frontend/src/
```
components/   ← shared components (AppSidebar, AppTopbar, AppModal, StatusBadge)
layouts/      ← layout wrappers
services/
  api.js      ← axios client DUY NHẤT
stores/
  auth.js     ← useAuthStore (login, register, logout, fetchMe)
views/
  auth/       ← LoginView, RegisterView, ForgotPasswordView
  dashboard/  ← LecturerDashboardView, StudentDashboardView, AdminDashboardView
router/
  index.js    ← Vue Router + Navigation Guard theo role
```
