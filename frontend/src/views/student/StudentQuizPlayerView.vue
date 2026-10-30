<script setup>
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import AppModal from '@/components/AppModal.vue'
import DashboardLayout from '@/layouts/DashboardLayout.vue'
import MathText from '@/components/MathText.vue'
import { createQuizSession } from '@/quiz/quizSession'
import { formatRemaining } from '@/quiz/quizClock'

// Student Quiz Player: intro, start/resume, chọn đáp án, autosave 15 giây, đồng hồ theo giờ server, nộp bài,
// xác minh kết quả và hiển thị kết quả. startAttempt chỉ chạy khi sinh viên bấm nút: mỗi lần start khi không
// còn bài dở sẽ tạo một lượt làm mới, nên không bao giờ gọi start để kiểm tra trạng thái.
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
const confirmOpen = ref(false)
const timerLabel = computed(() => (state.value?.timer ? formatRemaining(state.value.timer.remainingMs) : ''))
const unansweredCount = computed(() => (state.value ? state.value.questions.length - session.value.answeredCount.value : 0))
const isLocked = computed(() => ['needs_verification', 'conflict'].includes(state.value?.save.reason))

// Kết quả: ghép với câu hỏi theo question_id (không theo vị trí mảng); chỉ có khi server trả chi tiết.
const resultRows = computed(() => {
  const result = state.value?.result
  if (!result || result.results.length === 0) return []
  const byQuestion = new Map(result.results.map((item) => [item.questionId, item]))
  return state.value.questions.map((question, index) => {
    const item = byQuestion.get(question.id) ?? null
    const optionText = (id) => question.options.find((option) => option.id === id)?.text ?? null
    return {
      id: question.id,
      number: index + 1,
      text: question.text,
      found: item !== null,
      isCorrect: item?.isCorrect === true,
      selectedText: item?.selectedOptionId != null ? optionText(item.selectedOptionId) : null,
      correctText: item?.correctOptionId != null ? optionText(item.correctOptionId) : null,
      explanation: item?.explanation ?? '',
      citations: (item?.citations ?? []).filter((citation) => citation.documentName || citation.sourceLocator),
    }
  })
})
const totalQuestions = computed(() => state.value?.questions.length || state.value?.quiz?.totalQuestions || null)
// Đạt/Chưa đạt chỉ khi có cả điểm server trả và ngưỡng đạt đã đọc từ Quiz.
const passed = computed(() => {
  const score = state.value?.result?.score
  const passing = state.value?.quiz?.passingScore
  return typeof score === 'number' && typeof passing === 'number' ? score >= passing : null
})

function openSubmitConfirm() {
  if (session.value?.canSubmit.value) confirmOpen.value = true
}

function confirmSubmit() {
  confirmOpen.value = false
  session.value?.submit()
}

// Tab hiện lại sau khi bị ẩn: tính lại thời gian còn lại ngay (interval có thể đã bị trình duyệt làm chậm).
function onVisibilityChange() {
  if (typeof document === 'undefined' || document.visibilityState !== 'hidden') session.value?.refreshTimer()
}

const canSaveNow = computed(() => {
  const save = state.value?.save
  return canEdit.value && (save?.status === 'retrying' || (save?.status === 'stopped' && save.reason === 'network'))
})

function openSession(courseId, learningObjectId) {
  confirmOpen.value = false
  session.value?.dispose()
  session.value = createQuizSession({ courseId, learningObjectId })
  session.value.loadIntro()
}

function retry() {
  if (state.value?.error?.retry === 'intro') session.value.loadIntro()
  else if (state.value?.error?.retry === 'start') session.value.start()
}

// Cảnh báo khi đóng/tải lại tab nếu còn thay đổi chưa được server xác nhận, PATCH đang chạy, hoặc đang nộp/xác minh.
function warnBeforeUnload(event) {
  const phase = state.value?.phase
  const unsaved = phase === 'in_progress' && (session.value.dirty.value || session.value.hasPendingSave())
  if (unsaved || phase === 'submitting' || phase === 'expiring' || phase === 'verifying') {
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
onMounted(() => {
  window.addEventListener('beforeunload', warnBeforeUnload)
  window.addEventListener('visibilitychange', onVisibilityChange)
})
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', warnBeforeUnload)
  window.removeEventListener('visibilitychange', onVisibilityChange)
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
        <h1 class="text-2xl font-bold text-slate-900"><MathText :text="state.quiz.title" /></h1>
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

      <div
        v-else-if="state.phase === 'submitting' || state.phase === 'expiring'"
        class="bg-white rounded-2xl border border-slate-200/80 p-6 text-sm text-slate-700"
        data-test="submitting"
      >
        <p v-if="state.phase === 'expiring'" class="font-semibold text-amber-800" data-test="expiring">
          Đã hết thời gian làm bài theo đồng hồ trên trình duyệt. Đang gửi bài lên máy chủ để chấm...
        </p>
        <p v-else class="font-semibold">Đang nộp bài...</p>
        <p class="mt-1 text-xs text-slate-500">Các lựa chọn đã bị khóa. Vui lòng không đóng trang cho tới khi có kết quả.</p>
      </div>

      <div
        v-else-if="state.phase === 'verifying'"
        class="bg-white rounded-2xl border border-amber-200 p-6 text-sm text-slate-700"
        data-test="verifying"
      >
        <p v-if="state.verification?.status === 'checking'" data-test="verify-checking">Đang kiểm tra trạng thái bài làm với máy chủ...</p>
        <template v-else-if="state.verification?.status === 'failed'">
          <p data-test="verify-failed">Chưa kiểm tra được trạng thái bài làm. Bài có thể đã được nộp; vui lòng kiểm tra lại.</p>
        </template>
        <template v-else-if="state.verification?.status === 'not_found'">
          <p data-test="verify-not-found">
            Máy chủ chưa ghi nhận bài nộp này. Có thể yêu cầu nộp chưa tới máy chủ hoặc vẫn đang được xử lý, nên chưa thể kết luận là nộp thất bại.
          </p>
          <p v-if="state.verification.canResume" class="mt-1 text-xs text-slate-500">
            Bạn có thể kiểm tra lại, hoặc tiếp tục làm bài (các lựa chọn hiện tại vẫn được giữ) rồi nộp lại.
          </p>
          <p v-else class="mt-1 text-xs text-slate-500">Đã hết thời gian làm bài; hãy kiểm tra lại để lấy kết quả từ máy chủ.</p>
        </template>
        <div v-if="state.verification?.status !== 'checking'" class="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            class="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors"
            data-test="verify-again"
            @click="session.verifyAttempt()"
          >
            Kiểm tra lại
          </button>
          <button
            v-if="state.verification?.status === 'not_found' && state.verification.canResume"
            type="button"
            class="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            data-test="resume"
            @click="session.resumeAfterVerification()"
          >
            Tiếp tục làm bài
          </button>
        </div>
      </div>

      <div
        v-else-if="state.phase === 'completed' || state.phase === 'completed_summary'"
        class="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 space-y-5"
        data-test="completed"
      >
        <div>
          <h1 class="text-lg font-bold text-slate-900">Kết quả: <MathText :text="state.quiz.title" /></h1>
          <p class="mt-1 text-sm text-slate-600">Bài làm này đã kết thúc.</p>
          <p v-if="state.result?.timedOut" class="mt-1 text-sm text-amber-800" data-test="timed-out">
            Máy chủ đã tự động nộp bài do hết thời gian làm bài.
          </p>
          <p v-else-if="state.result?.autoSubmitted" class="mt-1 text-sm text-amber-800" data-test="auto-submitted">
            Bài làm được máy chủ tự động nộp.
          </p>
        </div>

        <dl class="grid grid-cols-1 sm:grid-cols-3 gap-4" data-test="result-summary">
          <div class="rounded-xl bg-slate-50 p-4">
            <dt class="text-xs font-medium text-slate-500">Điểm</dt>
            <dd class="mt-1 text-lg font-bold text-slate-900" data-test="result-score">
              {{ state.result?.score !== null && state.result?.score !== undefined ? `${state.result.score}%` : '—' }}
            </dd>
          </div>
          <div class="rounded-xl bg-slate-50 p-4">
            <dt class="text-xs font-medium text-slate-500">Số câu đúng</dt>
            <dd class="mt-1 text-lg font-bold text-slate-900" data-test="result-correct">
              {{ state.result?.totalCorrect ?? '—' }}{{ totalQuestions ? `/${totalQuestions}` : '' }}
            </dd>
          </div>
          <div class="rounded-xl bg-slate-50 p-4">
            <dt class="text-xs font-medium text-slate-500">Kết quả</dt>
            <dd class="mt-1 text-lg font-bold" :class="passed === true ? 'text-emerald-700' : passed === false ? 'text-red-700' : 'text-slate-900'" data-test="result-passed">
              {{ passed === true ? 'Đạt' : passed === false ? 'Chưa đạt' : '—' }}
            </dd>
          </div>
        </dl>
        <p v-if="state.quiz.passingScore !== null" class="text-xs text-slate-500">Ngưỡng đạt: {{ state.quiz.passingScore }}%</p>

        <ol v-if="resultRows.length > 0" class="space-y-4" data-test="result-details">
          <li v-for="row in resultRows" :key="row.id" class="rounded-xl border border-slate-200 p-4" :data-test="`result-${row.id}`">
            <p class="text-sm font-semibold text-slate-900">Câu {{ row.number }}. <MathText :text="row.text" /></p>
            <template v-if="row.found">
              <p class="mt-2 text-sm" :class="row.isCorrect ? 'text-emerald-700' : 'text-red-700'" data-test="result-verdict">
                {{ row.isCorrect ? 'Đúng' : 'Sai' }}
              </p>
              <p class="mt-1 text-sm text-slate-700" data-test="result-selected">Bạn chọn: <MathText v-if="row.selectedText !== null" :text="row.selectedText" /><template v-else>Bỏ trống</template></p>
              <p class="mt-1 text-sm text-slate-700" data-test="result-correct-answer">Đáp án đúng: <MathText v-if="row.correctText !== null" :text="row.correctText" /><template v-else>—</template></p>
              <p v-if="row.explanation" class="mt-2 text-sm text-slate-600 whitespace-pre-wrap" data-test="result-explanation"><MathText :text="row.explanation" /></p>
              <ul v-if="row.citations.length > 0" class="mt-2 text-xs text-slate-500 list-disc pl-5" data-test="result-citations">
                <li v-for="(citation, index) in row.citations" :key="index">
                  Nguồn: {{ citation.documentName ?? 'Tài liệu' }}<template v-if="citation.sourceLocator"> — {{ citation.sourceLocator }}</template>
                </li>
              </ul>
            </template>
            <p v-else class="mt-2 text-xs text-slate-500">Máy chủ không trả kết quả cho câu này.</p>
          </li>
        </ol>
        <p v-else class="text-xs text-slate-500" data-test="result-summary-only">
          Chi tiết từng câu chỉ hiển thị ngay sau khi nộp bài; hiện chỉ có điểm tổng hợp từ máy chủ.
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
            <h1 class="text-lg font-bold text-slate-900"><MathText :text="state.quiz.title" /></h1>
            <div class="flex items-center gap-3">
              <span
                v-if="state.timer"
                :class="['px-2.5 py-1 rounded-full border text-sm font-bold tabular-nums', state.timer.warning ? 'text-red-700 bg-red-50 border-red-200' : 'text-slate-700 bg-slate-50 border-slate-200']"
                :data-warning="state.timer.warning ? 'true' : 'false'"
                data-test="timer"
              >
                ⏱ {{ timerLabel }}
              </span>
              <span class="text-sm text-slate-600" data-test="progress">
                Đã trả lời {{ session.answeredCount.value }}/{{ state.questions.length }} câu
              </span>
            </div>
          </div>
          <p v-if="state.timer" class="text-xs text-slate-500" data-test="timer-note">
            Thời gian còn lại được ước lượng theo giờ máy chủ; máy chủ quyết định hạn nộp thực tế.
          </p>

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
            <button
              v-if="isLocked"
              type="button"
              class="px-2.5 py-1 rounded-lg bg-amber-600 text-white font-semibold hover:bg-amber-700 transition-colors"
              data-test="verify-locked"
              @click="session.verifyAttempt()"
            >
              Kiểm tra trạng thái bài
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
              Câu {{ state.currentIndex + 1 }}. <MathText :text="currentQuestion.text" />
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
                <MathText :text="option.text" />
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
              :disabled="!session.canSubmit.value"
              class="px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors"
              data-test="submit"
              @click="openSubmitConfirm"
            >
              Nộp bài
            </button>
          </div>
        </div>
      </template>
    </div>

    <AppModal :show="confirmOpen && state?.phase === 'in_progress'" title="Nộp bài?" @close="confirmOpen = false">
      <div class="text-sm text-slate-700 space-y-2" data-test="submit-confirm">
        <p>Đã trả lời: <strong data-test="confirm-answered">{{ session?.answeredCount.value }}</strong>/{{ state?.questions.length }} câu.</p>
        <p v-if="unansweredCount > 0" class="text-amber-800" data-test="confirm-unanswered">
          Còn {{ unansweredCount }} câu bỏ trống; các câu này sẽ được tính là sai.
        </p>
        <p>Sau khi nộp, bạn không thể thay đổi câu trả lời.</p>
      </div>
      <template #footer>
        <button
          type="button"
          class="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors"
          data-test="confirm-submit"
          @click="confirmSubmit"
        >
          Nộp bài
        </button>
        <button
          type="button"
          class="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          data-test="cancel-submit"
          @click="confirmOpen = false"
        >
          Tiếp tục làm bài
        </button>
      </template>
    </AppModal>
  </DashboardLayout>
</template>
