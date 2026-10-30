import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { AxiosError, CanceledError } from 'axios'
import api from '../src/services/api.js'
import { learningObjects, LearningObjectsApiError } from '../src/services/learningObjects.js'

// Service thật + axios instance thật (interceptor thật); chỉ thay adapter mạng bằng bản giả.
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
  setGlobal('window', { location: { href: '/quiz' } })
})

after(() => {
  api.defaults.adapter = originalAdapter
  for (const [key, descriptor] of Object.entries(originalGlobals)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else delete globalThis[key]
  }
})

// Giống axios settle(): 2xx resolve, còn lại reject AxiosError kèm response; body trả về dạng JSON string.
function respond(status, body) {
  api.defaults.adapter = async (config) => {
    calls.push(config)
    const response = { data: JSON.stringify(body), status, statusText: '', headers: {}, config }
    if (status >= 200 && status < 300) return response
    throw new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', config, {}, response)
  }
}

// Duyệt đệ quy mọi giá trị (kể cả thuộc tính non-enumerable như cause/stack) để tìm chuỗi bị rò rỉ.
function containsDeep(value, needle, seen = new Set()) {
  if (typeof value === 'string') return value.includes(needle)
  if (value === null || typeof value !== 'object' || seen.has(value)) return false
  seen.add(value)
  return Object.getOwnPropertyNames(value).some((key) => containsDeep(value[key], needle, seen))
}

const sentUrl = (config) => api.getUri(config)
const sentBody = (config) => (config.data === undefined ? undefined : JSON.parse(config.data))
const B = '/api/courses/3/learning-objects/7'

const inProgress = {
  attempt: { id: 11, status: 'in_progress', draft_version: 0, expires_at: null, score: null },
  server_time: '2026-10-29T08:00:00.000000Z',
  quiz: { learning_object_id: 7, title: 'Quiz 1', passing_percentage: 60, time_limit_minutes: null, questions: [] },
  draft_answers: [],
}
const payload = {
  draft_version: 1,
  answers: [
    { question_id: 21, selected_option_id: 42, time_spent_seconds: 15 },
    { question_id: 22, selected_option_id: null, time_spent_seconds: 3 },
  ],
}

test('TC01: startAttempt sends POST to quiz-attempts without a body', async () => {
  respond(201, inProgress)
  const data = await learningObjects.startAttempt(3, 7)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, 'post')
  assert.equal(sentUrl(calls[0]), `${B}/quiz-attempts`)
  assert.equal(sentBody(calls[0]), undefined)
  assert.deepEqual(data, inProgress)
})

test('TC02: saveDraft sends PATCH with the payload unchanged, incl. empty answers and null option', async () => {
  respond(200, inProgress)
  await learningObjects.saveDraft(3, 7, 11, payload)
  assert.equal(calls[0].method, 'patch')
  assert.equal(sentUrl(calls[0]), `${B}/quiz-attempts/11`)
  assert.deepEqual(sentBody(calls[0]), payload)

  await learningObjects.saveDraft('3', '7', '11', { draft_version: 0, answers: [] })
  assert.equal(sentUrl(calls[1]), `${B}/quiz-attempts/11`)
  assert.deepEqual(sentBody(calls[1]), { draft_version: 0, answers: [] })
})

test('TC03: submitAttempt sends POST to the submit endpoint with the payload', async () => {
  respond(200, { attempt: { id: 11, status: 'completed' }, results: [], timed_out: false })
  await learningObjects.submitAttempt(3, 7, 11, payload)
  assert.equal(calls[0].method, 'post')
  assert.equal(sentUrl(calls[0]), `${B}/quiz-attempts/11/submit`)
  assert.deepEqual(sentBody(calls[0]), payload)
})

test('TC04: attemptHistory sends GET with page (default 1)', async () => {
  respond(200, { attempts: { data: [], total: 0 }, best_score: null })
  await learningObjects.attemptHistory(3, 7)
  await learningObjects.attemptHistory(3, 7, 2)
  assert.deepEqual(calls.map((c) => [c.method, sentUrl(c)]), [
    ['get', `${B}/quiz-attempts?page=1`],
    ['get', `${B}/quiz-attempts?page=2`],
  ])
})

test('TC05: quizResults sends GET with page (default 1)', async () => {
  respond(200, { quiz: { learning_object_id: 7, title: 'Quiz 1' }, summary: {}, score_distribution: {}, attempts: {} })
  await learningObjects.quizResults(3, 7)
  await learningObjects.quizResults(3, 7, 3)
  assert.deepEqual(calls.map((c) => [c.method, sentUrl(c)]), [
    ['get', `${B}/quiz-results?page=1`],
    ['get', `${B}/quiz-results?page=3`],
  ])
})

test('TC06: attemptResult uses the given attemptId', async () => {
  respond(200, { attempt: { id: 55, status: 'completed' }, results: [], timed_out: false, student: { id: 9, name: 'SV' } })
  const data = await learningObjects.attemptResult(3, 7, 55)
  assert.equal(calls[0].method, 'get')
  assert.equal(sentUrl(calls[0]), `${B}/quiz-results/attempts/55`)
  assert.deepEqual(data.student, { id: 9, name: 'SV' })
})

test('TC07: Bearer token comes from the existing interceptor only when a token exists', async () => {
  respond(200, inProgress)
  await learningObjects.startAttempt(3, 7)
  assert.equal(calls[0].headers.Authorization, 'Bearer test-token')

  storage.delete('flts_token')
  await learningObjects.startAttempt(3, 7)
  assert.equal(calls[1].headers.has('Authorization'), false)
})

test('TC08: completed saveDraft response (timed out) is returned unchanged', async () => {
  const timedOut = {
    attempt: { id: 11, status: 'completed', score: 50, max_score: 2, passed: false, auto_submitted: true },
    server_time: '2026-10-29T08:10:00.000000Z',
    results: [{ id: 21, selected_option_id: 42, is_correct: true, correct_option_id: 42, time_spent_seconds: 15 }],
    timed_out: true,
  }
  respond(200, timedOut)
  const data = await learningObjects.saveDraft(3, 7, 11, payload)
  assert.deepEqual(data, timedOut)
  assert.equal(data.attempt.status, 'completed')
  assert.equal(data.timed_out, true)
})

test('TC09: HTTP 409 keeps status, message and payload and triggers no other request', async () => {
  const body = { message: 'Bản nháp đã thay đổi. Hãy tải lại bài làm trước khi lưu.' }
  respond(409, body)
  await assert.rejects(learningObjects.saveDraft(3, 7, 11, payload), (err) => {
    assert.ok(err instanceof LearningObjectsApiError)
    assert.equal(err.status, 409)
    assert.equal(err.message, body.message)
    assert.deepEqual(err.data, body)
    assert.deepEqual(err.errors, {})
    assert.equal(err.code, 'ERR_BAD_REQUEST')
    assert.equal(err.canceled, false)
    return true
  })
  assert.equal(calls.length, 1)
})

test('TC10: HTTP 422 keeps validation errors', async () => {
  const body = { message: 'Câu hỏi hoặc lựa chọn không thuộc bài làm.', errors: { answers: ['Câu hỏi hoặc lựa chọn không thuộc bài làm.'] } }
  respond(422, body)
  await assert.rejects(learningObjects.submitAttempt(3, 7, 11, payload), (err) => {
    assert.equal(err.status, 422)
    assert.deepEqual(err.errors.answers, body.errors.answers)
    assert.deepEqual(err.data, body)
    return true
  })
})

test('TC11: HTTP 403 without a backend message keeps status and uses a default message', async () => {
  for (const body of [{}, { message: '' }]) {
    respond(403, body)
    await assert.rejects(learningObjects.quizResults(3, 7), (err) => {
      assert.equal(err.status, 403)
      assert.equal(err.message, 'Bạn không có quyền thực hiện thao tác này.')
      assert.deepEqual(err.data, body)
      return true
    })
  }
})

test('TC12: HTTP 401 goes through the existing interceptor and is still rejected', async () => {
  storage.set('flts_user', '{"id":1}')
  storage.set('unrelated', 'keep')
  respond(401, { message: 'Authentication token is invalid or expired.' })
  await assert.rejects(learningObjects.startAttempt(3, 7), (err) => {
    assert.equal(err.status, 401)
    assert.equal(err.message, 'Authentication token is invalid or expired.')
    return true
  })
  assert.equal(calls.length, 1)
  assert.equal(storage.has('flts_token'), false)
  assert.equal(storage.has('flts_user'), false)
  assert.equal(storage.get('unrelated'), 'keep')
  assert.equal(globalThis.window.location.href, '/login')
})

test('TC13: network error without a response is normalised to status 0', async () => {
  api.defaults.adapter = async (config) => {
    calls.push(config)
    throw new AxiosError('Network Error', AxiosError.ERR_NETWORK, config, {})
  }
  await assert.rejects(learningObjects.attemptHistory(3, 7), (err) => {
    assert.ok(err instanceof LearningObjectsApiError)
    assert.equal(err.status, 0)
    assert.equal(err.data, null)
    assert.deepEqual(err.errors, {})
    assert.equal(err.message, 'Không thể kết nối tới máy chủ.')
    assert.equal(err.code, 'ERR_NETWORK')
    assert.equal(err.canceled, false)
    return true
  })
})

test('TC14: invalid route ids are rejected before any request is sent', async () => {
  respond(200, inProgress)
  for (const args of [[undefined, 7], [3, null], ['abc', 7], [0, 7], [3.5, 7]]) {
    await assert.rejects(learningObjects.startAttempt(...args), TypeError)
  }
  await assert.rejects(learningObjects.saveDraft(3, 7, undefined, payload), TypeError)
  assert.equal(calls.length, 0)
})

test('TC15: API errors keep no reference to the Bearer token or the request body', async () => {
  const secretPayload = { draft_version: 2, answers: [{ question_id: 21, selected_option_id: 9917, time_spent_seconds: 4 }] }
  respond(409, { message: 'Bài làm đã được nộp.' })
  await assert.rejects(learningObjects.saveDraft(3, 7, 11, secretPayload), (err) => {
    assert.equal(calls[0].headers.Authorization, 'Bearer test-token') // token thật sự đã được gửi
    assert.equal(err.cause, undefined)
    for (const key of ['config', 'request', 'response']) assert.equal(err[key], undefined)
    assert.equal(containsDeep(err, 'test-token'), false)
    assert.equal(containsDeep(err, '9917'), false)
    assert.deepEqual(err.data, { message: 'Bài làm đã được nộp.' }) // body backend vẫn giữ cho Player
    return true
  })
})

test('TC16: cancelled request is reported as canceled, not as a network failure', async () => {
  api.defaults.adapter = async (config) => {
    calls.push(config)
    throw new CanceledError(undefined, config)
  }
  await assert.rejects(learningObjects.saveDraft(3, 7, 11, payload), (err) => {
    assert.ok(err instanceof LearningObjectsApiError)
    assert.equal(err.canceled, true)
    assert.equal(err.code, 'ERR_CANCELED')
    assert.equal(err.status, 0)
    assert.equal(err.data, null)
    assert.equal(err.message, 'Yêu cầu đã bị hủy.')
    assert.notEqual(err.message, 'Không thể kết nối tới máy chủ.')
    return true
  })
  assert.equal(calls.length, 1)
})
