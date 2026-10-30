import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { AxiosError } from 'axios'

// Alias '@/' và file .vue cần loader riêng; mọi module src được import động sau khi đăng ký.
register('./helpers/vueLoader.mjs', import.meta.url)

const storage = new Map()
function setGlobal(key, value) {
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
}
setGlobal('localStorage', {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
})
const listeners = new Map()
const location = { pathname: '/', search: '', hash: '', host: 'localhost', protocol: 'http:', href: 'http://localhost/' }
const history = {
  state: null,
  replaceState(state) { this.state = state },
  pushState(state) { this.state = state },
}
let confirmAnswer = true
let confirmCalls = 0
setGlobal('window', {
  location,
  history,
  addEventListener: (type, fn) => listeners.set(type, fn),
  removeEventListener: (type, fn) => { if (listeners.get(type) === fn) listeners.delete(type) },
  scrollTo() {},
  confirm: () => { confirmCalls++; return confirmAnswer },
})
setGlobal('location', location)
setGlobal('history', history)

const { default: api } = await import('../src/services/api.js')
const { default: router } = await import('../src/router/index.js')
const { createPinia } = await import('pinia')
const { RouterView } = await import('vue-router')
const { h, ref, defineComponent } = await import('vue')
const { default: CourseQuizList } = await import('../src/components/CourseQuizList.vue')
const { mountApp, flush, click, textOf } = await import('./helpers/mountApp.mjs')

let calls
let routes
let mounted

function serve(table) {
  routes = table
  api.defaults.adapter = async (config) => {
    calls.push(config)
    const key = `${config.method.toUpperCase()} ${api.getUri(config)}`
    let entry = routes[key]
    if (typeof entry === 'function') entry = await entry(config)
    if (entry === 'network') throw new AxiosError('Network Error', 'ERR_NETWORK', config)
    const [status, body] = entry ?? [404, { message: 'not stubbed' }]
    const response = { data: JSON.stringify(body), status, statusText: '', headers: {}, config }
    if (status >= 200 && status < 300) return response
    throw new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', config, {}, response)
  }
}

function loginAs(role) {
  storage.clear()
  storage.set('flts_token', 'test-token')
  storage.set('flts_user', JSON.stringify({ id: 1, name: 'Demo Lecturer', role }))
}

const B = '/api/courses/3/learning-objects/7'
const EDIT = '/lecturer/courses/3/quizzes/7/edit'
const requestsTo = (key) => calls.filter((c) => `${c.method.toUpperCase()} ${api.getUri(c)}` === key)

const citation = { vector_id: 'v-1', source_locator: 'Trang 3', document_id: 4, document_name: 'Unit_1.pdf' }
const question = (n) => ({
  id: null,
  question_index: n,
  question_text: n === 0 ? 'Tính $x^2$ khi x = 3' : `Câu hỏi số ${n}`,
  question_type: 'single_choice',
  explanation: `Giải thích ${n}`,
  citations: [citation],
  options: ['A', 'B', 'C', 'D'].map((text, i) => ({ id: null, option_index: i, option_text: `${text}${n}`, is_correct: i === 1 })),
})
const lo = (overrides = {}) => ({
  learning_object: {
    id: 7,
    course_id: 3,
    type: 'quiz',
    title: 'Quiz: Thì hiện tại',
    description: null,
    status: 'draft',
    current_version: 1,
    published_version: null,
    has_unpublished_changes: true,
    generation: { id: 1, status: 'completed' },
    quiz: { id: 1, time_limit_minutes: 25, passing_score: 60, total_questions: 3, questions: [0, 1, 2].map(question) },
    ...overrides,
  },
})

async function openEditor(table) {
  serve(table)
  await router.push(EDIT)
  mounted = mountApp(RouterView, [createPinia(), router])
  await flush()
  return mounted
}

const one = (m, name) => {
  const nodes = m.find(name)
  assert.equal(nodes.length, 1, `expected one [data-test=${name}]`)
  return nodes[0]
}
const input = (node, value) => node.props.onInput({ target: { value } })
// Text + HTML của MathText (gắn bằng innerHTML) để kiểm tra nội dung hiển thị.
function contentOf(node) {
  if (node.text !== undefined) return node.text
  return (node.props.innerHTML ?? '') + node.children.map(contentOf).join('')
}

beforeEach(async () => {
  calls = []
  confirmAnswer = true
  confirmCalls = 0
  loginAs('lecturer')
  await router.push('/lecturer/courses').catch(() => {})
})

afterEach(async () => {
  confirmAnswer = true
  mounted?.unmount()
  mounted = null
})

test('editor: tải quiz nháp, hiển thị câu hỏi + citation, công thức được render bằng KaTeX', async () => {
  const m = await openEditor({ [`GET ${B}`]: [200, lo()] })
  assert.equal(requestsTo(`GET ${B}`).length, 1)
  assert.equal(one(m, 'field-title').props.value, 'Quiz: Thì hiện tại')
  assert.equal(one(m, 'field-q0-question_text').props.value, 'Tính $x^2$ khi x = 3')
  assert.equal(one(m, 'correct-q0-1').props.checked, true)
  assert.match(textOf(one(m, 'citation-q0-0')), /Unit_1\.pdf · Trang 3/)
  assert.match(contentOf(one(m, 'question-0')), /class="katex"/)
  assert.equal(m.find('save-button')[0].props.disabled, true) // chưa có thay đổi
  assert.equal(m.find('readonly-reason').length, 0)
  assert.equal(typeof listeners.get('beforeunload'), 'function')
})

test('editor: sửa → dirty; double-click Lưu chỉ 1 PATCH; nạp lại từ response và hết dirty', async () => {
  let release
  const m = await openEditor({
    [`GET ${B}`]: [200, lo()],
    [`PATCH ${B}`]: (config) => new Promise((resolve) => {
      const body = JSON.parse(config.data)
      release = () => resolve([200, lo({ current_version: 2, title: body.title, quiz: { ...lo().learning_object.quiz, questions: body.questions.map((q, n) => ({
        id: null, question_index: n, question_text: q.question_text, explanation: q.explanation, citations: q.citations,
        options: q.options.map((text, i) => ({ id: null, option_index: i, option_text: text, is_correct: i === q.correct_index })),
      })) } })])
    }),
  })
  input(one(m, 'field-q1-option-2'), 'Đáp án mới')
  one(m, 'correct-q2-3').props.onChange()
  await flush()
  assert.equal(m.find('dirty-indicator').length, 1)

  click(one(m, 'save-button'))
  click(one(m, 'save-button'))
  await flush()
  assert.equal(requestsTo(`PATCH ${B}`).length, 1)
  const body = JSON.parse(requestsTo(`PATCH ${B}`)[0].data)
  assert.deepEqual(body.questions[1].options, ['A1', 'B1', 'Đáp án mới', 'D1'])
  assert.equal(body.questions[2].correct_index, 3)
  assert.deepEqual(body.questions[0].citations, [citation])
  assert.equal(body.time_limit_minutes, 25)

  release()
  await flush()
  assert.equal(m.find('dirty-indicator').length, 0)
  assert.match(textOf(one(m, 'notice')), /phiên bản 2/)
  assert.equal(one(m, 'field-q1-option-2').props.value, 'Đáp án mới')
})

test('editor: validate phía client chặn PATCH; 422 của backend hiện đúng ô', async () => {
  const m = await openEditor({
    [`GET ${B}`]: [200, lo()],
    [`PATCH ${B}`]: [422, { message: 'invalid', errors: { 'questions.1.options.2': ['The option field is required.'], title: ['The title is taken.'] } }],
  })
  input(one(m, 'field-q0-explanation'), '')
  await flush()
  await click(one(m, 'save-button'))
  await flush()
  assert.equal(requestsTo(`PATCH ${B}`).length, 0)
  assert.match(textOf(one(m, 'error-q0-explanation')), /Giải thích là bắt buộc/)

  input(one(m, 'field-q0-explanation'), 'Giải thích đầy đủ')
  await flush()
  await click(one(m, 'save-button'))
  await flush()
  assert.equal(requestsTo(`PATCH ${B}`).length, 1)
  assert.match(textOf(one(m, 'error-q1-option-2')), /The option field is required/)
  assert.match(textOf(one(m, 'error-title')), /taken/)
  assert.match(textOf(one(m, 'save-error')), /Dữ liệu gửi lên không hợp lệ/)
})

test('editor: 409 hiện thông báo fallback', async () => {
  const m = await openEditor({ [`GET ${B}`]: [200, lo()], [`PATCH ${B}`]: [409, {}] })
  input(one(m, 'field-title'), 'Tiêu đề mới')
  await flush()
  await click(one(m, 'save-button'))
  await flush()
  assert.equal(textOf(one(m, 'save-error')), 'Quiz đang được tạo hoặc đang bị khóa, thử lại sau.')
  assert.equal(m.find('dirty-indicator').length, 1) // giữ thay đổi của người dùng
})

test('editor: chặn xuất bản khi còn thay đổi chưa lưu', async () => {
  const m = await openEditor({ [`GET ${B}`]: [200, lo()], [`POST ${B}/publish`]: [200, lo({ status: 'published' })] })
  input(one(m, 'field-title'), 'Tiêu đề mới')
  await flush()
  await click(one(m, 'publish-button'))
  await flush()
  assert.match(textOf(one(m, 'action-error')), /lưu thay đổi trước khi xuất bản/)
  assert.equal(m.find('confirm-panel').length, 0)
  assert.equal(requestsTo(`POST ${B}/publish`).length, 0)
})

test('editor: xuất bản qua hộp xác nhận, gọi đúng 1 lần rồi chuyển chỉ đọc', async () => {
  let release
  const m = await openEditor({
    [`GET ${B}`]: [200, lo()],
    [`POST ${B}/publish`]: () => new Promise((resolve) => {
      release = () => resolve([200, { ...lo({ status: 'published', has_unpublished_changes: false, published_version: 1 }), message: 'Quiz published.' }])
    }),
  })
  await click(one(m, 'publish-button'))
  await flush()
  assert.match(textOf(one(m, 'confirm-panel')), /Sinh viên đã ghi danh sẽ thấy/)

  click(one(m, 'confirm-yes'))
  click(one(m, 'confirm-yes'))
  await flush()
  assert.equal(requestsTo(`POST ${B}/publish`).length, 1)
  release()
  await flush()

  assert.match(textOf(one(m, 'notice')), /Sinh viên đã ghi danh khóa học sẽ thấy quiz này/)
  assert.equal(textOf(one(m, 'editor-badge')).trim(), 'Đã xuất bản')
  assert.equal(m.find('field-title').length, 0)
  assert.equal(m.find('save-button').length, 0)
  assert.equal(m.find('publish-button').length, 0)
  assert.match(textOf(one(m, 'readonly-reason')), /đã xuất bản/)
})

test('editor: quiz đã xuất bản → chỉ đọc, chỉ còn Lưu trữ (có xác nhận)', async () => {
  const m = await openEditor({
    [`GET ${B}`]: [200, lo({ status: 'published', has_unpublished_changes: false })],
    [`POST ${B}/archive`]: [200, lo({ status: 'archived', has_unpublished_changes: false })],
  })
  assert.equal(m.find('field-title').length, 0)
  assert.equal(m.find('readonly-summary').length, 1)
  assert.match(contentOf(one(m, 'readonly-q0-option-1')), /✓/)

  await click(one(m, 'archive-button'))
  await flush()
  assert.equal(requestsTo(`POST ${B}/archive`).length, 0)
  await click(one(m, 'confirm-yes'))
  await flush()
  assert.equal(requestsTo(`POST ${B}/archive`).length, 1)
  assert.match(textOf(one(m, 'notice')), /không còn thấy/)
  assert.equal(m.find('archive-button').length, 0)
})

test('editor: đang có generation run → chỉ đọc kèm thông báo', async () => {
  const m = await openEditor({ [`GET ${B}`]: [200, lo({ generation: { status: 'generating' } })] })
  assert.match(textOf(one(m, 'readonly-reason')), /đang được AI tạo/)
  assert.equal(m.find('field-title').length, 0)
  assert.equal(m.find('publish-button').length, 0)
})

test('editor: rời trang khi còn thay đổi chưa lưu phải xác nhận', async () => {
  const m = await openEditor({ [`GET ${B}`]: [200, lo()] })
  input(one(m, 'field-title'), 'Tiêu đề mới')
  await flush()

  const event = { preventDefault() { this.prevented = true }, returnValue: undefined }
  listeners.get('beforeunload')(event)
  assert.equal(event.prevented, true)

  confirmAnswer = false
  await router.push('/lecturer/courses').catch(() => {})
  await flush()
  assert.equal(confirmCalls, 1)
  assert.equal(router.currentRoute.value.fullPath, EDIT)

  confirmAnswer = true
  await router.push('/dashboard/lecturer').catch(() => {})
  await flush()
  assert.equal(router.currentRoute.value.name, 'lecturer-dashboard')
})

test('route chỉnh sửa: sinh viên bị chặn bởi guard', async () => {
  loginAs('student')
  serve({})
  await router.push(EDIT)
  assert.equal(router.currentRoute.value.name, 'student-dashboard')
  assert.equal(requestsTo(`GET ${B}`).length, 0)
})

// ===== Danh sách quiz của khóa học =====
const L = 'GET /api/courses/3/learning-objects'
const summaries = {
  learning_objects: [
    { id: 7, type: 'quiz', title: 'Quiz nháp', status: 'draft', current_version: 1, total_questions: 3, generation: { status: 'completed' } },
    { id: 8, type: 'quiz', title: 'Quiz đã xuất bản', status: 'published', current_version: 1, has_unpublished_changes: false, generation: { status: 'completed' } },
    { id: 9, type: 'quiz', title: 'Quiz lưu trữ', status: 'archived', current_version: 1, generation: { status: 'completed' } },
    { id: 10, type: 'quiz', title: 'Quiz đang tạo', status: 'draft', current_version: 0, generation: { status: 'queued' } },
    { id: 11, type: 'quiz', title: 'Quiz lỗi', status: 'draft', current_version: 0, generation: { status: 'failed' } },
    { id: 12, type: 'flashcard', title: 'Bộ thẻ', status: 'draft', current_version: 1 },
  ],
}

function mountList(table) {
  serve(table)
  const refreshKey = ref(0)
  const Root = defineComponent({ render: () => h(CourseQuizList, { courseId: 3, refreshKey: refreshKey.value }) })
  mounted = mountApp(Root, [router])
  return { ...mounted, refreshKey }
}

test('danh sách quiz: chỉ type quiz, badge đúng trạng thái, link tới trình chỉnh sửa', async () => {
  const m = mountList({ [L]: [200, summaries] })
  await flush()
  assert.equal(m.find('quiz-row').length, 5)
  const badges = Object.fromEntries([7, 8, 9, 10, 11].map((id) => [id, textOf(one(m, `quiz-badge-${id}`)).trim()]))
  assert.deepEqual(badges, { 7: 'Nháp', 8: 'Đã xuất bản', 9: 'Lưu trữ', 10: 'Đang tạo', 11: 'Tạo lỗi' })
  assert.equal(one(m, 'quiz-edit-7').props.href, EDIT)
  assert.doesNotMatch(m.text(), /Bộ thẻ/)
})

test('danh sách quiz: lỗi API hiện thông báo, không rơi về dữ liệu mẫu; refreshKey đổi thì tải lại', async () => {
  let attempt = 0
  const m = mountList({ [L]: () => (++attempt === 1 ? [500, { message: 'SQL' }] : [200, summaries]) })
  await flush()
  assert.match(textOf(one(m, 'quiz-list-error')), /Máy chủ đang gặp sự cố/)
  assert.equal(m.find('quiz-row').length, 0)

  m.refreshKey.value++
  await flush()
  assert.equal(requestsTo(L).length, 2)
  assert.equal(m.find('quiz-row').length, 5)
  assert.equal(m.find('quiz-list-error').length, 0)
})

// ===== CourseWorkspaceView với route thật + course thật (FIX-QUIZLIST) =====
// courseDocuments dùng fetch (không qua axios): giả fetch theo URL; learning-objects đi qua adapter axios.
function serveFetch(table) {
  const fetchCalls = []
  setGlobal('fetch', async (url) => {
    fetchCalls.push(url)
    const [status, body] = table[url] ?? [404, { message: 'not stubbed' }]
    return { ok: status >= 200 && status < 300, status, json: async () => body }
  })
  return fetchCalls
}

const realCourse = { id: 1, lecturer_id: 1, code: 'FLIP-101', name: 'Flipped Learning Foundations', is_enrollment_open: true }
const realDocuments = { documents: [{ id: 4, course_id: 1, original_name: 'Unit_1.pdf', processing_status: 'processed' }] }

for (const path of ['/courses/1', '/lecturer/courses?id=1']) {
  test(`workspace ${path}: mục "Quiz của khóa học" hiện dưới bảng tài liệu và gọi GET learning-objects của course 1`, async () => {
    serveFetch({
      '/api/courses?page=1': [200, { courses: [realCourse], meta: { current_page: 1, last_page: 1 } }],
      '/api/courses/1/documents?page=1': [200, realDocuments],
    })
    serve({ 'GET /api/courses/1/learning-objects': [200, summaries] })
    await router.push(path)
    mounted = mountApp(RouterView, [createPinia(), router])
    await flush(10)

    assert.equal(requestsTo('GET /api/courses/1/learning-objects').length, 1)
    assert.match(mounted.text(), /Unit_1\.pdf/) // tài liệu thật, không phải dữ liệu mẫu
    assert.match(mounted.text(), /Quiz của khóa học/)
    assert.equal(mounted.find('quiz-row').length, 5)
    assert.equal(mounted.find('open-quiz-generator').length, 1)
  })
}
