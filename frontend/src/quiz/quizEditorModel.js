/**
 * Mô hình thuần của trình chỉnh sửa Quiz (FAST-05), không phụ thuộc Vue.
 * Contract FLTS: LearningObjectController@update (PATCH thay toàn bộ nội dung) và @detail.
 * - Câu hỏi và lựa chọn KEY THEO INDEX: sau PATCH/restore, detail trả id null (payload dựng từ snapshot).
 * - PATCH nhận options là string[] đúng 4 phần tử + correct_index; response trả options [{ option_text, is_correct }].
 * - citations bắt buộc (≥1, vector_id) nhưng không sửa được ở UI: giữ nguyên và gửi lại.
 * Ô nhập số giữ chuỗi như người dùng gõ; chỉ ép kiểu khi validate/dựng payload.
 */

export const EDITOR_LIMITS = {
  title: 255,
  description: 2000,
  timeLimit: [1, 480],
  passingScore: [0, 100],
  questions: [3, 20],
  questionText: [3, 2000],
  explanation: [3, 4000],
  optionCount: 4,
  optionText: [1, 1000],
}

const CITATION_KEYS = ['vector_id', 'source_locator', 'document_id', 'document_name']

function copyCitation(citation) {
  const result = {}
  for (const key of CITATION_KEYS) if (citation?.[key] !== undefined) result[key] = citation[key]
  return result
}

/** learning_object (detail của Giảng viên) → state biểu mẫu. Không có quiz → null. */
export function fromApi(learningObject) {
  const quiz = learningObject?.quiz
  if (!quiz) return null
  return {
    title: learningObject.title ?? '',
    description: learningObject.description ?? '',
    unlimited_time: quiz.time_limit_minutes === null || quiz.time_limit_minutes === undefined,
    time_limit_minutes: quiz.time_limit_minutes == null ? '' : String(quiz.time_limit_minutes),
    passing_score: String(quiz.passing_score ?? 60),
    questions: (quiz.questions ?? []).map((question) => {
      const options = (question.options ?? []).map((option) => option.option_text ?? '')
      return {
        question_text: question.question_text ?? '',
        explanation: question.explanation ?? '',
        options,
        correct_index: (question.options ?? []).findIndex((option) => option.is_correct === true),
        citations: (question.citations ?? []).map(copyCitation),
      }
    }),
  }
}

/** state biểu mẫu → body PATCH. */
export function toPatchPayload(form) {
  const description = form.description.trim()
  return {
    title: form.title.trim(),
    description: description || null,
    time_limit_minutes: form.unlimited_time ? null : Number(form.time_limit_minutes),
    passing_score: Number(form.passing_score),
    questions: form.questions.map((question) => ({
      question_text: question.question_text.trim(),
      explanation: question.explanation.trim(),
      options: question.options.map((option) => option.trim()),
      correct_index: question.correct_index,
      citations: question.citations.map(copyCitation),
    })),
  }
}

function integerIn(raw, [min, max]) {
  const text = String(raw ?? '').trim()
  if (!/^-?\d+$/.test(text)) return null
  const value = Number(text)
  return value >= min && value <= max ? value : null
}

function lengthIn(text, [min, max]) {
  const length = text.trim().length
  return length >= min && length <= max
}

/**
 * Lỗi theo đường dẫn giống key 422 của Laravel: 'title', 'questions.0.question_text',
 * 'questions.0.options.2', 'questions.0.correct_index', 'questions.0.citations'. Rỗng = hợp lệ.
 */
export function validate(form) {
  const errors = {}
  const L = EDITOR_LIMITS
  if (!form.title.trim()) errors.title = 'Tiêu đề là bắt buộc.'
  else if (form.title.trim().length > L.title) errors.title = `Tiêu đề tối đa ${L.title} ký tự.`
  if (form.description.trim().length > L.description) errors.description = `Mô tả tối đa ${L.description} ký tự.`
  if (!form.unlimited_time && integerIn(form.time_limit_minutes, L.timeLimit) === null) {
    errors.time_limit_minutes = `Thời gian làm bài phải từ ${L.timeLimit[0]} đến ${L.timeLimit[1]} phút.`
  }
  if (integerIn(form.passing_score, L.passingScore) === null) {
    errors.passing_score = `Điểm đạt phải là số nguyên từ ${L.passingScore[0]} đến ${L.passingScore[1]}.`
  }
  if (form.questions.length < L.questions[0] || form.questions.length > L.questions[1]) {
    errors.questions = `Quiz phải có từ ${L.questions[0]} đến ${L.questions[1]} câu hỏi.`
  }
  form.questions.forEach((question, q) => {
    const at = `questions.${q}`
    if (!lengthIn(question.question_text, L.questionText)) {
      errors[`${at}.question_text`] = `Nội dung câu hỏi phải dài từ ${L.questionText[0]} đến ${L.questionText[1]} ký tự.`
    }
    if (!lengthIn(question.explanation, L.explanation)) {
      errors[`${at}.explanation`] = `Giải thích là bắt buộc (${L.explanation[0]}–${L.explanation[1]} ký tự).`
    }
    if (question.options.length !== L.optionCount) {
      errors[`${at}.options`] = `Mỗi câu phải có đúng ${L.optionCount} lựa chọn.`
    }
    question.options.forEach((option, o) => {
      if (!lengthIn(option, L.optionText)) {
        errors[`${at}.options.${o}`] = `Lựa chọn không được để trống (tối đa ${L.optionText[1]} ký tự).`
      }
    })
    if (!Number.isInteger(question.correct_index) || question.correct_index < 0 || question.correct_index >= question.options.length) {
      errors[`${at}.correct_index`] = 'Hãy chọn đúng 1 đáp án đúng.'
    }
    if (!question.citations.length || question.citations.some((c) => !c.vector_id)) {
      errors[`${at}.citations`] = 'Câu hỏi thiếu trích dẫn nguồn nên không thể lưu.'
    }
  })
  return errors
}

export const cloneForm = (form) => JSON.parse(JSON.stringify(form))

export function isDirty(form, baseline) {
  if (!form || !baseline) return false
  return JSON.stringify(form) !== JSON.stringify(baseline)
}

// Lỗi 422 của Laravel { 'questions.0.options.1': [msg] } → { key: msg } cùng dạng với validate().
export function serverErrorsFrom(errors) {
  const result = {}
  for (const [key, messages] of Object.entries(errors || {})) {
    const message = Array.isArray(messages) ? messages[0] : messages
    if (typeof message === 'string') result[key] = message
  }
  return result
}

/**
 * Quyền sửa/xuất bản theo backend:
 * - PATCH chỉ khi status = draft hoặc có version chưa xuất bản (LearningObjectController:278).
 *   Archived thì FE coi là chỉ đọc dù backend có thể nhận PATCH.
 * - publish chặn archived và version đã xuất bản (:330-332).
 * - Đang có generation queued/generating: FE coi là chỉ đọc để không ghi đè kết quả sắp tới.
 */
export function editorAccess(learningObject) {
  const generation = learningObject?.generation?.status
  if (generation === 'queued' || generation === 'generating') {
    return { editable: false, canPublish: false, canArchive: false, reason: 'Quiz đang được AI tạo. Hãy quay lại khi quá trình tạo hoàn tất.' }
  }
  if (!learningObject?.quiz) {
    const reason = generation === 'failed'
      ? learningObject?.generation?.error_message || 'Lần tạo Quiz gần nhất thất bại nên chưa có nội dung.'
      : 'Quiz chưa có nội dung để chỉnh sửa.'
    return { editable: false, canPublish: false, canArchive: false, reason }
  }
  if (learningObject.status === 'archived') {
    return { editable: false, canPublish: false, canArchive: false, reason: 'Quiz đã được lưu trữ: sinh viên không còn thấy và không thể chỉnh sửa.' }
  }
  const hasDraft = learningObject.status === 'draft' || learningObject.has_unpublished_changes === true
  if (!hasDraft) {
    return {
      editable: false,
      canPublish: false,
      canArchive: true,
      reason: 'Quiz đã xuất bản. Backend chỉ cho sửa bản nháp; tạo phiên bản nháp mới (tạo lại/khôi phục) sẽ có ở bước sau.',
    }
  }
  return { editable: true, canPublish: true, canArchive: true, reason: '' }
}

/** Nhãn trạng thái cho danh sách quiz (dùng summary của GET learning-objects). */
export function quizStatusBadge(learningObject) {
  const generation = learningObject?.generation?.status
  if (generation === 'queued' || generation === 'generating') return { key: 'generating', label: 'Đang tạo' }
  if (generation === 'failed' && !learningObject.current_version) return { key: 'failed', label: 'Tạo lỗi' }
  if (learningObject?.status === 'archived') return { key: 'archived', label: 'Lưu trữ' }
  if (learningObject?.status === 'published') {
    return learningObject.has_unpublished_changes
      ? { key: 'published-draft', label: 'Đã xuất bản · có bản nháp mới' }
      : { key: 'published', label: 'Đã xuất bản' }
  }
  return { key: 'draft', label: 'Nháp' }
}
