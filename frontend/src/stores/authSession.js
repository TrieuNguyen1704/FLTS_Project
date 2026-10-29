/**
 * Đọc phiên đăng nhập từ response POST /api/auth/login.
 * Backend (AuthController@login) trả về { token, user }.
 * Trả về null nếu dữ liệu không hợp lệ để không lưu token rác (vd. "undefined").
 * @param {unknown} data - response.data
 * @returns {{ token: string, user: Object } | null}
 */
export function readLoginSession(data) {
  const token = data?.token
  const user = data?.user
  if (typeof token !== 'string' || token.trim() === '') return null
  if (user === null || typeof user !== 'object' || Array.isArray(user)) return null
  return { token, user }
}
