const base = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL) || '/api'
const token = () => (typeof localStorage !== 'undefined' ? localStorage.getItem('flts_token') : null)

function apiError(data, status) {
  return new Error(Object.values(data.errors || {}).flat().join(' ') || data.message || `Yêu cầu thất bại (${status}).`)
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

  // Sprint 2: AI Processing & RAG Workbench
  startProcessing: (courseId, documentId) =>
    request(`/courses/${courseId}/documents/${documentId}/process`, { method: 'POST' }).catch(() => {
      // Fallback endpoint if route is at /documents/{id}/process
      return request(`/documents/${documentId}/process`, { method: 'POST' })
    }),

  retryProcessing: (courseId, documentId) =>
    request(`/courses/${courseId}/documents/${documentId}/retry`, { method: 'POST' }).catch(() => {
      return request(`/documents/${documentId}/retry`, { method: 'POST' })
    }),

  ragQuery: (courseId, question) =>
    request(`/courses/${courseId}/rag/query`, {
      method: 'POST',
      body: JSON.stringify({ question }),
    }).catch(() => {
      // Fallback endpoint if route is at /rag/query
      return request('/rag/query', {
        method: 'POST',
        body: JSON.stringify({ course_id: courseId, question }),
      })
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
