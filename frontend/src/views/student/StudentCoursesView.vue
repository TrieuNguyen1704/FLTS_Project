<script setup>
import { onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import DashboardLayout from '@/layouts/DashboardLayout.vue'
import { courses, CoursesApiError } from '@/services/courses'

// 'loading' | 'ready' | 'error'
const status = ref('loading')
const items = ref([])
const errorMessage = ref('')

// Chỉ giữ field cần hiển thị; bỏ enrollment_code, email giảng viên và các field nội bộ khác.
function toCourseCard(course) {
  return {
    id: course.id,
    code: course.code,
    name: course.name,
    description: course.description,
    lecturerName: course.lecturer?.name ?? null,
  }
}

async function load() {
  status.value = 'loading'
  errorMessage.value = ''
  try {
    const data = await courses.list()
    items.value = (Array.isArray(data?.courses) ? data.courses : []).map(toCourseCard)
    status.value = 'ready'
  } catch (err) {
    errorMessage.value = err instanceof CoursesApiError ? err.message : 'Không thể tải danh sách khóa học.'
    status.value = 'error'
  }
}

onMounted(load)
</script>

<template>
  <DashboardLayout>
    <div class="space-y-6">
      <div>
        <h1 class="text-2xl font-bold text-slate-900">Khóa học của tôi</h1>
        <p class="mt-1 text-sm text-slate-500">Các khóa học bạn đã tham gia và Quiz đã được giảng viên xuất bản.</p>
      </div>

      <div v-if="status === 'loading'" class="bg-white rounded-2xl border border-slate-200/80 p-6 text-sm text-slate-500" data-test="loading">
        Đang tải danh sách khóa học...
      </div>

      <div v-else-if="status === 'error'" class="bg-white rounded-2xl border border-red-200 p-6" data-test="error">
        <p class="text-sm text-red-700">{{ errorMessage }}</p>
        <button
          type="button"
          class="mt-3 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors"
          data-test="retry"
          @click="load"
        >
          Thử lại
        </button>
      </div>

      <div v-else-if="items.length === 0" class="bg-white rounded-2xl border border-slate-200/80 p-6 text-sm text-slate-500" data-test="empty">
        Bạn chưa tham gia khóa học nào.
      </div>

      <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" data-test="course-list">
        <RouterLink
          v-for="course in items"
          :key="course.id"
          :to="{ name: 'student-course', params: { courseId: course.id } }"
          class="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5 hover:border-emerald-300 hover:shadow-md transition-all"
          data-test="course-link"
        >
          <span class="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-50 text-emerald-700">{{ course.code }}</span>
          <h2 class="mt-3 text-base font-semibold text-slate-900">{{ course.name }}</h2>
          <p v-if="course.description" class="mt-1 text-sm text-slate-500 line-clamp-2">{{ course.description }}</p>
          <p v-if="course.lecturerName" class="mt-3 text-xs text-slate-500">Giảng viên: {{ course.lecturerName }}</p>
        </RouterLink>
      </div>
    </div>
  </DashboardLayout>
</template>
