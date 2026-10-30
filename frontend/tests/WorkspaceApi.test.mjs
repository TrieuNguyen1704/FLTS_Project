import { test, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { AxiosError } from 'axios'

// FAST-07A2: CourseWorkspaceView gọi đúng endpoint xử lý tài liệu / RAG / xóa và không báo thành công giả.
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
setGlobal('localStorage', local)
setGlobal('sessionStorage', memoryStorage())
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

let fetchCalls
let mounted

// Learning-objects (CourseQuizList) đi qua axios; courseDocuments đi qua fetch.
api.defaults.adapter = async (config) => {
  const response = { data: JSON.stringify({ learning_objects: [] }), status: 200, statusText: '', headers: {}, config }
  if (api.getUri(config).endsWith('/learning-objects')) return response
  throw new AxiosError('not stubbed', 'ERR_BAD_REQUEST', config, {}, { ...response, status: 404 })
}

// Bảng "METHOD url" → [status, body] | hàm trả [status, body] (có thể async) | 'network'.
function serveFetch(table) {
  setGlobal('fetch', async (url, options = {}) => {
    const key = `${options.method || 'GET'} ${url}`
    fetchCalls.push({ key, body: options.body })
    let entry = table[key]
    if (typeof entry === 'function') entry = await entry()
    if (entry === 'network') throw new TypeError('Failed to fetch')
    const [status, body] = entry ?? [404, { message: 'not stubbed' }]
    return { ok: status >= 200 && status < 300, status, json: async () => body }
  })
}

function loginAs(token = 'test-token') {
  local.map.clear()
  local.setItem('flts_token', token)
  local.setItem('flts_user', JSON.stringify({ id: 1, name: 'Demo Lecturer', role: 'lecturer' }))
}

async function open(path) {
  await router.push(path)
  mounted = mountApp(RouterView, [createPinia(), router])
  await flush(10)
  return mounted
}

const buttons = (m, pattern) => [...findAll(m.root, (n) => n.tag === 'button'), ...findAll(m.body, (n) => n.tag === 'button')]
  .filter((n) => pattern.test(textOf(n).trim()))
const one = (m, name) => {
  const nodes = m.find(name)
  assert.equal(nodes.length, 1, `expected one [data-test=${name}]`)
  return nodes[0]
}
const keys = (prefix) => fetchCalls.filter((c) => c.key.startsWith(prefix)).map((c) => c.key)

const course = { id: 1, lecturer_id: 1, code: 'FLIP-101', name: 'Flipped Learning Foundations' }
const pendingDoc = { id: 4, course_id: 1, original_name: 'Unit_1.pdf', processing_status: 'uploaded_pending_processing' }
const failedDoc = { id: 5, course_id: 1, original_name: 'Unit_2.pdf', processing_status: 'failed' }
const processedDoc = { id: 6, course_id: 1, original_name: 'Unit_3.pdf', processing_status: 'processed' }
const BASE = {
  'GET /api/courses?page=1': [200, { courses: [course] }],
}
const docs = (...list) => ({ 'GET /api/courses/1/documents?page=1': [200, { documents: list }] })
const FAKE_SUCCESS = /đã được AI phân tích và nhúng vector thành công|Đã thử lại thành công|Kết quả phân tích RAG cho/

beforeEach(async () => {
  fetchCalls = []
  loginAs()
  await router.push('/login').catch(() => {})
})

afterEach(() => {
  mounted?.unmount()
  mounted = null
  mock.timers.reset()
})

// ===== Xử lý AI =====
test('xử lý AI: POST processing-runs rồi poll GET processing đến processed (không tự báo thành công)', async () => {
  let polls = 0
  serveFetch({
    ...BASE,
    ...docs({ ...pendingDoc }),
    'POST /api/courses/1/documents/4/processing-runs': [202, { run: { id: 9, status: 'queued' }, message: 'Document processing queued.' }],
    'GET /api/courses/1/documents/4/processing': () => [200, { document: { id: 4, processing_status: ++polls < 2 ? 'processing' : 'processed' }, run: { status: 'completed' } }],
  })
  mock.timers.enable({ apis: ['setTimeout'] })
  const m = await open('/courses/1')
  await click(buttons(m, /^Bắt đầu xử lý AI$/)[0])
  await flush()
  const post = fetchCalls.find((c) => c.key === 'POST /api/courses/1/documents/4/processing-runs')
  assert.ok(post)
  assert.equal(post.body, '{}')
  assert.match(m.text(), /vào hàng đợi xử lý AI/)
  assert.doesNotMatch(m.text(), /đã được AI xử lý xong/)

  mock.timers.tick(4000)
  await flush()
  mock.timers.tick(4000)
  await flush()
  assert.equal(keys('GET /api/courses/1/documents/4/processing').length, 2)
  assert.match(m.text(), /đã được AI xử lý xong/)
  mock.timers.tick(20000)
  await flush()
  assert.equal(keys('GET /api/courses/1/documents/4/processing').length, 2) // dừng poll
})

test('xử lý AI lỗi: báo lỗi tiếng Việt, không đổi trạng thái, không có thành công giả', async () => {
  serveFetch({ ...BASE, ...docs({ ...pendingDoc }), 'POST /api/courses/1/documents/4/processing-runs': [503, { message: 'down' }] })
  mock.timers.enable({ apis: ['setTimeout'] })
  const m = await open('/courses/1')
  await click(buttons(m, /^Bắt đầu xử lý AI$/)[0])
  await flush()
  mock.timers.tick(5000)
  await flush()
  assert.match(m.text(), /Dịch vụ AI tạm thời không khả dụng/)
  assert.doesNotMatch(m.text(), FAKE_SUCCESS)
  assert.equal(buttons(m, /^Bắt đầu xử lý AI$/).length, 1) // vẫn ở trạng thái chờ xử lý
  assert.deepEqual(keys('GET /api/courses/1/documents/4/processing'), [])
})

test('thử lại: POST processing-runs/retry; lỗi 422 báo đúng, không mô phỏng thành công', async () => {
  serveFetch({ ...BASE, ...docs({ ...failedDoc }), 'POST /api/courses/1/documents/5/processing-runs/retry': [422, { message: 'Only a failed document can be retried.' }] })
  mock.timers.enable({ apis: ['setTimeout'] })
  const m = await open('/courses/1')
  await click(buttons(m, /^Thử lại$/)[0])
  await flush()
  mock.timers.tick(5000)
  await flush()
  assert.deepEqual(keys('POST'), ['POST /api/courses/1/documents/5/processing-runs/retry'])
  assert.match(m.text(), /Chỉ thử lại được tài liệu đang ở trạng thái lỗi/)
  assert.doesNotMatch(m.text(), FAKE_SUCCESS)
})

test('DEV Mode: xử lý AI vẫn mô phỏng như Sprint 2', async () => {
  loginAs('demo-token-lecturer')
  serveFetch({})
  mock.timers.enable({ apis: ['setTimeout'] })
  const m = await open('/lecturer/courses')
  await click(buttons(m, /^Bắt đầu xử lý AI$/)[0])
  await flush()
  mock.timers.tick(3000)
  await flush()
  assert.match(m.text(), /đã được AI phân tích và nhúng vector thành công/)
})

// ===== RAG Workbench =====
async function askRag(m, question) {
  const [textarea] = findAll(m.root, (n) => n.props.id === 'rag-input')
  textarea.value = question
  for (const listener of textarea.listeners.input ?? []) listener({ target: textarea })
  await flush()
  await click(buttons(m, /Tạo câu trả lời kèm dẫn chứng/)[0])
  await flush()
}

test('RAG: POST evidence-prototypes {prompt, top_k}; hiển thị câu trả lời + trích dẫn thật', async () => {
  serveFetch({
    ...BASE,
    ...docs({ ...processedDoc }),
    'POST /api/courses/1/evidence-prototypes': [200, {
      evidence: { answer: 'Thì hiện tại hoàn thành nối quá khứ với hiện tại.', citations: [{ vector_id: 'v-7', source_locator: 'page 3' }], limitations: 'Chỉ dựa trên Unit 3.' },
      retrieval: { query: 'q', matches: [{ vector_id: 'v-7', content: 'Present perfect connects past and present.', score: 0.82, document_id: 6, document_name: 'Unit_3.pdf', source_locator: 'page 3' }] },
    }],
  })
  const m = await open('/courses/1?tab=workbench')
  await askRag(m, 'Present perfect là gì?')
  const post = fetchCalls.find((c) => c.key === 'POST /api/courses/1/evidence-prototypes')
  assert.deepEqual(JSON.parse(post.body), { prompt: 'Present perfect là gì?', top_k: 5 })
  const result = textOf(one(m, 'rag-result'))
  assert.match(result, /Unit_3\.pdf/)
  assert.match(result, /page 3/)
  assert.match(result, /Present perfect connects past and present/)
  assert.match(result, /82\.0%/)
  assert.doesNotMatch(result, /Trang 1/)
  assert.equal(m.find('rag-demo-label').length, 0)
  assert.equal(m.find('rag-error').length, 0)
})

test('RAG lỗi: hiện thông báo, KHÔNG trả câu trả lời mẫu', async () => {
  serveFetch({ ...BASE, ...docs({ ...processedDoc }), 'POST /api/courses/1/evidence-prototypes': [422, { message: 'No processed source chunks matched this request.' }] })
  mock.timers.enable({ apis: ['setTimeout'] })
  const m = await open('/courses/1?tab=workbench')
  await askRag(m, 'Câu hỏi lạc đề')
  mock.timers.tick(3000)
  await flush()
  assert.match(textOf(one(m, 'rag-error')), /Không tìm thấy nội dung phù hợp/)
  assert.equal(m.find('rag-result').length, 0)
  assert.doesNotMatch(m.text(), FAKE_SUCCESS)
})

test('RAG DEV Mode: câu trả lời mô phỏng có nhãn "Dữ liệu minh họa"', async () => {
  loginAs('demo-token-lecturer')
  serveFetch({})
  mock.timers.enable({ apis: ['setTimeout'] })
  const m = await open('/lecturer/courses?tab=workbench')
  await askRag(m, 'Câu hỏi demo')
  mock.timers.tick(1500)
  await flush()
  assert.equal(m.find('rag-result').length, 1)
  assert.match(textOf(one(m, 'rag-demo-label')), /Dữ liệu minh họa/)
  assert.deepEqual(keys('POST'), [])
})

// ===== Xóa tài liệu =====
async function openDelete(m, name) {
  const trigger = findAll(m.root, (n) => n.props.title === 'Xóa tài liệu')
  await click(trigger[name])
  await flush()
}

test('xóa thành công: DELETE đúng 1 lần dù double-click, dòng biến mất', async () => {
  let release
  serveFetch({
    ...BASE,
    ...docs({ ...processedDoc }),
    'DELETE /api/courses/1/documents/6': () => new Promise((resolve) => { release = () => resolve([200, { message: 'Document deleted.' }]) }),
  })
  const m = await open('/courses/1')
  await openDelete(m, 0)
  const confirm = one(m, 'confirm-delete-document')
  click(confirm)
  click(confirm)
  await flush()
  assert.deepEqual(keys('DELETE'), ['DELETE /api/courses/1/documents/6'])
  release()
  await flush()
  assert.doesNotMatch(textOf(m.root), /Unit_3\.pdf/)
  assert.match(m.text(), /Đã xóa tài liệu thành công/)
})

test('xóa lỗi 409 / mất mạng: giữ nguyên dòng, hiện lỗi, không báo thành công', async () => {
  let attempt = 0
  serveFetch({
    ...BASE,
    ...docs({ ...processedDoc }),
    'DELETE /api/courses/1/documents/6': () => (++attempt === 1 ? [409, { message: 'busy' }] : 'network'),
  })
  const m = await open('/courses/1')
  await openDelete(m, 0)
  await click(one(m, 'confirm-delete-document'))
  await flush()
  assert.match(textOf(m.root), /Unit_3\.pdf/)
  assert.match(m.text(), /Tài liệu đang được xử lý nên chưa thể xóa/)
  assert.doesNotMatch(m.text(), /Đã xóa tài liệu/)

  await openDelete(m, 0)
  await click(one(m, 'confirm-delete-document'))
  await flush()
  assert.match(textOf(m.root), /Unit_3\.pdf/)
  assert.match(m.text(), /Không thể kết nối tới máy chủ/)
})
