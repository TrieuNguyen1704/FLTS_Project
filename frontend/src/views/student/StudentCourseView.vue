<script setup>
import { ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import DashboardLayout from '@/layouts/DashboardLayout.vue'
import { courses, CoursesApiError } from '@/services/courses'
import { learningObjects, LearningObjectsApiError } from '@/services/learningObjects'

const route = useRoute()

// 'loading' | 'ready' | 'error'
const status = ref('loading')
const course = ref(null)
const quizzes = ref([])
const errorMessage = ref('')
let generation = 0

// Student chỉ nhận bản published; lọc thêm ở client để không hiện học liệu khác loại hoặc chưa xuất bản.
function toQuizItems(list) {
  return (Array.isArray(list) ? list : [])
    .filter((item) => item?.type === 'quiz' && item.status === 'published')
    .map((item) => ({
      id: item.id,
      title: item.title,
      description: item.description,
      totalQuestions: item.total_questions ?? null,
    }))
}

function safeMessage(err) {
  if (err instanceof CoursesApiError || err instanceof LearningObjectsApiError) return err.message
  if (err instanceof TypeError) return 'Đường dẫn khóa học không hợp lệ.'
  return 'Không thể tải khóa học.'
}

async function load(courseId) {
  const current = ++generation
  status.value = 'loading'
  errorMessage.value = ''
  try {
    const [courseData, objectData] = await Promise.all([courses.show(courseId), learningObjects.list(courseId)])
    if (current !== generation) return
    const info = courseData?.course ?? {}
    course.value = { name: info.name, code: info.code, description: info.description }
    quizzes.value = toQuizItems(objectData?.learning_objects)
    status.value = 'ready'
  } catch (err) {
    if (current !== generation) return
    errorMessage.value = safeMessage(err)
    status.value = 'error'
  }
}

watch(() => route.params.courseId, (courseId) => load(courseId), { immediate: true })
</script>

<template>
  <DashboardLayout>
    <div class="space-y-6">
      <RouterLink :to="{ name: 'student-courses' }" class="text-sm font-semibold text-indigo-600 hover:underline" data-test="back">
        ← Khóa học của tôi
      </RouterLink>

      <div v-if="status === 'loading'" class="bg-white rounded-2xl border border-slate-200/80 p-6 text-sm text-slate-500" data-test="loading">
        Đang tải khóa học...
      </div>

      <div v-else-if="status === 'error'" class="bg-white rounded-2xl border border-red-200 p-6" data-test="error">
        <p class="text-sm text-red-700">{{ errorMessage }}</p>
        <button
          type="button"
          class="mt-3 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors"
          data-test="retry"
          @click="load(route.params.courseId)"
        >
          Thử lại
        </button>
      </div>

      <template v-else>
        <div>
          <span v-if="course.code" class="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-50 text-emerald-700">{{ course.code }}</span>
          <h1 class="mt-2 text-2xl font-bold text-slate-900">{{ course.name }}</h1>
          <p v-if="course.description" class="mt-1 text-sm text-slate-500">{{ course.description }}</p>
        </div>

        <div class="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
          <div class="px-6 py-4 border-b border-slate-100">
            <h2 class="font-bold text-slate-900 text-base">Quiz</h2>
          </div>

          <p v-if="quizzes.length === 0" class="p-6 text-sm text-slate-500" data-test="empty">
            Khóa học chưa có Quiz nào được xuất bản.
          </p>

          <div v-else class="divide-y divide-slate-100" data-test="quiz-list">
            <div v-for="quiz in quizzes" :key="quiz.id" class="p-4 flex items-center justify-between gap-4">
              <div class="min-w-0">
                <p class="text-sm font-medium text-slate-900 truncate">{{ quiz.title }}</p>
                <p v-if="quiz.totalQuestions !== null" class="mt-1 text-xs text-slate-500">{{ quiz.totalQuestions }} câu</p>
              </div>
              <RouterLink
                :to="{ name: 'student-quiz', params: { courseId: route.params.courseId, learningObjectId: quiz.id } }"
                class="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors shrink-0"
                data-test="quiz-link"
              >
                Xem Quiz
              </RouterLink>
            </div>
          </div>
        </div>
      </template>
    </div>
  </DashboardLayout>
</template>
