<script setup>
/**
 * Modal tạo Quiz bằng AI cho Giảng viên (FAST-04B).
 * Luồng: form → submitting → generating → completed | failed | timeout | error.
 * Contract: /tmp/fast04-contract.md (FAST-04A). Chỉnh sửa câu hỏi thuộc FAST-05, chưa có route.
 */
import { reactive, ref, computed, watch, onBeforeUnmount } from 'vue'
import AppModal from '@/components/AppModal.vue'
import { learningObjects } from '@/services/learningObjects'
import { createGenerationPoller } from '@/quiz/generationPoller'
import {
  LIMITS,
  DIFFICULTIES,
  PREVIEW_FIELDS,
  defaultForm,
  createRequestId,
  isProcessed,
  validateForm,
  buildCreatePayload,
  buildPreviewPayload,
  fieldErrorsFrom,
} from '@/quiz/quizGeneratorForm'

const props = defineProps({
  show: { type: Boolean, default: false },
  courseId: { type: [Number, String], required: true },
})
const emit = defineEmits(['close', 'created', 'edit'])

const DOCUMENT_STATUS_LABELS = {
  processed: 'Đã xử lý',
  processing: 'Đang xử lý',
  uploaded_pending_processing: 'Chờ xử lý',
  failed: 'Xử lý lỗi',
}
const GENERATION_LABELS = {
  queued: 'Đang chờ máy chủ nhận yêu cầu…',
  generating: 'AI đang phân tích tài liệu và sinh câu hỏi…',
}
const ASSESSMENT_LABELS = {
  sufficient: 'Nguồn đủ cho yêu cầu',
  limited: 'Nguồn còn hạn chế',
  insufficient: 'Nguồn không đủ',
}
const FAILED_FALLBACK = 'Chưa thể tạo Quiz lúc này. Vui lòng thử lại sau.'

const phase = ref('form')
const form = reactive(defaultForm())
// Sinh một lần cho mỗi lần tạo; giữ nguyên khi gửi lại sau lỗi để backend trả đúng quiz đã tạo thay vì tạo bản mới.
const requestId = ref('')
const showAdvanced = ref(false)

const documents = ref([])
const documentsLoading = ref(false)
const documentsError = ref('')

const clientErrors = ref({})
const serverErrors = ref({})
const submitError = ref('')

const preview = ref(null)
const previewLoading = ref(false)
const previewError = ref('')
const confirmInsufficient = ref(false)

const learningObject = ref(null)
const generationStatus = ref(null)
const statusMessage = ref('')
const retrying = ref(false)
const retryError = ref('')
const confirmingClose = ref(false)

let initialized = false
let submitting = false
let createdEmitted = false
let previewToken = 0
let documentsToken = 0

const poller = createGenerationPoller({
  fetchFn: () => learningObjects.show(props.courseId, learningObject.value.id),
  onChange: handlePollState,
})

const fieldError = (name) => clientErrors.value[name] || serverErrors.value[name] || ''
const processedCount = computed(() => documents.value.filter(isProcessed).length)
const needsConfirmation = computed(() => preview.value?.assessment === 'insufficient' && !confirmInsufficient.value)
const totalQuestions = computed(
  () => learningObject.value?.total_questions ?? learningObject.value?.quiz?.total_questions ?? null,
)
const modalTitle = computed(() => (phase.value === 'form' || phase.value === 'submitting' ? 'Tạo Quiz bằng AI' : 'Tiến độ tạo Quiz'))

function resetForm() {
  Object.assign(form, defaultForm())
  requestId.value = createRequestId()
  phase.value = 'form'
  clientErrors.value = {}
  serverErrors.value = {}
  submitError.value = ''
  invalidatePreview()
  learningObject.value = null
  generationStatus.value = null
  statusMessage.value = ''
  retryError.value = ''
  confirmingClose.value = false
  createdEmitted = false
}

async function loadDocuments() {
  const token = ++documentsToken
  documentsLoading.value = true
  documentsError.value = ''
  try {
    const data = await learningObjects.sourceDocuments(props.courseId)
    if (token !== documentsToken) return
    documents.value = Array.isArray(data?.documents) ? data.documents : []
  } catch (err) {
    if (token !== documentsToken) return
    documents.value = []
    documentsError.value = err.message
  } finally {
    if (token === documentsToken) documentsLoading.value = false
  }
}

watch(
  () => props.show,
  (visible) => {
    if (!visible) {
      poller.stop()
      return
    }
    // Mở lại sau lỗi gửi (chưa nhận 202) thì giữ biểu mẫu và request_id; sau khi đã tạo thì bắt đầu bản mới.
    if (!initialized || phase.value !== 'form') resetForm()
    initialized = true
    loadDocuments()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  poller.stop()
})

function clearFieldError(name) {
  if (clientErrors.value[name]) clientErrors.value = { ...clientErrors.value, [name]: undefined }
  if (serverErrors.value[name]) serverErrors.value = { ...serverErrors.value, [name]: undefined }
}

function invalidatePreview() {
  previewToken++
  preview.value = null
  previewError.value = ''
  previewLoading.value = false
  confirmInsufficient.value = false
}

function setField(name, value) {
  form[name] = value
  clearFieldError(name)
  if (PREVIEW_FIELDS.includes(name)) invalidatePreview()
}

function toggleDocument(doc, checked) {
  if (!isProcessed(doc)) return
  const ids = form.document_ids.filter((id) => id !== doc.id)
  setField('document_ids', checked ? [...ids, doc.id] : ids)
}

async function runPreview() {
  if (previewLoading.value || phase.value !== 'form') return
  const all = validateForm(form, documents.value)
  const errors = Object.fromEntries(Object.entries(all).filter(([key]) => PREVIEW_FIELDS.includes(key)))
  clientErrors.value = errors
  if (Object.keys(errors).length) return
  const token = ++previewToken
  previewLoading.value = true
  previewError.value = ''
  try {
    const data = await learningObjects.previewQuizSources(props.courseId, buildPreviewPayload(form))
    if (token !== previewToken) return
    preview.value = data
    confirmInsufficient.value = false
  } catch (err) {
    if (token !== previewToken) return
    previewError.value = err.message
    serverErrors.value = fieldErrorsFrom(err.errors)
  } finally {
    if (token === previewToken) previewLoading.value = false
  }
}

async function submit() {
  // Cờ đồng bộ chặn double-click trước khi Vue kịp render nút disabled.
  if (submitting || phase.value !== 'form') return
  const errors = validateForm(form, documents.value)
  clientErrors.value = errors
  serverErrors.value = {}
  if (Object.keys(errors).length) {
    submitError.value = 'Vui lòng sửa các trường được đánh dấu.'
    return
  }
  if (needsConfirmation.value) {
    submitError.value = 'Nguồn không đủ: hãy xác nhận vẫn muốn tạo hoặc điều chỉnh chủ đề/tài liệu.'
    return
  }
  submitting = true
  phase.value = 'submitting'
  submitError.value = ''
  try {
    const data = await learningObjects.createQuiz(props.courseId, buildCreatePayload(form, requestId.value))
    trackGeneration(data?.learning_object ?? null)
  } catch (err) {
    phase.value = 'form'
    submitError.value = err.message
    serverErrors.value = fieldErrorsFrom(err.errors)
  } finally {
    submitting = false
  }
}

function trackGeneration(object) {
  learningObject.value = object
  generationStatus.value = object?.generation?.status ?? null
  retryError.value = ''
  if (!object?.id) {
    phase.value = 'error'
    statusMessage.value = 'Máy chủ không trả về học liệu vừa tạo.'
    return
  }
  // Gửi lại cùng request_id có thể nhận ngay kết quả cuối của lần tạo trước.
  if (generationStatus.value === 'completed') return markCompleted()
  if (generationStatus.value === 'failed') {
    phase.value = 'failed'
    statusMessage.value = object.generation?.error_message || FAILED_FALLBACK
    return
  }
  poller.start({ initial: object })
}

function handlePollState(state) {
  if (state.learningObject) learningObject.value = state.learningObject
  generationStatus.value = state.generationStatus
  if (state.status === 'polling') {
    phase.value = 'generating'
  } else if (state.status === 'completed') {
    markCompleted()
  } else if (state.status === 'failed') {
    phase.value = 'failed'
    statusMessage.value = state.errorMessage || FAILED_FALLBACK
  } else if (state.status === 'timeout' || state.status === 'error') {
    phase.value = state.status
    statusMessage.value = state.errorMessage
  }
}

function markCompleted() {
  phase.value = 'completed'
  confirmingClose.value = false
  if (!createdEmitted) {
    createdEmitted = true
    emit('created', learningObject.value.id)
  }
}

async function retry() {
  if (retrying.value || phase.value !== 'failed') return
  retrying.value = true
  retryError.value = ''
  try {
    const data = await learningObjects.retryQuizGeneration(props.courseId, learningObject.value.id)
    trackGeneration(data?.learning_object ?? null)
  } catch (err) {
    retryError.value = err.message
  } finally {
    retrying.value = false
  }
}

function checkAgain() {
  if (!learningObject.value?.id) return
  poller.start({ immediate: true })
}

function startAnother() {
  resetForm()
  loadDocuments()
}

function requestClose() {
  if (phase.value === 'submitting') return
  // Đóng khi đang tạo chỉ dừng theo dõi; job vẫn chạy nền nên hỏi lại để người dùng không tưởng đã hủy.
  if (phase.value === 'generating' && !confirmingClose.value) {
    confirmingClose.value = true
    return
  }
  closeNow()
}

function closeNow() {
  confirmingClose.value = false
  poller.stop()
  emit('close')
}
</script>

<template>
  <AppModal :show="show" :title="modalTitle" max-width="max-w-2xl" @close="requestClose">
    <!-- ===== FORM ===== -->
    <form
      v-if="phase === 'form' || phase === 'submitting'"
      data-test="generator-form"
      class="space-y-5"
      novalidate
      @submit.prevent="submit"
    >
      <div>
        <label for="qg-topic" class="block text-xs font-semibold text-slate-700 mb-1">Chủ đề <span class="text-red-500">*</span></label>
        <textarea
          id="qg-topic"
          data-test="field-topic"
          rows="2"
          :value="form.topic"
          :maxlength="LIMITS.topic[1]"
          :disabled="phase === 'submitting'"
          placeholder="Ví dụ: Thì hiện tại hoàn thành và cách phân biệt với quá khứ đơn"
          class="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          @input="(e) => setField('topic', e.target.value)"
        />
        <p v-if="fieldError('topic')" data-test="error-topic" class="mt-1 text-xs text-red-600">{{ fieldError('topic') }}</p>
      </div>

      <div>
        <label for="qg-title" class="block text-xs font-semibold text-slate-700 mb-1">Tiêu đề (tùy chọn)</label>
        <input
          id="qg-title"
          data-test="field-title"
          type="text"
          :value="form.title"
          :maxlength="LIMITS.title"
          :disabled="phase === 'submitting'"
          placeholder="Để trống để AI đặt tiêu đề"
          class="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          @input="(e) => setField('title', e.target.value)"
        >
        <p v-if="fieldError('title')" data-test="error-title" class="mt-1 text-xs text-red-600">{{ fieldError('title') }}</p>
      </div>

      <!-- Tài liệu nguồn -->
      <fieldset>
        <legend class="block text-xs font-semibold text-slate-700 mb-1">Tài liệu nguồn</legend>
        <p class="text-xs text-slate-500 mb-2">
          Không chọn tài liệu nào thì AI dùng mọi tài liệu đã xử lý của khóa học. Chỉ chọn được tài liệu đã xử lý xong.
        </p>
        <p v-if="documentsLoading" class="text-xs text-slate-500">Đang tải danh sách tài liệu…</p>
        <p v-else-if="documentsError" data-test="documents-error" class="text-xs text-red-600">
          {{ documentsError }}
          <button type="button" class="underline font-semibold ml-1" @click="loadDocuments">Tải lại</button>
        </p>
        <p v-else-if="!documents.length" data-test="documents-empty" class="text-xs text-amber-700">
          Khóa học chưa có tài liệu. Hãy tải lên và xử lý tài liệu trước khi tạo Quiz.
        </p>
        <ul v-else class="max-h-44 overflow-y-auto divide-y divide-slate-100 rounded-xl border border-slate-200">
          <li v-for="doc in documents" :key="doc.id" class="px-3 py-2 flex items-center justify-between gap-3 text-sm">
            <label class="flex items-center gap-2 min-w-0" :class="isProcessed(doc) ? 'cursor-pointer' : 'opacity-60 cursor-not-allowed'">
              <input
                type="checkbox"
                :data-test="`document-${doc.id}`"
                :checked="form.document_ids.includes(doc.id)"
                :disabled="!isProcessed(doc) || phase === 'submitting'"
                @change="(e) => toggleDocument(doc, e.target.checked)"
              >
              <span class="truncate">{{ doc.original_name || `Tài liệu #${doc.id}` }}</span>
            </label>
            <span
              :data-test="`document-status-${doc.id}`"
              :class="['shrink-0 text-xs font-medium', isProcessed(doc) ? 'text-emerald-700' : 'text-slate-500']"
            >
              {{ DOCUMENT_STATUS_LABELS[doc.processing_status || doc.status] || (doc.processing_status || doc.status) }}
            </span>
          </li>
        </ul>
        <p v-if="documents.length && !processedCount" class="mt-1 text-xs text-amber-700">
          Chưa có tài liệu nào xử lý xong; Quiz sẽ không có nguồn để tạo.
        </p>
        <p v-if="fieldError('document_ids')" data-test="error-document_ids" class="mt-1 text-xs text-red-600">{{ fieldError('document_ids') }}</p>
      </fieldset>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label for="qg-count" class="block text-xs font-semibold text-slate-700 mb-1">Số câu hỏi ({{ LIMITS.questionCount[0] }}–{{ LIMITS.questionCount[1] }})</label>
          <input
            id="qg-count"
            data-test="field-question_count"
            type="number"
            :min="LIMITS.questionCount[0]"
            :max="LIMITS.questionCount[1]"
            :value="form.question_count"
            :disabled="phase === 'submitting'"
            class="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm"
            @input="(e) => setField('question_count', e.target.value)"
          >
          <p v-if="fieldError('question_count')" data-test="error-question_count" class="mt-1 text-xs text-red-600">{{ fieldError('question_count') }}</p>
        </div>

        <div>
          <label for="qg-difficulty" class="block text-xs font-semibold text-slate-700 mb-1">Độ khó</label>
          <select
            id="qg-difficulty"
            data-test="field-difficulty"
            :value="form.difficulty"
            :disabled="phase === 'submitting'"
            class="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white"
            @change="(e) => setField('difficulty', e.target.value)"
          >
            <option v-for="d in DIFFICULTIES" :key="d.value" :value="d.value">{{ d.label }}</option>
          </select>
          <p v-if="fieldError('difficulty')" data-test="error-difficulty" class="mt-1 text-xs text-red-600">{{ fieldError('difficulty') }}</p>
        </div>

        <div>
          <label for="qg-time" class="block text-xs font-semibold text-slate-700 mb-1">Thời gian làm bài (phút)</label>
          <div class="flex items-center gap-3">
            <input
              id="qg-time"
              data-test="field-time_limit_minutes"
              type="number"
              :min="LIMITS.timeLimit[0]"
              :max="LIMITS.timeLimit[1]"
              :value="form.time_limit_minutes"
              :disabled="form.unlimited_time || phase === 'submitting'"
              class="w-28 px-3 py-2 rounded-xl border border-slate-200 text-sm disabled:bg-slate-100"
              @input="(e) => setField('time_limit_minutes', e.target.value)"
            >
            <label class="flex items-center gap-1.5 text-xs text-slate-700">
              <input
                type="checkbox"
                data-test="field-unlimited_time"
                :checked="form.unlimited_time"
                :disabled="phase === 'submitting'"
                @change="(e) => { setField('unlimited_time', e.target.checked); clearFieldError('time_limit_minutes') }"
              >
              Không giới hạn
            </label>
          </div>
          <p v-if="fieldError('time_limit_minutes')" data-test="error-time_limit_minutes" class="mt-1 text-xs text-red-600">{{ fieldError('time_limit_minutes') }}</p>
        </div>

        <div>
          <label for="qg-passing" class="block text-xs font-semibold text-slate-700 mb-1">Điểm đạt (%)</label>
          <input
            id="qg-passing"
            data-test="field-passing_score"
            type="number"
            :min="LIMITS.passingScore[0]"
            :max="LIMITS.passingScore[1]"
            :value="form.passing_score"
            :disabled="phase === 'submitting'"
            class="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm"
            @input="(e) => setField('passing_score', e.target.value)"
          >
          <p v-if="fieldError('passing_score')" data-test="error-passing_score" class="mt-1 text-xs text-red-600">{{ fieldError('passing_score') }}</p>
        </div>
      </div>

      <!-- Nâng cao -->
      <div>
        <button type="button" data-test="toggle-advanced" class="text-xs font-semibold text-indigo-600" @click="showAdvanced = !showAdvanced">
          {{ showAdvanced ? '▾' : '▸' }} Nâng cao
        </button>
        <div v-if="showAdvanced || fieldError('top_k')" class="mt-2">
          <label for="qg-topk" class="block text-xs font-semibold text-slate-700 mb-1">Số đoạn nguồn truy xuất ({{ LIMITS.topK[0] }}–{{ LIMITS.topK[1] }})</label>
          <input
            id="qg-topk"
            data-test="field-top_k"
            type="number"
            :min="LIMITS.topK[0]"
            :max="LIMITS.topK[1]"
            :value="form.top_k"
            :disabled="phase === 'submitting'"
            class="w-28 px-3 py-2 rounded-xl border border-slate-200 text-sm"
            @input="(e) => setField('top_k', e.target.value)"
          >
          <p v-if="fieldError('top_k')" data-test="error-top_k" class="mt-1 text-xs text-red-600">{{ fieldError('top_k') }}</p>
        </div>
      </div>

      <!-- Xem trước nguồn (không bắt buộc) -->
      <div class="rounded-xl border border-slate-200 p-3 space-y-2">
        <div class="flex items-center justify-between gap-3">
          <p class="text-xs text-slate-600">Kiểm tra trước tài liệu có đủ nội dung cho chủ đề này không (không bắt buộc).</p>
          <button
            type="button"
            data-test="preview-button"
            :disabled="previewLoading || phase === 'submitting'"
            class="shrink-0 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            @click="runPreview"
          >
            {{ previewLoading ? 'Đang kiểm tra…' : 'Xem trước nguồn' }}
          </button>
        </div>
        <p v-if="previewError" data-test="preview-error" class="text-xs text-red-600">{{ previewError }}</p>
        <div v-if="preview" data-test="preview-result" class="space-y-2">
          <p
            data-test="preview-assessment"
            :class="[
              'text-xs font-semibold px-2 py-1 rounded-lg',
              preview.assessment === 'sufficient' ? 'bg-emerald-50 text-emerald-800'
              : preview.assessment === 'limited' ? 'bg-amber-50 text-amber-800' : 'bg-red-50 text-red-800',
            ]"
          >
            {{ ASSESSMENT_LABELS[preview.assessment] || preview.assessment }}<template v-if="preview.message"> — {{ preview.message }}</template>
          </p>
          <p v-if="preview.assessment === 'limited'" data-test="preview-limited-warning" class="text-xs text-amber-700">
            Có thể giảm số câu hỏi (gợi ý tối đa {{ preview.suggested_max_output }}) hoặc chọn thêm tài liệu.
          </p>
          <label v-if="preview.assessment === 'insufficient'" class="flex items-start gap-2 text-xs text-red-700">
            <input
              type="checkbox"
              data-test="confirm-insufficient"
              :checked="confirmInsufficient"
              @change="(e) => { confirmInsufficient = e.target.checked; submitError = '' }"
            >
            Tôi hiểu nguồn không đủ và kết quả có thể thất bại hoặc kém chính xác, vẫn muốn tạo Quiz.
          </label>
          <ul v-if="preview.matches?.length" class="max-h-48 overflow-y-auto space-y-1.5">
            <li v-for="match in preview.matches" :key="match.vector_id" data-test="preview-match" class="text-xs rounded-lg bg-slate-50 p-2">
              <p class="font-semibold text-slate-800">
                {{ match.document_name }}<template v-if="match.source_locator"> · {{ match.source_locator }}</template>
              </p>
              <p class="text-slate-600 line-clamp-3">{{ match.excerpt }}</p>
            </li>
          </ul>
        </div>
      </div>

      <p v-if="submitError" data-test="submit-error" role="alert" class="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
        {{ submitError }}
      </p>
    </form>

    <!-- ===== GENERATING ===== -->
    <div v-else-if="phase === 'generating'" data-test="phase-generating" class="space-y-3 text-sm">
      <div class="flex items-center gap-3">
        <span class="w-3 h-3 rounded-full bg-indigo-500 animate-pulse" />
        <p data-test="generation-status" class="font-medium text-slate-800">
          {{ GENERATION_LABELS[generationStatus] || 'Đang kiểm tra tiến độ…' }}
        </p>
      </div>
      <p class="text-xs text-slate-500">Thường mất dưới 3 phút. Có thể đóng cửa sổ này: Quiz vẫn được tạo ở nền và sẽ xuất hiện trong danh sách học liệu.</p>
      <div v-if="confirmingClose" data-test="confirm-close" class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 space-y-2">
        <p>Đóng cửa sổ sẽ dừng theo dõi nhưng không hủy việc tạo Quiz. Bạn vẫn muốn đóng?</p>
        <div class="flex gap-2">
          <button type="button" data-test="confirm-close-yes" class="px-3 py-1.5 rounded-lg bg-amber-600 text-white font-medium" @click="closeNow">Đóng, chạy nền</button>
          <button type="button" data-test="confirm-close-no" class="px-3 py-1.5 rounded-lg border border-amber-300 font-medium" @click="confirmingClose = false">Tiếp tục theo dõi</button>
        </div>
      </div>
    </div>

    <!-- ===== COMPLETED ===== -->
    <div v-else-if="phase === 'completed'" data-test="phase-completed" class="space-y-2 text-sm">
      <p class="font-semibold text-emerald-700">Đã tạo Quiz nháp thành công.</p>
      <p data-test="completed-summary" class="text-slate-700">
        {{ learningObject?.title }}<template v-if="totalQuestions !== null"> — {{ totalQuestions }} câu hỏi</template>
      </p>
      <p class="text-xs text-slate-500">Quiz đang ở trạng thái nháp, sinh viên chưa thấy. Mở trình chỉnh sửa để rà soát và xuất bản.</p>
    </div>

    <!-- ===== FAILED ===== -->
    <div v-else-if="phase === 'failed'" data-test="phase-failed" class="space-y-2 text-sm">
      <p class="font-semibold text-red-700">Tạo Quiz thất bại.</p>
      <p data-test="failed-message" class="text-slate-700">{{ statusMessage }}</p>
      <p v-if="retryError" data-test="retry-error" class="text-xs text-red-600">{{ retryError }}</p>
    </div>

    <!-- ===== TIMEOUT / ERROR ===== -->
    <div v-else data-test="phase-waiting-issue" class="space-y-2 text-sm">
      <p class="font-semibold text-amber-700">{{ phase === 'timeout' ? 'Chưa có kết quả' : 'Không kiểm tra được tiến độ' }}</p>
      <p data-test="issue-message" class="text-slate-700">{{ statusMessage }}</p>
      <p class="text-xs text-slate-500">Quiz có thể vẫn đang được tạo ở nền.</p>
    </div>

    <template #footer>
      <template v-if="phase === 'form' || phase === 'submitting'">
        <button
          type="button"
          data-test="submit-button"
          :disabled="phase === 'submitting'"
          class="px-4 py-2 rounded-xl bg-indigo-600 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          @click="submit"
        >
          {{ phase === 'submitting' ? 'Đang gửi…' : 'Tạo Quiz' }}
        </button>
        <button type="button" data-test="cancel-button" :disabled="phase === 'submitting'" class="px-4 py-2 rounded-xl border border-slate-200 text-sm" @click="requestClose">
          Hủy
        </button>
      </template>
      <template v-else-if="phase === 'completed'">
        <button type="button" data-test="edit-button" class="px-4 py-2 rounded-xl bg-indigo-600 text-sm font-medium text-white" @click="emit('edit', learningObject.id)">Mở trình chỉnh sửa</button>
        <button type="button" data-test="close-button" class="px-4 py-2 rounded-xl border border-slate-200 text-sm" @click="closeNow">Đóng</button>
        <button type="button" data-test="another-button" class="px-4 py-2 rounded-xl border border-slate-200 text-sm" @click="startAnother">Tạo Quiz khác</button>
      </template>
      <template v-else-if="phase === 'failed'">
        <button
          type="button"
          data-test="retry-button"
          :disabled="retrying"
          class="px-4 py-2 rounded-xl bg-indigo-600 text-sm font-medium text-white disabled:opacity-60"
          @click="retry"
        >
          {{ retrying ? 'Đang gửi…' : 'Thử lại' }}
        </button>
        <button type="button" data-test="close-button" class="px-4 py-2 rounded-xl border border-slate-200 text-sm" @click="closeNow">Đóng</button>
      </template>
      <template v-else-if="phase === 'timeout' || phase === 'error'">
        <button type="button" data-test="check-again-button" class="px-4 py-2 rounded-xl bg-indigo-600 text-sm font-medium text-white" @click="checkAgain">
          {{ phase === 'timeout' ? 'Kiểm tra lại' : 'Thử kiểm tra lại' }}
        </button>
        <button type="button" data-test="close-button" class="px-4 py-2 rounded-xl border border-slate-200 text-sm" @click="closeNow">Đóng</button>
      </template>
      <template v-else>
        <button type="button" data-test="close-button" class="px-4 py-2 rounded-xl border border-slate-200 text-sm" @click="requestClose">Đóng</button>
      </template>
    </template>
  </AppModal>
</template>
