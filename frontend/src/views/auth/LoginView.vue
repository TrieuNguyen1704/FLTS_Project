<script setup>
import { ref, reactive, computed } from 'vue'
import { useRouter, useRoute, RouterLink } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { showDevLogin, consumeSessionExpired } from '@/services/devMode'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

// State form
const form = reactive({
  email: '',
  password: '',
  remember: false,
})

const showPassword = ref(false)
const errorMessage = ref('')
// BL-03: bị interceptor 401 đưa về đây thì báo phiên hết hạn (chỉ một lần).
const sessionExpired = ref(consumeSessionExpired())
const isSubmitting = ref(false)

// Validate client-side cơ bản
const errors = reactive({
  email: '',
  password: '',
})

function validate() {
  let isValid = true
  errors.email = ''
  errors.password = ''

  if (!form.email.trim()) {
    errors.email = 'Vui lòng nhập địa chỉ email.'
    isValid = false
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
    errors.email = 'Email không hợp lệ.'
    isValid = false
  }

  if (!form.password) {
    errors.password = 'Vui lòng nhập mật khẩu.'
    isValid = false
  } else if (form.password.length < 6) {
    errors.password = 'Mật khẩu phải có ít nhất 6 ký tự.'
    isValid = false
  }

  return isValid
}

async function handleLogin() {
  errorMessage.value = ''
  if (!validate()) return

  isSubmitting.value = true
  try {
    const result = await authStore.login(form.email, form.password)

    if (result.success) {
      // Điều hướng về URL mong muốn trước đó hoặc dashboard theo vai trò
      const redirectPath = route.query.redirect
      if (redirectPath) {
        router.push(redirectPath)
        return
      }

      const role = result.user?.role
      if (role === 'lecturer') {
        router.push({ name: 'lecturer-dashboard' })
      } else if (role === 'admin') {
        router.push({ name: 'admin-dashboard' })
      } else {
        router.push({ name: 'student-dashboard' })
      }
    } else {
      errorMessage.value = result.message || 'Đăng nhập không thành công. Vui lòng kiểm tra lại thông tin.'
    }
  } catch (err) {
    errorMessage.value = 'Đã có lỗi kết nối máy chủ xảy ra. Vui lòng thử lại sau.'
  } finally {
    isSubmitting.value = false
  }
}

// BL-01: chỉ hiển thị chế độ xem trước khi VITE_SHOW_DEV_LOGIN=true (mặc định ẩn, kể cả npm run dev)
const isDev = computed(() => showDevLogin())

function loginAsRole(role) {
  const users = {
    lecturer: {
      id: 1,
      name: 'TS. Nguyễn Văn Hưng',
      email: 'lecturer@flts.test',
      role: 'lecturer',
    },
    student: {
      id: 2,
      name: 'Lê Thế Khánh Hưng',
      email: 'student@flts.test',
      role: 'student',
    },
    admin: {
      id: 3,
      name: 'Quản trị viên Hệ thống',
      email: 'admin@flts.test',
      role: 'admin',
    },
  }

  const userData = users[role]
  authStore.token = 'demo-token-' + role
  authStore.user = userData
  localStorage.setItem('flts_token', authStore.token)
  localStorage.setItem('flts_user', JSON.stringify(userData))

  if (role === 'lecturer') router.push({ name: 'lecturer-dashboard' })
  else if (role === 'admin') router.push({ name: 'admin-dashboard' })
  else router.push({ name: 'student-dashboard' })
}
</script>

<template>
  <div class="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
    <div class="sm:mx-auto sm:w-full sm:max-w-md">
      <!-- Logo & Tiêu đề -->
      <div class="flex justify-center">
        <div class="w-14 h-14 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-200">
          <svg class="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
        </div>
      </div>
      <h2 class="mt-6 text-center text-3xl font-extrabold text-slate-900 tracking-tight">
        Hệ thống FLTS
      </h2>
      <p class="mt-2 text-center text-sm text-slate-600">
        Flipped Learning Teaching System
      </p>
    </div>

    <div class="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
      <div class="bg-white py-8 px-6 shadow-xl shadow-slate-200/50 sm:rounded-2xl sm:px-10 border border-slate-100">
        <!-- BL-03: phiên hết hạn (interceptor 401) -->
        <div
          v-if="sessionExpired && !errorMessage"
          data-test="session-expired"
          class="mb-6 p-4 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-800 font-medium"
          role="status"
        >
          Phiên đăng nhập đã hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại.
        </div>

        <!-- Thông báo lỗi tổng quát -->
        <div
          v-if="errorMessage"
          class="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 flex items-start gap-3 text-sm text-red-700 animate-fadeIn"
          role="alert"
        >
          <svg class="w-5 h-5 text-red-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span class="flex-1 font-medium">{{ errorMessage }}</span>
        </div>

        <form class="space-y-5" @submit.prevent="handleLogin">
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
                  errors.email
                    ? 'border-red-300 text-red-900 focus:ring-red-500 focus:border-red-500 bg-red-50/30'
                    : 'border-slate-300 text-slate-900 placeholder-slate-400 focus:ring-indigo-500 focus:border-indigo-500'
                ]"
              />
            </div>
            <p v-if="errors.email" class="mt-1.5 text-xs text-red-600 font-medium">
              {{ errors.email }}
            </p>
          </div>

          <!-- Mật khẩu Field -->
          <div>
            <label for="password" class="block text-sm font-medium text-slate-700">
              Mật khẩu
            </label>
            <div class="mt-1 relative rounded-lg shadow-sm">
              <div class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <input
                id="password"
                v-model="form.password"
                :type="showPassword ? 'text' : 'password'"
                name="password"
                autocomplete="current-password"
                placeholder="••••••••"
                :class="[
                  'block w-full !pl-11 !pr-11 !py-2.5 sm:text-sm rounded-xl border transition-colors focus:outline-none focus:ring-2',
                  errors.password
                    ? 'border-red-300 text-red-900 focus:ring-red-500 focus:border-red-500 bg-red-50/30'
                    : 'border-slate-300 text-slate-900 placeholder-slate-400 focus:ring-indigo-500 focus:border-indigo-500'
                ]"
              />
              <button
                type="button"
                class="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 transition-colors"
                @click="showPassword = !showPassword"
              >
                <!-- Icon mắt ẩn/hiện -->
                <svg v-if="!showPassword" class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                <svg v-else class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                </svg>
              </button>
            </div>
            <p v-if="errors.password" class="mt-1.5 text-xs text-red-600 font-medium">
              {{ errors.password }}
            </p>
          </div>

          <!-- Nhớ mật khẩu & Quên mật khẩu -->
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <input
                id="remember"
                v-model="form.remember"
                name="remember"
                type="checkbox"
                class="!w-4 !h-4 shrink-0 text-indigo-600 focus:ring-indigo-500 border-slate-300 rounded cursor-pointer"
              />
              <label for="remember" class="text-sm text-slate-700 whitespace-nowrap cursor-pointer">
                Ghi nhớ đăng nhập
              </label>
            </div>

            <div class="text-sm">
              <RouterLink
                :to="{ name: 'forgot-password' }"
                class="font-medium text-indigo-600 hover:text-indigo-500 transition-colors"
              >
                Quên mật khẩu?
              </RouterLink>
            </div>
          </div>

          <!-- Nút Đăng nhập -->
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
              {{ isSubmitting ? 'Đang đăng nhập...' : 'Đăng nhập' }}
            </button>
          </div>
        </form>

        <!-- Xem nhanh theo từng vai trò (chỉ khi VITE_SHOW_DEV_LOGIN=true) -->
        <div v-if="isDev" data-test="dev-login" class="mt-6 pt-5 border-t border-dashed border-slate-200">
          <p class="text-xs text-center text-slate-500 font-medium mb-3">
            🧪 Chế độ xem trước Dashboard (DEV Mode):
          </p>
          <div class="grid grid-cols-3 gap-2">
            <button
              type="button"
              class="px-2 py-2 rounded-xl border border-indigo-200 bg-indigo-50/70 text-indigo-700 hover:bg-indigo-100 text-xs font-semibold transition-colors flex flex-col items-center gap-1 shadow-sm"
              @click="loginAsRole('lecturer')"
            >
              <span class="text-base">👨‍🏫</span>
              <span>Giảng viên</span>
            </button>
            <button
              type="button"
              class="px-2 py-2 rounded-xl border border-emerald-200 bg-emerald-50/70 text-emerald-700 hover:bg-emerald-100 text-xs font-semibold transition-colors flex flex-col items-center gap-1 shadow-sm"
              @click="loginAsRole('student')"
            >
              <span class="text-base">🎓</span>
              <span>Sinh viên</span>
            </button>
            <button
              type="button"
              class="px-2 py-2 rounded-xl border border-purple-200 bg-purple-50/70 text-purple-700 hover:bg-purple-100 text-xs font-semibold transition-colors flex flex-col items-center gap-1 shadow-sm"
              @click="loginAsRole('admin')"
            >
              <span class="text-base">🛡️</span>
              <span>Quản trị</span>
            </button>
          </div>
        </div>

        <!-- Divider & Đăng ký -->
        <div class="mt-6 border-t border-slate-200/80 pt-6 text-center text-sm text-slate-600">
          Chưa có tài khoản?
          <RouterLink
            :to="{ name: 'register' }"
            class="font-semibold text-indigo-600 hover:text-indigo-500 transition-colors ml-1"
          >
            Đăng ký ngay
          </RouterLink>
        </div>
      </div>
    </div>
  </div>
</template>
