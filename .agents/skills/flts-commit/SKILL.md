---
name: flts-commit
description: >-
  Hướng dẫn commit và đặt tên branch đúng quy ước nhóm FLTS (Conventional
  Commits). Dùng khi chuẩn bị commit code, tạo branch mới, hoặc mở Pull Request.
---

# FLTS — Quy ước Git & Commit

Theo `docs/GIT_WORKFLOW.md` và `docs/TEAM_AGREEMENT.md` của nhóm C1SE.32.

---

## 1. Conventional Commits

Mỗi commit message theo cú pháp:

```
<type>(<scope>): <mô tả ngắn bằng tiếng Anh>
```

| Type | Dùng khi | Ví dụ |
|---|---|---|
| `feat` | Thêm tính năng mới | `feat(auth): add login view with form validation` |
| `fix` | Sửa lỗi | `fix(router): redirect correctly after logout` |
| `docs` | Cập nhật tài liệu | `docs(readme): update sprint 1 task breakdown` |
| `refactor` | Tối ưu code, không thay đổi chức năng | `refactor(store): simplify auth token handling` |
| `test` | Viết kiểm thử | `test(auth): add unit test for useAuthStore` |
| `style` | Chỉnh CSS/format, không thay đổi logic | `style(login): improve button hover animation` |
| `chore` | Cấu hình, dependencies | `chore: add pinia and axios dependencies` |

---

## 2. Đặt tên Branch

```
feature/sprint<số>-<tên-thành-viên>-<mô-tả-ngắn>
fix/<tên-thành-viên>-<mô-tả-lỗi>
```

| Thành viên | Tên dùng trong branch |
|---|---|
| Lê Thế Khánh Hưng | `hung` |
| Trà Văn Minh Khoa | `khoa` |
| Đặng Trung Vương | `vuong` |
| Trương Công Triều Nguyên | `nguyen` |

**Ví dụ:**
```
feature/sprint1-hung-frontend-ui
feature/sprint1-hung-login-view
fix/hung-router-guard-redirect
```

---

## 3. Danh tính Git để commit

Mỗi thành viên commit dưới danh tính riêng. Xem chi tiết tại `docs/TEAM_MEMBERS.md`.

Hung commit với:
```bash
git config user.name "Lê Thế Khánh Hưng"
git config user.email "lethekhanhhung1808@gmail.com"
```

---

## 4. Quy trình Push & PR

```
1. git add .
2. git commit -m "feat(scope): mô tả"
3. git push origin feature/sprint1-hung-<tên-tính-năng>
4. Mở Pull Request lên main
5. Chờ ít nhất 1 thành viên review & Approve
6. Merge vào main
```

> ⚠️ **KHÔNG commit trực tiếp vào `main`** — mọi thay đổi đều qua PR.

---

## 5. Checklist trước khi Push

- [ ] `npm run build` chạy thành công, không có lỗi
- [ ] Không có `console.log`, `dd()`, comment debug thừa
- [ ] Text người dùng thấy đều là tiếng Việt
- [ ] Commit message đúng Conventional Commits
- [ ] Tên branch đúng quy ước nhóm
