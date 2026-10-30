<script setup>
import { computed, onBeforeUnmount, onMounted, shallowRef, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import DashboardLayout from '@/layouts/DashboardLayout.vue'
import { createQuizSession } from '@/quiz/quizSession'

// S3-H04B2/B3: intro, start/resume, chọn đáp án và autosave 15 giây. startAttempt chỉ chạy khi sinh viên bấm nút:
// mỗi lần start khi không còn bài dở sẽ tạo một lượt làm mới. Chưa có timer/submit (B4–B5).
const route = useRoute()
const session = shallowRef(null)

const state = computed(() => session.value?.state)
const currentQuestion = computed(() => state.value?.questions[state.value.currentIndex] ?? null)
const canEdit = computed(() => session.value?.canEdit.value === true)

// Chip trạng thái lưu: chỉ báo "Đã lưu" khi server đã xác nhận đúng bản nháp hiện tại.
const saveChip = computed(() => {
  const save = state.value?.save
  if (!save) return null
  if (save.status === 'saving') return { key: 'saving', label: 'Đang lưu...', tone: 'text-indigo-700 bg-indigo-50 border-indigo-200' }
  if (save.status === 'stopped') return { key: 'stopped', label: 'Tự động lưu đã dừng', tone: 'text-red-700 bg-red-50 border-red-200' }
  if (save.status === 'retrying') return { key: 'retrying', label: 'Lưu thất bại, sẽ thử lại', tone: 'text-amber-800 bg-amber-50 border-amber-200' }
  if (session.value.dirty.value) return { key: 'dirty', label: 'Chưa lưu', tone: 'text-amber-800 bg-amber-50 border-amber-200' }
  if (save.status === 'saved') return { key: 'saved', label: 'Đã lưu', tone: 'text-emerald-700 bg-emerald-50 border-emerald-200' }
  return { key: 'clean', label: 'Chưa có thay đổi', tone: 'text-slate-600 bg-slate-50 border-slate-200' }
})
const lastSavedLabel = computed(() => {
  const value = state.value?.save.lastSavedAt
  return value ? new Date(value).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''
})
const canSaveNow = computed(() => {
  const save = state.value?.save
  return canEdit.value && (save?.status === 'retrying' || (save?.status === 'stopped' && save.reason === 'network'))
})

function openSession(courseId, learningObjectId) {
  session.value?.dispose()
  session.value = createQuizSession({ courseId, learningObjectId })
  session.value.loadIntro()
}

function retry() {
  if (state.value?.error?.retry === 'intro') session.value.loadIntro()
  else if (state.value?.error?.retry === 'start') session.value.start()
}

// Cảnh báo khi đóng/tải lại tab nếu còn thay đổi chưa được server xác nhận hoặc PATCH đang chạy.
function warnBeforeUnload(event) {
  if (state.value?.phase === 'in_progress' && (session.value.dirty.value || session.value.hasPendingSave())) {
    event.preventDefault()
    event.returnValue = ''
  }
}

// Theo dõi từng param primitive: đổi query/hash không tạo lại session (getter trả mảng mới sẽ luôn bị coi là thay đổi).
watch(
  [() => route.params.courseId, () => route.params.learningObjectId],
  ([courseId, learningObjectId]) => openSession(courseId, learningObjectId),
  { immediate: true },
)
onMounted(() => window.addEventListener('beforeunload', warnBeforeUnload))
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', warnBeforeUnload)
  session.value?.dispose()
})
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

      <div
        v-if="!state || state.phase === 'idle' || state.phase === 'loading'"
        class="bg-white rounded-2xl border border-slate-200/80 p-6 text-sm text-slate-500"
        data-test="loading"
      >
        Đang tải thông tin Quiz...
      </div>

      <div
        v-else-if="state.phase === 'recoverable_error' || state.phase === 'fatal_error'"
        class="bg-white rounded-2xl border border-red-200 p-6"
        data-test="error"
      >
        <p class="text-sm text-red-700">{{ state.error?.message }}</p>
        <p v-if="state.startUncertain" class="mt-2 text-xs text-amber-700" data-test="start-uncertain">
          Không rõ máy chủ đã nhận yêu cầu bắt đầu hay chưa. Khi thử lại, nếu bài làm đã được tạo, hệ thống sẽ tiếp tục đúng bài làm đó.
        </p>
        <button
          v-if="state.error?.retry"
          type="button"
          class="mt-3 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors"
          data-test="retry"
          @click="retry"
        >
          Thử lại
        </button>
      </div>

      <div
        v-else-if="state.phase === 'intro' || state.phase === 'starting'"
        class="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6"
        data-test="quiz-info"
      >
        <h1 class="text-2xl font-bold text-slate-900">{{ state.quiz.title }}</h1>
        <p v-if="state.quiz.description" class="mt-1 text-sm text-slate-500">{{ state.quiz.description }}</p>

        <dl class="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div class="rounded-xl bg-slate-50 p-4">
            <dt class="text-xs font-medium text-slate-500">Số câu</dt>
            <dd class="mt-1 text-lg font-bold text-slate-900" data-test="total-questions">{{ state.quiz.totalQuestions ?? '—' }}</dd>
          </div>
          <div class="rounded-xl bg-slate-50 p-4">
            <dt class="text-xs font-medium text-slate-500">Thời gian</dt>
            <dd class="mt-1 text-lg font-bold text-slate-900" data-test="time-limit">
              {{ state.quiz.timeLimitMinutes ? `${state.quiz.timeLimitMinutes} phút` : 'Không giới hạn' }}
            </dd>
          </div>
          <div class="rounded-xl bg-slate-50 p-4">
            <dt class="text-xs font-medium text-slate-500">Ngưỡng đạt</dt>
            <dd class="mt-1 text-lg font-bold text-slate-900" data-test="passing-score">
              {{ state.quiz.passingScore !== null ? `${state.quiz.passingScore}%` : '—' }}
            </dd>
          </div>
        </dl>

        <div v-if="state.history" class="mt-4 text-sm text-slate-600" data-test="history">
          <p>Số lượt đã hoàn thành: <strong>{{ state.history.completedCount }}</strong></p>
          <p v-if="state.history.completedCount > 0">
            Điểm gần nhất: <strong>{{ state.history.latestScore }}%</strong> · Điểm cao nhất: <strong>{{ state.history.bestScore }}%</strong>
          </p>
        </div>
        <p v-else-if="state.historyError" class="mt-4 text-xs text-amber-700" data-test="history-error">{{ state.historyError }}</p>

        <div class="mt-6">
          <button
            type="button"
            :disabled="state.phase === 'starting'"
            class="px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors"
            data-test="start"
            @click="session.start()"
          >
            {{ state.phase === 'starting' ? 'Đang mở bài làm...' : 'Bắt đầu / Tiếp tục làm bài' }}
          </button>
          <p class="mt-2 text-xs text-slate-500">
            Nếu bạn đang có bài làm dở, hệ thống sẽ tiếp tục bài đó; nếu không, một lượt làm mới sẽ được tạo.
          </p>
        </div>
      </div>

      <div v-else-if="state.phase === 'completed'" class="bg-white rounded-2xl border border-slate-200/80 p-6" data-test="completed">
        <p class="text-sm text-slate-700">Bài làm này đã kết thúc.</p>
        <p v-if="state.result?.timedOut" class="mt-1 text-sm text-amber-800" data-test="timed-out">
          Máy chủ đã tự động nộp bài do hết thời gian làm bài.
        </p>
        <p v-if="state.result?.score !== null && state.result?.score !== undefined" class="mt-1 text-sm text-slate-700">
          Điểm: <strong>{{ state.result.score }}%</strong>
        </p>
      </div>

      <template v-else-if="state.phase === 'in_progress'">
        <div
          v-if="state.save.status === 'stopped' && state.save.message"
          class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
          data-test="save-stopped"
        >
          {{ state.save.message }}
          <span v-if="session.dirty.value"> Các lựa chọn gần nhất mới chỉ nằm trên trình duyệt này, chưa được lưu lên máy chủ.</span>
        </div>
        <div
          v-else-if="state.save.status === 'retrying'"
          class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"
          data-test="save-retrying"
        >
          Chưa lưu được câu trả lời lên máy chủ. Hệ thống sẽ thử lại sau ít giây; bạn có thể bấm "Lưu ngay".
        </div>
        <p v-if="state.ignoredDraftCount > 0" class="text-xs text-amber-700" data-test="ignored-draft">
          Một số câu trả lời đã lưu không còn khớp với đề hiện tại và đã được bỏ qua.
        </p>

        <div class="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 space-y-5" data-test="attempt">
          <div class="flex items-center justify-between gap-4">
            <h1 class="text-lg font-bold text-slate-900">{{ state.quiz.title }}</h1>
            <span class="text-sm text-slate-600" data-test="progress">
              Đã trả lời {{ session.answeredCount.value }}/{{ state.questions.length }} câu
            </span>
          </div>

          <div class="flex flex-wrap items-center gap-3 text-xs">
            <span :class="['px-2.5 py-1 rounded-full border font-semibold', saveChip.tone]" :data-save="saveChip.key" data-test="save-chip">
              {{ saveChip.label }}
            </span>
            <span v-if="lastSavedLabel" class="text-slate-500" data-test="last-saved">Lần lưu gần nhất: {{ lastSavedLabel }}</span>
            <button
              v-if="canSaveNow"
              type="button"
              class="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-700 transition-colors"
              data-test="save-now"
              @click="session.saveNow()"
            >
              Lưu ngay
            </button>
          </div>

          <nav class="flex flex-wrap gap-2" aria-label="Danh sách câu hỏi" data-test="question-nav">
            <button
              v-for="(question, index) in state.questions"
              :key="question.id"
              type="button"
              :class="[
                'w-9 h-9 rounded-lg text-sm font-semibold border transition-colors',
                index === state.currentIndex
                  ? 'border-indigo-600 bg-indigo-600 text-white'
                  : state.answers[question.id] !== null
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
              ]"
              :aria-current="index === state.currentIndex ? 'step' : undefined"
              :data-test="`nav-${index + 1}`"
              @click="session.goTo(index)"
            >
              {{ index + 1 }}
            </button>
          </nav>

          <fieldset v-if="currentQuestion" data-test="question">
            <legend class="text-base font-semibold text-slate-900">
              Câu {{ state.currentIndex + 1 }}. {{ currentQuestion.text }}
            </legend>
            <div class="mt-4 space-y-2">
              <label
                v-for="option in currentQuestion.options"
                :key="option.id"
                class="flex items-start gap-3 rounded-xl border border-slate-200 p-3 text-sm text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                <input
                  type="radio"
                  :name="`question-${currentQuestion.id}`"
                  :value="option.id"
                  :checked="state.answers[currentQuestion.id] === option.id"
                  :disabled="!canEdit"
                  :data-test="`option-${option.id}`"
                  @change="session.selectAnswer(currentQuestion.id, option.id)"
                />
                <span>{{ option.text }}</span>
              </label>
            </div>
            <button
              type="button"
              :disabled="!canEdit || state.answers[currentQuestion.id] === null"
              class="mt-3 text-xs font-semibold text-slate-500 hover:text-slate-700"
              data-test="clear"
              @click="session.clearAnswer(currentQuestion.id)"
            >
              Bỏ chọn
            </button>
          </fieldset>

          <div class="flex items-center justify-between gap-3">
            <button
              type="button"
              :disabled="state.currentIndex === 0"
              class="px-3 py-1.5 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              data-test="prev"
              @click="session.goTo(state.currentIndex - 1)"
            >
              ← Câu trước
            </button>
            <button
              type="button"
              :disabled="state.currentIndex === state.questions.length - 1"
              class="px-3 py-1.5 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              data-test="next"
              @click="session.goTo(state.currentIndex + 1)"
            >
              Câu sau →
            </button>
          </div>

          <div class="border-t border-slate-100 pt-4">
            <button
              type="button"
              disabled
              class="px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold opacity-60 cursor-not-allowed"
              data-test="submit"
            >
              Nộp bài
            </button>
            <p class="mt-2 text-xs text-slate-500">Chức năng nộp bài đang được hoàn thiện (S3-H04B5).</p>
          </div>
        </div>
      </template>
    </div>
  </DashboardLayout>
</template>
