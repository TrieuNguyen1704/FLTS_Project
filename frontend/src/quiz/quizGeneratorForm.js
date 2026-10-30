/**
 * Logic thuần của biểu mẫu tạo Quiz bằng AI (FAST-04B): giá trị mặc định, validate khớp giới hạn backend
 * (LearningObjectController@storeQuiz, LearningObjectSourcePreviewController@store) và dựng payload.
 * Ô nhập số giữ chuỗi như người dùng gõ; chỉ ép kiểu khi validate/dựng payload.
 */

export const LIMITS = {
  topic: [3, 500],
  title: 255,
  questionCount: [3, 20],
  timeLimit: [1, 480],
  passingScore: [0, 100],
  topK: [3, 15],
  maxDocuments: 50,
}

export const DIFFICULTIES = [
  { value: 'easy', label: 'Dễ' },
  { value: 'medium', label: 'Trung bình' },
  { value: 'hard', label: 'Khó' },
]

export function defaultForm() {
  return {
    topic: '',
    title: '',
    difficulty: 'medium',
    question_count: '10',
    unlimited_time: false,
    time_limit_minutes: '25',
    passing_score: '60',
    top_k: '8',
    document_ids: [],
  }
}

// crypto.randomUUID chỉ có trong secure context (HTTPS/localhost); truy cập qua IP LAN cần fallback.
export function createRequestId(cryptoImpl = globalThis.crypto) {
  if (typeof cryptoImpl?.randomUUID === 'function') return cryptoImpl.randomUUID()
  const bytes = new Uint8Array(16)
  if (typeof cryptoImpl?.getRandomValues === 'function') cryptoImpl.getRandomValues(bytes)
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant RFC 4122
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export const isProcessed = (doc) => (doc?.processing_status || doc?.status) === 'processed'

function integerIn(raw, [min, max]) {
  const text = String(raw ?? '').trim()
  if (!/^-?\d+$/.test(text)) return null
  const value = Number(text)
  return value >= min && value <= max ? value : null
}

/**
 * @param {object} form  state biểu mẫu
 * @param {Array} documents  tài liệu của course (để kiểm tra id đã chọn còn processed)
 * @returns {Record<string, string>} lỗi theo tên field backend; rỗng nghĩa là hợp lệ
 */
export function validateForm(form, documents = []) {
  const errors = {}
  const topic = form.topic.trim()
  if (topic.length < LIMITS.topic[0] || topic.length > LIMITS.topic[1]) {
    errors.topic = `Chủ đề phải dài từ ${LIMITS.topic[0]} đến ${LIMITS.topic[1]} ký tự.`
  }
  if (form.title.trim().length > LIMITS.title) errors.title = `Tiêu đề tối đa ${LIMITS.title} ký tự.`
  if (!DIFFICULTIES.some((d) => d.value === form.difficulty)) errors.difficulty = 'Hãy chọn độ khó.'
  if (integerIn(form.question_count, LIMITS.questionCount) === null) {
    errors.question_count = `Số câu hỏi phải là số nguyên từ ${LIMITS.questionCount[0]} đến ${LIMITS.questionCount[1]}.`
  }
  if (!form.unlimited_time && integerIn(form.time_limit_minutes, LIMITS.timeLimit) === null) {
    errors.time_limit_minutes = `Thời gian làm bài phải từ ${LIMITS.timeLimit[0]} đến ${LIMITS.timeLimit[1]} phút.`
  }
  if (integerIn(form.passing_score, LIMITS.passingScore) === null) {
    errors.passing_score = `Điểm đạt phải là số nguyên từ ${LIMITS.passingScore[0]} đến ${LIMITS.passingScore[1]}.`
  }
  if (integerIn(form.top_k, LIMITS.topK) === null) {
    errors.top_k = `Số đoạn nguồn phải từ ${LIMITS.topK[0]} đến ${LIMITS.topK[1]}.`
  }
  if (form.document_ids.length > LIMITS.maxDocuments) {
    errors.document_ids = `Chỉ chọn tối đa ${LIMITS.maxDocuments} tài liệu.`
  } else {
    const processedIds = new Set(documents.filter(isProcessed).map((d) => d.id))
    if (form.document_ids.some((id) => !processedIds.has(id))) {
      errors.document_ids = 'Chỉ chọn được tài liệu đã xử lý xong.'
    }
  }
  return errors
}

// Payload POST .../learning-objects/quizzes. Tên field theo backend: passing_score (không phải passing_percentage).
export function buildCreatePayload(form, requestId) {
  const payload = {
    request_id: requestId,
    topic: form.topic.trim(),
    difficulty: form.difficulty,
    question_count: Number(form.question_count),
    document_ids: [...form.document_ids],
    top_k: Number(form.top_k),
    time_limit_minutes: form.unlimited_time ? null : Number(form.time_limit_minutes),
    passing_score: Number(form.passing_score),
  }
  const title = form.title.trim()
  if (title) payload.title = title
  return payload
}

// Payload POST .../learning-objects/source-preview (top_k bắt buộc ở endpoint này).
export function buildPreviewPayload(form) {
  return {
    topic: form.topic.trim(),
    requested_count: Number(form.question_count),
    document_ids: [...form.document_ids],
    top_k: Number(form.top_k),
  }
}

// Preview chỉ cần các field nó gửi đi.
export const PREVIEW_FIELDS = ['topic', 'question_count', 'top_k', 'document_ids']

// Lỗi 422 của Laravel: { field: [msg, ...] } — lấy câu đầu; 'document_ids.3' gộp về 'document_ids'.
export function fieldErrorsFrom(errors) {
  const result = {}
  for (const [key, messages] of Object.entries(errors || {})) {
    const field = key.split('.')[0]
    const message = Array.isArray(messages) ? messages[0] : messages
    if (!result[field] && typeof message === 'string') result[field] = message
  }
  return result
}
