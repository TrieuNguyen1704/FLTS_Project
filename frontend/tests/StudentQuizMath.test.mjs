import { test, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { AxiosError } from 'axios'

// FAST-05C: Student Quiz Player render LaTeX bằng MathText. Cùng cách mount như StudentNavigation.test.mjs.
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
setGlobal('window', { location, history, addEventListener() {}, removeEventListener() {}, scrollTo() {} })
setGlobal('location', location)
setGlobal('history', history)

const { default: api } = await import('../src/services/api.js')
const { default: router } = await import('../src/router/index.js')
const { createPinia } = await import('pinia')
const { RouterView } = await import('vue-router')
const { mountApp, flush, click, textOf } = await import('./helpers/mountApp.mjs')

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

const PLAYER = '/api/courses/1/learning-objects/7'
const XSS_TEXT = '<script>alert(1)</script><img src=x onerror=alert(2)>'
const TITLE = 'Ôn tập $x^2$'

const questions = [
  {
    id: 21,
    question_index: 0,
    question_text: `Tính $x^2$ khi x = 3 ${XSS_TEXT}`,
    options: [
      { id: 41, option_index: 0, option_text: '$x^2 = 6$' },
      { id: 42, option_index: 1, option_text: '$x^2 = 9$' },
    ],
  },
  { id: 22, question_index: 1, question_text: 'Câu thường', options: [{ id: 43, option_index: 0, option_text: `Lựa chọn ${XSS_TEXT}` }] },
]
const quizDetail = {
  learning_object: {
    id: 7,
    course_id: 1,
    type: 'quiz',
    title: TITLE,
    description: '',
    status: 'published',
    total_questions: 2,
    quiz: { id: 1, time_limit_minutes: null, passing_score: 60, total_questions: 2, questions },
  },
}
const history0 = { attempts: [], latest_score: null, best_score: null }
const startPayload = {
  attempt: { id: 11, attempt_number: 1, status: 'in_progress', started_at: null, expires_at: null, draft_answers: [] },
  quiz: { learning_object_id: 7, title: TITLE, time_limit_minutes: null, passing_score: 60, total_questions: 2, questions },
  server_time: '2026-10-30T06:53:46.370035Z',
}
const submitResponse = {
  attempt: { id: 11, status: 'completed', score: 50, total_correct: 1, auto_submitted: false },
  latest_score: 50,
  best_score: 50,
  results: [
    { question_id: 21, selected_option_id: 42, correct_option_id: 42, is_correct: true, explanation: 'Vì $3^2 = 9$', citations: [{ vector_id: 'v', document_name: 'Đại số $1$.pdf', source_locator: 'Trang $2$' }] },
    { question_id: 22, selected_option_id: null, correct_option_id: 43, is_correct: false, explanation: `Giải thích ${XSS_TEXT}`, citations: [] },
  ],
  timed_out: false,
}

// Text + HTML gắn bằng innerHTML (MathText) của một node.
function contentOf(node) {
  if (node.text !== undefined) return node.text
  return (node.props.innerHTML ?? '') + node.children.map(contentOf).join('')
}
const katexCount = (html) => (html.match(/class="katex"/g) || []).length
const hasExecutableMarkup = (html) => /<script|<img|<[^>]+\son\w+\s*=/i.test(html)
// Node thật được tạo ra từ chuỗi người dùng (không phải innerHTML đã sanitize): không được có thẻ script/img.
const rawTags = (node, found = []) => {
  if (node.tag === 'script' || node.tag === 'img') found.push(node.tag)
  for (const child of node.children) rawTags(child, found)
  return found
}
const change = (node) => node.props.onChange()
const patches = () => calls.filter((c) => c.method === 'patch')

async function openIntro(extra = {}) {
  serve({
    [`GET ${PLAYER}`]: [200, quizDetail],
    [`GET ${PLAYER}/quiz-attempts`]: [200, history0],
    [`POST ${PLAYER}/quiz-attempts`]: [201, startPayload],
    ...extra,
  })
  await router.push('/student/courses/1/quizzes/7')
  mounted = mountApp(RouterView, [createPinia(), router])
  await flush()
  return mounted
}

beforeEach(() => {
  calls = []
  storage.clear()
  storage.set('flts_token', 'test-token')
  storage.set('flts_user', JSON.stringify({ id: 2, name: 'Demo Student', role: 'student' }))
})

afterEach(() => {
  mounted?.unmount()
  mounted = null
})

test('MATH01: tiêu đề quiz ở màn Intro render KaTeX', async () => {
  const page = await openIntro()
  const html = contentOf(page.root)
  assert.ok(katexCount(html) >= 1)
  assert.doesNotMatch(textOf(page.root), /\$x\^2\$/) // không còn chuỗi LaTeX thô trong text node
  assert.equal(calls.filter((c) => c.method === 'post').length, 0) // chỉ xem Intro, không tạo attempt
})

test('MATH02: câu hỏi và lựa chọn có công thức render KaTeX; <script>/<img onerror> bị escape', async () => {
  const page = await openIntro()
  await click(page.find('start')[0])
  await flush()

  const question = page.find('question')[0]
  const html = contentOf(question)
  assert.ok(katexCount(html) >= 3, 'câu hỏi + 2 lựa chọn')
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;&lt;img src=x onerror=alert\(2\)&gt;/)
  assert.equal(hasExecutableMarkup(html.replace(/&lt;.*?&gt;/g, '')), false)
  assert.deepEqual(rawTags(page.root), [])

  // Option chứa công thức vẫn nằm trong <label> cùng radio, nên click vào chữ/công thức vẫn chọn được đáp án.
  const radio = page.find('option-42')[0]
  assert.equal(radio.parent.tag, 'label')
  assert.ok(katexCount(contentOf(radio.parent)) >= 1)
})

test('MATH03: chọn đáp án có công thức → autosave gửi đúng selected_option_id', async () => {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  try {
    const page = await openIntro({ [`PATCH ${PLAYER}/quiz-attempts/11`]: [200, { attempt: { id: 11, status: 'in_progress', draft_answers: [] }, server_time: '2026-10-30T07:00:15.000000Z' }] })
    await click(page.find('start')[0])
    await flush()
    change(page.find('option-42')[0])
    await flush()
    assert.equal(page.find('option-42')[0].props.checked, true)

    mock.timers.tick(15000)
    await flush()
    assert.equal(patches().length, 1)
    assert.deepEqual(JSON.parse(patches()[0].data), {
      answers: [
        { question_id: 21, selected_option_id: 42 },
        { question_id: 22, selected_option_id: null },
      ],
    })
  } finally {
    mounted?.unmount()
    mounted = null
    mock.timers.reset()
  }
})

test('MATH04: màn kết quả render KaTeX cho câu hỏi, đáp án, giải thích; citation giữ text thuần; XSS bị escape', async () => {
  const page = await openIntro({ [`POST ${PLAYER}/quiz-attempts/11/submit`]: [200, submitResponse] })
  await click(page.find('start')[0])
  await flush()
  change(page.find('option-42')[0])
  await flush()
  await click(page.find('submit')[0])
  await flush()
  await click(page.find('confirm-submit')[0])
  await flush()
  assert.equal(page.find('completed').length, 1)

  const first = page.find('result-21')[0]
  const firstHtml = contentOf(first)
  assert.ok(katexCount(firstHtml) >= 4, 'câu hỏi, bạn chọn, đáp án đúng, giải thích')
  assert.ok(katexCount(contentOf(page.find('result-explanation')[0])) >= 1)
  // Citation: text thuần, không render công thức.
  assert.match(textOf(page.find('result-citations')[0]), /Nguồn: Đại số \$1\$\.pdf — Trang \$2\$/)
  assert.equal(katexCount(contentOf(page.find('result-citations')[0])), 0)

  const second = page.find('result-22')[0]
  assert.match(textOf(second), /Giải thích <script>alert\(1\)<\/script><img src=x onerror=alert\(2\)>/) // chỉ là text
  assert.match(textOf(second), /Bạn chọn: Bỏ trống/)
  assert.deepEqual(rawTags(page.root), [])
  assert.match(textOf(page.find('result-21')[0].children[0]), /^Câu 1\. /)
  assert.match(contentOf(page.root), /Kết quả: /)
})
