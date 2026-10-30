<script setup>
import { ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import DashboardLayout from '@/layouts/DashboardLayout.vue'
import { learningObjects, LearningObjectsApiError } from '@/services/learningObjects'

// S3-H04B1: skeleton chỉ đọc thông tin Quiz (GET learning object). Không gọi startAttempt ở đây:
// mỗi lần start khi không còn bài dở sẽ tạo một lượt làm mới, nên chỉ được gọi khi sinh viên chủ động bấm (B2).
const route = useRoute()

// 'loading' | 'ready' | 'error'
const status = ref('loading')
const quiz = ref(null)
const errorMessage = ref('')
let generation = 0

function safeMessage(err) {
  if (err instanceof LearningObjectsApiError) return err.message
  if (err instanceof TypeError) return 'Đường dẫn Quiz không hợp lệ.'
  return 'Không thể tải thông tin Quiz.'
}

async function load(courseId, learningObjectId) {
  const current = ++generation
  status.value = 'loading'
  errorMessage.value = ''
  try {
    const data = await learningObjects.show(courseId, learningObjectId)
    if (current !== generation) return
    const object = data?.learning_object
    if (object?.type !== 'quiz' || !object.quiz) {
      errorMessage.value = 'Không tìm thấy bài kiểm tra hoặc bài làm.'
      status.value = 'error'
      return
    }
    quiz.value = {
      title: object.title,
      description: object.description,
      totalQuestions: object.quiz.total_questions ?? object.total_questions ?? null,
      timeLimitMinutes: object.quiz.time_limit_minutes ?? null,
      passingScore: object.quiz.passing_score ?? null,
    }
    status.value = 'ready'
  } catch (err) {
    if (current !== generation) return
    errorMessage.value = safeMessage(err)
    status.value = 'error'
  }
}

watch(
  () => [route.params.courseId, route.params.learningObjectId],
  ([courseId, learningObjectId]) => load(courseId, learningObjectId),
  { immediate: true },
)
</script>

<template>
  <DashboardLayout>
    <div class="space-y-6 max-w-3xl">
      <RouterLink
        :to="{ name: 'student-course', params: { courseId: route.params.courseId } }"
        class="text-sm font-semibold text-indigo-600 hover:underline"
        data-test="back"
      >
        ← Danh sách Quiz
      </RouterLink>

      <div v-if="status === 'loading'" class="bg-white rounded-2xl border border-slate-200/80 p-6 text-sm text-slate-500" data-test="loading">
        Đang tải thông tin Quiz...
      </div>

      <div v-else-if="status === 'error'" class="bg-white rounded-2xl border border-red-200 p-6" data-test="error">
        <p class="text-sm text-red-700">{{ errorMessage }}</p>
        <button
          type="button"
          class="mt-3 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors"
          data-test="retry"
          @click="load(route.params.courseId, route.params.learningObjectId)"
        >
          Thử lại
        </button>
      </div>

      <div v-else class="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6" data-test="quiz-info">
        <h1 class="text-2xl font-bold text-slate-900">{{ quiz.title }}</h1>
        <p v-if="quiz.description" class="mt-1 text-sm text-slate-500">{{ quiz.description }}</p>

        <dl class="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div class="rounded-xl bg-slate-50 p-4">
            <dt class="text-xs font-medium text-slate-500">Số câu</dt>
            <dd class="mt-1 text-lg font-bold text-slate-900" data-test="total-questions">
              {{ quiz.totalQuestions ?? '—' }}
            </dd>
          </div>
          <div class="rounded-xl bg-slate-50 p-4">
            <dt class="text-xs font-medium text-slate-500">Thời gian</dt>
            <dd class="mt-1 text-lg font-bold text-slate-900" data-test="time-limit">
              {{ quiz.timeLimitMinutes ? `${quiz.timeLimitMinutes} phút` : 'Không giới hạn' }}
            </dd>
          </div>
          <div class="rounded-xl bg-slate-50 p-4">
            <dt class="text-xs font-medium text-slate-500">Ngưỡng đạt</dt>
            <dd class="mt-1 text-lg font-bold text-slate-900" data-test="passing-score">
              {{ quiz.passingScore !== null ? `${quiz.passingScore}%` : '—' }}
            </dd>
          </div>
        </dl>

        <div class="mt-6">
          <button
            type="button"
            disabled
            class="px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold opacity-60 cursor-not-allowed"
            data-test="start"
          >
            Bắt đầu làm bài
          </button>
          <p class="mt-2 text-xs text-slate-500">Chức năng làm bài đang được hoàn thiện (S3-H04B2).</p>
        </div>
      </div>
    </div>
  </DashboardLayout>
</template>
