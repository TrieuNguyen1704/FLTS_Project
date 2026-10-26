<script setup>
import { computed } from 'vue'
import { useRouter, useRoute, RouterLink } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const props = defineProps({
  isOpen: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['close'])

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const user = computed(() => authStore.user)
const role = computed(() => user.value?.role)

const menuItems = computed(() => {
  if (role.value === 'lecturer') {
    return [
      {
        name: 'Tổng quan',
        routeName: 'lecturer-dashboard',
        icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
      },
      {
        name: 'Quản lý khóa học',
        routeName: 'course-workspace',
        query: { tab: 'documents' },
        icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
      },
      {
        name: 'Tài liệu & RAG Workbench',
        routeName: 'course-workspace',
        query: { tab: 'workbench' },
        icon: 'M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z',
      },
      {
        name: 'Ngân hàng bài tập',
        routeName: 'lecturer-dashboard',
        hash: '#quizzes',
        icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01',
      },
    ]
  }

  if (role.value === 'admin') {
    return [
      {
        name: 'Tổng quan hệ thống',
        routeName: 'admin-dashboard',
        icon: 'M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z',
      },
      {
        name: 'Quản lý tài khoản',
        routeName: 'admin-dashboard',
        hash: '#users',
        icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z',
      },
      {
        name: 'Nhật ký hệ thống',
        routeName: 'admin-dashboard',
        hash: '#logs',
        icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
      },
    ]
  }

  // Mặc định cho sinh viên
  return [
    {
      name: 'Tổng quan học tập',
      routeName: 'student-dashboard',
      icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
    },
    {
      name: 'Khóa học của tôi',
      routeName: 'student-dashboard',
      hash: '#my-courses',
      icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
    },
    {
      name: 'Luyện tập câu hỏi AI',
      routeName: 'student-dashboard',
      hash: '#practice',
      icon: 'M13 10V3L4 14h7v7l9-11h-7z',
    },
    {
      name: 'Kết quả & Tiến độ',
      routeName: 'student-dashboard',
      hash: '#progress',
      icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
    },
  ]
})

async function handleLogout() {
  await authStore.logout()
  router.push({ name: 'login' })
}

function isItemActive(item) {
  if (item.hash) {
    return route.name === item.routeName && route.hash === item.hash
  }
  if (item.query?.tab) {
    const currentTab = route.query.tab || 'documents'
    return route.name === item.routeName && currentTab === item.query.tab
  }
  if (route.name !== item.routeName) return false
  if (route.hash) return false
  if (route.name === 'course-workspace') return false
  return true
}
</script>

<template>
  <div>
    <!-- Mobile Backdrop -->
    <div
      v-if="isOpen"
      class="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm lg:hidden transition-opacity"
      @click="emit('close')"
    />

    <!-- Sidebar Aside Container -->
    <aside
      :class="[
        'fixed top-0 bottom-0 left-0 z-40 w-64 bg-slate-900 text-white flex flex-col transition-transform duration-300 ease-in-out lg:translate-x-0',
        isOpen ? 'translate-x-0' : '-translate-x-full',
      ]"
    >
      <!-- Logo Header -->
      <div class="h-16 px-6 flex items-center justify-between border-b border-slate-800">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center font-bold text-white shadow-md shadow-indigo-500/20">
            F
          </div>
          <span class="font-bold text-lg tracking-wide text-white">FLTS Portal</span>
        </div>
        <button
          type="button"
          class="lg:hidden text-slate-400 hover:text-white p-1 rounded-lg"
          @click="emit('close')"
        >
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Nav Items -->
      <div class="flex-1 px-4 py-6 overflow-y-auto space-y-1.5">
        <RouterLink
          v-for="item in menuItems"
          :key="item.name"
          :to="{ name: item.routeName, hash: item.hash, query: item.query }"
          :class="[
            'flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors',
            isItemActive(item)
              ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30'
              : 'text-slate-300 hover:text-white hover:bg-slate-800/80',
          ]"
          @click="emit('close')"
        >
          <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="item.icon" />
          </svg>
          <span>{{ item.name }}</span>
        </RouterLink>
      </div>

      <!-- Footer Info & Logout -->
      <div class="p-4 border-t border-slate-800 bg-slate-950/40">
        <div class="flex items-center gap-3 mb-3 px-2">
          <div class="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold text-slate-200">
            {{ user?.name ? user.name.charAt(0) : 'U' }}
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-xs font-medium text-slate-200 truncate">{{ user?.name || 'Người dùng' }}</p>
            <p class="text-[11px] text-slate-400 truncate">{{ user?.email }}</p>
          </div>
        </div>
        <button
          type="button"
          class="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg text-slate-300 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          @click="handleLogout"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          Đăng xuất
        </button>
      </div>
    </aside>
  </div>
</template>
