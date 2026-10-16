---
name: flts-api
description: >-
  Hướng dẫn gọi API đúng chuẩn FLTS: dùng axios instance từ src/services/api.js,
  xử lý loading/error, hiển thị thông báo tiếng Việt. Dùng khi tích hợp API
  backend Laravel vào Vue component hoặc Pinia store.
---

# FLTS — Chuẩn gọi API với Axios

Dự án FLTS dùng **một axios instance duy nhất** tại `src/services/api.js`.
**KHÔNG** tạo thêm axios instance mới ở bất kỳ đâu.

---

## 1. Import đúng cách

```js
// ✅ Đúng
import api from '@/services/api'

// ❌ Sai — không tạo axios mới
import axios from 'axios'
const myAxios = axios.create(...)
```

---

## 2. Gọi API trong Pinia Store

```js
// src/stores/example.js
import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/services/api'

export const useExampleStore = defineStore('example', () => {
  const data = ref([])
  const isLoading = ref(false)
  const error = ref(null)

  async function fetchData() {
    isLoading.value = true
    error.value = null
    try {
      const response = await api.get('/endpoint')
      data.value = response.data
    } catch (err) {
      error.value = err.response?.data?.message || 'Đã có lỗi xảy ra. Vui lòng thử lại.'
    } finally {
      isLoading.value = false
    }
  }

  return { data, isLoading, error, fetchData }
})
```

---

## 3. Gọi API trực tiếp trong Component

```vue
<script setup>
import { ref } from 'vue'
import api from '@/services/api'

const isLoading = ref(false)
const errorMessage = ref('')

async function submitForm(payload) {
  isLoading.value = true
  errorMessage.value = ''
  try {
    await api.post('/endpoint', payload)
    // Xử lý thành công
  } catch (err) {
    // Lỗi validation từ Laravel (422)
    if (err.response?.status === 422) {
      const errors = err.response.data.errors
      errorMessage.value = Object.values(errors).flat().join(', ')
    } else {
      errorMessage.value = err.response?.data?.message || 'Đã có lỗi xảy ra. Vui lòng thử lại.'
    }
  } finally {
    isLoading.value = false
  }
}
</script>
```

---

## 4. Các API Endpoints của FLTS Backend

### Auth (`/api/auth/`)
| Method | Endpoint | Mô tả | Auth? |
|---|---|---|---|
| `POST` | `/api/auth/register` | Đăng ký | ❌ |
| `POST` | `/api/auth/login` | Đăng nhập → trả `bearer_token` + `user` | ❌ |
| `POST` | `/api/auth/logout` | Đăng xuất | ✅ |
| `GET` | `/api/auth/me` | Lấy thông tin user hiện tại | ✅ |
| `POST` | `/api/auth/password-recovery/request` | Quên mật khẩu | ❌ |
| `POST` | `/api/auth/password-recovery/reset` | Đặt lại mật khẩu | ❌ |

### Courses (`/api/courses/`)
| Method | Endpoint | Mô tả | Auth? |
|---|---|---|---|
| `GET` | `/api/courses` | Danh sách khóa học | ✅ |
| `POST` | `/api/courses` | Tạo khóa học (Giảng viên) | ✅ Lecturer |
| `GET` | `/api/courses/{id}` | Chi tiết khóa học | ✅ |

### Documents (`/api/courses/{course}/documents`)
| Method | Endpoint | Mô tả | Auth? |
|---|---|---|---|
| `POST` | `/api/courses/{course}/documents` | Upload tài liệu (≤20MB, .pdf/.docx/.doc) | ✅ Lecturer |
| `DELETE` | `/api/documents/{id}` | Xóa tài liệu | ✅ Owner |

---

## 5. Cấu trúc Response từ Laravel

```js
// Thành công
{
  "data": { ... },      // hoặc mảng [...]
  "message": "..."
}

// Lỗi validation (422)
{
  "message": "The given data was invalid.",
  "errors": {
    "email": ["Email đã tồn tại."],
    "password": ["Mật khẩu tối thiểu 8 ký tự."]
  }
}

// Lỗi xác thực (401)
{
  "message": "Unauthenticated."
}
```

---

## 6. Token Management

Token được `api.js` tự động xử lý qua interceptor:
- **Request**: Tự gắn `Authorization: Bearer <token>` từ `localStorage.flts_token`
- **Response 401**: Tự xóa token + redirect về `/login`

**Không cần** tự gắn header Authorization trong code component.
