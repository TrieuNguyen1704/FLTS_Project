<script setup>
/**
 * Kết quả Quiz cho Giảng viên (FAST-06) — CHỈ ĐỌC: chỉ gọi GET quiz-results và GET chi tiết một attempt khi bấm.
 * Contract: LecturerQuizResultController@index/show. Không có thống kê theo câu ở backend nên màn này không hiển thị;
 * tự tính bằng cách gọi chi tiết từng attempt sẽ thành N+1 request.
 */
import { ref, computed, onMounted } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import DashboardLayout from '@/layouts/DashboardLayout.vue'
import MathText from '@/components/MathText.vue'
import { learningObjects } from '@/services/learningObjects'
import {
  normalizeResults,
  filterStudents,
  sortStudents,
  formatScore,
  formatDuration,
} from '@/quiz/quizResultsModel'

const route = useRoute()
const courseId = computed(() => route.params.courseId)
const learningObjectId = computed(() => route.params.learningObjectId)

const results = ref(null)
const loading = ref(true)
const loadError = ref('')
const query = ref('')
const sortKey = ref('lastSubmittedAt')
const sortDirection = ref('desc')
const expandedStudentId = ref(null)

const detail = ref(null)
const detailAttemptId = ref(null)
const detailLoading = ref(false)
const detailError = ref('')
let detailToken = 0

const COLUMNS = [
  { key: 'name', label: 'Sinh viên' },
  { key: 'attemptsCount', label: 'Số lượt' },
  { key: 'latestScore', label: 'Điểm gần nhất' },
  { key: 'bestScore', label: 'Điểm cao nhất' },
  { key: 'lastSubmittedAt', label: 'Nộp gần nhất' },
]

const visibleStudents = computed(() => {
  if (!results.value) return []
  return sortStudents(filterStudents(results.value.students, query.value), sortKey.value, sortDirection.value)
})
const maxBucket = computed(() => Math.max(1, ...(results.value?.distribution ?? []).map((bucket) => bucket.count)))

function formatDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    results.value = normalizeResults(await learningObjects.lecturerQuizResults(courseId.value, learningObjectId.value))
  } catch (err) {
    results.value = null
    loadError.value = err.message
  } finally {
    loading.value = false
  }
}

function toggleSort(key) {
  if (sortKey.value === key) sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
  else {
    sortKey.value = key
    sortDirection.value = key === 'name' ? 'asc' : 'desc'
  }
}

function toggleStudent(id) {
  expandedStudentId.value = expandedStudentId.value === id ? null : id
}

async function openAttempt(attemptId) {
  if (detailLoading.value && detailAttemptId.value === attemptId) return
  const token = ++detailToken
  detailAttemptId.value = attemptId
  detail.value = null
  detailError.value = ''
  detailLoading.value = true
  try {
    const data = await learningObjects.lecturerAttemptDetail(courseId.value, learningObjectId.value, attemptId)
    if (token === detailToken) detail.value = data
  } catch (err) {
    if (token === detailToken) detailError.value = err.message
  } finally {
    if (token === detailToken) detailLoading.value = false
  }
}

function closeAttempt() {
  detailToken++
  detailAttemptId.value = null
  detail.value = null
  detailError.value = ''
  detailLoading.value = false
}

const optionLabel = (index) => ['A', 'B', 'C', 'D'][index] ?? String(index + 1)

onMounted(load)
</script>

<template>
  <DashboardLayout>
    <div class="space-y-6 max-w-5xl">
      <div class="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <RouterLink :to="{ name: 'course-workspace', query: { id: courseId } }" class="text-xs font-medium text-slate-500 hover:text-indigo-600">
            ← Quay lại khóa học
          </RouterLink>
          <h1 class="text-2xl font-bold text-slate-900 tracking-tight mt-1">
            Kết quả: <MathText v-if="results" :text="results.quiz.title" /><template v-else>Quiz</template>
          </h1>
          <p v-if="results" class="text-xs text-slate-500 mt-1" data-test="quiz-meta">
            {{ results.quiz.totalQuestions ?? '—' }} câu ·
            {{ results.quiz.timeLimitMinutes ? `${results.quiz.timeLimitMinutes} phút` : 'Không giới hạn thời gian' }} ·
            Điểm đạt {{ formatScore(results.quiz.passingScore) }}
          </p>
        </div>
        <button type="button" data-test="reload" class="self-start px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50" @click="load">
          Làm mới
        </button>
      </div>

      <p v-if="loading && !results" class="text-sm text-slate-500">Đang tải kết quả…</p>
      <div v-else-if="loadError" data-test="load-error" role="alert" class="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800">
        {{ loadError }}
      </div>

      <template v-else-if="results">
        <!-- Tổng quan -->
        <dl data-test="summary" class="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div class="rounded-xl bg-white border border-slate-200 p-4">
            <dt class="text-xs text-slate-500">Lượt nộp</dt>
            <dd class="text-xl font-bold text-slate-900" data-test="summary-attempts">{{ results.summary.totalAttempts }}</dd>
          </div>
          <div class="rounded-xl bg-white border border-slate-200 p-4">
            <dt class="text-xs text-slate-500">Sinh viên đã nộp</dt>
            <dd class="text-xl font-bold text-slate-900" data-test="summary-participants">
              {{ results.summary.participants }}<span v-if="results.summary.enrolledStudents !== null" class="text-sm font-medium text-slate-500">/{{ results.summary.enrolledStudents }}</span>
            </dd>
          </div>
          <div class="rounded-xl bg-white border border-slate-200 p-4">
            <dt class="text-xs text-slate-500">Điểm trung bình</dt>
            <dd class="text-xl font-bold text-slate-900" data-test="summary-average">{{ formatScore(results.summary.averageScore) }}</dd>
            <dd class="text-xs text-slate-500">Trung vị {{ formatScore(results.summary.medianScore) }}</dd>
          </div>
          <div class="rounded-xl bg-white border border-slate-200 p-4">
            <dt class="text-xs text-slate-500">Tỉ lệ đạt (lần gần nhất)</dt>
            <dd class="text-xl font-bold text-slate-900" data-test="summary-pass-rate">{{ formatScore(results.summary.passRate) }}</dd>
            <dd class="text-xs text-slate-500" data-test="summary-range">
              Cao nhất {{ formatScore(results.summary.highestScore) }} · Thấp nhất {{ formatScore(results.summary.lowestScore) }}
            </dd>
          </div>
        </dl>

        <p v-if="!results.students.length" data-test="empty" class="p-6 rounded-2xl bg-white border border-slate-200 text-sm text-slate-500 text-center">
          Chưa có sinh viên nào nộp bài.
        </p>

        <template v-else>
          <!-- Phân phối điểm -->
          <section class="rounded-2xl bg-white border border-slate-200 p-6">
            <h2 class="text-base font-bold text-slate-900">Phân phối điểm</h2>
            <p class="text-xs text-slate-500 mb-4">Mọi lượt nộp, theo khoảng điểm (%).</p>
            <ul data-test="distribution" class="flex items-end gap-3 h-40" aria-label="Phân phối điểm theo khoảng">
              <li v-for="bucket in results.distribution" :key="bucket.label" :data-test="`bucket-${bucket.label}`" class="flex-1 h-full flex flex-col justify-end items-center gap-1">
                <span class="text-xs font-semibold text-slate-700">{{ bucket.count }}</span>
                <span
                  class="w-full rounded-t-md bg-indigo-500"
                  :style="{ height: `${(bucket.count / maxBucket) * 100}%`, minHeight: bucket.count ? '4px' : '0' }"
                  aria-hidden="true"
                />
                <span class="text-xs text-slate-500">{{ bucket.label }}</span>
              </li>
            </ul>
          </section>

          <!-- Bảng sinh viên -->
          <section class="rounded-2xl bg-white border border-slate-200 overflow-hidden">
            <div class="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <h2 class="text-base font-bold text-slate-900">Sinh viên</h2>
              <input
                data-test="search"
                type="search"
                :value="query"
                placeholder="Tìm theo tên hoặc email"
                class="w-full sm:w-64 px-3 py-1.5 rounded-lg border border-slate-200 text-sm"
                @input="(e) => (query = e.target.value)"
              >
            </div>
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead class="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th v-for="column in COLUMNS" :key="column.key" class="px-4 py-2 text-left font-semibold">
                      <button type="button" :data-test="`sort-${column.key}`" class="hover:text-slate-800" @click="toggleSort(column.key)">
                        {{ column.label }}<template v-if="sortKey === column.key">{{ sortDirection === 'asc' ? ' ▲' : ' ▼' }}</template>
                      </button>
                    </th>
                    <th class="px-4 py-2 text-left font-semibold">Kết quả</th>
                    <th class="px-4 py-2 text-left font-semibold">Thời gian làm</th>
                    <th class="px-4 py-2" />
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  <template v-for="student in visibleStudents" :key="student.id">
                    <tr data-test="student-row">
                      <td class="px-4 py-2">
                        <p class="font-medium text-slate-900" data-test="student-name">{{ student.name }}</p>
                        <p v-if="student.email" class="text-xs text-slate-500">{{ student.email }}</p>
                      </td>
                      <td class="px-4 py-2">{{ student.attemptsCount }}</td>
                      <td class="px-4 py-2" data-test="student-latest">{{ formatScore(student.latestScore) }}</td>
                      <td class="px-4 py-2" data-test="student-best">{{ formatScore(student.bestScore) }}</td>
                      <td class="px-4 py-2 text-xs text-slate-600">{{ formatDate(student.lastSubmittedAt) }}</td>
                      <td class="px-4 py-2" data-test="student-passed">
                        <span v-if="student.passed === true" class="text-emerald-700 font-medium">Đạt</span>
                        <span v-else-if="student.passed === false" class="text-red-700 font-medium">Chưa đạt</span>
                        <span v-else>—</span>
                      </td>
                      <td class="px-4 py-2 text-xs text-slate-600">{{ formatDuration(student.latestDurationSeconds) }}</td>
                      <td class="px-4 py-2 text-right">
                        <button type="button" :data-test="`toggle-${student.id}`" class="text-xs font-medium text-indigo-600 hover:underline" @click="toggleStudent(student.id)">
                          {{ expandedStudentId === student.id ? 'Ẩn lượt làm' : 'Các lượt làm' }}
                        </button>
                      </td>
                    </tr>
                    <tr v-if="expandedStudentId === student.id" :data-test="`attempts-${student.id}`">
                      <td colspan="8" class="px-4 py-2 bg-slate-50">
                        <ul class="space-y-1 text-xs">
                          <li v-for="attempt in student.attempts" :key="attempt.id" class="flex flex-wrap items-center gap-3">
                            <span class="font-semibold">Lượt {{ attempt.attemptNumber ?? '?' }}</span>
                            <span>{{ formatScore(attempt.score) }}</span>
                            <span>{{ formatDate(attempt.submittedAt) }}</span>
                            <span>{{ formatDuration(attempt.durationSeconds) }}</span>
                            <span v-if="attempt.autoSubmitted" class="text-amber-700">Tự nộp khi hết giờ</span>
                            <button type="button" :data-test="`open-attempt-${attempt.id}`" class="font-medium text-indigo-600 hover:underline" @click="openAttempt(attempt.id)">
                              Xem chi tiết
                            </button>
                          </li>
                        </ul>
                      </td>
                    </tr>
                  </template>
                </tbody>
              </table>
              <p v-if="!visibleStudents.length" data-test="no-match" class="p-4 text-sm text-slate-500">Không có sinh viên khớp tìm kiếm.</p>
            </div>
          </section>

          <!-- Chi tiết một lượt làm -->
          <section v-if="detailAttemptId !== null" data-test="attempt-detail" class="rounded-2xl bg-white border border-slate-200 p-6 space-y-4">
            <div class="flex items-center justify-between gap-3">
              <h2 class="text-base font-bold text-slate-900">
                Chi tiết bài làm<template v-if="detail"> — {{ detail.attempt?.student?.name }} · Lượt {{ detail.attempt?.attempt_number }} · {{ formatScore(detail.attempt?.score) }}</template>
              </h2>
              <button type="button" data-test="close-attempt" class="text-xs font-medium text-slate-500 hover:text-slate-800" @click="closeAttempt">Đóng</button>
            </div>
            <p v-if="detailLoading" class="text-sm text-slate-500">Đang tải chi tiết…</p>
            <p v-else-if="detailError" data-test="detail-error" class="text-sm text-red-700">{{ detailError }}</p>
            <ol v-else-if="detail" class="space-y-4">
              <li v-for="(question, index) in detail.questions" :key="question.id ?? index" :data-test="`detail-question-${index}`" class="rounded-xl border border-slate-200 p-4 space-y-2">
                <p class="text-sm font-semibold text-slate-900">
                  Câu {{ index + 1 }}. <MathText :text="question.question_text" />
                  <span :class="question.is_correct ? 'text-emerald-700' : 'text-red-700'" data-test="detail-verdict">
                    {{ question.is_correct ? '· Đúng' : question.selected_option_id === null ? '· Bỏ trống' : '· Sai' }}
                  </span>
                </p>
                <ul class="space-y-1 text-sm">
                  <li
                    v-for="option in question.options"
                    :key="option.id"
                    :data-test="`detail-option-${option.id}`"
                    :class="option.is_correct ? 'text-emerald-700 font-medium' : option.id === question.selected_option_id ? 'text-red-700' : 'text-slate-700'"
                  >
                    {{ optionLabel(option.option_index) }}. <MathText :text="option.option_text" />
                    <template v-if="option.id === question.selected_option_id"> (đã chọn)</template>
                    <template v-if="option.is_correct"> ✓ đáp án đúng</template>
                  </li>
                </ul>
                <p v-if="question.explanation" class="text-sm text-slate-600"><span class="text-xs font-semibold text-slate-500">Giải thích: </span><MathText :text="question.explanation" /></p>
              </li>
            </ol>
          </section>
        </template>
      </template>
    </div>
  </DashboardLayout>
</template>
