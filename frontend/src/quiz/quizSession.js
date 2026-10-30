import { computed, reactive, readonly } from 'vue'
import { learningObjects, LearningObjectsApiError } from '../services/learningObjects.js'
import { createServerClock } from './quizClock.js'

/**
 * Sprint 3 — lõi phiên làm Quiz của sinh viên: intro, start/resume, answer state (B2), autosave (B3),
 * đồng hồ theo giờ server, hết hạn, nộp bài và xác minh kết quả (FAST-02).
 * Không phụ thuộc component: view chỉ đọc `state` và gọi các method; test chạy bằng service/scheduler/clock giả.
 *
 * Phase: idle → loading → intro → starting → in_progress
 *        in_progress → submitting (sinh viên nộp) | expiring (đồng hồ về 0) → completed (có chi tiết từng câu)
 *        submitting/expiring → verifying (kết quả chưa rõ) → completed_summary (điểm từ lịch sử) | in_progress
 *        lỗi: recoverable_error (thử lại thủ công) | fatal_error; dispose() → disposed.
 * Không bao giờ gọi startAttempt để xác minh: start khi bài cũ đã hết hạn sẽ tạo lượt làm mới.
 *
 * Kênh lưu (state.save) độc lập với phase: idle | saving | saved | retrying | stopped.
 * dirty = editSeq > savedSeq; savedSeq chỉ tăng tới seq của snapshot được server xác nhận.
 * Không có draft_version ở backend: single-flight chỉ bảo đảm phía client, một PATCH đã timeout
 * vẫn có thể được server ghi sau đó; cooldown chỉ giảm chứ không loại bỏ khả năng ghi đè.
 */

export const AUTOSAVE_INTERVAL_MS = 15000
export const SAVE_TIMEOUT_MS = 20000
export const SUBMIT_TIMEOUT_MS = 30000
// Submit chờ PATCH đang chạy tối đa hơn timeout của PATCH một chút; hết hạn chờ thì chuyển sang xác minh.
export const SUBMIT_WAIT_MS = SAVE_TIMEOUT_MS + 5000
export const TIMER_TICK_MS = 1000
export const TIMER_WARNING_MS = 60000
// Còn dưới mốc này mà có thay đổi chưa lưu thì lưu ngay một lần: sau hạn server chỉ chấm draft đã lưu.
export const FINAL_SAVE_MS = 20000
const MAX_SAVE_FAILURES = 3
// PATCH được phép cập nhật state trong các phase này (kể cả khi đang nộp, để biết server đã kết thúc bài).
const SAVE_PHASES = new Set(['in_progress', 'submitting', 'expiring'])

const FATAL_STATUSES = new Set([401, 403, 404, 422])

const defaultScheduler = {
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: (id) => globalThis.clearInterval(id),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id),
}

// Câu an toàn cho từng lý do dừng autosave; không dùng serverMessage hay err.data.
const STOP_MESSAGES = {
  network: 'Không kết nối được máy chủ sau nhiều lần thử. Các thay đổi gần nhất chưa được lưu.',
  invalid_data: 'Dữ liệu bài làm không hợp lệ nên chưa thể lưu. Hãy tải lại trang.',
  needs_verification: 'Không thể lưu bài làm và cần kiểm tra lại trạng thái bài. Các lựa chọn đã được khóa.',
  conflict: 'Bài làm đã thay đổi trên máy chủ. Tự động lưu đã dừng để không ghi đè dữ liệu.',
  invalid_response: 'Phản hồi lưu bài không hợp lệ. Tự động lưu đã dừng.',
  unauthorized: 'Phiên đăng nhập đã hết hạn.',
  client_error: 'Không thể lưu bài làm. Hãy tải lại trang.',
}
// Lý do dừng khiến dữ liệu trên server không còn tin cậy được: khóa chỉnh sửa, giữ answers trong bộ nhớ.
const LOCKING_REASONS = new Set(['needs_verification', 'conflict'])

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

const validTime = (value) => (typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null)
const numberOrNull = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

// Kết quả API trả khi bài kết thúc (start/PATCH): chỉ giữ field đã biết, không suy đoán thêm.
function toResult(data) {
  const attempt = data?.attempt ?? {}
  return {
    score: numberOrNull(attempt.score),
    totalCorrect: numberOrNull(attempt.total_correct),
    autoSubmitted: attempt.auto_submitted === true,
    timedOut: data?.timed_out === true,
    latestScore: numberOrNull(data?.latest_score),
    bestScore: numberOrNull(data?.best_score),
    results: Array.isArray(data?.results)
      ? data.results.map((item) => ({
          questionId: item?.question_id,
          selectedOptionId: item?.selected_option_id ?? null,
          correctOptionId: item?.correct_option_id ?? null,
          isCorrect: item?.is_correct === true,
          explanation: typeof item?.explanation === 'string' ? item.explanation : '',
          citations: Array.isArray(item?.citations)
            ? item.citations.map((citation) => ({ documentName: citation?.document_name ?? null, sourceLocator: citation?.source_locator ?? null }))
            : [],
        }))
      : [],
  }
}

// Tóm tắt từ lịch sử (sau khi xác minh): không có chi tiết từng câu, không suy đoán lý do kết thúc.
function toSummary(attempt, history) {
  return {
    score: numberOrNull(attempt.score),
    totalCorrect: numberOrNull(attempt.total_correct),
    autoSubmitted: attempt.auto_submitted === true,
    timedOut: null,
    latestScore: numberOrNull(history?.latest_score),
    bestScore: numberOrNull(history?.best_score),
    submittedAt: validTime(attempt.submitted_at),
    results: [],
  }
}

export function createQuizSession({
  courseId,
  learningObjectId,
  service = learningObjects,
  scheduler = defaultScheduler,
  autosaveIntervalMs = AUTOSAVE_INTERVAL_MS,
  saveTimeoutMs = SAVE_TIMEOUT_MS,
  submitTimeoutMs = SUBMIT_TIMEOUT_MS,
  now = () => Date.now(),
}) {
  const clock = createServerClock(now)
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
    result: null, // kết quả API trả khi bài kết thúc (start hoặc autosave)
    error: null, // { message, retry: 'intro' | 'start' | null }
    startUncertain: false, // lần start trước lỗi mạng/5xx: server có thể đã tạo attempt
    editSeq: 0,
    savedSeq: 0,
    save: { status: 'idle', failures: 0, lastSavedAt: null, reason: null, message: '' },
    timer: null, // { remainingMs, warning } khi có hạn nộp; null nếu không giới hạn thời gian
    verification: null, // { status: 'checking' | 'failed' | 'not_found', canResume }
  })

  // Mỗi thao tác mạng mang một generation; response của generation cũ (hoặc sau dispose) bị bỏ qua.
  let generation = 0
  let introRequest = null
  let startRequest = null
  let saveRequest = null
  let timer = null
  let skipTicks = 0
  let autosaveEnabled = true
  let ticker = null
  let finalSaveTriggered = false
  let submitRequest = null
  let verifyRequest = null
  const waiters = new Set() // awaitPendingSave đang chờ: dọn khi dispose

  const isCurrent = (token) => token === generation && state.phase !== 'disposed'

  function fail(err, retry) {
    const { fatal, message } = classifyError(err)
    state.phase = fatal ? 'fatal_error' : 'recoverable_error'
    state.error = { message, retry: fatal ? null : retry }
  }

  // ---------- Intro ----------

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

  // ---------- Start / resume ----------

  function finishWith(data) {
    stopScheduler()
    stopTicker()
    state.result = toResult(data)
    state.phase = 'completed'
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
      // Bài đã kết thúc: không mở input, chỉ giữ kết quả server trả về.
      state.answers = {}
      finishWith(data)
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
    state.save = { status: 'idle', failures: 0, lastSavedAt: null, reason: null, message: '' }
    state.verification = null
    state.phase = 'in_progress'
    startScheduler()
    startTicker()
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
        const sentAt = now()
        const data = await service.startAttempt(courseId, learningObjectId)
        if (!isCurrent(token)) return false
        clock.sync(data?.server_time, sentAt, now())
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

  // ---------- Answers ----------

  const canEdit = computed(() => state.phase === 'in_progress' && !LOCKING_REASONS.has(state.save.reason))

  function findOption(questionId, optionId) {
    const question = state.questions.find((q) => q.id === questionId)
    return question && question.options.some((option) => option.id === optionId) ? question : null
  }

  // Không dùng `in`: toán tử này khớp cả key của prototype ('toString', '__proto__') và id dạng chuỗi.
  const isQuestionId = (questionId) =>
    Number.isSafeInteger(questionId) && questionId > 0 && Object.hasOwn(state.answers, questionId)

  function setAnswer(questionId, optionId) {
    if (!canEdit.value || !isQuestionId(questionId)) return false
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

  // ---------- Autosave ----------

  const dirty = computed(() => state.editSeq > state.savedSeq)

  function startScheduler() {
    if (timer === null && autosaveEnabled && state.phase === 'in_progress') {
      timer = scheduler.setInterval(tick, autosaveIntervalMs)
    }
  }

  function stopScheduler() {
    if (timer !== null) {
      scheduler.clearInterval(timer)
      timer = null
    }
  }

  function stopSaving(reason) {
    stopScheduler()
    state.save.status = 'stopped'
    state.save.reason = reason
    state.save.message = STOP_MESSAGES[reason]
  }

  function tick() {
    if (state.phase !== 'in_progress' || !autosaveEnabled) return stopScheduler()
    if (skipTicks > 0) {
      skipTicks--
      return
    }
    if (state.save.status === 'stopped' || saveRequest || !dirty.value) return
    flush()
  }

  function handleSaveError(err) {
    if (err?.canceled === true) {
      // Bị hủy: không phải lưu thành công, không tính là lỗi; tick sau sẽ thử lại nếu còn dirty.
      state.save.status = 'idle'
      return false
    }
    if (!(err instanceof LearningObjectsApiError)) {
      stopSaving('client_error')
      return false
    }
    if (err.status === 403 || err.status === 404) {
      stopScheduler()
      state.save.status = 'stopped'
      state.phase = 'fatal_error'
      state.error = { message: err.message, retry: null }
      return false
    }
    if (err.status === 401) {
      stopSaving('unauthorized') // interceptor hiện có tự chuyển tới /login
      return false
    }
    if (err.status === 422) {
      // 422 không đồng nghĩa đã nộp: có errors là lỗi dữ liệu, không có thì cần xác minh trạng thái bài.
      stopSaving(Object.keys(err.errors ?? {}).length > 0 ? 'invalid_data' : 'needs_verification')
      return false
    }
    if (err.status === 409) {
      stopSaving('conflict')
      return false
    }
    // 5xx, ERR_NETWORK, ECONNABORTED: chưa xác định server đã ghi hay chưa; giữ dirty và thử lại có giới hạn.
    if (err.code === 'ECONNABORTED') skipTicks = 1
    state.save.failures++
    if (state.save.failures >= MAX_SAVE_FAILURES) {
      stopSaving('network')
    } else {
      state.save.status = 'retrying'
      state.save.reason = null
      state.save.message = ''
    }
    return false
  }

  function flush() {
    if (saveRequest) return saveRequest
    if (!canEdit.value || !autosaveEnabled || !dirty.value) return Promise.resolve(false)
    const token = generation
    const attemptId = state.attempt.id
    const seq = state.editSeq
    const payload = snapshot()
    state.save.status = 'saving'
    saveRequest = (async () => {
      try {
        const sentAt = now()
        const data = await service.saveDraft(courseId, learningObjectId, attemptId, payload, { timeout: saveTimeoutMs })
        if (!isCurrent(token) || !SAVE_PHASES.has(state.phase) || state.attempt?.id !== attemptId) return false
        clock.sync(data?.server_time, sentAt, now())
        if (data?.attempt?.id !== attemptId) {
          stopSaving('invalid_response')
          return false
        }
        if (data.timed_out === true || data.attempt.status === 'completed') {
          // Server đã kết thúc bài (vd. hết giờ): khóa chỉnh sửa, giữ kết quả server trả về.
          finishWith(data)
          return false
        }
        if (data.attempt.status !== 'in_progress') {
          stopSaving('invalid_response')
          return false
        }
        state.savedSeq = Math.max(state.savedSeq, seq)
        state.save.failures = 0
        state.save.lastSavedAt = validTime(data.server_time)
        state.save.status = 'saved'
        state.save.reason = null
        state.save.message = ''
        return true
      } catch (err) {
        if (!isCurrent(token) || !SAVE_PHASES.has(state.phase)) return false
        return handleSaveError(err)
      } finally {
        if (token === generation) saveRequest = null
      }
    })()
    return saveRequest
  }

  // Nút "Lưu ngay": chỉ khi lỗi recoverable (đang retrying, hoặc đã dừng vì mạng). Không áp dụng cho 422/409.
  function saveNow() {
    if (!autosaveEnabled) return Promise.resolve(false) // đã dừng cho submit hoặc đã dispose
    if (saveRequest) return saveRequest // bấm lặp lại khi đang lưu dùng chung request
    if (!canEdit.value) return Promise.resolve(false)
    const recoverable = state.save.status === 'retrying' || (state.save.status === 'stopped' && state.save.reason === 'network')
    if (!recoverable) return Promise.resolve(false)
    state.save.failures = 0
    state.save.reason = null
    state.save.message = ''
    skipTicks = 0
    startScheduler()
    return flush()
  }

  // Cho B5 (submit): dừng lập lịch, không cho PATCH mới bắt đầu; PATCH đang chạy (nếu có) vẫn được xử lý.
  function stopAutosave() {
    autosaveEnabled = false
    stopScheduler()
  }

  // Chờ PATCH đang chạy với giới hạn thời gian; true nếu không còn PATCH nào, false nếu hết hạn chờ hoặc dispose.
  function awaitPendingSave(maxWaitMs = saveTimeoutMs + 5000) {
    if (!saveRequest) return Promise.resolve(true)
    const pending = saveRequest
    return new Promise((resolve) => {
      const waiter = { resolve, id: null }
      const done = (value) => {
        if (!waiters.delete(waiter)) return
        scheduler.clearTimeout(waiter.id)
        resolve(value)
      }
      waiter.resolve = done
      waiter.id = scheduler.setTimeout(() => done(false), maxWaitMs)
      waiters.add(waiter)
      pending.then(() => done(true), () => done(true))
    })
  }

  // ---------- Đồng hồ (ước lượng theo giờ server; backend quyết định hạn nộp thật) ----------

  function startTicker() {
    if (ticker !== null || state.phase !== 'in_progress') return
    if (!updateTimer() || state.phase !== 'in_progress') return
    ticker = scheduler.setInterval(updateTimer, TIMER_TICK_MS)
  }

  function stopTicker() {
    if (ticker !== null) {
      scheduler.clearInterval(ticker)
      ticker = null
    }
  }

  // Tính lại thời gian còn lại từ mốc expires_at; gọi được bất cứ lúc nào (tick, tab hiện lại).
  // Trả false nếu không có hạn nộp hoặc không còn ở in_progress.
  function updateTimer() {
    if (state.phase !== 'in_progress') {
      stopTicker()
      return false
    }
    const remaining = clock.remainingMs(state.attempt?.expiresAt)
    if (remaining === null) {
      state.timer = null
      stopTicker()
      return false
    }
    state.timer = { remainingMs: Math.max(0, remaining), warning: remaining <= TIMER_WARNING_MS }
    if (remaining <= 0) {
      expire()
      return true
    }
    if (remaining <= FINAL_SAVE_MS && !finalSaveTriggered && dirty.value && !saveRequest) {
      finalSaveTriggered = true
      flush()
    }
    return true
  }

  // Đồng hồ client về 0: khóa chỉnh sửa và kết thúc bài qua cùng luồng với nộp bài.
  // Không báo thành công ở đây; chỉ response của server (hoặc lịch sử) mới xác nhận bài đã kết thúc.
  function expire() {
    if (state.phase !== 'in_progress') return
    stopTicker()
    state.phase = 'expiring'
    finalize()
  }

  // ---------- Nộp bài ----------

  const canSubmit = computed(() => state.phase === 'in_progress' && !LOCKING_REASONS.has(state.save.reason))

  // Sinh viên đã xác nhận nộp. Bấm lặp lại dùng chung request; không tự retry POST.
  function submit() {
    if (submitRequest) return submitRequest
    if (!canSubmit.value) return Promise.resolve(false)
    stopTicker()
    state.phase = 'submitting'
    return finalize()
  }

  // Dừng autosave, chờ PATCH đang chạy (có giới hạn), rồi gửi đúng một POST submit với snapshot mới nhất.
  function finalize() {
    stopAutosave()
    const token = generation
    const attemptId = state.attempt.id
    submitRequest = (async () => {
      try {
        const settled = await awaitPendingSave(SUBMIT_WAIT_MS)
        if (!isCurrent(token)) return false
        // PATCH đang chạy có thể đã kết thúc bài (timed_out/completed) hoặc gặp lỗi fatal: không POST nữa.
        if (state.phase !== 'submitting' && state.phase !== 'expiring') return state.phase === 'completed'
        // PATCH vẫn chưa xong: không kiểm soát được thứ tự request, chuyển sang xác minh thay vì POST.
        if (!settled) return await runVerification()
        let data
        try {
          data = await service.submitAttempt(courseId, learningObjectId, attemptId, snapshot(), { timeout: submitTimeoutMs })
        } catch (err) {
          if (!isCurrent(token)) return false
          if (err instanceof LearningObjectsApiError && [401, 403, 404].includes(err.status)) {
            state.phase = 'fatal_error'
            state.error = { message: err.message, retry: null }
            return false
          }
          // Timeout, mạng, 5xx, 409, 422 (đã nộp hoặc dữ liệu không hợp lệ): kết quả chưa rõ, xác minh qua lịch sử.
          return await runVerification()
        }
        if (!isCurrent(token)) return false
        if (data?.attempt?.id !== attemptId || data.attempt.status !== 'completed') return await runVerification()
        finishWith(data)
        return true
      } finally {
        if (token === generation) submitRequest = null
      }
    })()
    return submitRequest
  }

  // ---------- Xác minh qua lịch sử (GET; FLTS có thể tự kết thúc bài đã hết hạn khi được gọi) ----------

  function runVerification() {
    if (verifyRequest) return verifyRequest
    if (!state.attempt) return Promise.resolve(false)
    stopAutosave()
    stopTicker()
    const token = generation
    const attemptId = state.attempt.id
    state.phase = 'verifying'
    state.verification = { status: 'checking', canResume: false }
    verifyRequest = (async () => {
      try {
        const data = await service.attemptHistory(courseId, learningObjectId)
        if (!isCurrent(token) || state.phase !== 'verifying') return false
        const found = (Array.isArray(data?.attempts) ? data.attempts : []).find((attempt) => attempt?.id === attemptId)
        if (found && found.status === 'completed') {
          state.result = toSummary(found, data)
          state.phase = 'completed_summary'
          state.verification = null
          return true
        }
        // Chưa thấy bài trong lịch sử: không kết luận nộp thất bại; chỉ cho làm tiếp nếu còn hạn.
        const remaining = clock.remainingMs(state.attempt.expiresAt)
        state.verification = { status: 'not_found', canResume: remaining === null || remaining > 0 }
        return false
      } catch (err) {
        if (!isCurrent(token) || state.phase !== 'verifying') return false
        if (err instanceof LearningObjectsApiError && [401, 403, 404].includes(err.status)) {
          state.phase = 'fatal_error'
          state.error = { message: err.message, retry: null }
          return false
        }
        state.verification = { status: 'failed', canResume: false }
        return false
      } finally {
        if (token === generation) verifyRequest = null
      }
    })()
    return verifyRequest
  }

  // Nút "Kiểm tra lại" / "Kiểm tra trạng thái bài": chỉ khi đang xác minh hoặc autosave bị khóa chờ xác minh.
  function verifyAttempt() {
    if (verifyRequest) return verifyRequest
    const lockedForVerification = state.phase === 'in_progress' && LOCKING_REASONS.has(state.save.reason)
    const retrying = state.phase === 'verifying' && state.verification?.status !== 'checking'
    if (!lockedForVerification && !retrying) return Promise.resolve(false)
    return runVerification()
  }

  // Sau khi đã giải thích trạng thái chưa rõ, sinh viên có thể làm tiếp (chỉ khi còn hạn).
  function resumeAfterVerification() {
    if (state.phase !== 'verifying' || state.verification?.status !== 'not_found') return false
    const remaining = clock.remainingMs(state.attempt?.expiresAt)
    if (remaining !== null && remaining <= 0) {
      state.verification = { status: 'not_found', canResume: false }
      return false
    }
    state.verification = null
    state.save.status = 'idle'
    state.save.failures = 0
    state.save.reason = null
    state.save.message = ''
    skipTicks = 0
    finalSaveTriggered = false
    autosaveEnabled = true
    state.phase = 'in_progress'
    startScheduler()
    startTicker()
    return true
  }

  function dispose() {
    generation++
    stopScheduler()
    stopTicker()
    autosaveEnabled = false
    introRequest = null
    startRequest = null
    saveRequest = null
    submitRequest = null
    verifyRequest = null
    for (const waiter of [...waiters]) waiter.resolve(false)
    state.phase = 'disposed'
  }

  const answeredCount = computed(() => Object.values(state.answers).filter((value) => value !== null).length)

  return {
    state: readonly(state),
    answeredCount,
    dirty,
    canEdit,
    canSubmit,
    hasPendingSave: () => saveRequest !== null,
    loadIntro,
    start,
    selectAnswer: (questionId, optionId) => (optionId === null ? false : setAnswer(questionId, optionId)),
    clearAnswer: (questionId) => setAnswer(questionId, null),
    goTo,
    snapshot,
    saveNow,
    stopAutosave,
    awaitPendingSave,
    submit,
    verifyAttempt,
    resumeAfterVerification,
    refreshTimer: () => {
      updateTimer()
    },
    dispose,
  }
}
