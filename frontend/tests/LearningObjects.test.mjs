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
    const data = typeof body === 'string' ? body : JSON.stringify(body)
    const response = { data, status, statusText: '', headers: {}, config }
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

// Fixtures theo shape response FLTS đã ghi nhận bằng API thật (S3-ENV03B), rút gọn số câu/lựa chọn.
const studentQuestion = {
  id: 21,
  question_index: 0,
  question_text: 'Câu 1',
  options: [
    { id: 41, option_index: 0, option_text: 'A' },
    { id: 42, option_index: 1, option_text: 'B' },
  ],
}
const inProgress = {
  attempt: {
    id: 11,
    attempt_number: 1,
    score: 0,
    total_correct: 0,
    status: 'in_progress',
    started_at: '2026-10-30T06:53:46.000000Z',
    expires_at: '2026-10-30T07:18:46.000000Z',
    submitted_at: null,
    auto_submitted: null,
    draft_answers: [{ question_id: 21, selected_option_id: 42 }],
  },
  quiz: { learning_object_id: 7, title: 'Quiz 1', description: '', time_limit_minutes: 25, passing_score: 60, questions: [studentQuestion] },
  server_time: '2026-10-30T06:53:46.370035Z',
}
const completed = {
  attempt: { ...inProgress.attempt, status: 'completed', score: 50, total_correct: 1, submitted_at: '2026-10-30T07:00:00.000000Z', auto_submitted: false },
  latest_score: 50,
  best_score: 50,
  results: [
    {
      question_id: 21,
      selected_option_id: 42,
      correct_option_id: 42,
      correct_option_index: 1,
      is_correct: true,
      explanation: 'Giải thích',
      citations: [{ vector_id: '1:2:2', document_id: 1, document_name: 'tai-lieu.pdf', source_locator: 'page 9' }],
    },
    { question_id: 22, selected_option_id: null, correct_option_id: 44, correct_option_index: 0, is_correct: false, explanation: '', citations: [] },
  ],
  timed_out: false,
}
const payload = {
  answers: [
    { question_id: 21, selected_option_id: 42 },
    { question_id: 22, selected_option_id: null },
  ],
}
// Body lỗi khi Laravel APP_DEBUG=true: abort(422) không có errors nhưng kèm exception/file/line/trace.
const debugBody = (message) => ({
  message,
  exception: 'Symfony\\Component\\HttpKernel\\Exception\\HttpException',
  file: '/var/www/html/vendor/laravel/framework/src/Illuminate/Foundation/Application.php',
  line: 1440,
  trace: [{ file: '/var/www/html/app/Http/Controllers/QuizAttemptController.php', line: 77, function: 'abort_unless' }],
})

test('TC01: startAttempt sends POST to quiz-attempts without a body and returns data unchanged', async () => {
  respond(201, inProgress)
  const data = await learningObjects.startAttempt(3, 7)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, 'post')
  assert.equal(sentUrl(calls[0]), `${B}/quiz-attempts`)
  assert.equal(sentBody(calls[0]), undefined)
  assert.deepEqual(data, inProgress)
  assert.deepEqual(data.attempt.draft_answers, [{ question_id: 21, selected_option_id: 42 }])
  assert.equal(data.quiz.passing_score, 60)
})

test('TC02: saveDraft sends PATCH with the payload unchanged and adds no draft_version or time_spent_seconds', async () => {
  respond(200, { attempt: inProgress.attempt, server_time: inProgress.server_time })
  await learningObjects.saveDraft(3, 7, 11, payload)
  assert.equal(calls[0].method, 'patch')
  assert.equal(sentUrl(calls[0]), `${B}/quiz-attempts/11`)
  assert.deepEqual(sentBody(calls[0]), payload)
  assert.equal('draft_version' in sentBody(calls[0]), false)
  assert.equal(sentBody(calls[0]).answers.some((answer) => 'time_spent_seconds' in answer), false)

  await learningObjects.saveDraft('3', '7', '11', { answers: [] })
  assert.equal(sentUrl(calls[1]), `${B}/quiz-attempts/11`)
  assert.deepEqual(sentBody(calls[1]), { answers: [] })
})

test('TC03: submitAttempt sends POST {answers} with null option and returns the completed result unchanged', async () => {
  respond(200, completed)
  const data = await learningObjects.submitAttempt(3, 7, 11, payload)
  assert.equal(calls[0].method, 'post')
  assert.equal(sentUrl(calls[0]), `${B}/quiz-attempts/11/submit`)
  assert.deepEqual(sentBody(calls[0]), payload)
  assert.deepEqual(data, completed)
  assert.equal(data.latest_score, 50)
  assert.equal(data.best_score, 50)
  assert.equal(data.results[1].selected_option_id, null)
})

test('TC04: attemptHistory sends GET without page by default and only adds page when given', async () => {
  const history = { attempts: [{ ...completed.attempt }], latest_score: 50, best_score: 50 }
  respond(200, history)
  const data = await learningObjects.attemptHistory(3, 7)
  await learningObjects.attemptHistory(3, 7, 2)
  assert.deepEqual(calls.map((c) => [c.method, sentUrl(c)]), [
    ['get', `${B}/quiz-attempts`],
    ['get', `${B}/quiz-attempts?page=2`],
  ])
  assert.deepEqual(data, history)
  assert.ok(Array.isArray(data.attempts))
})

test('TC05: quizResults sends GET without page by default and returns summary and students unchanged', async () => {
  const results = {
    quiz: { learning_object_id: 7, title: 'Quiz 1', passing_score: 60, total_questions: 2, time_limit_minutes: 25 },
    summary: { enrolled_students: 1, participants: 1, total_attempts: 1, average_score: 50, highest_score: 50, pass_rate: 0 },
    students: [
      {
        student: { id: 9, name: 'SV' },
        attempts_count: 1,
        latest_score: 50,
        best_score: 50,
        last_submitted_at: '2026-10-30T07:00:00.000000Z',
        attempts: [{ id: 11, attempt_number: 1, score: 50, duration_seconds: 374 }],
      },
    ],
  }
  respond(200, results)
  const data = await learningObjects.quizResults(3, 7)
  await learningObjects.quizResults(3, 7, 3)
  assert.deepEqual(calls.map((c) => [c.method, sentUrl(c)]), [
    ['get', `${B}/quiz-results`],
    ['get', `${B}/quiz-results?page=3`],
  ])
  assert.deepEqual(data, results)
  assert.ok(Array.isArray(data.students))
})

test('TC06: attemptResult uses the given attemptId and returns the questions array unchanged', async () => {
  const result = {
    attempt: { id: 55, attempt_number: 1, score: 50, duration_seconds: 374, student: { id: 9, name: 'SV' } },
    questions: [
      {
        ...studentQuestion,
        selected_option_id: 42,
        correct_option_id: 42,
        is_correct: true,
        explanation: 'Giải thích',
        citations: [],
        options: studentQuestion.options.map((option) => ({ ...option, is_correct: option.id === 42 })),
      },
    ],
  }
  respond(200, result)
  const data = await learningObjects.attemptResult(3, 7, 55)
  assert.equal(calls[0].method, 'get')
  assert.equal(sentUrl(calls[0]), `${B}/quiz-results/attempts/55`)
  assert.deepEqual(data, result)
  assert.ok(Array.isArray(data.questions))
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
    attempt: { ...completed.attempt, auto_submitted: true },
    latest_score: 50,
    best_score: 50,
    results: completed.results,
    timed_out: true,
  }
  respond(200, timedOut)
  const data = await learningObjects.saveDraft(3, 7, 11, payload)
  assert.deepEqual(data, timedOut)
  assert.equal(data.attempt.status, 'completed')
  assert.equal(data.timed_out, true)
})

test('TC09: HTTP 409 is still handled generically: status, server message and payload kept, no other request', async () => {
  const body = { message: 'Bản nháp đã thay đổi. Hãy tải lại bài làm trước khi lưu.' }
  respond(409, body)
  await assert.rejects(learningObjects.saveDraft(3, 7, 11, payload), (err) => {
    assert.ok(err instanceof LearningObjectsApiError)
    assert.equal(err.status, 409)
    assert.equal(err.message, 'Bài làm đã thay đổi trên máy chủ.')
    assert.equal(err.serverMessage, body.message)
    assert.deepEqual(err.data, body)
    assert.deepEqual(err.errors, {})
    assert.equal(err.code, 'ERR_BAD_REQUEST')
    assert.equal(err.canceled, false)
    return true
  })
  assert.equal(calls.length, 1)

  respond(409, {})
  await assert.rejects(learningObjects.saveDraft(3, 7, 11, payload), {
    status: 409,
    message: 'Bài làm đã thay đổi trên máy chủ.',
    serverMessage: null,
  })
})

test('TC10: HTTP 422 keeps Laravel validation errors', async () => {
  const body = {
    message: 'The answers.0.question_id field must be an integer. (and 1 more error)',
    errors: {
      'answers.0.question_id': ['The answers.0.question_id field must be an integer.'],
      'answers.0.selected_option_id': ['The answers.0.selected_option_id field must be an integer.'],
    },
  }
  respond(422, body)
  await assert.rejects(learningObjects.saveDraft(3, 7, 11, { answers: [{ question_id: 'x', selected_option_id: 'y' }] }), (err) => {
    assert.equal(err.status, 422)
    assert.equal(err.message, 'Dữ liệu gửi lên không hợp lệ.')
    assert.equal(err.serverMessage, body.message)
    assert.deepEqual(err.errors, body.errors)
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
      assert.equal(err.serverMessage, null)
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
    assert.equal(err.message, 'Phiên đăng nhập đã hết hạn.')
    assert.equal(err.serverMessage, 'Authentication token is invalid or expired.')
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
    assert.equal(err.serverMessage, null)
    assert.equal(err.code, 'ERR_NETWORK')
    assert.equal(err.canceled, false)
    return true
  })
})

test('TC14: invalid route ids are rejected before any request is sent', async () => {
  respond(200, inProgress)
  for (const args of [[undefined, 7], [3, null], ['abc', 7], [0, 7], [3.5, 7]]) {
    await assert.rejects(learningObjects.startAttempt(...args), TypeError)
    await assert.rejects(learningObjects.show(...args), TypeError)
  }
  for (const courseId of [undefined, null, 'abc', 0, -1, 3.5, '3a']) {
    await assert.rejects(learningObjects.list(courseId), TypeError)
  }
  await assert.rejects(learningObjects.saveDraft(3, 7, undefined, payload), TypeError)
  assert.equal(calls.length, 0)
})

test('TC15: API errors keep no reference to the Bearer token or the request body', async () => {
  const secretPayload = { answers: [{ question_id: 21, selected_option_id: 9917 }] }
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
    assert.equal(err.serverMessage, null)
    assert.notEqual(err.message, 'Không thể kết nối tới máy chủ.')
    return true
  })
  assert.equal(calls.length, 1)
})

test('TC17: list sends GET to the course learning-objects collection and returns data unchanged', async () => {
  const body = {
    learning_objects: [
      { id: 7, course_id: 3, type: 'quiz', title: 'Quiz 1', status: 'published', total_questions: 2, published_version: 1, generation: { status: 'completed' } },
    ],
  }
  respond(200, body)
  const data = await learningObjects.list(3)
  await learningObjects.list('3')
  assert.deepEqual(calls.map((c) => [c.method, sentUrl(c)]), [
    ['get', '/api/courses/3/learning-objects'],
    ['get', '/api/courses/3/learning-objects'],
  ])
  assert.equal(sentBody(calls[0]), undefined)
  assert.deepEqual(data, body)
})

test('TC18: show sends GET to the learning object and returns data unchanged', async () => {
  const body = {
    learning_object: {
      id: 7,
      course_id: 3,
      type: 'quiz',
      status: 'published',
      quiz: { id: 1, time_limit_minutes: 25, passing_score: 60, total_questions: 1, questions: [{ ...studentQuestion, question_type: 'single_choice' }] },
    },
  }
  respond(200, body)
  const data = await learningObjects.show(3, 7)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, 'get')
  assert.equal(sentUrl(calls[0]), B)
  assert.deepEqual(data, body)
})

test('TC19: HTTP 422 for an already submitted attempt keeps status and server message, errors stay empty', async () => {
  respond(422, { message: 'This attempt has already been submitted.' })
  await assert.rejects(learningObjects.submitAttempt(3, 7, 11, payload), (err) => {
    assert.ok(err instanceof LearningObjectsApiError)
    assert.equal(err.status, 422)
    assert.equal(err.message, 'Dữ liệu gửi lên không hợp lệ.') // không suy đoán nguyên nhân 422 từ status
    assert.equal(err.serverMessage, 'This attempt has already been submitted.')
    assert.deepEqual(err.errors, {})
    assert.deepEqual(err.data, { message: 'This attempt has already been submitted.' })
    return true
  })
  assert.equal(calls.length, 1)
})

test('TC20: Laravel debug fields (exception, file, line, trace) are not kept in the error', async () => {
  respond(422, { ...debugBody('An answer does not belong to this quiz.'), attempt_id: 11 })
  await assert.rejects(learningObjects.saveDraft(3, 7, 11, payload), (err) => {
    assert.equal(err.status, 422)
    assert.equal(err.message, 'Dữ liệu gửi lên không hợp lệ.')
    assert.equal(err.serverMessage, 'An answer does not belong to this quiz.')
    assert.deepEqual(err.errors, {})
    assert.deepEqual(err.data, { message: 'An answer does not belong to this quiz.', attempt_id: 11 }) // field nghiệp vụ khác vẫn giữ
    assert.equal(containsDeep(err.data, '/var/www'), false)
    assert.equal(containsDeep(err.data, 'Symfony'), false)
    return true
  })

  // Body không phải JSON object (vd. trang HTML lỗi 500) không được giữ lại.
  respond(500, '<html>Whoops /var/www/html/app.php</html>')
  await assert.rejects(learningObjects.list(3), (err) => {
    assert.equal(err.status, 500)
    assert.equal(err.data, null)
    assert.equal(err.message, 'Máy chủ đang gặp sự cố. Vui lòng thử lại sau.')
    assert.equal(containsDeep(err, '/var/www'), false)
    return true
  })
})

test('TC21: failures are never retried and never trigger startAttempt', async () => {
  const failures = [
    [409, {}],
    [422, debugBody('This attempt has already been submitted.')],
    [500, { message: 'Server Error' }],
  ]
  for (const [status, body] of failures) {
    calls = []
    respond(status, body)
    await assert.rejects(learningObjects.saveDraft(3, 7, 11, payload), { status })
    await assert.rejects(learningObjects.submitAttempt(3, 7, 11, payload), { status })
    assert.deepEqual(calls.map((c) => [c.method, sentUrl(c)]), [
      ['patch', `${B}/quiz-attempts/11`],
      ['post', `${B}/quiz-attempts/11/submit`],
    ])
  }

  calls = []
  api.defaults.adapter = async (config) => {
    calls.push(config)
    throw new AxiosError('timeout of 0ms exceeded', AxiosError.ECONNABORTED, config, {})
  }
  await assert.rejects(learningObjects.submitAttempt(3, 7, 11, payload), { status: 0, code: 'ECONNABORTED' })
  assert.equal(calls.length, 1)
})

test('TC22: HTTP 404 with a technical debug message shows a safe message and keeps the original separately', async () => {
  respond(404, {
    ...debugBody('No query results for model [App\\Models\\QuizAttempt] 999999'),
    exception: 'Symfony\\Component\\HttpKernel\\Exception\\NotFoundHttpException',
  })
  await assert.rejects(learningObjects.attemptResult(3, 7, 999999), (err) => {
    assert.equal(err.status, 404)
    assert.equal(err.message, 'Không tìm thấy bài kiểm tra hoặc bài làm.')
    assert.equal(err.serverMessage, 'No query results for model [App\\Models\\QuizAttempt] 999999')
    assert.deepEqual(err.data, { message: 'No query results for model [App\\Models\\QuizAttempt] 999999' })
    assert.equal(containsDeep(err.data, '/var/www'), false)
    assert.equal(containsDeep(err.data, 'Symfony'), false)
    return true
  })
})

test('TC23: HTTP 5xx drops the whole body, including stack trace and technical message', async () => {
  const sqlMessage = 'SQLSTATE[HY000] [2002] Connection refused (SQL: select * from `users` where `api_token_hash` = abc)'
  for (const [status, body] of [
    [500, { ...debugBody(sqlMessage), exception: 'Illuminate\\Database\\QueryException', errors: { db: ['down'] } }],
    [502, { message: 'Bad Gateway' }],
    [503, { message: 'AI provider quota exceeded at /var/www/html/app/Services/RagService.php' }],
  ]) {
    respond(status, body)
    await assert.rejects(learningObjects.submitAttempt(3, 7, 11, { answers: [{ question_id: 21, selected_option_id: 9917 }] }), (err) => {
      assert.ok(err instanceof LearningObjectsApiError)
      assert.equal(err.status, status)
      assert.equal(err.code, 'ERR_BAD_REQUEST')
      assert.equal(err.canceled, false)
      assert.equal(err.message, 'Máy chủ đang gặp sự cố. Vui lòng thử lại sau.')
      assert.equal(err.serverMessage, null)
      assert.equal(err.data, null)
      assert.deepEqual(err.errors, {})
      for (const needle of ['SQLSTATE', 'api_token_hash', '/var/www', 'Bad Gateway', 'test-token', '9917']) {
        assert.equal(containsDeep(err, needle), false, `leaked ${needle}`)
      }
      return true
    })
  }
})

// So sánh header thật gửi tới adapter (AxiosHeaders → object thường).
const sentHeaders = (config) => JSON.parse(JSON.stringify(config.headers))

test('TC24: saveDraft with four arguments behaves as before (no per-request timeout)', async () => {
  respond(200, { attempt: inProgress.attempt, server_time: inProgress.server_time })
  await learningObjects.saveDraft(3, 7, 11, payload)
  await learningObjects.saveDraft(3, 7, 11, payload, undefined)
  await learningObjects.saveDraft(3, 7, 11, payload, {})
  await learningObjects.saveDraft(3, 7, 11, payload, { timeout: undefined })
  for (const config of calls) {
    assert.equal(config.method, 'patch')
    assert.equal(sentUrl(config), `${B}/quiz-attempts/11`)
    assert.deepEqual(sentBody(config), payload)
    assert.equal(config.timeout, api.defaults.timeout) // giữ mặc định của instance (0)
  }
  assert.equal(api.defaults.timeout, 0)
})

test('TC25: saveDraft forwards { timeout } to the adapter without changing body, headers or URL', async () => {
  respond(200, { attempt: inProgress.attempt, server_time: inProgress.server_time })
  await learningObjects.saveDraft(3, 7, 11, payload)
  await learningObjects.saveDraft(3, 7, 11, payload, { timeout: 20000 })
  const [plain, timed] = calls
  assert.equal(timed.timeout, 20000)
  assert.equal(timed.method, 'patch')
  assert.equal(sentUrl(timed), sentUrl(plain))
  assert.equal(timed.baseURL, plain.baseURL)
  assert.deepEqual(sentBody(timed), payload)
  assert.deepEqual(sentHeaders(timed), sentHeaders(plain))
  assert.equal(timed.headers.Authorization, 'Bearer test-token')
  // Timeout chỉ áp dụng cho request đó, không đổi cấu hình dùng chung.
  assert.equal(api.defaults.timeout, 0)
})

test('TC26: invalid options or timeout values are rejected before any request is sent', async () => {
  respond(200, { attempt: inProgress.attempt, server_time: inProgress.server_time })
  const invalid = [
    null,
    'fast',
    20000,
    [20000],
    { timeout: '20000' },
    { timeout: 0 },
    { timeout: -1 },
    { timeout: 1.5 },
    { timeout: NaN },
    { timeout: Infinity },
    { timeout: 2 ** 53 },
    { timeout: null },
    { headers: { Authorization: 'Bearer other' } },
    { url: '/admin' },
    { baseURL: 'http://evil.test' },
    { method: 'delete' },
    { data: { answers: [] } },
    { timeout: 20000, headers: { 'X-Test': '1' } },
  ]
  for (const options of invalid) {
    await assert.rejects(learningObjects.saveDraft(3, 7, 11, payload, options), TypeError, JSON.stringify(options) ?? String(options))
  }
  assert.equal(calls.length, 0)
})

test('TC27: a saveDraft timeout is normalised to ECONNABORTED/status 0 and is not retried', async () => {
  api.defaults.adapter = async (config) => {
    calls.push(config)
    throw new AxiosError(`timeout of ${config.timeout}ms exceeded`, AxiosError.ECONNABORTED, config, {})
  }
  await assert.rejects(learningObjects.saveDraft(3, 7, 11, payload, { timeout: 20000 }), (err) => {
    assert.ok(err instanceof LearningObjectsApiError)
    assert.equal(err.status, 0)
    assert.equal(err.code, 'ECONNABORTED')
    assert.equal(err.canceled, false)
    assert.equal(err.data, null)
    assert.equal(err.serverMessage, null)
    assert.equal(err.message, 'Không thể kết nối tới máy chủ.')
    assert.equal(containsDeep(err, 'test-token'), false)
    return true
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(calls.length, 1)
  assert.equal(calls[0].timeout, 20000)
  // Không có request nào khác, đặc biệt không có POST startAttempt.
  assert.deepEqual(calls.map((c) => [c.method, sentUrl(c)]), [['patch', `${B}/quiz-attempts/11`]])
})

test('TC28: saveDraft errors never trigger startAttempt or any other request', async () => {
  for (const [status, body] of [
    [422, { message: 'This attempt has already been submitted.' }],
    [500, { message: 'Server Error' }],
    [404, {}],
  ]) {
    calls = []
    respond(status, body)
    await assert.rejects(learningObjects.saveDraft(3, 7, 11, payload, { timeout: 20000 }), { status })
    assert.deepEqual(calls.map((c) => c.method), ['patch'])
  }
})

test('TC29: the other six endpoints keep their behaviour and ignore an extra argument', async () => {
  respond(200, {})
  await learningObjects.list(3, { timeout: 1 })
  await learningObjects.show(3, 7, { timeout: 1 })
  await learningObjects.startAttempt(3, 7, { timeout: 1 })
  await learningObjects.submitAttempt(3, 7, 11, payload, { timeout: 1 })
  await learningObjects.attemptHistory(3, 7)
  await learningObjects.quizResults(3, 7)
  await learningObjects.attemptResult(3, 7, 55, { timeout: 1 })
  assert.deepEqual(calls.map((c) => [c.method, sentUrl(c), c.timeout]), [
    ['get', '/api/courses/3/learning-objects', 0],
    ['get', B, 0],
    ['post', `${B}/quiz-attempts`, 0],
    ['post', `${B}/quiz-attempts/11/submit`, 0],
    ['get', `${B}/quiz-attempts`, 0],
    ['get', `${B}/quiz-results`, 0],
    ['get', `${B}/quiz-results/attempts/55`, 0],
  ])
  assert.deepEqual(sentBody(calls[3]), payload)
})
