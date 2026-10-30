<script setup>
/**
 * Danh sách Quiz của khóa học cho Giảng viên (FAST-05). Dùng API thật (GET learning-objects), lọc type quiz.
 * Không dùng dữ liệu mẫu: lỗi API hiện thông báo lỗi kèm nút tải lại.
 * refreshKey: màn cha tăng giá trị để nạp lại (vd. sau khi QuizGeneratorModal emit created).
 */
import { ref, computed, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { learningObjects } from '@/services/learningObjects'
import { quizStatusBadge } from '@/quiz/quizEditorModel'

const props = defineProps({
  courseId: { type: [Number, String], required: true },
  refreshKey: { type: Number, default: 0 },
})

const BADGE_CLASSES = {
  draft: 'bg-slate-100 text-slate-700',
  published: 'bg-emerald-50 text-emerald-700',
  'published-draft': 'bg-emerald-50 text-emerald-700',
  archived: 'bg-slate-200 text-slate-500',
  generating: 'bg-indigo-50 text-indigo-700',
  failed: 'bg-red-50 text-red-700',
}

const items = ref([])
const loading = ref(false)
const error = ref('')
let token = 0

const quizzes = computed(() => items.value.filter((item) => item.type === 'quiz'))
// Chỉ quiz đã xuất bản (hoặc đã lưu trữ sau khi xuất bản) mới có bài làm của sinh viên.
const hasResults = (quiz) => quiz.status === 'published' || quiz.status === 'archived'

async function load() {
  const current = ++token
  loading.value = true
  error.value = ''
  try {
    const data = await learningObjects.list(props.courseId)
    if (current !== token) return
    items.value = Array.isArray(data?.learning_objects) ? data.learning_objects : []
  } catch (err) {
    if (current !== token) return
    items.value = []
    error.value = err.message
  } finally {
    if (current === token) loading.value = false
  }
}

watch(() => [props.courseId, props.refreshKey], load, { immediate: true })
</script>

<template>
  <div class="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
    <div class="p-6 border-b border-slate-100 flex items-center justify-between gap-4">
      <div>
        <h2 class="text-base font-bold text-slate-900">Quiz của khóa học</h2>
        <p class="text-xs text-slate-500 mt-0.5">Quiz nháp chỉ giảng viên thấy; sinh viên chỉ thấy quiz đã xuất bản.</p>
      </div>
      <button
        type="button"
        data-test="quiz-list-reload"
        class="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50"
        @click="load"
      >
        Làm mới
      </button>
    </div>

    <p v-if="loading && !quizzes.length" class="p-6 text-sm text-slate-500">Đang tải danh sách quiz…</p>
    <p v-else-if="error" data-test="quiz-list-error" role="alert" class="p-6 text-sm text-red-700">
      {{ error }}
    </p>
    <p v-else-if="!quizzes.length" data-test="quiz-list-empty" class="p-6 text-sm text-slate-500">
      Chưa có quiz nào. Dùng nút "Tạo Quiz bằng AI" ở trên để tạo quiz đầu tiên.
    </p>
    <ul v-else class="divide-y divide-slate-100">
      <li v-for="quiz in quizzes" :key="quiz.id" data-test="quiz-row" class="px-6 py-3 flex items-center justify-between gap-4">
        <div class="min-w-0">
          <p class="text-sm font-medium text-slate-900 truncate">{{ quiz.title }}</p>
          <p class="text-xs text-slate-500">
            <template v-if="quiz.total_questions">{{ quiz.total_questions }} câu · </template>Phiên bản {{ quiz.current_version || 0 }}
          </p>
        </div>
        <div class="flex items-center gap-3 shrink-0">
          <span
            :data-test="`quiz-badge-${quiz.id}`"
            :class="['px-2 py-0.5 rounded-full text-xs font-semibold', BADGE_CLASSES[quizStatusBadge(quiz).key]]"
          >
            {{ quizStatusBadge(quiz).label }}
          </span>
          <RouterLink
            v-if="hasResults(quiz)"
            :data-test="`quiz-results-${quiz.id}`"
            :to="{ name: 'lecturer-quiz-results', params: { courseId: String(courseId), learningObjectId: String(quiz.id) } }"
            class="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Kết quả
          </RouterLink>
          <RouterLink
            :data-test="`quiz-edit-${quiz.id}`"
            :to="{ name: 'lecturer-quiz-edit', params: { courseId: String(courseId), learningObjectId: String(quiz.id) } }"
            class="px-3 py-1.5 rounded-lg border border-indigo-200 text-xs font-medium text-indigo-700 hover:bg-indigo-50"
          >
            Chỉnh sửa
          </RouterLink>
        </div>
      </li>
    </ul>
  </div>
</template>
