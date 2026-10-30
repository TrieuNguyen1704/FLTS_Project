import api from './api.js'

/**
 * Sprint 3 — khóa học phía Student: GET /courses (chỉ các course đã enroll) và GET /courses/{id}.
 * Contract: backend FLTS CourseController@index/show, trả { courses } và { course } kèm lecturer.
 * Trả về nguyên response.data; view tự chọn field cần hiển thị (không render enrollment_code, email).
 */

const DEFAULT_MESSAGES = {
  0: 'Không thể kết nối tới máy chủ.',
  401: 'Phiên đăng nhập đã hết hạn.',
  403: 'Bạn chưa tham gia khóa học này.',
  404: 'Không tìm thấy khóa học.',
}

// Chỉ giữ status và câu thông báo an toàn; không giữ AxiosError (chứa Bearer token) hay body lỗi backend.
export class CoursesApiError extends Error {
  constructor(message, { status, canceled }) {
    super(message)
    this.name = 'CoursesApiError'
    this.status = status // 0 = không có response (lỗi mạng, timeout hoặc bị hủy)
    this.canceled = canceled
  }
}

function toApiError(err) {
  const canceled = err.code === 'ERR_CANCELED'
  const status = err.response?.status ?? 0
  const message = canceled
    ? 'Yêu cầu đã bị hủy.'
    : DEFAULT_MESSAGES[status] ||
      (status >= 500 ? 'Máy chủ đang gặp sự cố. Vui lòng thử lại sau.' : `Yêu cầu thất bại (${status}).`)
  return new CoursesApiError(message, { status, canceled })
}

// Route backend chỉ nhận id dạng số; chặn sớm để không gửi /courses/undefined.
function courseRouteId(value) {
  const id = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  if (!Number.isSafeInteger(id) || id < 1) throw new TypeError('courseId phải là số nguyên dương.')
  return id
}

async function send(request) {
  try {
    return (await request()).data
  } catch (err) {
    throw err?.isAxiosError ? toApiError(err) : err
  }
}

export const courses = {
  list: () => send(() => api.get('/courses')),
  show: (courseId) => send(() => api.get(`/courses/${courseRouteId(courseId)}`)),
}
