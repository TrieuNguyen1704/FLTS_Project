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

// Option tùy chọn của saveDraft/submitAttempt: chỉ nhận timeout (ms). Không cho caller truyền headers/url/baseURL
// hay config axios khác; giá trị sai bị từ chối trước khi gửi, không tự ép kiểu chuỗi sang số.
// Timeout phía client không có nghĩa server chưa xử lý: session phải coi kết quả là chưa xác định.
function timeoutConfig(options) {
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
        timeoutConfig(options),
      ),
    ),

  // payload: { answers } phải đủ mọi câu (câu bỏ trống gửi selected_option_id: null), nếu không backend trả 422.
  // options (tùy chọn): { timeout } tính bằng ms. Sau hạn nộp, server chỉ chấm draft đã lưu và bỏ qua payload.
  submitAttempt: (courseId, learningObjectId, attemptId, payload, options) =>
    send(() =>
      api.post(
        `${objectPath(courseId, learningObjectId)}/quiz-attempts/${routeId(attemptId, 'attemptId')}/submit`,
        payload,
        timeoutConfig(options),
      ),
    ),

  attemptHistory: (courseId, learningObjectId, page) =>
    send(() => api.get(`${objectPath(courseId, learningObjectId)}/quiz-attempts`, pageConfig(page))),

  // Giảng viên chủ course: thống kê và danh sách sinh viên/bài đã nộp
  quizResults: (courseId, learningObjectId, page) =>
    send(() => api.get(`${objectPath(courseId, learningObjectId)}/quiz-results`, pageConfig(page))),

  attemptResult: (courseId, learningObjectId, attemptId) =>
    send(() => api.get(`${objectPath(courseId, learningObjectId)}/quiz-results/attempts/${routeId(attemptId, 'attemptId')}`)),

  // --- Quiz Generator (Giảng viên) — contract FAST-04A. Poll tiến độ dùng show() và đọc learning_object.generation. ---

  // Danh sách tài liệu thật của course (không phân trang, có processing_status). Không dùng dữ liệu mẫu như
  // CourseWorkspaceView: document_ids giả sẽ bị backend từ chối (422).
  sourceDocuments: (courseId) =>
    sendGenerator(() => api.get(`/courses/${routeId(courseId, 'courseId')}/documents`)),

  // payload: { topic, requested_count, top_k, document_ids?, max_pages? }; learning_object_type luôn là 'quiz'.
  // Gọi FastAPI đồng bộ (server chờ tối đa 30 giây) nên client chờ 35 giây.
  previewQuizSources: (courseId, payload) =>
    sendGenerator(() =>
      api.post(`${collectionPath(courseId)}/source-preview`, { ...payload, learning_object_type: 'quiz' }, { timeout: 35000 }),
    ),

  // payload gửi nguyên như caller truyền (topic, difficulty, question_count, passing_score, request_id...).
  // Backend trả 202; gửi lại cùng request_id trả về đúng learning object đã tạo thay vì tạo bản mới.
  createQuiz: (courseId, payload) => {
    if (typeof payload?.request_id !== 'string' || !payload.request_id) {
      throw new TypeError('payload.request_id là bắt buộc để chống tạo trùng.')
    }
    return sendGenerator(() => api.post(`${collectionPath(courseId)}/quizzes`, payload, { timeout: 20000 }))
  },

  // Chỉ hợp lệ khi lần tạo gần nhất failed và chưa có nội dung; server tự sinh request_id mới (202).
  retryQuizGeneration: (courseId, learningObjectId) =>
    sendGenerator(() =>
      api.post(`${objectPath(courseId, learningObjectId)}/generation-runs/retry`, undefined, { timeout: 20000 }),
    ),
}

// Thông báo cho luồng tạo Quiz: khác DEFAULT_MESSAGES (viết cho bài làm của sinh viên) và có thêm 429/503/timeout.
const GENERATOR_MESSAGES = {
  0: 'Không thể kết nối tới máy chủ. Vui lòng kiểm tra mạng và thử lại.',
  403: 'Bạn không có quyền tạo Quiz trong khóa học này.',
  404: 'Không tìm thấy khóa học hoặc học liệu.',
  409: 'Yêu cầu tạo Quiz bị trùng với một yêu cầu khác. Vui lòng mở lại biểu mẫu.',
  422: 'Dữ liệu gửi lên không hợp lệ.',
  429: 'Dịch vụ AI đang bận. Vui lòng thử lại sau ít phút.',
  503: 'Dịch vụ AI tạm thời không khả dụng. Vui lòng thử lại sau.',
}
const TIMEOUT_MESSAGE = 'Máy chủ phản hồi quá lâu. Vui lòng thử lại.'
const TIMEOUT_CODES = new Set(['ECONNABORTED', 'ETIMEDOUT'])

// Backend trả các câu tiếng Anh cố định cho lỗi nghiệp vụ (LearningObjectController, SourcePreviewController).
const KNOWN_SERVER_MESSAGES = {
  'Every selected document must belong to this course and be processed.':
    'Mọi tài liệu được chọn phải thuộc khóa học và đã xử lý xong.',
  'The requested output count is invalid for this learning object type.': 'Số câu hỏi phải từ 3 đến 20.',
  'Only a failed generation can be retried.': 'Chỉ có thể thử lại khi lần tạo gần nhất thất bại.',
  'Source preview is temporarily unavailable.':
    'Chưa kiểm tra được nguồn: không tìm thấy nội dung phù hợp hoặc dịch vụ đang tạm ngưng.',
  'The source check is temporarily rate limited. Please retry shortly.': GENERATOR_MESSAGES[429],
}

async function sendGenerator(request) {
  try {
    return await send(request)
  } catch (err) {
    if (!(err instanceof LearningObjectsApiError) || err.canceled) throw err
    if (err.status === 0 && TIMEOUT_CODES.has(err.code)) err.message = TIMEOUT_MESSAGE
    else err.message = KNOWN_SERVER_MESSAGES[err.serverMessage] || GENERATOR_MESSAGES[err.status] || err.message
    throw err
  }
}
