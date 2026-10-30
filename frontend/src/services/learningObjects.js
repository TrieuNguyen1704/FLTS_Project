import api from './api.js'

/**
 * Sprint 3 — Learning Objects (Quiz): bài làm của sinh viên và kết quả cho giảng viên.
 * Contract: origin/feature/sprint3-vuong-quiz-attempts (docs/VUONG_SPRINT3_API_CONTRACT.md).
 * Trả về nguyên response.data (snake_case). Không retry, không tự xử lý 409:
 * tầng Player quyết định dựa trên status và payload của LearningObjectsApiError.
 */

const DEFAULT_MESSAGES = {
  0: 'Không thể kết nối tới máy chủ.',
  401: 'Phiên đăng nhập đã hết hạn.',
  403: 'Bạn không có quyền thực hiện thao tác này.',
  404: 'Không tìm thấy bài kiểm tra hoặc bài làm.',
  409: 'Bài làm đã thay đổi trên máy chủ.',
  422: 'Dữ liệu gửi lên không hợp lệ.',
}

// Không giữ AxiosError gốc (cause): nó chứa config.headers.Authorization (Bearer token) và request body.
// Chỉ giữ dữ liệu Player cần: status, mã lỗi axios, errors và body lỗi backend.
export class LearningObjectsApiError extends Error {
  constructor(message, { status, code, canceled, errors, data }) {
    super(message)
    this.name = 'LearningObjectsApiError'
    this.status = status // 0 = không có response (lỗi mạng, timeout hoặc bị hủy)
    this.code = code // mã lỗi axios, vd. 'ERR_NETWORK', 'ECONNABORTED', 'ERR_CANCELED'
    this.canceled = canceled // true khi request bị hủy chủ động (AbortController), không phải mất mạng
    this.errors = errors
    this.data = data
  }
}

function toApiError(err) {
  const canceled = err.code === 'ERR_CANCELED'
  const status = err.response?.status ?? 0
  const data = err.response?.data ?? null
  const errors = data && typeof data.errors === 'object' && data.errors !== null ? data.errors : {}
  const message = canceled
    ? 'Yêu cầu đã bị hủy.'
    : (typeof data?.message === 'string' && data.message.trim()) ||
      DEFAULT_MESSAGES[status] ||
      `Yêu cầu thất bại (${status}).`
  return new LearningObjectsApiError(message, { status, code: err.code ?? null, canceled, errors, data })
}

// Route backend chỉ nhận id dạng số ([0-9]+); chặn sớm để không gửi /courses/undefined/...
function routeId(value, name) {
  const id = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  if (!Number.isSafeInteger(id) || id < 1) throw new TypeError(`${name} phải là số nguyên dương.`)
  return id
}

const objectPath = (courseId, learningObjectId) =>
  `/courses/${routeId(courseId, 'courseId')}/learning-objects/${routeId(learningObjectId, 'learningObjectId')}`

async function send(request) {
  try {
    return (await request()).data
  } catch (err) {
    throw err?.isAxiosError ? toApiError(err) : err
  }
}

export const learningObjects = {
  // Sinh viên: bắt đầu hoặc tiếp tục bài đang làm (201 cả khi resume)
  startAttempt: (courseId, learningObjectId) =>
    send(() => api.post(`${objectPath(courseId, learningObjectId)}/quiz-attempts`)),

  // payload: { draft_version, answers: [{ question_id, selected_option_id, time_spent_seconds? }] }
  // Có thể trả 200 với attempt.status = 'completed' và timed_out = true nếu đã hết giờ.
  saveDraft: (courseId, learningObjectId, attemptId, payload) =>
    send(() => api.patch(`${objectPath(courseId, learningObjectId)}/quiz-attempts/${routeId(attemptId, 'attemptId')}`, payload)),

  submitAttempt: (courseId, learningObjectId, attemptId, payload) =>
    send(() => api.post(`${objectPath(courseId, learningObjectId)}/quiz-attempts/${routeId(attemptId, 'attemptId')}/submit`, payload)),

  attemptHistory: (courseId, learningObjectId, page = 1) =>
    send(() => api.get(`${objectPath(courseId, learningObjectId)}/quiz-attempts`, { params: { page } })),

  // Giảng viên chủ course: thống kê và danh sách bài đã nộp
  quizResults: (courseId, learningObjectId, page = 1) =>
    send(() => api.get(`${objectPath(courseId, learningObjectId)}/quiz-results`, { params: { page } })),

  attemptResult: (courseId, learningObjectId, attemptId) =>
    send(() => api.get(`${objectPath(courseId, learningObjectId)}/quiz-results/attempts/${routeId(attemptId, 'attemptId')}`)),
}
