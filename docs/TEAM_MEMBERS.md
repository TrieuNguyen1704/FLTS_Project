# 📋 DANH SÁCH THÀNH VIÊN & CẤU HÌNH DANH TÍNH GIT (TEAM ROSTER & GIT IDENTITIES)

> **Dự án:** FLTS (Foreign Language Teaching Support System) — Capstone Project 1 (CMU-SE 450)  
> **Nhóm thực hiện:** C1SE.32 — Đại học Duy Tân  
> **Mục đích file:** Lưu trữ thông tin định danh chính xác của 4 thành viên nhóm. Cung cấp câu lệnh Git để Scrum Master (anh Nguyên) hoặc AI có thể chuyển đổi danh tính (`user.name` và `user.email`) khi cần commit / tạo nhánh thay mặt từng bạn.

---

## 1. BẢNG THÔNG TIN ĐỊNH DANH CHI TIẾT (TEAM PROFILES)

| STT | Họ và tên | MSSV | Vai trò chính | Email (Git Commit Email) | Username GitHub & Profile | Số điện thoại |
|:---:|---|:---:|---|---|---|:---:|
| 1 | **Trương Công Triều Nguyên** | **25201205268** | Scrum Master & Dev | `shellingofficical@gmail.com` | [`TrieuNguyen1704`](https://github.com/TrieuNguyen1704) | **0907857735** |
| 2 | **Trà Văn Minh Khoa** | **29219054767** | Developer (Backend Lead) | `minhkhoa131103@gmail.com` | [`khoaminh1311`](https://github.com/khoaminh1311) | **0702665686** |
| 3 | **Lê Thế Khánh Hưng** | **29211143657** | Developer (Frontend Lead) | `lethekhanhhung1808@gmail.com` | [`khanhhungdev1808`](https://github.com/khanhhungdev1808) | **0855482883** |
| 4 | **Đặng Trung Vương** | **29211150834** | Developer (Core Feature) | `dangtrungvuong2020@gmail.com` | [`vit2604`](https://github.com/vit2604) | **0349474291** |

---

## 2. NGUYÊN TẮC NHẬN DIỆN COMMIT CỦA GITHUB

> 💡 **CƠ CHẾ CỦA GITHUB:** GitHub liên kết commit với tài khoản của ai **hoàn toàn dựa vào `user.email`** trong commit metadata. Khi email trùng khớp với email tài khoản GitHub của bạn đó, GitHub sẽ tự động hiển thị Avatar, Tên và đóng góp (Contribution Graph) của chính bạn đó trên GitHub.

---

## 3. CÁC LỆNH CHUYỂN ĐỔI DANH TÍNH GIT (LOCAL CONFIG COMMANDS)

Khi cần commit thay mặt hoặc chuyển danh tính trên máy local cho từng thành viên, chỉ cần chạy các lệnh PowerShell / Bash tương ứng dưới đây trong thư mục `FLTS_Team`:

### 🟢 1. Chuyển sang: Trương Công Triều Nguyên (Scrum Master)
```powershell
git config user.name "Truong Cong Trieu Nguyen"
git config user.email "shellingofficical@gmail.com"
```

### 🔵 2. Chuyển sang: Trà Văn Minh Khoa (Backend Lead)
```powershell
git config user.name "Tra Van Minh Khoa"
git config user.email "minhkhoa131103@gmail.com"
```

### 🟠 3. Chuyển sang: Lê Thế Khánh Hưng (Frontend Lead)
```powershell
git config user.name "Le The Khanh Hung"
git config user.email "lethekhanhhung1808@gmail.com"
```

### 🟣 4. Chuyển sang: Đặng Trung Vương (Core Feature Lead)
```powershell
git config user.name "Dang Trung Vuong"
git config user.email "dangtrungvuong2020@gmail.com"
```

---

## 4. CÚ PHÁP COMMIT MẪU DÀNH CHO TỪNG BẠN

Khi commit cho bạn nào, hãy checkout đúng nhánh của bạn đó:

* **Khoa:**
  ```powershell
  git checkout -b feature/sprint1-khoa-auth-backend
  git config user.name "Tra Van Minh Khoa"
  git config user.email "minhkhoa131103@gmail.com"
  git commit -m "feat(auth): implement user registration and login endpoints"
  ```
* **Hưng:**
  ```powershell
  git checkout -b feature/sprint1-hung-frontend-ui
  git config user.name "Le The Khanh Hung"
  git config user.email "lethekhanhhung1808@gmail.com"
  git commit -m "feat(ui): build login and registration screens"
  ```
* **Vương:**
  ```powershell
  git checkout -b feature/sprint1-vuong-courses-documents
  git config user.name "Dang Trung Vuong"
  git config user.email "dangtrungvuong2020@gmail.com"
  git commit -m "feat(course): implement course creation and teaching document upload"
  ```
* **Nguyên:**
  ```powershell
  git checkout -b feature/sprint1-nguyen-document-core
  git config user.name "Truong Cong Trieu Nguyen"
  git config user.email "shellingofficical@gmail.com"
  git commit -m "feat(security): implement secure token password reset and processing state machine"
  ```
