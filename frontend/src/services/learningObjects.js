import api from './api.js'

/**
 * Sprint 3 — Learning Objects (Quiz): danh sách/chi tiết học liệu, bài làm của sinh viên và kết quả cho giảng viên.
 * Contract: backend FLTS (QuizAttemptController, LecturerQuizResultController, LearningObjectController),
 * đã kiểm chứng bằng API thật ở S3-ENV03B.
 * Trả về nguyên response.data (snake_case), không normalize. Không retry, không tự gọi lại startAttempt:
 * tầng Player quyết định dựa trên status và payload của LearningObjectsApiError.
 * Lưu ý FLTS: không có draft_version/409 (bài đã nộp trả 422), history và quiz-results không phân trang.
 */

const DEFAULT_MESSAGES = {
  0: 'Không thể kết nối tới máy chủ.',
  401: 'Phiên đăng nhập đã hết hạn.',
  403: 'Bạn không có quyền thực hiện thao tác này.',
  404: 'Không tìm thấy bài kiểm tra hoặc bài làm.',
  409: 'Bài làm đã thay đổi trên máy chủ.',
  422: 'Dữ liệu gửi lên không hợp lệ.',
}
const SERVER_ERROR_MESSAGE = 'Máy chủ đang gặp sự cố. Vui lòng thử lại sau.'

// Laravel APP_DEBUG=true thêm các khóa này vào body lỗi (đường dẫn, stack trace nội bộ); không giữ trong lỗi ứng dụng.
const DEBUG_KEYS = new Set(['exception', 'file', 'line', 'trace'])

// Không giữ AxiosError gốc (cause): nó chứa config.headers.Authorization (Bearer token) và request body.
// message luôn là câu tiếng Việt an toàn để hiển thị, chọn theo status; message gốc của backend có thể chứa
// chi tiết kỹ thuật (tên model, SQL, đường dẫn) nên chỉ nằm ở serverMessage/data để Player phân biệt lỗi, không hiển thị.
export class LearningObjectsApiError extends Error {
  constructor(message, { status, code, canceled, serverMessage, errors, data }) {
    super(message)
    this.name = 'LearningObjectsApiError'
    this.status = status // 0 = không có response (lỗi mạng, timeout hoặc bị hủy)
    this.code = code // mã lỗi axios, vd. 'ERR_NETWORK', 'ECONNABORTED', 'ERR_CANCELED'
    this.canceled = canceled // true khi request bị hủy chủ động (AbortController), không phải mất mạng
    this.serverMessage = serverMessage // message gốc của backend cho lỗi 4xx, null nếu không có hoặc lỗi 5xx
    this.errors = errors
    this.data = data
  }
}

// Body không phải object (vd. trang HTML lỗi) không phải dữ liệu nghiệp vụ nên bỏ.
function safeErrorBody(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null
  return Object.fromEntries(Object.entries(body).filter(([key]) => !DEBUG_KEYS.has(key)))
}

function toApiError(err) {
  const canceled = err.code === 'ERR_CANCELED'
  const status = err.response?.status ?? 0
  // 5xx là lỗi hệ thống: body có thể chứa SQL hoặc thông tin hạ tầng và không mang dữ liệu nghiệp vụ nên bỏ toàn bộ.
  const data = status >= 400 && status < 500 ? safeErrorBody(err.response?.data) : null
  const errors = data && typeof data.errors === 'object' && data.errors !== null ? data.errors : {}
  const serverMessage = typeof data?.message === 'string' && data.message.trim() ? data.message : null
  const message = canceled
    ? 'Yêu cầu đã bị hủy.'
    : DEFAULT_MESSAGES[status] || (status >= 500 ? SERVER_ERROR_MESSAGE : `Yêu cầu thất bại (${status}).`)
  return new LearningObjectsApiError(message, { status, code: err.code ?? null, canceled, serverMessage, errors, data })
}

// Route backend chỉ nhận id dạng số ([0-9]+); chặn sớm để không gửi /courses/undefined/...
function routeId(value, name) {
  const id = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  if (!Number.isSafeInteger(id) || id < 1) throw new TypeError(`${name} phải là số nguyên dương.`)
  return id
}

const collectionPath = (courseId) => `/courses/${routeId(courseId, 'courseId')}/learning-objects`

const objectPath = (courseId, learningObjectId) =>
  `${collectionPath(courseId)}/${routeId(learningObjectId, 'learningObjectId')}`

// Option tùy chọn của saveDraft: chỉ nhận timeout (ms). Không cho caller truyền headers/url/baseURL
// hay config axios khác; giá trị sai bị từ chối trước khi gửi, không tự ép kiểu chuỗi sang số.
// Timeout phía client không có nghĩa server chưa ghi draft: session phải coi kết quả là chưa xác định.
function saveDraftConfig(options) {
  if (options === undefined) return undefined
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('options phải là object.')
  }
  const unknownKeys = Object.keys(options).filter((key) => key !== 'timeout')
  if (unknownKeys.length > 0) throw new TypeError(`options không hỗ trợ: ${unknownKeys.join(', ')}.`)
  if (options.timeout === undefined) return undefined
  if (!Number.isSafeInteger(options.timeout) || options.timeout < 1) {
    throw new TypeError('timeout phải là số nguyên dương (ms).')
  }
  return { timeout: options.timeout }
}

// FLTS không phân trang; chỉ gửi page khi caller truyền để tương thích backend có phân trang.
const pageConfig = (page) => (page === undefined ? undefined : { params: { page } })

async function send(request) {
  try {
    return (await request()).data
  } catch (err) {
    throw err?.isAxiosError ? toApiError(err) : err
  }
}

export const learningObjects = {
  // Lecturer chủ course thấy mọi trạng thái; Student đã enroll chỉ thấy bản published
  list: (courseId) => send(() => api.get(collectionPath(courseId))),

  // Student nhận quiz không có is_correct/explanation/citations
  show: (courseId, learningObjectId) => send(() => api.get(objectPath(courseId, learningObjectId))),

  // Sinh viên: bắt đầu hoặc tiếp tục bài đang làm (201 cả khi resume); draft nằm ở attempt.draft_answers
  startAttempt: (courseId, learningObjectId) =>
    send(() => api.post(`${objectPath(courseId, learningObjectId)}/quiz-attempts`)),

  // payload: { answers: [{ question_id, selected_option_id | null }] } — toàn bộ bản nháp, gửi nguyên như caller truyền.
  // Có thể trả 200 với attempt.status = 'completed' và timed_out = true nếu đã hết giờ.
  // options (tùy chọn): { timeout } tính bằng ms, ví dụ autosave dùng { timeout: 20000 }.
  saveDraft: (courseId, learningObjectId, attemptId, payload, options) =>
    send(() =>
      api.patch(
        `${objectPath(courseId, learningObjectId)}/quiz-attempts/${routeId(attemptId, 'attemptId')}`,
        payload,
        saveDraftConfig(options),
      ),
    ),

  // payload: { answers } phải đủ mọi câu (câu bỏ trống gửi selected_option_id: null), nếu không backend trả 422.
  submitAttempt: (courseId, learningObjectId, attemptId, payload) =>
    send(() => api.post(`${objectPath(courseId, learningObjectId)}/quiz-attempts/${routeId(attemptId, 'attemptId')}/submit`, payload)),

  attemptHistory: (courseId, learningObjectId, page) =>
    send(() => api.get(`${objectPath(courseId, learningObjectId)}/quiz-attempts`, pageConfig(page))),

  // Giảng viên chủ course: thống kê và danh sách sinh viên/bài đã nộp
  quizResults: (courseId, learningObjectId, page) =>
    send(() => api.get(`${objectPath(courseId, learningObjectId)}/quiz-results`, pageConfig(page))),

  attemptResult: (courseId, learningObjectId, attemptId) =>
    send(() => api.get(`${objectPath(courseId, learningObjectId)}/quiz-results/attempts/${routeId(attemptId, 'attemptId')}`)),
}
