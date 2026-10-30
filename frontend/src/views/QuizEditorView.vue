<script setup>
/**
 * Trình chỉnh sửa Quiz của Giảng viên (FAST-05): sửa nội dung bản nháp, xuất bản, lưu trữ.
 * Contract: LearningObjectController@show/update/publish/archive (xem quizEditorModel.js).
 * Không thêm/xóa câu hỏi: câu mới bắt buộc có citation (vector_id) mà UI không tạo được.
 * Chưa hỗ trợ tạo lại (regenerate) và phiên bản/khôi phục (FAST-05B).
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { RouterLink, useRoute, onBeforeRouteLeave } from 'vue-router'
import DashboardLayout from '@/layouts/DashboardLayout.vue'
import MathText from '@/components/MathText.vue'
import { learningObjects } from '@/services/learningObjects'
import { hasMath } from '@/quiz/mathRender'
import {
  EDITOR_LIMITS,
  fromApi,
  toPatchPayload,
  validate,
  cloneForm,
  isDirty,
  serverErrorsFrom,
  editorAccess,
  quizStatusBadge,
} from '@/quiz/quizEditorModel'

const LEAVE_MESSAGE = 'Bạn có thay đổi chưa lưu. Rời trang sẽ mất các thay đổi này?'
const OPTION_LABELS = ['A', 'B', 'C', 'D']

const route = useRoute()
const courseId = computed(() => route.params.courseId)
const learningObjectId = computed(() => route.params.learningObjectId)

const learningObject = ref(null)
const form = ref(null)
const baseline = ref(null)
const loading = ref(true)
const loadError = ref('')

const clientErrors = ref({})
const serverErrors = ref({})
const saveError = ref('')
const saving = ref(false)
const notice = ref('')

const confirmAction = ref(null) // 'publish' | 'archive' | null
const actionBusy = ref(false)
const actionError = ref('')

// Cờ đồng bộ chặn double-click trước khi Vue kịp render nút disabled.
let saveInFlight = false
let actionInFlight = false

const access = computed(() => editorAccess(learningObject.value))
const editable = computed(() => access.value.editable && form.value !== null)
const dirty = computed(() => isDirty(form.value, baseline.value))
const validationErrors = computed(() => (form.value ? validate(form.value) : {}))
const badge = computed(() => quizStatusBadge(learningObject.value))
const publishBlockReason = computed(() => {
  if (!access.value.canPublish) return ''
  if (dirty.value) return 'Hãy lưu thay đổi trước khi xuất bản.'
  if (Object.keys(validationErrors.value).length) return 'Hãy sửa các lỗi trong quiz trước khi xuất bản.'
  return ''
})

const errorFor = (key) => clientErrors.value[key] || serverErrors.value[key] || ''

function applyLearningObject(object) {
  learningObject.value = object
  const next = fromApi(object)
  form.value = next
  baseline.value = next ? cloneForm(next) : null
  clientErrors.value = {}
  serverErrors.value = {}
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const data = await learningObjects.show(courseId.value, learningObjectId.value)
    if (data?.learning_object?.type !== 'quiz') {
      loadError.value = 'Học liệu này không phải Quiz.'
      return
    }
    applyLearningObject(data.learning_object)
  } catch (err) {
    loadError.value = err.message
  } finally {
    loading.value = false
  }
}

function clearError(key) {
  if (clientErrors.value[key]) clientErrors.value = { ...clientErrors.value, [key]: undefined }
  if (serverErrors.value[key]) serverErrors.value = { ...serverErrors.value, [key]: undefined }
  notice.value = ''
}

function setField(key, value) {
  form.value[key] = value
  clearError(key)
}

function setQuestionField(q, key, value) {
  form.value.questions[q][key] = value
  clearError(`questions.${q}.${key}`)
}

function setOption(q, o, value) {
  form.value.questions[q].options[o] = value
  clearError(`questions.${q}.options.${o}`)
}

function setCorrect(q, o) {
  form.value.questions[q].correct_index = o
  clearError(`questions.${q}.correct_index`)
}

async function save() {
  if (saveInFlight || !editable.value) return
  const errors = validate(form.value)
  clientErrors.value = errors
  serverErrors.value = {}
  saveError.value = ''
  notice.value = ''
  if (Object.keys(errors).length) {
    saveError.value = 'Vui lòng sửa các ô được đánh dấu trước khi lưu.'
    return
  }
  saveInFlight = true
  saving.value = true
  try {
    const data = await learningObjects.updateQuiz(courseId.value, learningObjectId.value, toPatchPayload(form.value))
    applyLearningObject(data.learning_object)
    notice.value = `Đã lưu bản nháp (phiên bản ${data.learning_object.current_version}).`
  } catch (err) {
    saveError.value = err.message
    serverErrors.value = serverErrorsFrom(err.errors)
  } finally {
    saveInFlight = false
    saving.value = false
  }
}

function askConfirm(action) {
  actionError.value = ''
  notice.value = ''
  if (action === 'publish' && publishBlockReason.value) {
    actionError.value = publishBlockReason.value
    return
  }
  confirmAction.value = action
}

async function runConfirmedAction() {
  const action = confirmAction.value
  if (actionInFlight || !action) return
  actionInFlight = true
  actionBusy.value = true
  actionError.value = ''
  try {
    const call = action === 'publish' ? learningObjects.publish : learningObjects.archive
    const data = await call(courseId.value, learningObjectId.value)
    applyLearningObject(data.learning_object)
    confirmAction.value = null
    notice.value = action === 'publish'
      ? 'Đã xuất bản. Sinh viên đã ghi danh khóa học sẽ thấy quiz này.'
      : 'Đã lưu trữ. Sinh viên không còn thấy quiz này.'
  } catch (err) {
    actionError.value = err.message
  } finally {
    actionInFlight = false
    actionBusy.value = false
  }
}

function onBeforeUnload(event) {
  if (!dirty.value) return
  event.preventDefault()
  event.returnValue = ''
}

onMounted(() => {
  window.addEventListener('beforeunload', onBeforeUnload)
  load()
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onBeforeUnload)
})

onBeforeRouteLeave(() => {
  if (dirty.value && !window.confirm(LEAVE_MESSAGE)) return false
  return true
})
</script>

<template>
  <DashboardLayout>
    <div class="space-y-6 max-w-4xl">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <RouterLink
            :to="{ name: 'course-workspace', query: { id: courseId } }"
            data-test="back-link"
            class="text-xs font-medium text-slate-500 hover:text-indigo-600"
          >
            ← Quay lại khóa học
          </RouterLink>
          <h1 class="text-2xl font-bold text-slate-900 tracking-tight mt-1">Chỉnh sửa Quiz</h1>
          <RouterLink
            v-if="learningObject && ['published', 'archived'].includes(learningObject.status)"
            :to="{ name: 'lecturer-quiz-results', params: { courseId, learningObjectId } }"
            data-test="results-link"
            class="text-xs font-medium text-indigo-600 hover:underline"
          >
            Xem kết quả →
          </RouterLink>
        </div>
        <span v-if="learningObject" data-test="editor-badge" class="self-start px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">
          {{ badge.label }}
        </span>
      </div>

      <p v-if="loading" class="text-sm text-slate-500">Đang tải quiz…</p>
      <div v-else-if="loadError" data-test="load-error" role="alert" class="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800">
        {{ loadError }}
        <button type="button" class="underline font-semibold ml-2" @click="load">Thử lại</button>
      </div>

      <template v-else-if="learningObject">
        <p v-if="notice" data-test="notice" role="status" class="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
          {{ notice }}
        </p>
        <p v-if="access.reason" data-test="readonly-reason" class="p-3 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-800">
          {{ access.reason }}
        </p>

        <template v-if="form">
          <!-- Thông tin chung -->
          <section class="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-sm space-y-4">
            <h2 class="text-base font-bold text-slate-900">Thông tin chung</h2>
            <template v-if="editable">
              <div>
                <label for="qe-title" class="block text-xs font-semibold text-slate-700 mb-1">Tiêu đề</label>
                <input
                  id="qe-title"
                  data-test="field-title"
                  type="text"
                  :value="form.title"
                  :maxlength="EDITOR_LIMITS.title"
                  class="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm"
                  @input="(e) => setField('title', e.target.value)"
                >
                <p v-if="errorFor('title')" data-test="error-title" class="mt-1 text-xs text-red-600">{{ errorFor('title') }}</p>
              </div>
              <div>
                <label for="qe-description" class="block text-xs font-semibold text-slate-700 mb-1">Mô tả (tùy chọn)</label>
                <textarea
                  id="qe-description"
                  data-test="field-description"
                  rows="2"
                  :value="form.description"
                  :maxlength="EDITOR_LIMITS.description"
                  class="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm"
                  @input="(e) => setField('description', e.target.value)"
                />
                <p v-if="errorFor('description')" data-test="error-description" class="mt-1 text-xs text-red-600">{{ errorFor('description') }}</p>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label for="qe-time" class="block text-xs font-semibold text-slate-700 mb-1">Thời gian làm bài (phút)</label>
                  <div class="flex items-center gap-3">
                    <input
                      id="qe-time"
                      data-test="field-time_limit_minutes"
                      type="number"
                      :min="EDITOR_LIMITS.timeLimit[0]"
                      :max="EDITOR_LIMITS.timeLimit[1]"
                      :value="form.time_limit_minutes"
                      :disabled="form.unlimited_time"
                      class="w-28 px-3 py-2 rounded-xl border border-slate-200 text-sm disabled:bg-slate-100"
                      @input="(e) => setField('time_limit_minutes', e.target.value)"
                    >
                    <label class="flex items-center gap-1.5 text-xs text-slate-700">
                      <input
                        type="checkbox"
                        data-test="field-unlimited_time"
                        :checked="form.unlimited_time"
                        @change="(e) => { setField('unlimited_time', e.target.checked); clearError('time_limit_minutes') }"
                      >
                      Không giới hạn
                    </label>
                  </div>
                  <p v-if="errorFor('time_limit_minutes')" data-test="error-time_limit_minutes" class="mt-1 text-xs text-red-600">{{ errorFor('time_limit_minutes') }}</p>
                </div>
                <div>
                  <label for="qe-passing" class="block text-xs font-semibold text-slate-700 mb-1">Điểm đạt (%)</label>
                  <input
                    id="qe-passing"
                    data-test="field-passing_score"
                    type="number"
                    :min="EDITOR_LIMITS.passingScore[0]"
                    :max="EDITOR_LIMITS.passingScore[1]"
                    :value="form.passing_score"
                    class="w-28 px-3 py-2 rounded-xl border border-slate-200 text-sm"
                    @input="(e) => setField('passing_score', e.target.value)"
                  >
                  <p v-if="errorFor('passing_score')" data-test="error-passing_score" class="mt-1 text-xs text-red-600">{{ errorFor('passing_score') }}</p>
                </div>
              </div>
            </template>
            <dl v-else data-test="readonly-summary" class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div class="sm:col-span-3"><dt class="text-xs text-slate-500">Tiêu đề</dt><dd class="font-medium text-slate-900"><MathText :text="form.title" /></dd></div>
              <div><dt class="text-xs text-slate-500">Thời gian</dt><dd>{{ form.unlimited_time ? 'Không giới hạn' : `${form.time_limit_minutes} phút` }}</dd></div>
              <div><dt class="text-xs text-slate-500">Điểm đạt</dt><dd>{{ form.passing_score }}%</dd></div>
              <div><dt class="text-xs text-slate-500">Số câu</dt><dd>{{ form.questions.length }}</dd></div>
            </dl>
          </section>

          <!-- Câu hỏi -->
          <p v-if="errorFor('questions')" data-test="error-questions" class="text-xs text-red-600">{{ errorFor('questions') }}</p>
          <section
            v-for="(question, q) in form.questions"
            :key="q"
            :data-test="`question-${q}`"
            class="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-sm space-y-3"
          >
            <h3 class="text-sm font-bold text-slate-900">Câu {{ q + 1 }}</h3>

            <template v-if="editable">
              <div>
                <textarea
                  :data-test="`field-q${q}-question_text`"
                  rows="2"
                  :value="question.question_text"
                  :maxlength="EDITOR_LIMITS.questionText[1]"
                  class="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm"
                  @input="(e) => setQuestionField(q, 'question_text', e.target.value)"
                />
                <p v-if="hasMath(question.question_text)" class="mt-1 text-sm text-slate-700 bg-slate-50 rounded-lg px-3 py-2">
                  <span class="text-xs text-slate-400 mr-1">Xem trước:</span><MathText :text="question.question_text" />
                </p>
                <p v-if="errorFor(`questions.${q}.question_text`)" :data-test="`error-q${q}-question_text`" class="mt-1 text-xs text-red-600">
                  {{ errorFor(`questions.${q}.question_text`) }}
                </p>
              </div>

              <fieldset class="space-y-2">
                <legend class="text-xs font-semibold text-slate-700 mb-1">Lựa chọn (chọn đáp án đúng)</legend>
                <div v-for="(option, o) in question.options" :key="o">
                  <div class="flex items-start gap-2">
                    <input
                      type="radio"
                      :name="`correct-${q}`"
                      :data-test="`correct-q${q}-${o}`"
                      :checked="question.correct_index === o"
                      class="mt-2.5"
                      @change="setCorrect(q, o)"
                    >
                    <span class="mt-2 text-xs font-semibold text-slate-500 w-4">{{ OPTION_LABELS[o] || o + 1 }}</span>
                    <input
                      type="text"
                      :data-test="`field-q${q}-option-${o}`"
                      :value="option"
                      :maxlength="EDITOR_LIMITS.optionText[1]"
                      class="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-sm"
                      @input="(e) => setOption(q, o, e.target.value)"
                    >
                  </div>
                  <p v-if="hasMath(option)" class="ml-10 mt-1 text-sm text-slate-700"><MathText :text="option" /></p>
                  <p v-if="errorFor(`questions.${q}.options.${o}`)" :data-test="`error-q${q}-option-${o}`" class="ml-10 mt-1 text-xs text-red-600">
                    {{ errorFor(`questions.${q}.options.${o}`) }}
                  </p>
                </div>
                <p v-if="errorFor(`questions.${q}.correct_index`)" :data-test="`error-q${q}-correct_index`" class="text-xs text-red-600">
                  {{ errorFor(`questions.${q}.correct_index`) }}
                </p>
                <p v-if="errorFor(`questions.${q}.options`)" class="text-xs text-red-600">{{ errorFor(`questions.${q}.options`) }}</p>
              </fieldset>

              <div>
                <label class="block text-xs font-semibold text-slate-700 mb-1">Giải thích</label>
                <textarea
                  :data-test="`field-q${q}-explanation`"
                  rows="2"
                  :value="question.explanation"
                  :maxlength="EDITOR_LIMITS.explanation[1]"
                  class="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm"
                  @input="(e) => setQuestionField(q, 'explanation', e.target.value)"
                />
                <p v-if="hasMath(question.explanation)" class="mt-1 text-sm text-slate-700 bg-slate-50 rounded-lg px-3 py-2">
                  <span class="text-xs text-slate-400 mr-1">Xem trước:</span><MathText :text="question.explanation" />
                </p>
                <p v-if="errorFor(`questions.${q}.explanation`)" :data-test="`error-q${q}-explanation`" class="mt-1 text-xs text-red-600">
                  {{ errorFor(`questions.${q}.explanation`) }}
                </p>
              </div>
            </template>

            <template v-else>
              <MathText :text="question.question_text" tag="p" class="text-sm text-slate-900" />
              <ol class="space-y-1 text-sm">
                <li
                  v-for="(option, o) in question.options"
                  :key="o"
                  :data-test="`readonly-q${q}-option-${o}`"
                  :class="question.correct_index === o ? 'font-semibold text-emerald-700' : 'text-slate-700'"
                >
                  {{ OPTION_LABELS[o] || o + 1 }}. <MathText :text="option" /><template v-if="question.correct_index === o"> ✓</template>
                </li>
              </ol>
              <p class="text-sm text-slate-600"><span class="text-xs font-semibold text-slate-500">Giải thích: </span><MathText :text="question.explanation" /></p>
            </template>

            <div v-if="question.citations.length" class="pt-2 border-t border-slate-100">
              <p class="text-xs font-semibold text-slate-500 mb-1">Nguồn trích dẫn (chỉ đọc)</p>
              <ul class="text-xs text-slate-600 space-y-0.5">
                <li v-for="(citation, c) in question.citations" :key="c" :data-test="`citation-q${q}-${c}`">
                  {{ citation.document_name || `Tài liệu #${citation.document_id ?? '?'}` }}<template v-if="citation.source_locator"> · {{ citation.source_locator }}</template>
                </li>
              </ul>
            </div>
            <p v-if="errorFor(`questions.${q}.citations`)" :data-test="`error-q${q}-citations`" class="text-xs text-red-600">
              {{ errorFor(`questions.${q}.citations`) }}
            </p>
          </section>

          <!-- Thanh hành động -->
          <section class="sticky bottom-0 bg-white/95 backdrop-blur rounded-2xl border border-slate-200 p-4 shadow-sm space-y-3">
            <p v-if="saveError" data-test="save-error" role="alert" class="text-sm text-red-700">{{ saveError }}</p>
            <p v-if="actionError" data-test="action-error" role="alert" class="text-sm text-red-700">{{ actionError }}</p>

            <div v-if="confirmAction" data-test="confirm-panel" class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 space-y-2">
              <p v-if="confirmAction === 'publish'">
                Xuất bản phiên bản hiện tại? Sinh viên đã ghi danh sẽ thấy và làm được quiz này. Sau khi xuất bản, quiz không sửa trực tiếp được nữa.
              </p>
              <p v-else>Lưu trữ quiz? Sinh viên sẽ không còn thấy quiz này và không thể xuất bản lại.</p>
              <div class="flex gap-2">
                <button
                  type="button"
                  data-test="confirm-yes"
                  :disabled="actionBusy"
                  class="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-medium disabled:opacity-60"
                  @click="runConfirmedAction"
                >
                  {{ actionBusy ? 'Đang xử lý…' : confirmAction === 'publish' ? 'Xuất bản' : 'Lưu trữ' }}
                </button>
                <button type="button" data-test="confirm-no" :disabled="actionBusy" class="px-3 py-1.5 rounded-lg border border-amber-300 text-xs font-medium" @click="confirmAction = null">
                  Hủy
                </button>
              </div>
            </div>

            <div class="flex flex-wrap items-center gap-2">
              <button
                v-if="editable"
                type="button"
                data-test="save-button"
                :disabled="saving || !dirty"
                class="px-4 py-2 rounded-xl bg-indigo-600 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                @click="save"
              >
                {{ saving ? 'Đang lưu…' : 'Lưu bản nháp' }}
              </button>
              <button
                v-if="access.canPublish"
                type="button"
                data-test="publish-button"
                :disabled="actionBusy || saving"
                class="px-4 py-2 rounded-xl bg-emerald-600 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                @click="askConfirm('publish')"
              >
                Xuất bản
              </button>
              <button
                v-if="access.canArchive"
                type="button"
                data-test="archive-button"
                :disabled="actionBusy || saving"
                class="px-4 py-2 rounded-xl border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                @click="askConfirm('archive')"
              >
                Lưu trữ
              </button>
              <span v-if="dirty" data-test="dirty-indicator" class="text-xs text-amber-700">Có thay đổi chưa lưu</span>
              <span v-else-if="publishBlockReason" class="text-xs text-slate-500">{{ publishBlockReason }}</span>
            </div>
          </section>
        </template>
      </template>
    </div>
  </DashboardLayout>
</template>
