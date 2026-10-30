<script setup>
import { computed, ref, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import DashboardLayout from '@/layouts/DashboardLayout.vue'
import { useAuthStore } from '@/stores/auth'
import { courses as coursesApi } from '@/services/courses'
import { isDemoSession } from '@/services/devMode'

const authStore = useAuthStore()
const user = computed(() => authStore.user)

const stats = [
  { label: 'Khóa học đang học', value: '4', icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253', color: 'bg-indigo-500' },
  { label: 'Bài tập đã hoàn thành', value: '28', icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z', color: 'bg-emerald-500' },
  { label: 'Điểm trung bình', value: '8.6', icon: 'M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z', color: 'bg-amber-500' },
  { label: 'Chuỗi ngày học liên tục', value: '7 ngày', icon: 'M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z', color: 'bg-rose-500' },
]

// BL-02: "Khóa học của tôi" lấy từ GET /api/courses (backend chỉ trả course sinh viên đã ghi danh).
// Phiên DEV Mode dùng token giả nên không gọi API (401 sẽ đẩy về trang đăng nhập).
const enrolledCourses = ref([])
const coursesLoading = ref(false)
const coursesError = ref('')
const demoSession = isDemoSession()
const COMING_SOON = 'Tính năng đang phát triển'

async function loadCourses() {
  if (demoSession) return
  coursesLoading.value = true
  coursesError.value = ''
  try {
    const data = await coursesApi.list()
    enrolledCourses.value = Array.isArray(data?.courses) ? data.courses : []
  } catch (err) {
    enrolledCourses.value = []
    coursesError.value = err.message
  } finally {
    coursesLoading.value = false
  }
}

onMounted(loadCourses)

const recommendedQuizzes = [
  { id: 1, title: 'Ôn tập thì Hiện Tại Hoàn Thành (Present Perfect)', course: 'ENG101', questionsCount: 15, duration: '20 phút' },
  { id: 2, title: 'Từ vựng Collocation chủ đề Môi trường', course: 'ENG202', questionsCount: 20, duration: '25 phút' },
  { id: 3, title: 'IELTS Reading - Chiến thuật Skimming & Scanning', course: 'IELTS-B2', questionsCount: 10, duration: '15 phút' },
]
</script>

<template>
  <DashboardLayout>
    <div class="space-y-6">
      <!-- Welcome Banner -->
      <div class="bg-gradient-to-r from-teal-600 via-emerald-600 to-indigo-600 rounded-2xl p-6 sm:p-8 text-white shadow-lg shadow-emerald-600/10 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <span class="inline-block px-2.5 py-1 rounded-full text-xs font-semibold bg-white/20 backdrop-blur-sm mb-3">
            Khu vực Học tập Sinh viên
          </span>
          <h1 class="text-2xl sm:text-3xl font-extrabold tracking-tight">
            Chào mừng trở lại, {{ user?.name || 'Bạn' }}!
          </h1>
          <p class="mt-2 text-emerald-100 text-sm max-w-xl">
            Tiếp tục lộ trình học tập hôm nay cùng trợ lý tài liệu và câu hỏi thông minh FLTS.
          </p>
        </div>

        <button
          type="button"
          data-test="continue-latest"
          disabled
          :title="COMING_SOON"
          class="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-emerald-700 font-semibold text-sm shadow-sm transition-all opacity-60 cursor-not-allowed"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Tiếp tục bài học gần nhất
        </button>
      </div>

      <!-- Stats Grid (chưa có API thống kê: dữ liệu minh họa) -->
      <p data-test="stats-illustrative" class="text-xs font-medium text-amber-700">Dữ liệu minh họa — thống kê học tập đang được phát triển.</p>
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

      <!-- Khóa học đang học & Luyện tập hôm nay -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Khóa học đang tham gia -->
        <div class="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden flex flex-col">
          <div class="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 class="font-bold text-slate-900 text-base">Khóa học của tôi</h2>
            <RouterLink :to="{ name: 'student-courses' }" class="text-xs text-indigo-600 font-semibold hover:underline">Xem tất cả</RouterLink>
          </div>
          <div class="divide-y divide-slate-100 flex-1">
            <p v-if="demoSession" data-test="courses-demo" class="p-4 text-sm text-slate-500">Chế độ xem trước (DEV Mode): không có dữ liệu khóa học thật.</p>
            <p v-else-if="coursesLoading" class="p-4 text-sm text-slate-500">Đang tải khóa học…</p>
            <p v-else-if="coursesError" data-test="courses-error" role="alert" class="p-4 text-sm text-red-700">
              {{ coursesError }}
              <button type="button" class="underline font-semibold ml-1" @click="loadCourses">Thử lại</button>
            </p>
            <p v-else-if="!enrolledCourses.length" data-test="courses-empty" class="p-4 text-sm text-slate-500">Bạn chưa tham gia khóa học nào.</p>
            <template v-else>
              <RouterLink
                v-for="course in enrolledCourses"
                :key="course.id"
                data-test="enrolled-course"
                :to="{ name: 'student-course', params: { courseId: String(course.id) } }"
                class="block p-4 hover:bg-slate-50/80 transition-colors"
              >
                <div class="flex items-center gap-2 mb-1">
                  <span class="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-50 text-emerald-700">
                    {{ course.code }}
                  </span>
                  <h3 class="text-sm font-semibold text-slate-800">{{ course.name }}</h3>
                </div>
                <p v-if="course.lecturer?.name" class="text-xs text-slate-500">Giảng viên: {{ course.lecturer.name }}</p>
              </RouterLink>
            </template>
          </div>
        </div>

        <!-- Luyện tập gợi ý bởi AI -->
        <div class="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden flex flex-col">
          <div class="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 class="font-bold text-slate-900 text-base">Luyện tập AI đề xuất hôm nay</h2>
            <span data-test="recommended-illustrative" class="text-xs font-medium text-amber-700">Dữ liệu minh họa</span>
          </div>
          <div class="divide-y divide-slate-100 flex-1">
            <div
              v-for="quiz in recommendedQuizzes"
              :key="quiz.id"
              class="p-4 hover:bg-slate-50/80 transition-colors flex items-center justify-between"
            >
              <div class="min-w-0 pr-4">
                <p class="text-sm font-medium text-slate-900 truncate">{{ quiz.title }}</p>
                <div class="flex items-center gap-2 mt-1 text-xs text-slate-500">
                  <span class="font-semibold text-slate-600">{{ quiz.course }}</span>
                  <span>•</span>
                  <span>{{ quiz.questionsCount }} câu</span>
                  <span>•</span>
                  <span>{{ quiz.duration }}</span>
                </div>
              </div>
              <button
                type="button"
                data-test="recommended-start"
                disabled
                :title="COMING_SOON"
                class="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold transition-colors shrink-0 opacity-60 cursor-not-allowed"
              >
                Làm bài
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </DashboardLayout>
</template>
