<script setup>
import { ref } from 'vue'
import { RouterLink } from 'vue-router'
import api from '@/services/api'

const email = ref('')
const isSubmitting = ref(false)
const errorMessage = ref('')
const successMessage = ref('')
const emailError = ref('')

function validate() {
  emailError.value = ''
  if (!email.value.trim()) {
    emailError.value = 'Vui lòng nhập địa chỉ email.'
    return false
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value)) {
    emailError.value = 'Địa chỉ email không đúng định dạng.'
    return false
  }
  return true
}

async function handleForgotPassword() {
  errorMessage.value = ''
  successMessage.value = ''

  if (!validate()) return

  isSubmitting.value = true
  try {
    const response = await api.post('/auth/password-recovery/request', {
      email: email.value.trim(),
    })
    successMessage.value =
      response.data?.message ||
      'Hướng dẫn đặt lại mật khẩu đã được gửi đến hộp thư email của bạn. Vui lòng kiểm tra (kể cả hòm thư Spam).'
  } catch (err) {
    errorMessage.value =
      err.response?.data?.message ||
      'Không thể gửi email khôi phục lúc này. Vui lòng kiểm tra lại địa chỉ email hoặc thử lại sau.'
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
    <div class="sm:mx-auto sm:w-full sm:max-w-md">
      <!-- Icon khóa bảo mật -->
      <div class="flex justify-center">
        <div class="w-14 h-14 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-200">
          <svg class="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
          </svg>
        </div>
      </div>
      <h2 class="mt-6 text-center text-3xl font-extrabold text-slate-900 tracking-tight">
        Khôi phục mật khẩu
      </h2>
      <p class="mt-2 text-center text-sm text-slate-600 max-w-sm mx-auto">
        Nhập địa chỉ email đăng ký để nhận liên kết đặt lại mật khẩu mới
      </p>
    </div>

    <div class="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
      <div class="bg-white py-8 px-6 shadow-xl shadow-slate-200/50 sm:rounded-2xl sm:px-10 border border-slate-100">
        <!-- Thông báo thành công -->
        <div
          v-if="successMessage"
          class="mb-6 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-800 animate-fadeIn"
        >
          <div class="flex items-start gap-3">
            <svg class="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p class="font-semibold">Đã gửi yêu cầu!</p>
              <p class="mt-1 text-xs text-emerald-700 leading-relaxed">{{ successMessage }}</p>
            </div>
          </div>
        </div>

        <!-- Thông báo lỗi -->
        <div
          v-if="errorMessage"
          class="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 flex items-start gap-3 text-sm text-red-700 animate-fadeIn"
          role="alert"
        >
          <svg class="w-5 h-5 text-red-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span class="font-medium">{{ errorMessage }}</span>
        </div>

        <form class="space-y-5" @submit.prevent="handleForgotPassword">
          <div>
            <label for="email" class="block text-sm font-medium text-slate-700">
              Địa chỉ Email tài khoản
            </label>
            <div class="mt-1 relative rounded-lg shadow-sm">
              <div class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.206" />
                </svg>
              </div>
              <input
                id="email"
                v-model="email"
                name="email"
                type="email"
                autocomplete="email"
                placeholder="name@example.com"
                :class="[
                  'block w-full !pl-11 !pr-3.5 !py-2.5 sm:text-sm rounded-xl border transition-colors focus:outline-none focus:ring-2',
                  emailError
                    ? 'border-red-300 text-red-900 focus:ring-red-500 focus:border-red-500 bg-red-50/30'
                    : 'border-slate-300 text-slate-900 placeholder-slate-400 focus:ring-indigo-500 focus:border-indigo-500'
                ]"
              />
            </div>
            <p v-if="emailError" class="mt-1.5 text-xs text-red-600 font-medium">
              {{ emailError }}
            </p>
          </div>

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
              {{ isSubmitting ? 'Đang gửi yêu cầu...' : 'Gửi email khôi phục' }}
            </button>
          </div>
        </form>

        <div class="mt-6 border-t border-slate-200/80 pt-6 text-center text-sm text-slate-600">
          <RouterLink
            :to="{ name: 'login' }"
            class="font-semibold text-indigo-600 hover:text-indigo-500 inline-flex items-center gap-1.5 transition-colors"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Quay lại trang Đăng nhập
          </RouterLink>
        </div>
      </div>
    </div>
  </div>
</template>
