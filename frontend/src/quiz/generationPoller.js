/**
 * Theo dõi tiến độ tạo Quiz bằng AI (FAST-04B). Không phụ thuộc Vue: caller truyền fetchFn và clock.
 * Contract FLTS (FAST-04A): không có endpoint riêng cho generation run; GET learning object trả
 * learning_object.generation = { status: queued | generating | completed | failed, error_code, error_message, ... }.
 *
 * Trạng thái của poller (state.status):
 * - 'idle'      chưa start
 * - 'polling'   đang chờ (generation.status là queued/generating hoặc chưa đọc được)
 * - 'completed' | 'failed'  kết quả cuối từ backend
 * - 'timeout'   quá thời gian chờ phía client; KHÔNG có nghĩa job thất bại (worker có thể chưa chạy)
 * - 'error'     không đọc được tiến độ: 403/404, hoặc nhiều lỗi mạng liên tiếp
 * - 'stopped'   caller gọi stop()
 */

export const POLL_FAST_INTERVAL_MS = 2000
export const POLL_SLOW_INTERVAL_MS = 5000
export const POLL_FAST_PHASE_MS = 30000
export const POLL_TIMEOUT_MS = 240000
export const MAX_CONSECUTIVE_ERRORS = 3

export const POLL_TIMEOUT_MESSAGE = 'Quá thời gian chờ. Có thể worker xử lý nền chưa chạy; kiểm tra lại sau.'
export const POLL_ERROR_MESSAGE = 'Không đọc được tiến độ tạo Quiz do lỗi kết nối.'
const FATAL_MESSAGES = {
  401: 'Phiên đăng nhập đã hết hạn.',
  403: 'Bạn không có quyền xem học liệu này.',
  404: 'Không tìm thấy học liệu đang được tạo.',
}

const defaultClock = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id),
  now: () => Date.now(),
}

/**
 * @param {object} options
 * @param {() => Promise<object>} options.fetchFn  trả response.data của GET learning object ({ learning_object })
 * @param {(state: object) => void} [options.onChange]  gọi mỗi khi state đổi
 * @param {{ setTimeout, clearTimeout, now }} [options.clock]
 */
export function createGenerationPoller({ fetchFn, onChange = () => {}, clock = defaultClock } = {}) {
  if (typeof fetchFn !== 'function') throw new TypeError('fetchFn phải là hàm.')

  const state = {
    status: 'idle',
    generationStatus: null,
    learningObject: null,
    errorMessage: null,
    consecutiveErrors: 0,
  }
  let timer = null
  let startedAt = 0
  let inFlight = false
  // Tăng mỗi lần start/stop: response về muộn của vòng cũ bị bỏ qua.
  let session = 0

  const snapshot = () => ({ ...state })
  const emit = () => onChange(snapshot())

  function clearTimer() {
    if (timer !== null) clock.clearTimeout(timer)
    timer = null
  }

  function finish(status, errorMessage = null) {
    clearTimer()
    state.status = status
    state.errorMessage = errorMessage
    emit()
  }

  function scheduleNext(current) {
    const elapsed = clock.now() - startedAt
    const remaining = POLL_TIMEOUT_MS - elapsed
    if (remaining <= 0) return finish('timeout', POLL_TIMEOUT_MESSAGE)
    const interval = elapsed < POLL_FAST_PHASE_MS ? POLL_FAST_INTERVAL_MS : POLL_SLOW_INTERVAL_MS
    // Lần kiểm tra cuối rơi đúng mốc timeout để không bỏ lỡ kết quả vừa xong.
    timer = clock.setTimeout(() => tick(current), Math.min(interval, remaining))
  }

  async function tick(current) {
    timer = null
    if (current !== session) return
    // Single-flight: request của vòng trước (vd. stop() rồi start() ngay) chưa xong thì hẹn lượt sau.
    if (inFlight) return scheduleNext(current)
    inFlight = true
    let data
    let failure = null
    try {
      data = await fetchFn()
    } catch (err) {
      failure = err
    } finally {
      inFlight = false
    }
    if (current !== session) return

    if (failure) {
      const fatal = FATAL_MESSAGES[failure?.status]
      if (fatal) return finish('error', fatal)
      state.consecutiveErrors += 1
      if (state.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) return finish('error', POLL_ERROR_MESSAGE)
      emit()
      return scheduleNext(current)
    }

    state.consecutiveErrors = 0
    applyLearningObject(data?.learning_object ?? null)
    if (state.generationStatus === 'completed') return finish('completed')
    if (state.generationStatus === 'failed') return finish('failed', state.learningObject?.generation?.error_message || null)
    emit()
    scheduleNext(current)
  }

  function applyLearningObject(learningObject) {
    if (!learningObject) return
    state.learningObject = learningObject
    state.generationStatus = learningObject.generation?.status ?? null
  }

  return {
    get state() {
      return snapshot()
    },

    // initial: learning object vừa nhận (202) để hiện trạng thái ngay. immediate: poll ngay (nút "Kiểm tra lại").
    start({ initial = null, immediate = false } = {}) {
      clearTimer()
      session += 1
      const current = session
      startedAt = clock.now()
      Object.assign(state, { status: 'polling', errorMessage: null, consecutiveErrors: 0 })
      applyLearningObject(initial)
      emit()
      if (immediate) tick(current)
      else scheduleNext(current)
    },

    // Hủy hẳn timer; response đang chờ (nếu có) bị bỏ qua. An toàn khi gọi nhiều lần hoặc lúc unmount.
    stop() {
      session += 1
      clearTimer()
      if (state.status === 'polling') {
        state.status = 'stopped'
        emit()
      }
    },
  }
}
