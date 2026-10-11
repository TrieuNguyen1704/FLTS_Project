<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const props = defineProps({
  sidebarOpen: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['toggleSidebar'])

const router = useRouter()
const authStore = useAuthStore()

const user = computed(() => authStore.user)

const roleName = computed(() => {
  switch (user.value?.role) {
    case 'lecturer':
      return 'Giảng viên'
    case 'admin':
      return 'Quản trị viên'
    case 'student':
      return 'Sinh viên'
    default:
      return 'Thành viên'
  }
})

const roleBadgeClass = computed(() => {
  switch (user.value?.role) {
    case 'lecturer':
      return 'bg-indigo-50 text-indigo-700 border-indigo-200'
    case 'admin':
      return 'bg-purple-50 text-purple-700 border-purple-200'
    default:
      return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  }
})

async function handleLogout() {
  await authStore.logout()
  router.push({ name: 'login' })
}
</script>

<template>
  <header class="bg-white border-b border-slate-200 sticky top-0 z-30">
    <div class="px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
      <!-- Left side: Hamburger toggle for mobile -->
      <div class="flex items-center gap-3">
        <button
          type="button"
          class="lg:hidden p-2 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          @click="emit('toggleSidebar')"
        >
          <span class="sr-only">Mở menu</span>
          <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>

      <!-- Right side: Role badge, user profile, logout -->
      <div class="flex items-center gap-4">
        <!-- Role Badge -->
        <span
          :class="[
            'text-xs px-2.5 py-1 rounded-full font-medium border',
            roleBadgeClass
          ]"
        >
          {{ roleName }}
        </span>

        <!-- User Info -->
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-xs uppercase shadow-sm">
            {{ user?.name ? user.name.charAt(0) : 'U' }}
          </div>
          <div class="hidden md:block text-left">
            <p class="text-sm font-semibold text-slate-800 leading-tight">
              {{ user?.name || 'Người dùng' }}
            </p>
            <p class="text-xs text-slate-500">
              {{ user?.email || '' }}
            </p>
          </div>
        </div>

        <!-- Nút Đăng xuất nhanh -->
        <button
          type="button"
          class="p-2 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors"
          title="Đăng xuất"
          @click="handleLogout"
        >
          <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
        </button>
      </div>
    </div>
  </header>
</template>
