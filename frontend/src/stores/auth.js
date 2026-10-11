import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '@/services/api'

/**
 * Store xác thực người dùng (HUNG-03).
 * Quản lý trạng thái đăng nhập, token và thông tin người dùng.
 * Token được lưu bền vững trong localStorage dưới key 'flts_token'.
 */
export const useAuthStore = defineStore('auth', () => {
  // --- State ---
  const user = ref(JSON.parse(localStorage.getItem('flts_user') || 'null'))
  const token = ref(localStorage.getItem('flts_token') || null)
  const loading = ref(false)
  const error = ref(null)

  // --- Getters ---
  const isAuthenticated = computed(() => !!token.value)
  const isLecturer = computed(() => user.value?.role === 'lecturer')
  const isStudent = computed(() => user.value?.role === 'student')
  const isAdmin = computed(() => user.value?.role === 'admin')

  // --- Actions ---

  /**
   * Đăng nhập — gọi POST /api/auth/login
   * @param {string} email
   * @param {string} password
   */
  async function login(email, password) {
    loading.value = true
    error.value = null
    try {
      const response = await api.post('/auth/login', { email, password })
      const { user: userData, bearer_token } = response.data

      // Lưu token và thông tin người dùng vào localStorage
      token.value = bearer_token
      user.value = userData
      localStorage.setItem('flts_token', bearer_token)
      localStorage.setItem('flts_user', JSON.stringify(userData))

      return { success: true, user: userData }
    } catch (err) {
      const message =
        err.response?.data?.message || 'Đăng nhập thất bại. Vui lòng thử lại.'
      error.value = message
      return { success: false, message }
    } finally {
      loading.value = false
    }
  }

  /**
   * Đăng ký tài khoản mới — gọi POST /api/auth/register
   * @param {Object} payload - { name, email, password, password_confirmation, role }
   */
  async function register(payload) {
    loading.value = true
    error.value = null
    try {
      const response = await api.post('/auth/register', payload)
      return { success: true, data: response.data }
    } catch (err) {
      const message =
        err.response?.data?.message || 'Đăng ký thất bại. Vui lòng thử lại.'
      const errors = err.response?.data?.errors || {}
      error.value = message
      return { success: false, message, errors }
    } finally {
      loading.value = false
    }
  }

  /**
   * Đăng xuất — gọi POST /api/auth/logout và xóa dữ liệu local
   */
  async function logout() {
    loading.value = true
    try {
      await api.post('/auth/logout')
    } catch {
      // Vẫn tiếp tục xóa local dù request thất bại
    } finally {
      token.value = null
      user.value = null
      localStorage.removeItem('flts_token')
      localStorage.removeItem('flts_user')
      loading.value = false
    }
  }

  /**
   * Lấy thông tin người dùng hiện tại — gọi GET /api/auth/me
   */
  async function fetchMe() {
    if (!token.value) return
    try {
      const response = await api.get('/auth/me')
      user.value = response.data
      localStorage.setItem('flts_user', JSON.stringify(response.data))
    } catch {
      // Token không còn hợp lệ — interceptor sẽ xử lý redirect
    }
  }

  return {
    user,
    token,
    loading,
    error,
    isAuthenticated,
    isLecturer,
    isStudent,
    isAdmin,
    login,
    register,
    logout,
    fetchMe,
  }
})
