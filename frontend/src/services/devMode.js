/**
 * Cờ DEV Mode và thông báo phiên hết hạn (FAST-07A: BL-01, BL-03, BL-06).
 * - Nút "Chế độ xem trước Dashboard" chỉ hiện khi VITE_SHOW_DEV_LOGIN=true (mặc định ẩn, kể cả npm run dev).
 * - Phiên DEV Mode dùng token giả 'demo-token-<role>' (LoginView.loginAsRole); chỉ phiên này mới được dùng dữ liệu mẫu.
 * - Interceptor 401 tải lại trang về /login nên cờ hết phiên đi qua sessionStorage (không chứa token).
 */

export const DEMO_TOKEN_PREFIX = 'demo-token-'
const SESSION_EXPIRED_KEY = 'flts_session_expired'

export function showDevLogin(env = import.meta.env) {
  return env?.VITE_SHOW_DEV_LOGIN === 'true'
}

export function isDemoSession(storage = globalThis.localStorage) {
  try {
    return String(storage?.getItem('flts_token') ?? '').startsWith(DEMO_TOKEN_PREFIX)
  } catch {
    return false
  }
}

export function markSessionExpired(storage = globalThis.sessionStorage) {
  try {
    storage?.setItem(SESSION_EXPIRED_KEY, '1')
  } catch {
    // sessionStorage có thể bị chặn (chế độ riêng tư): chỉ mất thông báo, không ảnh hưởng đăng xuất.
  }
}

/** Đọc rồi xóa cờ để thông báo chỉ hiện một lần. */
export function consumeSessionExpired(storage = globalThis.sessionStorage) {
  try {
    const expired = storage?.getItem(SESSION_EXPIRED_KEY) === '1'
    storage?.removeItem(SESSION_EXPIRED_KEY)
    return expired
  } catch {
    return false
  }
}
