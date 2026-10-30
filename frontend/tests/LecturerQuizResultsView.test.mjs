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
const location = { pathname: '/', search: '', hash: '', host: 'localhost', protocol: 'http:', href: 'http://localhost/' }
const history = {
  state: null,
  replaceState(state) { this.state = state },
  pushState(state) { this.state = state },
}
setGlobal('window', { location, history, addEventListener() {}, removeEventListener() {}, scrollTo() {}, confirm: () => true })
setGlobal('location', location)
setGlobal('history', history)

const { default: api } = await import('../src/services/api.js')
const { default: router } = await import('../src/router/index.js')
const { createPinia } = await import('pinia')
const { RouterView } = await import('vue-router')
const { h, defineComponent } = await import('vue')
const { default: CourseQuizList } = await import('../src/components/CourseQuizList.vue')
const { mountApp, flush, click, textOf } = await import('./helpers/mountApp.mjs')
const { resultsFixture } = await import('./helpers/quizResultsFixture.mjs')

let calls
let mounted

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

function loginAs(role) {
  storage.clear()
  storage.set('flts_token', 'test-token')
  storage.set('flts_user', JSON.stringify({ id: 1, name: 'Demo', role }))
}

const B = '/api/courses/3/learning-objects/7'
const RESULTS = '/lecturer/courses/3/quizzes/7/results'
const requestsTo = (key) => calls.filter((c) => `${c.method.toUpperCase()} ${api.getUri(c)}` === key)
const onlyGets = () => calls.every((c) => c.method === 'get')

const attemptDetail = {
  attempt: { id: 12, attempt_number: 2, score: 25, total_correct: 2, auto_submitted: false, duration_seconds: 600, student: { id: 2, name: 'Demo Student', email: 'student@flts.test' } },
  questions: [
    {
      id: 21,
      question_index: 0,
      question_text: 'Tính $x^2$ khi x = 3',
      selected_option_id: 41,
      correct_option_id: 42,
      is_correct: false,
      explanation: 'Vì $3^2 = 9$',
      citations: [],
      options: [
        { id: 41, option_index: 0, option_text: '6', is_correct: false },
        { id: 42, option_index: 1, option_text: '$9$', is_correct: true },
      ],
    },
    { id: 22, question_index: 1, question_text: 'Câu hai', selected_option_id: null, correct_option_id: 43, is_correct: false, explanation: '', citations: [], options: [{ id: 43, option_index: 0, option_text: 'X', is_correct: true }] },
  ],
}

async function openResults(table) {
  serve(table)
  await router.push(RESULTS)
  mounted = mountApp(RouterView, [createPinia(), router])
  await flush()
  return mounted
}

const one = (m, name) => {
  const nodes = m.find(name)
  assert.equal(nodes.length, 1, `expected one [data-test=${name}]`)
  return nodes[0]
}
function contentOf(node) {
  if (node.text !== undefined) return node.text
  return (node.props.innerHTML ?? '') + node.children.map(contentOf).join('')
}

beforeEach(async () => {
  calls = []
  loginAs('lecturer')
  await router.push('/lecturer/courses').catch(() => {})
})

afterEach(() => {
  mounted?.unmount()
  mounted = null
})

test('results: tổng quan + phân phối + bảng sinh viên; chỉ 1 GET, không gọi chi tiết từng bài', async () => {
  const m = await openResults({ [`GET ${B}/quiz-results`]: [200, resultsFixture] })
  assert.equal(calls.length, 1)
  assert.equal(requestsTo(`GET ${B}/quiz-results`).length, 1)

  assert.equal(textOf(one(m, 'summary-attempts')).trim(), '3')
  assert.match(textOf(one(m, 'summary-participants')), /2\/3/)
  assert.equal(textOf(one(m, 'summary-average')).trim(), '53.33%')
  assert.equal(textOf(one(m, 'summary-pass-rate')).trim(), '50%')
  assert.match(textOf(one(m, 'summary-range')), /Cao nhất 100% · Thấp nhất 25%/)
  assert.match(textOf(one(m, 'quiz-meta')), /8 câu · 25 phút · Điểm đạt 60%/)

  assert.equal(textOf(one(m, 'bucket-20–39')).replace(/\s+/g, ''), '220–39')
  assert.equal(textOf(one(m, 'bucket-80–100')).replace(/\s+/g, ''), '180–100')

  const rows = m.find('student-row')
  assert.equal(rows.length, 2)
  assert.match(textOf(rows[0]), /Demo Student/) // mặc định: nộp gần nhất trước
  assert.match(textOf(rows[0]), /student@flts\.test/)
  assert.match(textOf(rows[0]), /Chưa đạt/)
  assert.match(textOf(rows[0]), /10 phút/)
  assert.match(textOf(rows[1]), /Đạt/)
  assert.ok(onlyGets())
})

test('results: sắp xếp theo điểm và tìm kiếm theo tên không dấu', async () => {
  const m = await openResults({ [`GET ${B}/quiz-results`]: [200, resultsFixture] })
  await click(one(m, 'sort-latestScore'))
  await flush()
  assert.deepEqual(m.find('student-name').map((n) => textOf(n)), ['Lê Thế Hưng', 'Demo Student'])
  await click(one(m, 'sort-latestScore'))
  await flush()
  assert.deepEqual(m.find('student-name').map((n) => textOf(n)), ['Demo Student', 'Lê Thế Hưng'])

  one(m, 'search').props.onInput({ target: { value: 'hung' } })
  await flush()
  assert.deepEqual(m.find('student-name').map((n) => textOf(n)), ['Lê Thế Hưng'])
  one(m, 'search').props.onInput({ target: { value: 'không ai' } })
  await flush()
  assert.equal(m.find('student-row').length, 0)
  assert.equal(m.find('no-match').length, 1)
})

test('results: mở chi tiết một lượt làm — GET đúng 1 lần, MathText, đánh dấu đúng/sai', async () => {
  const m = await openResults({
    [`GET ${B}/quiz-results`]: [200, resultsFixture],
    [`GET ${B}/quiz-results/attempts/12`]: [200, attemptDetail],
  })
  await click(one(m, 'toggle-2'))
  await flush()
  assert.match(textOf(one(m, 'attempts-2')), /Tự nộp khi hết giờ/)
  await click(one(m, 'open-attempt-12'))
  await flush()

  assert.equal(requestsTo(`GET ${B}/quiz-results/attempts/12`).length, 1)
  const detail = one(m, 'attempt-detail')
  assert.match(textOf(detail), /Demo Student · Lượt 2 · 25%/)
  assert.match(contentOf(one(m, 'detail-question-0')), /class="katex"/)
  assert.match(textOf(one(m, 'detail-option-41')), /\(đã chọn\)/)
  assert.match(textOf(one(m, 'detail-option-42')), /✓ đáp án đúng/)
  assert.match(textOf(m.find('detail-verdict')[0]), /Sai/)
  assert.match(textOf(m.find('detail-verdict')[1]), /Bỏ trống/)

  await click(one(m, 'close-attempt'))
  await flush()
  assert.equal(m.find('attempt-detail').length, 0)
  assert.ok(onlyGets())
})

test('results: chưa có bài nộp → trạng thái rỗng', async () => {
  const m = await openResults({
    [`GET ${B}/quiz-results`]: [200, {
      quiz: { learning_object_id: 7, title: 'Q', passing_score: 60, total_questions: 3, time_limit_minutes: null },
      summary: { enrolled_students: 1, participants: 0, total_attempts: 0, average_score: null, highest_score: null, pass_rate: null },
      students: [],
    }],
  })
  assert.match(textOf(one(m, 'empty')), /Chưa có sinh viên nào nộp bài/)
  assert.equal(m.find('student-row').length, 0)
  assert.equal(m.find('distribution').length, 0)
  assert.equal(textOf(one(m, 'summary-average')).trim(), '—')
})

test('results: lỗi 403 hiện thông báo, không có dữ liệu mẫu', async () => {
  const m = await openResults({ [`GET ${B}/quiz-results`]: [403, {}] })
  assert.equal(textOf(one(m, 'load-error')).trim(), 'Bạn không có quyền xem kết quả quiz này.')
  assert.equal(m.find('summary').length, 0)
  assert.equal(m.find('student-row').length, 0)
})

test('route kết quả: sinh viên bị chặn bởi guard, không có request', async () => {
  loginAs('student')
  serve({})
  await router.push(RESULTS)
  assert.equal(router.currentRoute.value.name, 'student-dashboard')
  assert.equal(calls.length, 0)
})

test('CourseQuizList: nút "Kết quả" chỉ có ở quiz Đã xuất bản/Lưu trữ', async () => {
  serve({
    'GET /api/courses/3/learning-objects': [200, {
      learning_objects: [
        { id: 7, type: 'quiz', title: 'Nháp', status: 'draft', current_version: 1, generation: { status: 'completed' } },
        { id: 8, type: 'quiz', title: 'Xuất bản', status: 'published', current_version: 1, generation: { status: 'completed' } },
        { id: 9, type: 'quiz', title: 'Lưu trữ', status: 'archived', current_version: 1, generation: { status: 'completed' } },
        { id: 10, type: 'quiz', title: 'Đang tạo', status: 'draft', current_version: 0, generation: { status: 'queued' } },
      ],
    }],
  })
  mounted = mountApp(defineComponent({ render: () => h(CourseQuizList, { courseId: 3 }) }), [router])
  await flush()
  assert.deepEqual([7, 8, 9, 10].map((id) => mounted.find(`quiz-results-${id}`).length), [0, 1, 1, 0])
  assert.equal(mounted.find('quiz-results-8')[0].props.href, '/lecturer/courses/3/quizzes/8/results')
})

test('QuizEditorView: link "Xem kết quả" chỉ hiện khi quiz đã xuất bản', async () => {
  const quiz = { id: 1, time_limit_minutes: 25, passing_score: 60, total_questions: 0, questions: [] }
  const object = (status) => ({ learning_object: { id: 7, type: 'quiz', title: 'Q', status, current_version: 1, has_unpublished_changes: status === 'draft', generation: { status: 'completed' }, quiz } })
  for (const [status, expected] of [['published', 1], ['draft', 0]]) {
    serve({ [`GET ${B}`]: [200, object(status)] })
    await router.push('/lecturer/courses/3/quizzes/7/edit')
    mounted = mountApp(RouterView, [createPinia(), router])
    await flush()
    assert.equal(mounted.find('results-link').length, expected, status)
    if (expected) assert.equal(mounted.find('results-link')[0].props.href, RESULTS)
    mounted.unmount()
    mounted = null
    await router.push('/lecturer/courses').catch(() => {})
  }
})
