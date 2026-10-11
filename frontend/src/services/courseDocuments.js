const base = import.meta.env.VITE_API_BASE_URL || '/api'
const token = () => localStorage.getItem('flts_token')

function apiError(data, status) {
  return new Error(Object.values(data.errors || {}).flat().join(' ') || data.message || `Yêu cầu thất bại (${status}).`)
}

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token() || ''}` },
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
