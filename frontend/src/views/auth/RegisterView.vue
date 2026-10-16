<script setup>
import { ref, reactive } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const authStore = useAuthStore()

// State Form
const form = reactive({
  name: '',
  email: '',
  role: 'student', // 'student' hoặc 'lecturer'
  password: '',
  password_confirmation: '',
  agreeTerms: true,
})

const showPassword = ref(false)
const showConfirmPassword = ref(false)
const isSubmitting = ref(false)
const generalError = ref('')
const successMessage = ref('')

// Lỗi validation (kết hợp client-side và backend)
const fieldErrors = reactive({
  name: '',
  email: '',
  role: '',
  password: '',
  password_confirmation: '',
  agreeTerms: '',
})

function clearErrors() {
  generalError.value = ''
  fieldErrors.name = ''
  fieldErrors.email = ''
  fieldErrors.role = ''
  fieldErrors.password = ''
  fieldErrors.password_confirmation = ''
  fieldErrors.agreeTerms = ''
}

function validateClient() {
  clearErrors()
  let isValid = true

  if (!form.name.trim()) {
    fieldErrors.name = 'Vui lòng nhập họ và tên.'
    isValid = false
  } else if (form.name.trim().length < 2) {
    fieldErrors.name = 'Họ và tên tối thiểu 2 ký tự.'
    isValid = false
  }

  if (!form.email.trim()) {
    fieldErrors.email = 'Vui lòng nhập địa chỉ email.'
    isValid = false
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
    fieldErrors.email = 'Địa chỉ email không đúng định dạng.'
    isValid = false
  }

  if (!form.role) {
    fieldErrors.role = 'Vui lòng chọn vai trò của bạn.'
    isValid = false
  }

  if (!form.password) {
    fieldErrors.password = 'Vui lòng nhập mật khẩu.'
    isValid = false
  } else if (form.password.length < 8) {
    fieldErrors.password = 'Mật khẩu phải có độ dài tối thiểu 8 ký tự.'
    isValid = false
  }

  if (!form.password_confirmation) {
    fieldErrors.password_confirmation = 'Vui lòng xác nhận mật khẩu.'
    isValid = false
  } else if (form.password !== form.password_confirmation) {
    fieldErrors.password_confirmation = 'Mật khẩu xác nhận không trùng khớp.'
    isValid = false
  }

  if (!form.agreeTerms) {
    fieldErrors.agreeTerms = 'Bạn cần đồng ý với điều khoản dịch vụ để tiếp tục.'
    isValid = false
  }

  return isValid
}

async function handleRegister() {
  if (!validateClient()) return

  isSubmitting.value = true
  successMessage.value = ''

  try {
    const payload = {
      name: form.name.trim(),
      email: form.email.trim(),
      role: form.role,
      password: form.password,
      password_confirmation: form.password_confirmation,
    }

    const result = await authStore.register(payload)

    if (result.success) {
      successMessage.value = 'Đăng ký tài khoản thành công! Đang chuyển hướng sang trang đăng nhập...'
      setTimeout(() => {
        router.push({
          name: 'login',
          query: { registeredEmail: form.email },
        })
      }, 1500)
    } else {
      generalError.value = result.message || 'Đăng ký không thành công. Vui lòng kiểm tra lại.'
      if (result.errors) {
        // Gán lỗi chi tiết từ backend vào từng trường nếu có
        if (result.errors.name) fieldErrors.name = result.errors.name[0]
        if (result.errors.email) fieldErrors.email = result.errors.email[0]
        if (result.errors.role) fieldErrors.role = result.errors.role[0]
        if (result.errors.password) fieldErrors.password = result.errors.password[0]
        if (result.errors.password_confirmation) {
          fieldErrors.password_confirmation = result.errors.password_confirmation[0]
        }
      }
    }
  } catch (err) {
    generalError.value = 'Đã có lỗi kết nối máy chủ. Vui lòng thử lại sau.'
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-slate-50 flex flex-col justify-center py-10 sm:px-6 lg:px-8">
    <div class="sm:mx-auto sm:w-full sm:max-w-xl">
      <!-- Logo & Tiêu đề -->
      <div class="flex justify-center">
        <div class="w-14 h-14 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-200">
          <svg class="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
        </div>
      </div>
      <h2 class="mt-5 text-center text-3xl font-extrabold text-slate-900 tracking-tight">
        Tạo tài khoản FLTS
      </h2>
      <p class="mt-2 text-center text-sm text-slate-600">
        Tham gia hệ thống để trải nghiệm công cụ hỗ trợ giảng dạy và học tập hiện đại
      </p>
    </div>

    <div class="mt-8 sm:mx-auto sm:w-full sm:max-w-xl">
      <div class="bg-white py-8 px-6 shadow-xl shadow-slate-200/50 sm:rounded-2xl sm:px-10 border border-slate-100">
        <!-- Thông báo thành công -->
        <div
          v-if="successMessage"
          class="mb-6 p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-start gap-3 text-sm text-emerald-800 animate-fadeIn"
        >
          <svg class="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span class="font-medium">{{ successMessage }}</span>
        </div>

        <!-- Thông báo lỗi tổng quát -->
        <div
          v-if="generalError"
          class="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 flex items-start gap-3 text-sm text-red-700 animate-fadeIn"
          role="alert"
        >
          <svg class="w-5 h-5 text-red-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span class="font-medium">{{ generalError }}</span>
        </div>

        <form class="space-y-5" @submit.prevent="handleRegister">
          <!-- Chọn Vai trò (Giảng viên / Sinh viên) -->
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-2">
              Bạn tham gia với vai trò:
            </label>
            <div class="grid grid-cols-2 gap-3">
              <!-- Sinh viên -->
              <label
                :class="[
                  'cursor-pointer border-2 rounded-xl p-3.5 flex flex-col items-center justify-center transition-all text-center',
                  form.role === 'student'
                    ? 'border-indigo-600 bg-indigo-50/40 text-indigo-900 shadow-sm'
                    : 'border-slate-200 hover:border-slate-300 text-slate-700'
                ]"
              >
                <input
                  v-model="form.role"
                  type="radio"
                  value="student"
                  class="sr-only"
                />
                <div class="w-10 h-10 rounded-full flex items-center justify-center mb-1.5" :class="form.role === 'student' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14zm-4 6v-7.5" />
                  </svg>
                </div>
                <span class="font-semibold text-sm">Sinh viên</span>
                <span class="text-xs text-slate-500 mt-0.5">Tham gia học & luyện tập</span>
              </label>

              <!-- Giảng viên -->
              <label
                :class="[
                  'cursor-pointer border-2 rounded-xl p-3.5 flex flex-col items-center justify-center transition-all text-center',
                  form.role === 'lecturer'
                    ? 'border-indigo-600 bg-indigo-50/40 text-indigo-900 shadow-sm'
                    : 'border-slate-200 hover:border-slate-300 text-slate-700'
                ]"
              >
                <input
                  v-model="form.role"
                  type="radio"
                  value="lecturer"
                  class="sr-only"
                />
                <div class="w-10 h-10 rounded-full flex items-center justify-center mb-1.5" :class="form.role === 'lecturer' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                  </svg>
                </div>
                <span class="font-semibold text-sm">Giảng viên</span>
                <span class="text-xs text-slate-500 mt-0.5">Quản lý khóa học & bài giảng</span>
              </label>
            </div>
            <p v-if="fieldErrors.role" class="mt-1.5 text-xs text-red-600 font-medium">
              {{ fieldErrors.role }}
            </p>
          </div>

          <!-- Họ và tên -->
          <div>
            <label for="name" class="block text-sm font-medium text-slate-700">
              Họ và tên
            </label>
            <div class="mt-1 relative rounded-lg shadow-sm">
              <div class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7 7z" />
                </svg>
              </div>
              <input
                id="name"
                v-model="form.name"
                name="name"
                type="text"
                autocomplete="name"
                placeholder="Nguyễn Văn A"
                :class="[
                  'block w-full !pl-11 !pr-3.5 !py-2.5 sm:text-sm rounded-xl border transition-colors focus:outline-none focus:ring-2',
                  fieldErrors.name
                    ? 'border-red-300 text-red-900 focus:ring-red-500 focus:border-red-500 bg-red-50/30'
                    : 'border-slate-300 text-slate-900 placeholder-slate-400 focus:ring-indigo-500 focus:border-indigo-500'
                ]"
              />
            </div>
            <p v-if="fieldErrors.name" class="mt-1.5 text-xs text-red-600 font-medium">
              {{ fieldErrors.name }}
            </p>
          </div>

          <!-- Email Field -->
          <div>
            <label for="email" class="block text-sm font-medium text-slate-700">
              Địa chỉ Email
            </label>
            <div class="mt-1 relative rounded-lg shadow-sm">
              <div class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.206" />
                </svg>
              </div>
              <input
                id="email"
                v-model="form.email"
                name="email"
                type="email"
                autocomplete="email"
                placeholder="name@example.com"
                :class="[
                  'block w-full !pl-11 !pr-3.5 !py-2.5 sm:text-sm rounded-xl border transition-colors focus:outline-none focus:ring-2',
                  fieldErrors.email
                    ? 'border-red-300 text-red-900 focus:ring-red-500 focus:border-red-500 bg-red-50/30'
                    : 'border-slate-300 text-slate-900 placeholder-slate-400 focus:ring-indigo-500 focus:border-indigo-500'
                ]"
              />
            </div>
            <p v-if="fieldErrors.email" class="mt-1.5 text-xs text-red-600 font-medium">
              {{ fieldErrors.email }}
            </p>
          </div>

          <!-- Mật khẩu & Xác nhận Mật khẩu (Grid 2 cột) -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <!-- Mật khẩu -->
            <div>
              <label for="password" class="block text-sm font-medium text-slate-700">
                Mật khẩu
              </label>
              <div class="mt-1 relative rounded-lg shadow-sm">
                <input
                  id="password"
                  v-model="form.password"
                  :type="showPassword ? 'text' : 'password'"
                  name="password"
                  autocomplete="new-password"
                  placeholder="Tối thiểu 8 ký tự"
                  :class="[
                    'block w-full pl-3 pr-10 py-2.5 sm:text-sm rounded-xl border transition-colors focus:outline-none focus:ring-2',
                    fieldErrors.password
                      ? 'border-red-300 text-red-900 focus:ring-red-500 focus:border-red-500 bg-red-50/30'
                      : 'border-slate-300 text-slate-900 placeholder-slate-400 focus:ring-indigo-500 focus:border-indigo-500'
                  ]"
                />
                <button
                  type="button"
                  class="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 transition-colors"
                  @click="showPassword = !showPassword"
                >
                  <svg v-if="!showPassword" class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  <svg v-else class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                  </svg>
                </button>
              </div>
              <p v-if="fieldErrors.password" class="mt-1.5 text-xs text-red-600 font-medium">
                {{ fieldErrors.password }}
              </p>
            </div>

            <!-- Xác nhận Mật khẩu -->
            <div>
              <label for="password_confirmation" class="block text-sm font-medium text-slate-700">
                Xác nhận Mật khẩu
              </label>
              <div class="mt-1 relative rounded-lg shadow-sm">
                <input
                  id="password_confirmation"
                  v-model="form.password_confirmation"
                  :type="showConfirmPassword ? 'text' : 'password'"
                  name="password_confirmation"
                  autocomplete="new-password"
                  placeholder="Nhập lại mật khẩu"
                  :class="[
                    'block w-full pl-3 pr-10 py-2.5 sm:text-sm rounded-xl border transition-colors focus:outline-none focus:ring-2',
                    fieldErrors.password_confirmation
                      ? 'border-red-300 text-red-900 focus:ring-red-500 focus:border-red-500 bg-red-50/30'
                      : 'border-slate-300 text-slate-900 placeholder-slate-400 focus:ring-indigo-500 focus:border-indigo-500'
                  ]"
                />
                <button
                  type="button"
                  class="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 transition-colors"
                  @click="showConfirmPassword = !showConfirmPassword"
                >
                  <svg v-if="!showConfirmPassword" class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  <svg v-else class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                  </svg>
                </button>
              </div>
              <p v-if="fieldErrors.password_confirmation" class="mt-1.5 text-xs text-red-600 font-medium">
                {{ fieldErrors.password_confirmation }}
              </p>
            </div>
          </div>

          <!-- Điều khoản sử dụng -->
          <div>
            <div class="flex items-start">
              <input
                id="agreeTerms"
                v-model="form.agreeTerms"
                name="agreeTerms"
                type="checkbox"
                class="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-slate-300 rounded mt-0.5"
              />
              <label for="agreeTerms" class="ml-2.5 block text-xs sm:text-sm text-slate-600 leading-snug">
                Tôi đồng ý với các
                <a href="#" class="text-indigo-600 hover:underline font-medium">Điều khoản sử dụng</a>
                và
                <a href="#" class="text-indigo-600 hover:underline font-medium">Chính sách bảo mật</a>
                của FLTS.
              </label>
            </div>
            <p v-if="fieldErrors.agreeTerms" class="mt-1.5 text-xs text-red-600 font-medium">
              {{ fieldErrors.agreeTerms }}
            </p>
          </div>

          <!-- Nút Đăng ký -->
          <div>
            <button
              type="submit"
              :disabled="isSubmitting"
              class="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-xl shadow-sm text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              <svg
                v-if="isSubmitting"
                class="animate-spin -ml-1 mr-2.5 h-4 w-4 text-white"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
              </svg>
              {{ isSubmitting ? 'Đang khởi tạo tài khoản...' : 'Đăng ký tài khoản' }}
            </button>
          </div>
        </form>

        <!-- Divider & Đăng nhập -->
        <div class="mt-6 border-t border-slate-200/80 pt-6 text-center text-sm text-slate-600">
          Đã có tài khoản?
          <RouterLink
            :to="{ name: 'login' }"
            class="font-semibold text-indigo-600 hover:text-indigo-500 transition-colors ml-1"
          >
            Đăng nhập ngay
          </RouterLink>
        </div>
      </div>
    </div>
  </div>
</template>
