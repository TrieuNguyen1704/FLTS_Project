---
name: vue-component
description: >-
  Tạo Vue 3 component đúng chuẩn FLTS. Dùng khi cần tạo mới hoặc chỉnh sửa
  Vue component, view, hoặc layout cho dự án FLTS. Áp dụng đầy đủ quy ước:
  script setup, Composition API, PascalCase, Tailwind CSS, tiếng Việt.
---

# FLTS — Chuẩn Vue 3 Component

Dự án FLTS Frontend dùng **Vue 3 + Vite + Pinia + Vue Router + Tailwind CSS**.
Mọi component PHẢI tuân thủ các quy tắc dưới đây (theo `docs/TEAM_AGREEMENT.md`).

---

## 1. Cấu trúc file bắt buộc

Thứ tự các block trong `.vue` file luôn là:

```vue
<script setup>
// 1. Imports (thư viện → stores → composables → components → utils)
// 2. Props & Emits
// 3. Store
// 4. Reactive state (ref, reactive, computed)
// 5. Lifecycle hooks
// 6. Functions / Methods
</script>

<template>
  <!-- Root element duy nhất -->
</template>

<style scoped>
/* Chỉ dùng khi Tailwind không đủ */
</style>
```

---

## 2. Quy tắc đặt tên

| Thứ | Quy tắc | Ví dụ |
|---|---|---|
| Tên file component | `PascalCase.vue` | `CourseCard.vue`, `AppSidebar.vue` |
| Tên biến, hàm | `camelCase` | `isLoading`, `handleSubmit()` |
| Props | `camelCase` khai báo, `kebab-case` khi dùng | `:course-id="id"` |
| Emit events | `camelCase` | `emit('updateStatus')` |
| CSS class (Tailwind) | theo utility Tailwind | `flex`, `gap-4`, `text-sm` |

---

## 3. Template mẫu — Component cơ bản

```vue
<script setup>
import { ref, computed } from 'vue'
import { useAuthStore } from '@/stores/auth'

// Props
const props = defineProps({
  title: {
    type: String,
    required: true,
  },
  isLoading: {
    type: Boolean,
    default: false,
  },
})

// Emits
const emit = defineEmits(['close', 'submit'])

// Store
const authStore = useAuthStore()

// State
const errorMessage = ref('')

// Computed
const canSubmit = computed(() => !props.isLoading && !errorMessage.value)

// Methods
function handleSubmit() {
  emit('submit')
}
</script>

<template>
  <div class="...">
    <h2>{{ title }}</h2>
    <p v-if="errorMessage" class="text-red-500 text-sm">{{ errorMessage }}</p>
    <button
      :disabled="!canSubmit"
      class="..."
      @click="handleSubmit"
    >
      Xác nhận
    </button>
  </div>
</template>
```

---

## 4. Template mẫu — View (Page)

View là component đặt trong `src/views/`, được router render trực tiếp.

```vue
<script setup>
import { onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import AppSidebar from '@/components/AppSidebar.vue'
import AppTopbar from '@/components/AppTopbar.vue'

const authStore = useAuthStore()

onMounted(async () => {
  await authStore.fetchMe()
})
</script>

<template>
  <div class="app-shell">
    <AppSidebar />
    <div class="app-shell__content">
      <AppTopbar />
      <main class="page-content">
        <div class="page-heading">
          <div class="eyebrow">TIÊU ĐỀ PHỤ</div>
          <h1>Tiêu đề trang</h1>
          <p>Mô tả ngắn</p>
        </div>
        <!-- Nội dung trang -->
      </main>
    </div>
  </div>
</template>
```

---

## 5. Quy tắc hiển thị

- **Ngôn ngữ**: Toàn bộ text hiển thị cho người dùng phải dùng **tiếng Việt** (`vi-VN`)
- **Loading state**: Luôn có trạng thái loading khi gọi API — dùng biến `isLoading` hoặc lấy từ store
- **Error state**: Hiển thị thông báo lỗi rõ ràng bằng tiếng Việt, không để trống
- **Empty state**: Khi danh sách rỗng phải có thông báo "Chưa có dữ liệu" thay vì để trắng

---

## 6. Tích hợp API (dùng useAuthStore hoặc api.js)

```vue
<script setup>
import { ref } from 'vue'
import api from '@/services/api'

const isLoading = ref(false)
const errorMessage = ref('')
const data = ref(null)

async function fetchData() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    const response = await api.get('/endpoint')
    data.value = response.data
  } catch (err) {
    errorMessage.value = err.response?.data?.message || 'Đã có lỗi xảy ra. Vui lòng thử lại.'
  } finally {
    isLoading.value = false
  }
}
</script>
```

---

## 7. Cấu trúc thư mục src/

```
src/
├── assets/          # CSS, hình ảnh tĩnh
├── components/      # Shared components (AppSidebar, AppTopbar, AppModal, StatusBadge...)
├── layouts/         # Layout wrappers
├── services/
│   └── api.js       # Axios client — LUÔN dùng file này, không tạo axios mới
├── stores/
│   └── auth.js      # useAuthStore — token, user, isAuthenticated, isLecturer...
├── views/
│   ├── auth/        # LoginView, RegisterView, ForgotPasswordView
│   └── dashboard/   # LecturerDashboardView, StudentDashboardView, AdminDashboardView
└── router/
    └── index.js     # Route guard theo role
```

---

## 8. Checklist trước khi commit component

- [ ] Dùng `<script setup>` (không dùng Options API)
- [ ] Tên file là PascalCase
- [ ] Không có `console.log` thừa
- [ ] Tất cả text người dùng thấy là tiếng Việt
- [ ] Có xử lý loading và error state
- [ ] `npm run build` không có lỗi
