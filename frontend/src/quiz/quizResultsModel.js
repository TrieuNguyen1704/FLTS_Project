/**
 * Mô hình thuần cho màn Kết quả Quiz của Giảng viên (FAST-06), không phụ thuộc Vue.
 * Contract: LecturerQuizResultController@index (backend/app/Http/Controllers/LecturerQuizResultController.php:13-50).
 * - Chỉ attempt completed; điểm thang 0–100 (QuizAttemptController:161, decimal 5,2).
 * - students[].attempts sắp theo submitted_at mới nhất trước; latest = attempts[0].
 * - Backend tính pass_rate theo điểm LẦN GẦN NHẤT của mỗi sinh viên ≥ passing_score; FE dùng cùng quy tắc.
 * Điểm thấp nhất, trung vị và phân phối điểm tính từ các attempt có sẵn trong cùng response (không gọi thêm API).
 */

export const SCORE_BUCKETS = [
  { label: '0–19', min: 0, max: 20 },
  { label: '20–39', min: 20, max: 40 },
  { label: '40–59', min: 40, max: 60 },
  { label: '60–79', min: 60, max: 80 },
  { label: '80–100', min: 80, max: Infinity },
]

const toNumber = (value) => (value === null || value === undefined || value === '' ? null : Number(value))

function normalizeAttempt(attempt) {
  return {
    id: attempt.id,
    attemptNumber: attempt.attempt_number ?? null,
    score: toNumber(attempt.score),
    totalCorrect: attempt.total_correct ?? null,
    startedAt: attempt.started_at ?? null,
    submittedAt: attempt.submitted_at ?? null,
    autoSubmitted: attempt.auto_submitted === true,
    durationSeconds: toNumber(attempt.duration_seconds),
  }
}

export function median(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const value = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
  return Math.round(value * 100) / 100
}

/** Gom điểm (0–100) vào SCORE_BUCKETS; 60 thuộc nhóm 60–79, 100 thuộc nhóm 80–100. */
export function bucketScores(scores) {
  const buckets = SCORE_BUCKETS.map((bucket) => ({ label: bucket.label, count: 0 }))
  for (const score of scores) {
    if (typeof score !== 'number' || Number.isNaN(score)) continue
    const index = SCORE_BUCKETS.findIndex((bucket) => score >= bucket.min && score < bucket.max)
    if (index !== -1) buckets[index].count++
  }
  return buckets
}

/** response GET quiz-results → dữ liệu hiển thị. */
export function normalizeResults(data) {
  const quiz = {
    learningObjectId: data?.quiz?.learning_object_id ?? null,
    title: data?.quiz?.title ?? '',
    passingScore: toNumber(data?.quiz?.passing_score),
    totalQuestions: data?.quiz?.total_questions ?? null,
    timeLimitMinutes: data?.quiz?.time_limit_minutes ?? null,
  }
  const students = (data?.students ?? []).map((row) => {
    const attempts = (row.attempts ?? []).map(normalizeAttempt)
    const latestScore = toNumber(row.latest_score)
    return {
      id: row.student?.id ?? null,
      name: row.student?.name ?? 'Sinh viên',
      email: row.student?.email ?? null,
      attemptsCount: row.attempts_count ?? attempts.length,
      latestScore,
      bestScore: toNumber(row.best_score),
      lastSubmittedAt: row.last_submitted_at ?? null,
      passed: latestScore !== null && quiz.passingScore !== null ? latestScore >= quiz.passingScore : null,
      latestDurationSeconds: attempts[0]?.durationSeconds ?? null,
      attempts,
    }
  })
  const scores = students.flatMap((student) => student.attempts.map((attempt) => attempt.score)).filter((s) => s !== null)
  const summary = data?.summary ?? {}
  return {
    quiz,
    summary: {
      enrolledStudents: summary.enrolled_students ?? null,
      participants: summary.participants ?? students.length,
      totalAttempts: summary.total_attempts ?? scores.length,
      averageScore: toNumber(summary.average_score),
      highestScore: toNumber(summary.highest_score),
      lowestScore: scores.length ? Math.min(...scores) : null,
      medianScore: median(scores),
      passRate: toNumber(summary.pass_rate),
    },
    distribution: bucketScores(scores),
    students,
  }
}

export function formatScore(score) {
  if (score === null || score === undefined) return '—'
  return `${Number.isInteger(score) ? score : score.toFixed(2).replace(/\.?0+$/, '')}%`
}

export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds) || seconds < 0) return '—'
  const total = Math.round(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = total % 60
  if (hours) return `${hours} giờ ${minutes} phút`
  if (minutes) return rest ? `${minutes} phút ${rest} giây` : `${minutes} phút`
  return `${rest} giây`
}

// So khớp tên không phân biệt hoa/thường và dấu tiếng Việt ("Hưng" khớp "hung").
const fold = (text) => String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase()

export function filterStudents(students, query) {
  const needle = fold(query).trim()
  if (!needle) return students
  return students.filter((student) => fold(student.name).includes(needle) || fold(student.email).includes(needle))
}

export const SORT_KEYS = ['name', 'attemptsCount', 'latestScore', 'bestScore', 'lastSubmittedAt']

/** Sắp xếp không đổi mảng gốc; giá trị null luôn ở cuối. */
export function sortStudents(students, key, direction = 'asc') {
  const sign = direction === 'desc' ? -1 : 1
  return [...students].sort((a, b) => {
    const left = a[key]
    const right = b[key]
    if (left === null || left === undefined) return right === null || right === undefined ? 0 : 1
    if (right === null || right === undefined) return -1
    if (key === 'name') return sign * fold(left).localeCompare(fold(right))
    if (key === 'lastSubmittedAt') return sign * (Date.parse(left) - Date.parse(right))
    return sign * (left - right)
  })
}
