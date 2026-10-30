import { computed, reactive, readonly } from 'vue'
import { learningObjects, LearningObjectsApiError } from '../services/learningObjects.js'

/**
 * Sprint 3 — lõi phiên làm Quiz của sinh viên (S3-H04B2): intro, start/resume và answer state.
 * Không phụ thuộc component: view chỉ đọc `state` và gọi các method; test chạy bằng service giả.
 * Chưa có autosave/timer/submit (B3–B5). editSeq/savedSeq chuẩn bị cho autosave: dirty = editSeq > savedSeq.
 *
 * Phase: idle → loading → intro → starting → in_progress | completed
 *        lỗi: recoverable_error (thử lại thủ công) | fatal_error; dispose() → disposed.
 */

const FATAL_STATUSES = new Set([401, 403, 404, 422])

// Chỉ dùng err.message (câu an toàn của service); không đọc serverMessage hoặc err.data.
function classifyError(err) {
  if (err instanceof TypeError) return { fatal: true, message: 'Đường dẫn Quiz không hợp lệ.' }
  if (err instanceof LearningObjectsApiError) return { fatal: FATAL_STATUSES.has(err.status), message: err.message }
  return { fatal: false, message: 'Đã có lỗi xảy ra. Vui lòng thử lại.' }
}

// Chỉ giữ field sinh viên được phép thấy trước khi nộp (không is_correct/explanation/citations).
function toQuestions(rawQuestions) {
  return rawQuestions
    .filter((question) => Number.isSafeInteger(question?.id) && Array.isArray(question.options))
    .map((question) => ({
      id: question.id,
      index: question.question_index,
      text: question.question_text,
      options: question.options
        .filter((option) => Number.isSafeInteger(option?.id))
        .map((option) => ({ id: option.id, index: option.option_index, text: option.option_text })),
    }))
}

function toQuizInfo(object) {
  return {
    title: object.title,
    description: object.description,
    totalQuestions: object.quiz.total_questions ?? object.total_questions ?? null,
    timeLimitMinutes: object.quiz.time_limit_minutes ?? null,
    passingScore: object.quiz.passing_score ?? null,
  }
}

function toHistory(data) {
  const attempts = Array.isArray(data?.attempts) ? data.attempts : []
  return { completedCount: attempts.length, latestScore: data?.latest_score ?? null, bestScore: data?.best_score ?? null }
}

export function createQuizSession({ courseId, learningObjectId, service = learningObjects }) {
  const state = reactive({
    phase: 'idle',
    quiz: null, // thông tin intro từ show()
    history: null, // { completedCount, latestScore, bestScore } hoặc null nếu không tải được
    historyError: '',
    attempt: null, // { id, attemptNumber, status, startedAt, expiresAt }
    questions: [],
    answers: {}, // question_id → option_id | null
    currentIndex: 0,
    ignoredDraftCount: 0, // số đáp án nháp từ server không khớp câu hỏi/lựa chọn hiện tại
    result: null, // tóm tắt khi start trả bài đã kết thúc
    error: null, // { message, retry: 'intro' | 'start' | null }
    startUncertain: false, // lần start trước lỗi mạng/5xx: server có thể đã tạo attempt
    editSeq: 0,
    savedSeq: 0,
  })

  // Mỗi thao tác mạng mang một generation; response của generation cũ (hoặc sau dispose) bị bỏ qua.
  let generation = 0
  let introRequest = null
  let startRequest = null

  const isCurrent = (token) => token === generation && state.phase !== 'disposed'

  function fail(err, retry) {
    const { fatal, message } = classifyError(err)
    state.phase = fatal ? 'fatal_error' : 'recoverable_error'
    state.error = { message, retry: fatal ? null : retry }
  }

  function loadIntro() {
    if (introRequest) return introRequest
    if (state.phase !== 'idle' && !(state.phase === 'recoverable_error' && state.error?.retry === 'intro')) {
      return Promise.resolve(false)
    }
    const token = ++generation
    state.phase = 'loading'
    state.error = null
    introRequest = (async () => {
      try {
        // Lịch sử là thông tin phụ: lỗi lịch sử không chặn việc xem và bắt đầu Quiz.
        const [detail, history] = await Promise.all([
          service.show(courseId, learningObjectId),
          service.attemptHistory(courseId, learningObjectId).then(
            (data) => ({ data }),
            (err) => ({ err }),
          ),
        ])
        if (!isCurrent(token)) return false
        const object = detail?.learning_object
        if (object?.type !== 'quiz' || !object.quiz) {
          state.phase = 'fatal_error'
          state.error = { message: 'Không tìm thấy bài kiểm tra hoặc bài làm.', retry: null }
          return false
        }
        state.quiz = toQuizInfo(object)
        state.history = history.data ? toHistory(history.data) : null
        state.historyError = history.err ? 'Không tải được lịch sử làm bài.' : ''
        state.phase = 'intro'
        return true
      } catch (err) {
        if (!isCurrent(token)) return false
        fail(err, 'intro')
        return false
      } finally {
        if (token === generation) introRequest = null
      }
    })()
    return introRequest
  }

  function applyAttempt(data) {
    const questions = toQuestions(Array.isArray(data?.quiz?.questions) ? data.quiz.questions : [])
    const attempt = data?.attempt
    // Chỉ hai trạng thái đã biết; status lạ hoặc thiếu không được âm thầm coi là đang làm bài.
    const knownStatus = attempt?.status === 'in_progress' || attempt?.status === 'completed'
    if (!attempt || !Number.isSafeInteger(attempt.id) || !knownStatus || questions.length === 0) {
      state.phase = 'fatal_error'
      state.error = { message: 'Dữ liệu bài làm không hợp lệ.', retry: null }
      return false
    }
    state.attempt = {
      id: attempt.id,
      attemptNumber: attempt.attempt_number ?? null,
      status: attempt.status,
      startedAt: attempt.started_at ?? null,
      expiresAt: attempt.expires_at ?? null,
    }
    state.questions = questions
    state.currentIndex = 0
    state.startUncertain = false

    if (attempt.status === 'completed') {
      // Bài đã kết thúc: không mở input, chỉ giữ tóm tắt điểm nếu server trả về.
      state.result = { score: attempt.score ?? null, totalCorrect: attempt.total_correct ?? null, timedOut: data?.timed_out === true }
      state.answers = {}
      state.phase = 'completed'
      return true
    }

    const answers = Object.fromEntries(questions.map((question) => [question.id, null]))
    let ignored = 0
    for (const draft of Array.isArray(attempt.draft_answers) ? attempt.draft_answers : []) {
      const question = questions.find((q) => q.id === draft?.question_id)
      const optionId = draft?.selected_option_id ?? null
      if (!question || (optionId !== null && !question.options.some((option) => option.id === optionId))) {
        ignored++
        continue
      }
      answers[question.id] = optionId
    }
    state.answers = answers
    state.ignoredDraftCount = ignored
    // Draft vừa nhận từ server được coi là đã lưu.
    state.editSeq = 0
    state.savedSeq = 0
    state.phase = 'in_progress'
    return true
  }

  // Chỉ gọi khi sinh viên bấm nút; không tự retry. Bấm lặp lại khi đang chờ dùng chung request đang chạy.
  function start() {
    if (startRequest) return startRequest
    const canStart = state.phase === 'intro' || (state.phase === 'recoverable_error' && state.error?.retry === 'start')
    if (!canStart) return Promise.resolve(false)
    const token = ++generation
    state.phase = 'starting'
    state.error = null
    startRequest = (async () => {
      try {
        const data = await service.startAttempt(courseId, learningObjectId)
        if (!isCurrent(token)) return false
        return applyAttempt(data)
      } catch (err) {
        if (!isCurrent(token)) return false
        fail(err, 'start')
        // Lỗi không có response hợp lệ (mạng, timeout, 5xx): server có thể đã tạo attempt.
        state.startUncertain = state.phase === 'recoverable_error'
        return false
      } finally {
        if (token === generation) startRequest = null
      }
    })()
    return startRequest
  }

  function findOption(questionId, optionId) {
    const question = state.questions.find((q) => q.id === questionId)
    return question && question.options.some((option) => option.id === optionId) ? question : null
  }

  // Không dùng `in`: toán tử này khớp cả key của prototype ('toString', '__proto__') và id dạng chuỗi.
  const isQuestionId = (questionId) =>
    Number.isSafeInteger(questionId) && questionId > 0 && Object.hasOwn(state.answers, questionId)

  function setAnswer(questionId, optionId) {
    if (state.phase !== 'in_progress' || !isQuestionId(questionId)) return false
    if (optionId !== null && !findOption(questionId, optionId)) return false
    if (state.answers[questionId] !== optionId) {
      state.answers[questionId] = optionId
      state.editSeq++
    }
    return true
  }

  function goTo(index) {
    if (state.phase !== 'in_progress' || !Number.isInteger(index) || index < 0 || index >= state.questions.length) return false
    state.currentIndex = index
    return true
  }

  // Bản nháp đầy đủ theo thứ tự câu hỏi, câu chưa chọn là null (cùng payload với saveDraft/submit).
  function snapshot() {
    return {
      answers: state.questions.map((question) => ({
        question_id: question.id,
        selected_option_id: state.answers[question.id] ?? null,
      })),
    }
  }

  function dispose() {
    generation++
    introRequest = null
    startRequest = null
    state.phase = 'disposed'
  }

  const answeredCount = computed(() => Object.values(state.answers).filter((value) => value !== null).length)
  const dirty = computed(() => state.editSeq > state.savedSeq)

  return {
    state: readonly(state),
    answeredCount,
    dirty,
    loadIntro,
    start,
    selectAnswer: (questionId, optionId) => (optionId === null ? false : setAnswer(questionId, optionId)),
    clearAnswer: (questionId) => setAnswer(questionId, null),
    goTo,
    snapshot,
    dispose,
  }
}
