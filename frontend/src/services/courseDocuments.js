const base = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL) || '/api'
const token = () => (typeof localStorage !== 'undefined' ? localStorage.getItem('flts_token') : null)

function apiError(data, status) {
  const error = new Error(Object.values(data.errors || {}).flat().join(' ') || data.message || `Yêu cầu thất bại (${status}).`)
  error.status = status // view chọn thông báo tiếng Việt theo status (FAST-07A2)
  return error
}

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token() || ''}`,
      ...(options.headers || {}),
    },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw apiError(data, response.status)
  return data
}

export const courseDocuments = {
  listCourses: (page = 1) => request(`/courses?page=${page}`),
  createCourse: (data) => request('/courses', { method: 'POST', body: JSON.stringify(data) }),
  course: (id) => request(`/courses/${id}`),
  listDocuments: (id, page = 1) => request(`/courses/${id}/documents?page=${page}`),
  deleteDocument: (courseId, documentId) => request(`/courses/${courseId}/documents/${documentId}`, { method: 'DELETE' }),
  downloadUrl: (courseId, documentId) => `${base}/courses/${courseId}/documents/${documentId}/download`,

  // Sprint 2: AI Processing & RAG Workbench — route thật của backend FLTS (DocumentProcessingController).
  // 202 { run, message }; 422 khi tài liệu đang xử lý (start) hoặc không ở trạng thái failed (retry).
  startProcessing: (courseId, documentId) =>
    request(`/courses/${courseId}/documents/${documentId}/processing-runs`, { method: 'POST', body: '{}' }),

  retryProcessing: (courseId, documentId) =>
    request(`/courses/${courseId}/documents/${documentId}/processing-runs/retry`, { method: 'POST', body: '{}' }),

  // { document: { processing_status, ... }, run: { status, stage, error_detail, ... } | null }
  processingStatus: (courseId, documentId) => request(`/courses/${courseId}/documents/${documentId}/processing`),

  // Grounded evidence: { evidence: { answer, citations: [{ vector_id, source_locator }], limitations },
  // retrieval: { matches: [{ vector_id, content, score, document_name, source_locator }] } }
  ragQuery: (courseId, question) =>
    request(`/courses/${courseId}/evidence-prototypes`, {
      method: 'POST',
      body: JSON.stringify({ prompt: question, top_k: 5 }),
    }),

  upload: (id, file, onProgress) => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${base}/courses/${id}/documents`)
    xhr.timeout = 120000
    xhr.setRequestHeader('Accept', 'application/json')
    xhr.setRequestHeader('Authorization', `Bearer ${token() || ''}`)
    // Real browser upload progress, not a timer-based simulated percentage.
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round(event.loaded * 100 / event.total))
    }
    xhr.onload = () => {
      let data = {}
      try { data = JSON.parse(xhr.responseText) } catch { /* Nginx may return HTML for a transport error. */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data)
      else reject(apiError(data, xhr.status))
    }
    xhr.onerror = () => reject(new Error('Mất kết nối khi tải tài liệu.'))
    xhr.ontimeout = () => reject(new Error('Tải lên quá lâu. Vui lòng thử lại.'))
    const body = new FormData()
    body.append('document', file)
    xhr.send(body)
  }),
}
