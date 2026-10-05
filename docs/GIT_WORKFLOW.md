# QUY TRÌNH QUẢN LÝ MÃ NGUỒN (GIT WORKFLOW) — NHÓM C1SE.32

Tài liệu này hướng dẫn chi tiết từ A-Z cách nhóm C1SE.32 thiết lập GitHub Repository, làm việc cộng tác qua nhánh, mở Pull Request (PR) và giải quyết xung đột mã nguồn.

---

## 1. HƯỚNG DẪN KHỞI TẠO REPO TRÊN GITHUB (CHO ANH NGUYÊN)

### Bước 1: Tạo Repository mới trên GitHub
1. Truy cập vào GitHub: [https://github.com/new](https://github.com/new)
2. Điền thông tin repository:
   * **Repository name:** `FLTS-Team` (hoặc tên nhóm thống nhất, ví dụ `FLTS-Capstone1`)
   * **Visibility:** Chọn **Public** (để giảng viên và hội đồng dễ xem) hoặc **Private** (thêm 3 thành viên vào làm Collaborators).
   * **Khởi tạo repository:** **BỎ CHỌN TẤT CẢ** các mục:
     * [ ] *Add a README file* (Không tick)
     * [ ] *Add .gitignore* (Không tick)
     * [ ] *Choose a license* (Không tick)
     *(Lý do: Chúng ta đã tạo sẵn README và .gitignore chuẩn ở máy local rồi).*
3. Bấm **Create repository**.

### Bước 2: Liên kết mã nguồn local lên GitHub
Sau khi tạo xong, GitHub sẽ hiển thị đường link repo (dạng `https://github.com/<username>/FLTS-Team.git`).

Mở terminal tại máy anh Nguyên và chạy các lệnh sau:
```powershell
# Di chuyển vào thư mục FLTS_Team
cd d:\CMU\Capstone1\FLTS_Team

# Thêm remote origin (thay link thật của nhóm vào)
git remote add origin https://github.com/<username-cua-anh>/FLTS-Team.git

# Kiểm tra remote đã nhận chưa
git remote -v

# Đẩy commit ban đầu lên nhánh main
git push -u origin main
```

### Bước 3: Thêm các thành viên vào dự án (Invite Collaborators)
Vào repo trên GitHub -> **Settings** -> **Collaborators** -> **Add people**:
* Thêm email/GitHub của:
  * Trà Văn Minh Khoa (`minhkhoa131103@gmail.com`)
  * Lê Thế Khánh Hưng (`lethekhanhhung1808@gmail.com`)
  * Đặng Trung Vương (`Dangtrungvuong2020@gmail.com`)

---

## 2. HƯỚNG DẪN CHO CÁC THÀNH VIÊN KÉO MÃ NGUỒN VỀ MÁY (KHOA, HƯNG, VƯƠNG)

Mỗi bạn mở terminal trên máy tính cá nhân và thực hiện theo đúng các bước sau:

### Bước 1: Cấu hình thông tin cá nhân trên Git (BẮT BUỘC)
Mục đích: Đảm bảo mọi commit trên GitHub đều hiện đúng tên và ảnh đại diện của từng người để nộp minh chứng điểm cá nhân.
```bash
git config --global user.name "Tên Của Bạn"
git config --global user.email "email-cua-ban@gmail.com"
```

### Bước 2: Clone repository về máy
```bash
git clone https://github.com/<username-cua-anh-nguyen>/FLTS-Team.git
cd FLTS-Team
```

---

## 3. QUY TRÌNH LÀM VIỆC THEO TỪNG TÍNH NĂNG (FEATURE BRANCH WORKFLOW)

> ⚠️ **QUY TẮC BẤT THÀNH VĂN:** Tuyệt đối **KHÔNG ĐƯỢC CODE TRỰC TIẾP** trên nhánh `main`. Mọi dòng code phải được viết trên nhánh tính năng riêng.

### Bước 1: Cập nhật nhánh `main` mới nhất trước khi làm việc
```bash
git checkout main
git pull origin main
```

### Bước 2: Tạo nhánh mới cho task của mình
Cú pháp tên nhánh: `feature/sprint<số>-<tên-thành-viên>-<tính-năng>`

* **Khoa (Backend Auth):**
  ```bash
  git checkout -b feature/sprint1-khoa-auth-backend
  ```
* **Hưng (Frontend Auth):**
  ```bash
  git checkout -b feature/sprint1-hung-frontend-ui
  ```
* **Vương (Courses & Upload):**
  ```bash
  git checkout -b feature/sprint1-vuong-courses-documents
  ```
* **Nguyên (Document Logic & Security):**
  ```bash
  git checkout -b feature/sprint1-nguyen-document-core
  ```

### Bước 3: Code và Commit thường xuyên
Khi code xong một hàm hoặc một component, thực hiện commit ngay với thông điệp rõ ràng:
```bash
git status
git add .
git commit -m "feat(auth): implement user registration controller and validation"
```

**Các tiền tố commit chuẩn:**
* `feat:` Tính năng mới (ví dụ: `feat(ui): add LoginView component`)
* `fix:` Sửa lỗi (ví dụ: `fix(auth): handle duplicate email error`)
* `test:` Viết unit test / feature test
* `docs:` Viết hoặc sửa tài liệu
* `refactor:` Tối ưu code không làm đổi logic

### Bước 4: Đẩy nhánh lên GitHub và tạo Pull Request (PR)
```bash
git push -u origin feature/sprint1-<ten-ban>-<tinh-nang>
```
1. Truy cập vào GitHub repo của nhóm, bạn sẽ thấy thông báo màu vàng: **"Compare & pull request"**.
2. Bấm vào nút đó, điền tiêu đề PR và mô tả ngắn gọn những gì mình đã làm.
3. Gán (Assignee) chính mình, gán Reviewers là ít nhất 1 bạn khác trong nhóm (hoặc anh Nguyên).
4. Sau khi các bạn xem code, comment góp ý và chấp thuận (Approve), anh Nguyên hoặc người phụ trách sẽ bấm **Merge pull request** vào `main`.
