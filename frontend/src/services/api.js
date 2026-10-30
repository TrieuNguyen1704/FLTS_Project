import axios from 'axios'
import { markSessionExpired } from './devMode.js'

/**
 * Axios instance dùng chung cho toàn bộ ứng dụng.
 * Tự động gắn header Authorization: Bearer <token> vào mọi request
 * nếu token tồn tại trong localStorage.
 */
const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
})

// Request interceptor — đính kèm token vào mỗi request
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('flts_token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error),
)

// Response interceptor — xử lý lỗi 401 (token hết hạn / không hợp lệ)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Xóa token cũ và điều hướng về trang đăng nhập
      localStorage.removeItem('flts_token')
      localStorage.removeItem('flts_user')
      // Trang login đọc cờ này để báo phiên hết hạn (BL-03); không lưu token hay thông tin lỗi.
      markSessionExpired()
      window.location.href = '/login'
    }
    return Promise.reject(error)
  },
)

export default api
