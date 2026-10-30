import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { AxiosError } from 'axios'
import api from '../src/services/api.js'
import { learningObjects, LearningObjectsApiError } from '../src/services/learningObjects.js'
import {
  createGenerationPoller,
  POLL_TIMEOUT_MESSAGE,
  POLL_ERROR_MESSAGE,
} from '../src/quiz/generationPoller.js'
import {
  defaultForm,
  validateForm,
  buildCreatePayload,
  buildPreviewPayload,
  createRequestId,
  fieldErrorsFrom,
} from '../src/quiz/quizGeneratorForm.js'

// ===== Service: axios instance thật, chỉ thay adapter mạng (cùng cách LearningObjects.test.mjs) =====
const originalAdapter = api.defaults.adapter
const originalGlobals = Object.fromEntries(
  ['localStorage', 'window'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
)
let storage
let calls

function setGlobal(key, value) {
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
}

before(() => {
  setGlobal('localStorage', {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  })
})

beforeEach(() => {
  storage = new Map([['flts_token', 'test-token']])
  calls = []
  setGlobal('window', { location: { href: '/lecturer/courses' } })
})

after(() => {
  api.defaults.adapter = originalAdapter
  for (const [key, descriptor] of Object.entries(originalGlobals)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else delete globalThis[key]
  }
})

function respond(status, body) {
  api.defaults.adapter = async (config) => {
    calls.push(config)
    const data = typeof body === 'string' ? body : JSON.stringify(body)
    const response = { data, status, statusText: '', headers: {}, config }
    if (status >= 200 && status < 300) return response
    throw new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', config, {}, response)
  }
}

// Lỗi không có response (timeout hoặc mất mạng), giống axios khi request không tới được server.
function failTransport(code) {
  api.defaults.adapter = async (config) => {
    calls.push(config)
    throw new AxiosError(code === 'ECONNABORTED' ? 'timeout of 20000ms exceeded' : 'Network Error', code, config)
  }
}

const sentUrl = (config) => api.getUri(config)
const sentBody = (config) => (config.data === undefined ? undefined : JSON.parse(config.data))
const C = '/api/courses/3/learning-objects'
const queuedObject = { id: 7, type: 'quiz', status: 'draft', quiz: null, generation: { id: 1, status: 'queued' } }

async function rejection(promise) {
  try {
    await promise
  } catch (err) {
    return err
  }
  assert.fail('expected rejection')
}

test('previewQuizSources: POST source-preview, luôn gửi learning_object_type quiz, timeout 35 giây', async () => {
  respond(200, { assessment: 'sufficient', matches: [] })
  const payload = { topic: 'Thì hiện tại', requested_count: 10, document_ids: [4], top_k: 8 }
  const data = await learningObjects.previewQuizSources(3, payload)

  assert.equal(data.assessment, 'sufficient')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, 'post')
  assert.equal(sentUrl(calls[0]), `${C}/source-preview`)
  assert.deepEqual(sentBody(calls[0]), { ...payload, learning_object_type: 'quiz' })
  assert.equal(calls[0].timeout, 35000)
})

test('createQuiz: POST quizzes với request_id + passing_score, timeout 20 giây, trả data khi 202', async () => {
  respond(202, { learning_object: queuedObject })
  const payload = {
    request_id: '2f1c1b8e-4a5d-4c3e-9f7a-1b2c3d4e5f60',
    topic: 'Thì hiện tại',
    difficulty: 'medium',
    question_count: 10,
    document_ids: [],
    top_k: 8,
    time_limit_minutes: null,
    passing_score: 60,
  }
  const data = await learningObjects.createQuiz('3', payload)

  assert.equal(data.learning_object.generation.status, 'queued')
  assert.equal(calls[0].method, 'post')
  assert.equal(sentUrl(calls[0]), `${C}/quizzes`)
  assert.deepEqual(sentBody(calls[0]), payload)
  assert.equal('passing_percentage' in sentBody(calls[0]), false)
  assert.equal(calls[0].timeout, 20000)
})

test('createQuiz: thiếu request_id thì từ chối trước khi gửi', () => {
  respond(202, {})
  assert.throws(() => learningObjects.createQuiz(3, { topic: 'abc' }), TypeError)
  assert.equal(calls.length, 0)
})

test('retryQuizGeneration: POST generation-runs/retry không có body', async () => {
  respond(202, { learning_object: queuedObject })
  await learningObjects.retryQuizGeneration(3, 7)

  assert.equal(calls[0].method, 'post')
  assert.equal(sentUrl(calls[0]), `${C}/7/generation-runs/retry`)
  assert.equal(calls[0].data, undefined)
  assert.equal(calls[0].timeout, 20000)
})

test('sourceDocuments: GET danh sách tài liệu thật của course', async () => {
  respond(200, { documents: [{ id: 4, processing_status: 'processed' }] })
  const data = await learningObjects.sourceDocuments(3)

  assert.equal(calls[0].method, 'get')
  assert.equal(sentUrl(calls[0]), '/api/courses/3/documents')
  assert.equal(data.documents.length, 1)
})

test('lỗi tạo Quiz có thông báo tiếng Việt theo status khi backend không gửi message', async () => {
  const cases = [
    [403, { message: '' }, 'Bạn không có quyền tạo Quiz trong khóa học này.'],
    [409, {}, 'Yêu cầu tạo Quiz bị trùng với một yêu cầu khác. Vui lòng mở lại biểu mẫu.'],
    [429, { message: 'The source check is temporarily rate limited. Please retry shortly.' }, 'Dịch vụ AI đang bận. Vui lòng thử lại sau ít phút.'],
    [503, { message: 'Source preview is temporarily unavailable.' }, 'Dịch vụ AI tạm thời không khả dụng. Vui lòng thử lại sau.'],
    [500, { message: 'SQLSTATE secret' }, 'Máy chủ đang gặp sự cố. Vui lòng thử lại sau.'],
  ]
  for (const [status, body, message] of cases) {
    respond(status, body)
    const err = await rejection(learningObjects.createQuiz(3, { request_id: 'r-1' }))
    assert.ok(err instanceof LearningObjectsApiError)
    assert.equal(err.status, status)
    assert.equal(err.message, message, `status ${status}`)
  }
})

test('lỗi 422: dịch câu nghiệp vụ đã biết và giữ field errors', async () => {
  respond(422, { message: 'Every selected document must belong to this course and be processed.' })
  let err = await rejection(learningObjects.createQuiz(3, { request_id: 'r-1' }))
  assert.equal(err.message, 'Mọi tài liệu được chọn phải thuộc khóa học và đã xử lý xong.')

  respond(422, { message: 'The question count field must not be greater than 20.', errors: { question_count: ['The question count field must not be greater than 20.'] } })
  err = await rejection(learningObjects.createQuiz(3, { request_id: 'r-1' }))
  assert.equal(err.message, 'Dữ liệu gửi lên không hợp lệ.')
  assert.deepEqual(err.errors, { question_count: ['The question count field must not be greater than 20.'] })

  respond(422, { message: 'Only a failed generation can be retried.' })
  err = await rejection(learningObjects.retryQuizGeneration(3, 7))
  assert.equal(err.message, 'Chỉ có thể thử lại khi lần tạo gần nhất thất bại.')
})

test('timeout và mất mạng: status 0 với thông báo riêng, không rò token', async () => {
  failTransport('ECONNABORTED')
  let err = await rejection(learningObjects.previewQuizSources(3, { topic: 'abc' }))
  assert.equal(err.status, 0)
  assert.equal(err.message, 'Máy chủ phản hồi quá lâu. Vui lòng thử lại.')
  assert.equal(JSON.stringify(err).includes('test-token'), false)
  assert.equal(err.cause, undefined)

  failTransport('ERR_NETWORK')
  err = await rejection(learningObjects.createQuiz(3, { request_id: 'r-1' }))
  assert.equal(err.status, 0)
  assert.equal(err.message, 'Không thể kết nối tới máy chủ. Vui lòng kiểm tra mạng và thử lại.')
})

test('method cũ của learningObjects giữ nguyên thông báo lỗi (không bị ảnh hưởng)', async () => {
  respond(404, {})
  const err = await rejection(learningObjects.show(3, 7))
  assert.equal(err.message, 'Không tìm thấy bài kiểm tra hoặc bài làm.')
})

// ===== Poller: đồng hồ giả, không phụ thuộc Vue =====
function fakeClock() {
  let now = 0
  let nextId = 0
  let timers = []
  const settle = () => new Promise((resolve) => setImmediate(resolve))
  return {
    now: () => now,
    setTimeout(fn, ms) {
      const timer = { id: ++nextId, at: now + ms, fn }
      timers.push(timer)
      return timer.id
    },
    clearTimeout(id) {
      timers = timers.filter((timer) => timer.id !== id)
    },
    pending: () => timers.length,
    settle,
    async advance(ms) {
      const end = now + ms
      for (;;) {
        timers.sort((a, b) => a.at - b.at)
        const timer = timers[0]
        if (!timer || timer.at > end) break
        timers.shift()
        now = timer.at
        timer.fn()
        await settle()
        await settle()
      }
      now = end
    },
  }
}

const objectWith = (status, extra = {}) => ({ learning_object: { id: 7, generation: { status, ...extra } } })

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

test('poller: queued → generating → completed rồi dừng hẳn', async () => {
  const clock = fakeClock()
  const responses = [objectWith('generating'), objectWith('completed')]
  const seen = []
  const poller = createGenerationPoller({ clock, fetchFn: async () => responses.shift(), onChange: (s) => seen.push(s.generationStatus) })
  poller.start({ initial: objectWith('queued').learning_object })
  assert.equal(poller.state.generationStatus, 'queued')

  await clock.advance(2000)
  assert.equal(poller.state.status, 'polling')
  assert.equal(poller.state.generationStatus, 'generating')
  await clock.advance(2000)
  assert.equal(poller.state.status, 'completed')
  assert.equal(clock.pending(), 0)
  assert.deepEqual(seen, ['queued', 'generating', 'completed'])
})

test('poller: failed trả error_message của backend', async () => {
  const clock = fakeClock()
  const poller = createGenerationPoller({
    clock,
    fetchFn: async () => objectWith('failed', { error_code: 'NO_CONTEXT', error_message: 'Không tìm thấy đủ nội dung phù hợp trong tài liệu đã chọn.' }),
  })
  poller.start()
  await clock.advance(2000)
  assert.equal(poller.state.status, 'failed')
  assert.equal(poller.state.errorMessage, 'Không tìm thấy đủ nội dung phù hợp trong tài liệu đã chọn.')
  assert.equal(clock.pending(), 0)
})

test('poller: 2 giây trong 30 giây đầu, sau đó 5 giây', async () => {
  const clock = fakeClock()
  const times = []
  const poller = createGenerationPoller({ clock, fetchFn: async () => { times.push(clock.now()); return objectWith('queued') } })
  poller.start()
  await clock.advance(45000)
  poller.stop()

  const fast = Array.from({ length: 15 }, (_, i) => (i + 1) * 2000) // 2s … 30s
  assert.deepEqual(times, [...fast, 35000, 40000, 45000])
})

test('poller: quá 240 giây thì chuyển timeout (không phải failed) và ngừng gọi', async () => {
  const clock = fakeClock()
  const times = []
  const poller = createGenerationPoller({ clock, fetchFn: async () => { times.push(clock.now()); return objectWith('generating') } })
  poller.start()
  await clock.advance(239999)
  assert.equal(poller.state.status, 'polling')
  await clock.advance(1)
  assert.equal(poller.state.status, 'timeout')
  assert.equal(poller.state.errorMessage, POLL_TIMEOUT_MESSAGE)
  assert.equal(times.at(-1), 240000)
  const count = times.length
  await clock.advance(60000)
  assert.equal(times.length, count)
  assert.equal(clock.pending(), 0)
})

test('poller: single-flight — không gửi request mới khi request trước chưa xong', async () => {
  const clock = fakeClock()
  const pending = []
  const poller = createGenerationPoller({ clock, fetchFn: () => { const d = deferred(); pending.push(d); return d.promise } })
  poller.start({ immediate: true })
  assert.equal(pending.length, 1)
  await clock.advance(20000)
  assert.equal(pending.length, 1)

  // stop() + start() ngay khi request cũ còn treo: vẫn chỉ một request tại một thời điểm.
  poller.stop()
  poller.start({ immediate: true })
  await clock.advance(10000)
  assert.equal(pending.length, 1)

  pending[0].resolve(objectWith('completed')) // response của vòng cũ: bị bỏ qua
  await clock.settle()
  assert.equal(poller.state.status, 'polling')
  await clock.advance(2000)
  assert.equal(pending.length, 2)
  pending[1].resolve(objectWith('completed'))
  await clock.settle()
  assert.equal(poller.state.status, 'completed')
})

test('poller: stop() hủy timer và bỏ qua response về muộn', async () => {
  const clock = fakeClock()
  let count = 0
  const poller = createGenerationPoller({ clock, fetchFn: async () => { count++; return objectWith('queued') } })
  poller.start()
  assert.equal(clock.pending(), 1)
  poller.stop()
  assert.equal(clock.pending(), 0)
  assert.equal(poller.state.status, 'stopped')
  await clock.advance(60000)
  assert.equal(count, 0)

  const late = deferred()
  const statuses = []
  const second = createGenerationPoller({ clock, fetchFn: () => late.promise, onChange: (s) => statuses.push(s.status) })
  second.start({ immediate: true })
  second.stop()
  second.stop() // gọi lại không lỗi
  late.resolve(objectWith('completed'))
  await clock.settle()
  assert.equal(second.state.status, 'stopped')
  assert.equal(statuses.includes('completed'), false)
})

test('poller: lỗi mạng tạm thời tiếp tục poll; 3 lỗi liên tiếp thì dừng với error', async () => {
  const clock = fakeClock()
  const script = ['fail', 'fail', 'ok', 'fail', 'fail', 'fail', 'ok']
  let count = 0
  const poller = createGenerationPoller({
    clock,
    fetchFn: async () => {
      if (script[count++] === 'fail') throw new LearningObjectsApiError('x', { status: 0, code: 'ERR_NETWORK' })
      return objectWith('generating')
    },
  })
  poller.start()
  await clock.advance(4000)
  assert.equal(poller.state.status, 'polling')
  assert.equal(poller.state.consecutiveErrors, 2)
  await clock.advance(2000) // thành công: reset bộ đếm
  assert.equal(poller.state.consecutiveErrors, 0)
  await clock.advance(6000)
  assert.equal(poller.state.status, 'error')
  assert.equal(poller.state.errorMessage, POLL_ERROR_MESSAGE)
  assert.equal(count, 6)
  assert.equal(clock.pending(), 0)
})

test('poller: 403/404 dừng ngay sau một lần gọi', async () => {
  for (const status of [403, 404]) {
    const clock = fakeClock()
    let count = 0
    const poller = createGenerationPoller({
      clock,
      fetchFn: async () => { count++; throw new LearningObjectsApiError('x', { status }) },
    })
    poller.start()
    await clock.advance(30000)
    assert.equal(count, 1, `status ${status}`)
    assert.equal(poller.state.status, 'error')
    assert.ok(poller.state.errorMessage)
    assert.equal(clock.pending(), 0)
  }
})

// ===== Form logic =====
test('validateForm: khớp giới hạn backend', () => {
  const docs = [{ id: 4, processing_status: 'processed' }, { id: 5, processing_status: 'processing' }]
  const valid = { ...defaultForm(), topic: 'Thì hiện tại', document_ids: [4] }
  assert.deepEqual(validateForm(valid, docs), {})

  const errors = validateForm({
    ...valid,
    topic: 'ab',
    question_count: '21',
    time_limit_minutes: '481',
    passing_score: '101',
    top_k: '2',
    document_ids: [5],
  }, docs)
  assert.deepEqual(Object.keys(errors).sort(), ['document_ids', 'passing_score', 'question_count', 'time_limit_minutes', 'top_k', 'topic'])

  assert.ok(validateForm({ ...valid, question_count: '2' }, docs).question_count)
  assert.ok(validateForm({ ...valid, question_count: '3.5' }, docs).question_count)
  assert.deepEqual(validateForm({ ...valid, question_count: '3', passing_score: '0', top_k: '15' }, docs), {})
  assert.deepEqual(validateForm({ ...valid, unlimited_time: true, time_limit_minutes: '' }, docs), {})
  const many = Array.from({ length: 51 }, (_, i) => ({ id: i + 1, processing_status: 'processed' }))
  assert.ok(validateForm({ ...valid, document_ids: many.map((d) => d.id) }, many).document_ids)
})

test('buildCreatePayload: passing_score, request_id, null khi không giới hạn thời gian', () => {
  const form = { ...defaultForm(), topic: '  Thì hiện tại  ', unlimited_time: true, document_ids: [4] }
  const payload = buildCreatePayload(form, 'req-1')
  assert.deepEqual(payload, {
    request_id: 'req-1',
    topic: 'Thì hiện tại',
    difficulty: 'medium',
    question_count: 10,
    document_ids: [4],
    top_k: 8,
    time_limit_minutes: null,
    passing_score: 60,
  })
  assert.equal(buildCreatePayload({ ...form, title: ' Quiz A ' }, 'r').title, 'Quiz A')
  assert.deepEqual(buildPreviewPayload(form), { topic: 'Thì hiện tại', requested_count: 10, document_ids: [4], top_k: 8 })
})

test('createRequestId: dùng randomUUID nếu có, nếu không thì tự sinh UUID v4', () => {
  assert.equal(createRequestId({ randomUUID: () => 'fixed' }), 'fixed')
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  assert.match(createRequestId({ getRandomValues: (bytes) => bytes.fill(255) }), uuid)
  assert.match(createRequestId({}), uuid)
})

test('fieldErrorsFrom: lấy câu đầu, gộp document_ids.N', () => {
  assert.deepEqual(fieldErrorsFrom({ topic: ['a', 'b'], 'document_ids.2': ['c'] }), { topic: 'a', document_ids: 'c' })
  assert.deepEqual(fieldErrorsFrom(undefined), {})
})
