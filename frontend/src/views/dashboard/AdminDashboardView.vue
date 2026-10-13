<script setup>
import { computed } from 'vue'
import DashboardLayout from '@/layouts/DashboardLayout.vue'
import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore()
const user = computed(() => authStore.user)

const stats = [
  { label: 'Tổng số người dùng', value: '158', icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z', color: 'bg-purple-500' },
  { label: 'Giảng viên', value: '18', icon: 'M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z', color: 'bg-indigo-500' },
  { label: 'Sinh viên', value: '140', icon: 'M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14zm-4 6v-7.5', color: 'bg-blue-500' },
  { label: 'Khóa học đang mở', value: '24', icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253', color: 'bg-emerald-500' },
]

const recentUsers = [
  { id: 1, name: 'Trần Minh Quân', email: 'quan.tm@dtu.edu.vn', role: 'lecturer', roleLabel: 'Giảng viên', date: 'Hôm nay' },
  { id: 2, name: 'Nguyễn Thảo Ly', email: 'ly.student@dtu.edu.vn', role: 'student', roleLabel: 'Sinh viên', date: 'Hôm qua' },
  { id: 3, name: 'Phạm Đức Duy', email: 'duy.student@dtu.edu.vn', role: 'student', roleLabel: 'Sinh viên', date: '2 ngày trước' },
  { id: 4, name: 'Lê Hoàng Yến', email: 'yen.lh@dtu.edu.vn', role: 'lecturer', roleLabel: 'Giảng viên', date: '3 ngày trước' },
]

const systemServices = [
  { name: 'Laravel API Backend', status: 'Hoạt động bình thường', code: 'healthy', color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  { name: 'MySQL Database', status: 'Kết nối ổn định', code: 'healthy', color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  { name: 'AI Service (Ollama / LLM)', status: 'Sẵn sàng xử lý', code: 'ready', color: 'text-blue-600 bg-blue-50 border-blue-200' },
  { name: 'Mailpit SMTP', status: 'Sẵn sàng nhận mail', code: 'ready', color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
]
</script>

<template>
  <DashboardLayout>
    <div class="space-y-6">
      <!-- Welcome Banner -->
      <div class="bg-gradient-to-r from-purple-800 via-indigo-700 to-slate-800 rounded-2xl p-6 sm:p-8 text-white shadow-lg shadow-purple-800/10 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <span class="inline-block px-2.5 py-1 rounded-full text-xs font-semibold bg-white/20 backdrop-blur-sm mb-3">
            Bảng Điều Khiển Quản Trị Hệ Thống
          </span>
          <h1 class="text-2xl sm:text-3xl font-extrabold tracking-tight">
            Xin chào, {{ user?.name || 'Quản trị viên' }}!
          </h1>
          <p class="mt-2 text-indigo-100 text-sm max-w-xl">
            Theo dõi trạng thái hệ sinh thái FLTS, quản lý phân quyền và kiểm soát luồng dữ liệu học liệu toàn trường.
          </p>
        </div>
      </div>

      <!-- Stats Grid -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div
          v-for="stat in stats"
          :key="stat.label"
          class="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm flex items-center justify-between"
        >
          <div>
            <p class="text-xs font-medium text-slate-500">{{ stat.label }}</p>
            <p class="text-2xl font-bold text-slate-900 mt-1">{{ stat.value }}</p>
          </div>
          <div :class="['w-12 h-12 rounded-xl flex items-center justify-center text-white shadow-sm', stat.color]">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="stat.icon" />
            </svg>
          </div>
        </div>
      </div>

      <!-- Người dùng mới đăng ký & Trạng thái dịch vụ nền tảng -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Người dùng mới đăng ký -->
        <div class="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden flex flex-col">
          <div class="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 class="font-bold text-slate-900 text-base">Tài khoản đăng ký gần đây</h2>
            <span class="text-xs text-indigo-600 font-semibold cursor-pointer hover:underline">Quản lý</span>
          </div>
          <div class="divide-y divide-slate-100 flex-1">
            <div
              v-for="u in recentUsers"
              :key="u.id"
              class="p-4 hover:bg-slate-50/80 transition-colors flex items-center justify-between"
            >
              <div class="min-w-0 pr-4">
                <p class="text-sm font-semibold text-slate-800 truncate">{{ u.name }}</p>
                <p class="text-xs text-slate-500 truncate">{{ u.email }}</p>
              </div>
              <div class="flex items-center gap-3 shrink-0">
                <span
                  :class="[
                    'text-[11px] font-semibold px-2 py-0.5 rounded-full border',
                    u.role === 'lecturer' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-blue-50 text-blue-700 border-blue-200'
                  ]"
                >
                  {{ u.roleLabel }}
                </span>
                <span class="text-xs text-slate-400">{{ u.date }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Trạng thái dịch vụ -->
        <div class="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden flex flex-col">
          <div class="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 class="font-bold text-slate-900 text-base">Hạ tầng dịch vụ Docker & API</h2>
            <span class="text-xs text-emerald-600 font-semibold flex items-center gap-1">
              <span class="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-ping"></span>
              Trực tuyến
            </span>
          </div>
          <div class="divide-y divide-slate-100 flex-1">
            <div
              v-for="svc in systemServices"
              :key="svc.name"
              class="p-4 flex items-center justify-between hover:bg-slate-50/80 transition-colors"
            >
              <div class="flex items-center gap-3">
                <div class="w-2.5 h-2.5 rounded-full bg-emerald-500"></div>
                <span class="text-sm font-medium text-slate-800">{{ svc.name }}</span>
              </div>
              <span :class="['text-xs font-semibold px-2.5 py-1 rounded-full border', svc.color]">
                {{ svc.status }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </DashboardLayout>
</template>
