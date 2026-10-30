/**
 * Sprint 3 — đồng hồ làm Quiz ước lượng theo giờ server (S3 FAST-02).
 * Độ lệch client/server = server_time − thời điểm giữa của round-trip (request gửi đi → response về).
 * Thời gian còn lại luôn tính lại từ mốc expires_at, không đếm lùi một biến, nên không phụ thuộc
 * setInterval chạy đúng mỗi giây (tab bị ẩn/throttle). Đây chỉ là ước lượng: backend quyết định hạn nộp thật.
 */

export function parseServerTime(value) {
  if (typeof value !== 'string') return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

export function createServerClock(now = () => Date.now()) {
  let offset = 0
  let synced = false

  return {
    // Ghi nhận server_time của một response; requestStartedAt/responseReceivedAt là giờ client quanh request đó.
    sync(serverTime, requestStartedAt, responseReceivedAt) {
      const server = parseServerTime(serverTime)
      if (server === null || !Number.isFinite(requestStartedAt) || !Number.isFinite(responseReceivedAt)) return false
      offset = server - (requestStartedAt + responseReceivedAt) / 2
      synced = true
      return true
    },
    now: () => now() + offset,
    // null nếu không có hạn nộp (Quiz không giới hạn thời gian) hoặc expires_at không đọc được.
    remainingMs(expiresAt) {
      const deadline = parseServerTime(expiresAt)
      return deadline === null ? null : deadline - (now() + offset)
    },
    get offset() {
      return offset
    },
    get synced() {
      return synced
    },
  }
}

// mm:ss (hoặc h:mm:ss khi ≥ 1 giờ); làm tròn lên giây để không hiện 00:00 khi vẫn còn thời gian.
export function formatRemaining(ms) {
  if (!Number.isFinite(ms)) return ''
  const total = Math.max(0, Math.ceil(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (value) => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`
}
