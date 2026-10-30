import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { AxiosError } from 'axios'

// FAST-07A: BL-01, BL-02, BL-03, BL-05, BL-06.
register('./helpers/vueLoader.mjs', import.meta.url)

function setGlobal(key, value) {
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
}
function memoryStorage() {
  const map = new Map()
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  }
}
const local = memoryStorage()
const session = memoryStorage()
setGlobal('localStorage', local)
setGlobal('sessionStorage', session)
const location = { pathname: '/', search: '', hash: '', host: 'localhost', protocol: 'http:', href: 'http://localhost/' }
const history = {
  state: null,
  replaceState(state) { this.state = state },
  pushState(state) { this.state = state },
}
setGlobal('window', { location, history, addEventListener() {}, removeEventListener() {}, scrollTo() {}, open() {} })
setGlobal('location', location)
setGlobal('history', history)

const { default: api } = await import('../src/services/api.js')
const { default: router } = await import('../src/router/index.js')
const { createPinia } = await import('pinia')
const { RouterView } = await import('vue-router')
const { mountApp, flush, click, textOf, findAll } = await import('./helpers/mountApp.mjs')
const { showDevLogin, isDemoSession } = await import('../src/services/devMode.js')

let calls
let fetchCalls
let mounted
let warnings
const originalWarn = console.warn

function serve(table) {
  api.defaults.adapter = async (config) => {
    calls.push(config)
    const entry = table[`${config.method.toUpperCase()} ${api.getUri(config)}`]
    const [status, body] = entry ?? [404, { message: 'not stubbed' }]
    const response = { data: JSON.stringify(body), status, statusText: '', headers: {}, config }
    if (status >= 200 && status < 300) return response
    throw new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', config, {}, response)
  }
}

// courseDocuments dùng fetch: bảng theo "METHOD url"; giá trị [status, body] hoặc hàm trả [status, body].
function serveFetch(table) {
  setGlobal('fetch', async (url, options = {}) => {
    const key = `${options.method || 'GET'} ${url}`
    fetchCalls.push({ key, body: options.body })
    let entry = table[key]
    if (typeof entry === 'function') entry = entry()
    const [status, body] = entry ?? [404, { message: 'not stubbed' }]
    return { ok: status >= 200 && status < 300, status, json: async () => body }
  })
}

function loginAs(role, token = 'test-token') {
  local.map.clear()
  local.setItem('flts_token', token)
  local.setItem('flts_user', JSON.stringify({ id: role === 'student' ? 2 : 1, name: 'Demo', role }))
}

async function open(path) {
  await router.push(path)
  mounted = mountApp(RouterView, [createPinia(), router])
  await flush(10)
  return mounted
}

const byText = (m, tag, pattern) =>
  [...findAll(m.root, (n) => n.tag === tag), ...findAll(m.body, (n) => n.tag === tag)].filter((n) => pattern.test(textOf(n)))
const one = (m, name) => {
  const nodes = m.find(name)
  assert.equal(nodes.length, 1, `expected one [data-test=${name}]`)
  return nodes[0]
}
// v-model: gán value rồi gọi listener 'input' như trình duyệt.
function typeInto(node, value) {
  node.value = value
  for (const listener of node.listeners.input ?? []) listener({ target: node })
}

const course = { id: 1, lecturer_id: 1, code: 'FLIP-101', name: 'Flipped Learning Foundations' }
const doc = { id: 4, course_id: 1, original_name: 'Unit_1.pdf', processing_status: 'processed', size_bytes: 1024 }
const MOCK_MARKERS = /ENG101|Tiếng Anh Giao Tiếp Cơ Bản|Grammar_Unit_1_Present_Tenses/

beforeEach(async () => {
  calls = []
  fetchCalls = []
  warnings = []
  console.warn = (...args) => { warnings.push(args.map(String).join(' ')) }
  session.map.clear()
  local.map.clear()
  serve({ 'GET /api/courses/1/learning-objects': [200, { learning_objects: [] }] })
  await router.push('/login').catch(() => {})
})

afterEach(() => {
  mounted?.unmount()
  mounted = null
  console.warn = originalWarn
})

// ===== BL-05 =====
test('BL-05: modal Xóa tài liệu hiển thị, xác nhận gọi DELETE đúng 1 tài liệu; không còn Vue warn', async () => {
  loginAs('lecturer')
  serveFetch({
    'GET /api/courses?page=1': [200, { courses: [course] }],
    'GET /api/courses/1/documents?page=1': [200, { documents: [doc] }],
    'DELETE /api/courses/1/documents/4': [200, { message: 'ok' }],
  })
  const m = await open('/courses/1')
  const trigger = findAll(m.root, (n) => n.props.title === 'Xóa tài liệu')
  assert.equal(trigger.length, 1)
  await click(trigger[0])
  await flush()
  assert.match(m.text(), /Xác nhận xóa tài liệu/)
  await click(one(m, 'confirm-delete-document'))
  await flush()
  assert.deepEqual(fetchCalls.filter((c) => c.key.startsWith('DELETE')).map((c) => c.key), ['DELETE /api/courses/1/documents/4'])
  assert.equal(m.find('confirm-delete-document').length, 0) // modal đóng
  assert.deepEqual(warnings.filter((w) => /Extraneous|model-value|confirm-label/.test(w)), [])
})

test('BL-05: modal Tạo khóa học hiển thị, nút xác nhận gửi POST với dữ liệu nhập', async () => {
  loginAs('lecturer')
  serveFetch({
    'GET /api/courses?page=1': [200, { courses: [course] }],
    'GET /api/courses/1/documents?page=1': [200, { documents: [doc] }],
    'POST /api/courses': [201, { course: { id: 2, code: 'ENG301', name: 'Tiếng Anh 3' } }],
    'GET /api/courses/2/documents?page=1': [200, { documents: [] }],
  })
  const m = await open('/courses/1')
  await click(byText(m, 'button', /^\s*Tạo khóa học\s*$/)[0])
  await flush()
  assert.equal(m.find('confirm-create-course').length, 1)
  const [code] = findAll(m.body, (n) => n.tag === 'input' && n.props.placeholder === 'Ví dụ: ENG301')
  const [name] = findAll(m.body, (n) => n.tag === 'input' && /Thương Mại/.test(n.props.placeholder ?? ''))
  typeInto(code, 'eng301')
  typeInto(name, 'Tiếng Anh 3')
  await click(one(m, 'confirm-create-course'))
  await flush(10)
  const post = fetchCalls.find((c) => c.key === 'POST /api/courses')
  assert.deepEqual(JSON.parse(post.body), { name: 'Tiếng Anh 3', code: 'ENG301', description: null })
  assert.equal(m.find('confirm-create-course').length, 0)
  assert.deepEqual(warnings.filter((w) => /Extraneous|model-value|confirm-label/.test(w)), [])
})

// ===== BL-06 =====
test('BL-06: API khóa học lỗi → thông báo + Thử lại, không có dữ liệu mẫu', async () => {
  loginAs('lecturer')
  let attempt = 0
  serveFetch({
    'GET /api/courses?page=1': () => (++attempt === 1 ? [500, { message: 'down' }] : [200, { courses: [course] }]),
    'GET /api/courses/1/documents?page=1': [200, { documents: [doc] }],
  })
  const m = await open('/lecturer/courses')
  assert.match(textOf(one(m, 'workspace-load-error')), /Không tải được danh sách khóa học/)
  assert.doesNotMatch(m.text(), MOCK_MARKERS)

  await click(one(m, 'workspace-retry'))
  await flush(10)
  assert.equal(m.find('workspace-load-error').length, 0)
  assert.match(m.text(), /Unit_1\.pdf/)
})

test('BL-06: course thật chưa có tài liệu → trạng thái rỗng thật; lỗi tài liệu → thông báo lỗi', async () => {
  loginAs('lecturer')
  let docsAttempt = 0
  serveFetch({
    'GET /api/courses?page=1': [200, { courses: [course] }],
    'GET /api/courses/1/documents?page=1': () => (++docsAttempt === 1 ? [200, { documents: [] }] : [503, {}]),
  })
  const m = await open('/courses/1')
  assert.match(m.text(), /Chưa có tài liệu nào trong khóa học này/)
  assert.doesNotMatch(m.text(), MOCK_MARKERS)

  await click(byText(m, 'button', /^\s*Làm mới\s*$/)[0])
  await flush(10)
  assert.match(textOf(one(m, 'workspace-load-error')), /Không tải được danh sách tài liệu/)
  assert.doesNotMatch(m.text(), MOCK_MARKERS)
})

test('BL-06: phiên DEV Mode (token demo) vẫn dùng dữ liệu mẫu khi API lỗi', async () => {
  loginAs('lecturer', 'demo-token-lecturer')
  assert.equal(isDemoSession(), true)
  serveFetch({})
  const m = await open('/lecturer/courses')
  assert.match(m.text(), /ENG101/)
  assert.equal(m.find('workspace-load-error').length, 0)
})

// ===== BL-01 =====
test('BL-01: nút DEV Mode mặc định ẩn (kể cả có ?demo); chỉ bật khi VITE_SHOW_DEV_LOGIN=true', async () => {
  assert.equal(showDevLogin(undefined), false)
  assert.equal(showDevLogin({ DEV: true }), false)
  assert.equal(showDevLogin({ VITE_SHOW_DEV_LOGIN: 'false' }), false)
  assert.equal(showDevLogin({ VITE_SHOW_DEV_LOGIN: 'true' }), true)

  const m = await open('/login?demo')
  assert.equal(m.find('dev-login').length, 0)
  assert.doesNotMatch(m.text(), /DEV Mode/)
})

// ===== BL-03 =====
test('BL-03: 401 đặt cờ phiên hết hạn (không token); trang login báo một lần', async () => {
  loginAs('student')
  serve({ 'GET /api/courses': [401, { message: 'Unauthenticated.' }] })
  const { courses } = await import('../src/services/courses.js')
  await assert.rejects(courses.list())
  assert.equal(window.location.href, '/login')
  assert.equal(local.getItem('flts_token'), null)
  assert.deepEqual([...session.map.entries()], [['flts_session_expired', '1']])

  const m = await open('/login')
  assert.equal(textOf(one(m, 'session-expired')).trim(), 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại.')
  assert.equal(session.getItem('flts_session_expired'), null)
  m.unmount()
  mounted = mountApp(RouterView, [createPinia(), router])
  await flush()
  assert.equal(mounted.find('session-expired').length, 0)
})

// ===== BL-02 =====
test('BL-02: Khóa học của tôi lấy từ API thật; thống kê/đề xuất gắn nhãn minh họa và nút bị disable', async () => {
  loginAs('student')
  serve({ 'GET /api/courses': [200, { courses: [{ ...course, lecturer: { id: 1, name: 'Demo Lecturer' } }] }] })
  const m = await open('/dashboard/student')
  const rows = m.find('enrolled-course')
  assert.equal(rows.length, 1)
  assert.match(textOf(rows[0]), /FLIP-101/)
  assert.match(textOf(rows[0]), /Flipped Learning Foundations/)
  assert.match(textOf(rows[0]), /Giảng viên: Demo Lecturer/)
  assert.equal(rows[0].props.href, '/student/courses/1')
  assert.doesNotMatch(m.text(), /Tiếng Anh Giao Tiếp Cơ Bản|\d+%/)

  assert.match(textOf(one(m, 'stats-illustrative')), /Dữ liệu minh họa/)
  assert.match(textOf(one(m, 'recommended-illustrative')), /Dữ liệu minh họa/)
  for (const button of [one(m, 'continue-latest'), ...m.find('recommended-start')]) {
    assert.notEqual(button.props.disabled, undefined) // thuộc tính disabled tĩnh
    assert.equal(button.props.title, 'Tính năng đang phát triển')
  }
  assert.ok(calls.every((c) => c.method === 'get'))
})

test('BL-02: lỗi API hiện thông báo; chưa ghi danh → rỗng; DEV Mode không gọi API', async () => {
  loginAs('student')
  serve({ 'GET /api/courses': [500, {}] })
  let m = await open('/dashboard/student')
  assert.match(textOf(one(m, 'courses-error')), /Máy chủ đang gặp sự cố/)
  m.unmount()

  serve({ 'GET /api/courses': [200, { courses: [] }] })
  await router.push('/student/courses').catch(() => {}) // rời route để lần mở sau mount lại dashboard
  m = await open('/dashboard/student')
  assert.match(textOf(one(m, 'courses-empty')), /chưa tham gia khóa học nào/)
  m.unmount()
  await router.push('/student/courses').catch(() => {})

  loginAs('student', 'demo-token-student')
  calls = []
  m = await open('/dashboard/student')
  assert.equal(calls.length, 0)
  assert.equal(m.find('courses-demo').length, 1)
})
