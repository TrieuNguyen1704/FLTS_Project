/**
 * Render văn bản có công thức LaTeX thành HTML an toàn (FAST-05).
 * AI service yêu cầu Gemini bọc công thức bằng $...$ hoặc $$...$$ (ai-service/main.py:537); hỗ trợ thêm \(...\) và \[...\].
 * - Đoạn chữ thường luôn được escape HTML.
 * - Đoạn toán render bằng KaTeX với trust:false (chặn \href, \url, \includegraphics, \html*), nên không sinh thẻ hay
 *   thuộc tính thực thi được. Công thức lỗi hiển thị nguyên văn (đã escape), không ném lỗi.
 * - "$" của tiền tệ: $ mở phải dính ký tự không phải khoảng trắng, $ đóng phải dính ký tự trước và không có chữ số
 *   ngay sau (quy tắc kiểu Pandoc), nên "giá $5 và $10" giữ nguyên là chữ. "\$" luôn là ký tự $.
 */
import katex from 'katex'

const KATEX_OPTIONS = {
  throwOnError: false,
  trust: false,
  strict: 'ignore',
  // Giới hạn chống công thức cố ý làm treo trình duyệt (macro lồng nhau, kích thước khổng lồ).
  maxExpand: 200,
  maxSize: 20,
  output: 'htmlAndMathml',
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => HTML_ESCAPES[char])
}

const isSpace = (char) => char === undefined || /\s/.test(char)

// Vị trí $ đóng hợp lệ cho inline $...$ bắt đầu sau `from`, hoặc -1.
function findInlineClose(text, from) {
  for (let i = from; i < text.length; i++) {
    const char = text[i]
    if (char === '\\') {
      i++ // bỏ qua ký tự được escape trong công thức (vd. \$)
      continue
    }
    if (char === '\n' && text[i + 1] === '\n') return -1 // không cho công thức inline vượt đoạn văn
    if (char === '$') {
      if (i === from || isSpace(text[i - 1]) || /\d/.test(text[i + 1] ?? '')) return -1
      return i
    }
  }
  return -1
}

/**
 * Tách thành các đoạn [{ type: 'text' | 'math', value, display? }]. Đoạn math giữ `source` (kèm dấu phân cách)
 * để hiển thị nguyên văn khi render lỗi.
 */
export function splitMath(input) {
  const text = String(input ?? '')
  const segments = []
  let buffer = ''
  const pushText = () => {
    if (buffer) segments.push({ type: 'text', value: buffer })
    buffer = ''
  }
  const pushMath = (value, display, source) => {
    pushText()
    segments.push({ type: 'math', value, display, source })
  }

  let i = 0
  while (i < text.length) {
    const rest = text.slice(i)
    if (rest.startsWith('\\$')) {
      buffer += '$'
      i += 2
      continue
    }
    const pair = [['$$', '$$', true], ['\\[', '\\]', true], ['\\(', '\\)', false]].find(([open]) => rest.startsWith(open))
    if (pair) {
      const [open, close, display] = pair
      const end = text.indexOf(close, i + open.length)
      const body = end === -1 ? '' : text.slice(i + open.length, end)
      if (end !== -1 && body.trim()) {
        pushMath(body, display, text.slice(i, end + close.length))
        i = end + close.length
        continue
      }
      buffer += open
      i += open.length
      continue
    }
    if (text[i] === '$' && !isSpace(text[i + 1])) {
      const end = findInlineClose(text, i + 1)
      if (end !== -1) {
        pushMath(text.slice(i + 1, end), false, text.slice(i, end + 1))
        i = end + 1
        continue
      }
    }
    buffer += text[i]
    i++
  }
  pushText()
  return segments
}

export function renderMath(tex, display) {
  return katex.renderToString(tex, { ...KATEX_OPTIONS, displayMode: display })
}

/** Văn bản → HTML an toàn để gắn bằng v-html. */
export function renderMathText(input) {
  return splitMath(input)
    .map((segment) => {
      if (segment.type === 'text') return escapeHtml(segment.value)
      try {
        return renderMath(segment.value, segment.display)
      } catch {
        return escapeHtml(segment.source)
      }
    })
    .join('')
}

export const hasMath = (input) => splitMath(input).some((segment) => segment.type === 'math')
