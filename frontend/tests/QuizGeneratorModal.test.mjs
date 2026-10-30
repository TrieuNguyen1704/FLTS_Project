import { test, beforeEach, afterEach, mock } from 'node:test'
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
setGlobal('window', { location: { href: '/lecturer/courses' }, addEventListener() {}, removeEventListener() {} })

const { default: api } = await import('../src/services/api.js')
const { default: QuizGeneratorModal } = await import('../src/views/QuizGeneratorModal.vue')
const { h, ref, defineComponent } = await import('vue')
const { mountApp, flush, click } = await import('./helpers/mountApp.mjs')

let calls
let routes
let mounted

// Adapter giả theo "METHOD url"; giá trị là [status, body], hàm trả [status, body] (có thể async) hoặc
// 'network' để mô phỏng mất kết nối.
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

const C = '/api/courses/3/learning-objects'
const DOCS = 'GET /api/courses/3/documents'
const CREATE = `POST ${C}/quizzes`
const PREVIEW = `POST ${C}/source-preview`
const SHOW = `GET ${C}/7`
const RETRY = `POST ${C}/7/generation-runs/retry`

const documents = {
  documents: [
    { id: 4, original_name: 'Unit_1.pdf', processing_status: 'processed' },
    { id: 5, original_name: 'Unit_2.pdf', processing_status: 'processing' },
    { id: 6, original_name: 'Unit_3.pdf', processing_status: 'failed' },
  ],
}
const object = (status, extra = {}) => ({
  learning_object: {
    id: 7,
    type: 'quiz',
    status: 'draft',
    title: 'Quiz: Thì hiện tại',
    total_questions: status === 'completed' ? 10 : 0,
    quiz: null,
    generation: { id: 1, status, attempt_number: 1, error_code: null, error_message: null, ...extra },
  },
})

const requestsTo = (key) => calls.filter((c) => `${c.method.toUpperCase()} ${api.getUri(c)}` === key)
const bodyOf = (config) => JSON.parse(config.data)

function mountModal({ show = true } = {}) {
  const visible = ref(show)
  const events = { created: [], close: 0 }
  const Root = defineComponent({
    render: () => h(QuizGeneratorModal, {
      show: visible.value,
      courseId: 3,
      onCreated: (id) => events.created.push(id),
      onClose: () => { events.close++; visible.value = false },
    }),
  })
  mounted = mountApp(Root, [])
  return { ...mounted, visible, events }
}

const one = (m, name) => {
  const nodes = m.find(name)
  assert.equal(nodes.length, 1, `expected one [data-test=${name}]`)
  return nodes[0]
}
const input = (node, value) => node.props.onInput({ target: { value } })
const check = (node, checked = true) => node.props.onChange({ target: { checked } })

async function fillValid(m) {
  input(one(m, 'field-topic'), 'Thì hiện tại hoàn thành')
  await flush()
}

beforeEach(() => {
  calls = []
  storage.clear()
  storage.set('flts_token', 'test-token')
  storage.set('flts_user', JSON.stringify({ id: 1, role: 'lecturer' }))
})

afterEach(() => {
  mounted?.unmount()
  mounted = null
})

test('modal: tài liệu chưa xử lý bị disable và hiện trạng thái; chỉ tài liệu processed chọn được', async () => {
  serve({ [DOCS]: [200, documents] })
  const m = mountModal()
  await flush()

  assert.equal(one(m, 'document-4').props.disabled, undefined)
  assert.equal(one(m, 'document-5').props.disabled, true)
  assert.equal(one(m, 'document-6').props.disabled, true)
  assert.match(m.text(), /Đang xử lý/)
  assert.match(m.text(), /Xử lý lỗi/)

  check(one(m, 'document-4'))
  check(one(m, 'document-5')) // bị bỏ qua dù handler được gọi trực tiếp
  await flush()
  assert.equal(one(m, 'document-4').props.checked, true)
  assert.equal(one(m, 'document-5').props.checked, undefined)
})

test('modal: validate giới hạn phía client, không gửi POST khi sai', async () => {
  serve({ [DOCS]: [200, documents], [CREATE]: [202, object('queued')] })
  const m = mountModal()
  await flush()

  input(one(m, 'field-topic'), 'ab')
  input(one(m, 'field-question_count'), '21')
  input(one(m, 'field-passing_score'), '101')
  await click(one(m, 'submit-button'))
  await flush()

  assert.equal(requestsTo(CREATE).length, 0)
  assert.match(one(m, 'error-topic').children.map((n) => n.text).join(''), /3 đến 500/)
  assert.match(m.text(), /Số câu hỏi phải là số nguyên từ 3 đến 20/)
  assert.match(m.text(), /Điểm đạt phải là số nguyên từ 0 đến 100/)

  input(one(m, 'field-question_count'), '20') // sửa field thì lỗi của field đó biến mất
  await flush()
  assert.equal(m.find('error-question_count').length, 0)
})

test('modal: double-click chỉ gửi một POST, payload đúng contract', async () => {
  let release
  serve({
    [DOCS]: [200, documents],
    [CREATE]: () => new Promise((resolve) => { release = () => resolve([202, object('queued')]) }),
  })
  const m = mountModal()
  await flush()
  await fillValid(m)
  check(one(m, 'document-4'))
  check(one(m, 'field-unlimited_time'))
  await flush()

  click(one(m, 'submit-button'))
  click(one(m, 'submit-button'))
  await flush()
  assert.equal(requestsTo(CREATE).length, 1)
  assert.equal(one(m, 'submit-button').props.disabled, true)

  const body = bodyOf(requestsTo(CREATE)[0])
  assert.match(body.request_id, /^[0-9a-f-]{36}$/)
  assert.deepEqual({ ...body, request_id: 'x' }, {
    request_id: 'x',
    topic: 'Thì hiện tại hoàn thành',
    difficulty: 'medium',
    question_count: 10,
    document_ids: [4],
    top_k: 8,
    time_limit_minutes: null,
    passing_score: 60,
  })
  release()
  await flush()
  assert.equal(m.find('phase-generating').length, 1)
})

test('modal: lỗi mạng rồi gửi lại dùng CÙNG request_id; đóng/mở lại vẫn giữ', async () => {
  let attempt = 0
  serve({
    [DOCS]: [200, documents],
    [CREATE]: () => (++attempt === 1 ? 'network' : [202, object('queued')]),
  })
  const m = mountModal()
  await flush()
  await fillValid(m)

  await click(one(m, 'submit-button'))
  await flush()
  assert.match(one(m, 'submit-error').children.map((n) => n.text).join(''), /Không thể kết nối/)
  assert.equal(m.find('generator-form').length, 1)

  m.visible.value = false
  await flush()
  m.visible.value = true
  await flush()
  assert.equal(one(m, 'field-topic').props.value, 'Thì hiện tại hoàn thành')

  await click(one(m, 'submit-button'))
  await flush()
  const [first, second] = requestsTo(CREATE).map(bodyOf)
  assert.equal(first.request_id, second.request_id)
})

test('modal: 422 hiển thị lỗi theo field từ backend', async () => {
  serve({
    [DOCS]: [200, documents],
    [CREATE]: [422, {
      message: 'The given data was invalid.',
      errors: { question_count: ['The question count field must not be greater than 20.'], 'document_ids.0': ['The document is invalid.'] },
    }],
  })
  const m = mountModal()
  await flush()
  await fillValid(m)
  await click(one(m, 'submit-button'))
  await flush()

  assert.match(textOfNode(one(m, 'error-question_count')), /must not be greater than 20/)
  assert.match(textOfNode(one(m, 'error-document_ids')), /The document is invalid/)
  assert.match(textOfNode(one(m, 'submit-error')), /Dữ liệu gửi lên không hợp lệ/)
})

test('modal: xem trước nguồn hiển thị assessment + matches; insufficient phải xác nhận trước khi tạo', async () => {
  serve({
    [DOCS]: [200, documents],
    [PREVIEW]: [200, {
      assessment: 'insufficient',
      message: 'Không tìm thấy nguồn đủ liên quan.',
      suggested_max_output: 0,
      matches: [{ vector_id: 'v1', document_name: 'Unit_1.pdf', source_locator: 'Trang 3', excerpt: 'Present perfect…', score: 0.4 }],
    }],
    [CREATE]: [202, object('queued')],
  })
  const m = mountModal()
  await flush()
  await fillValid(m)
  check(one(m, 'document-4'))
  await click(one(m, 'preview-button'))
  await flush()

  assert.deepEqual(bodyOf(requestsTo(PREVIEW)[0]), {
    topic: 'Thì hiện tại hoàn thành',
    requested_count: 10,
    document_ids: [4],
    top_k: 8,
    learning_object_type: 'quiz',
  })
  assert.match(textOfNode(one(m, 'preview-assessment')), /Nguồn không đủ/)
  const match = textOfNode(one(m, 'preview-match'))
  assert.match(match, /Unit_1\.pdf · Trang 3/)
  assert.match(match, /Present perfect/)

  await click(one(m, 'submit-button'))
  await flush()
  assert.equal(requestsTo(CREATE).length, 0)
  assert.match(textOfNode(one(m, 'submit-error')), /xác nhận/)

  check(one(m, 'confirm-insufficient'))
  await flush()
  await click(one(m, 'submit-button'))
  await flush()
  assert.equal(requestsTo(CREATE).length, 1)
})

test('modal: preview limited hiện cảnh báo và đổi chủ đề thì bỏ kết quả preview cũ', async () => {
  serve({
    [DOCS]: [200, documents],
    [PREVIEW]: [200, { assessment: 'limited', message: 'Nguồn còn hạn chế.', suggested_max_output: 5, matches: [] }],
  })
  const m = mountModal()
  await flush()
  await fillValid(m)
  await click(one(m, 'preview-button'))
  await flush()
  assert.match(textOfNode(one(m, 'preview-limited-warning')), /tối đa 5/)

  input(one(m, 'field-topic'), 'Chủ đề khác')
  await flush()
  assert.equal(m.find('preview-result').length, 0)
})

test('modal: failed → "Thử lại" gọi retry đúng 1 lần rồi poll đến completed và emit created', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  try {
    let showCount = 0
    let releaseRetry
    serve({
      [DOCS]: [200, documents],
      [CREATE]: [202, object('queued')],
      [SHOW]: () => (++showCount === 1
        ? [200, object('failed', { error_code: 'RATE_LIMITED', error_message: 'Dịch vụ tạo câu hỏi đang bận. Vui lòng thử lại sau ít phút.' })]
        : [200, object('completed')]),
      [RETRY]: () => new Promise((resolve) => { releaseRetry = () => resolve([202, object('queued', { attempt_number: 2 })]) }),
    })
    const m = mountModal()
    await flush()
    await fillValid(m)
    await click(one(m, 'submit-button'))
    await flush()
    assert.equal(m.find('phase-generating').length, 1)

    mock.timers.tick(2000)
    await flush()
    assert.match(textOfNode(one(m, 'failed-message')), /Dịch vụ tạo câu hỏi đang bận/)
    assert.equal(m.events.created.length, 0)

    click(one(m, 'retry-button'))
    click(one(m, 'retry-button'))
    await flush()
    assert.equal(requestsTo(RETRY).length, 1)
    assert.equal(requestsTo(RETRY)[0].data, undefined)
    releaseRetry()
    await flush()
    assert.equal(m.find('phase-generating').length, 1)

    mock.timers.tick(2000)
    await flush()
    assert.equal(m.find('phase-completed').length, 1)
    assert.match(textOfNode(one(m, 'completed-summary')), /10 câu hỏi/)
    assert.deepEqual(m.events.created, [7])

    mock.timers.tick(30000) // đã dừng poll: không GET thêm
    await flush()
    assert.equal(requestsTo(SHOW).length, 2)
  } finally {
    mock.timers.reset()
  }
})

test('modal: unmount khi đang tạo thì dừng poll', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  try {
    serve({ [DOCS]: [200, documents], [CREATE]: [202, object('queued')], [SHOW]: [200, object('generating')] })
    const m = mountModal()
    await flush()
    await fillValid(m)
    await click(one(m, 'submit-button'))
    await flush()
    mock.timers.tick(2000)
    await flush()
    assert.equal(requestsTo(SHOW).length, 1)
    assert.match(textOfNode(one(m, 'generation-status')), /AI đang phân tích/)

    m.unmount()
    mounted = null
    mock.timers.tick(60000)
    await flush()
    assert.equal(requestsTo(SHOW).length, 1)
  } finally {
    mock.timers.reset()
  }
})

test('modal: đóng khi đang tạo phải xác nhận; đóng thì dừng poll và mở lại là biểu mẫu mới', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  try {
    serve({ [DOCS]: [200, documents], [CREATE]: [202, object('queued')], [SHOW]: [200, object('generating')] })
    const m = mountModal()
    await flush()
    await fillValid(m)
    await click(one(m, 'submit-button'))
    await flush()
    const firstId = bodyOf(requestsTo(CREATE)[0]).request_id

    await click(one(m, 'close-button'))
    await flush()
    assert.equal(m.events.close, 0)
    assert.equal(m.find('confirm-close').length, 1)
    await click(one(m, 'confirm-close-yes'))
    await flush()
    assert.equal(m.events.close, 1)

    mock.timers.tick(60000)
    await flush()
    assert.equal(requestsTo(SHOW).length, 0)

    m.visible.value = true
    await flush()
    assert.equal(one(m, 'field-topic').props.value, '')
    await fillValid(m)
    await click(one(m, 'submit-button'))
    await flush()
    assert.notEqual(bodyOf(requestsTo(CREATE)[1]).request_id, firstId)
  } finally {
    mock.timers.reset()
  }
})

test('modal: 202 trả ngay completed (gửi lại cùng request_id) thì không poll và emit created một lần', async () => {
  serve({ [DOCS]: [200, documents], [CREATE]: [202, object('completed')] })
  const m = mountModal()
  await flush()
  await fillValid(m)
  await click(one(m, 'submit-button'))
  await flush()
  assert.equal(m.find('phase-completed').length, 1)
  assert.deepEqual(m.events.created, [7])
  assert.equal(requestsTo(SHOW).length, 0)
})

function textOfNode(node) {
  if (node.text !== undefined) return node.text
  return node.children.map(textOfNode).join('')
}
