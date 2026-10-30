import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createQuizSession } from '../src/quiz/quizSession.js'
import { LearningObjectsApiError } from '../src/services/learningObjects.js'

// Service giả: mỗi lời gọi trả một promise do test tự resolve/reject, để kiểm soát thứ tự và đồng thời.
function fakeService() {
  const calls = []
  const pending = []
  const method = (name) => (...args) => {
    calls.push(name)
    return new Promise((resolve, reject) => pending.push({ name, args, resolve, reject }))
  }
  return {
    service: {
      show: method('show'),
      attemptHistory: method('attemptHistory'),
      startAttempt: method('startAttempt'),
      saveDraft: method('saveDraft'),
    },
    calls,
    // Lấy request đang chờ sớm nhất của method; test resolve hoặc reject nó.
    take(name) {
      const index = pending.findIndex((p) => p.name === name)
      assert.notEqual(index, -1, `no pending ${name}`)
      return pending.splice(index, 1)[0]
    },
  }
}

const settle = () => new Promise((resolve) => setImmediate(resolve))

// Scheduler giả: không có timer thật; test gọi tick() để mô phỏng một nhịp 15 giây.
function fakeScheduler() {
  let nextId = 1
  const intervals = new Map()
  const timeouts = new Map()
  return {
    intervals,
    timeouts,
    setInterval(fn, ms) {
      const id = nextId++
      intervals.set(id, { fn, ms })
      return id
    },
    clearInterval(id) {
      intervals.delete(id)
    },
    setTimeout(fn, ms) {
      const id = nextId++
      timeouts.set(id, { fn, ms })
      return id
    },
    clearTimeout(id) {
      timeouts.delete(id)
    },
    tick() {
      for (const { fn } of [...intervals.values()]) fn()
    },
    fireTimeouts() {
      for (const [id, { fn }] of [...timeouts]) {
        timeouts.delete(id)
        fn()
      }
    },
  }
}

const apiError = (status, extra = {}) =>
  new LearningObjectsApiError(
    { 0: 'Không thể kết nối tới máy chủ.', 403: 'Bạn không có quyền thực hiện thao tác này.', 404: 'Không tìm thấy bài kiểm tra hoặc bài làm.' }[status] ??
      'Máy chủ đang gặp sự cố. Vui lòng thử lại sau.',
    { status, code: status ? 'ERR_BAD_REQUEST' : 'ERR_NETWORK', canceled: false, serverMessage: status ? 'SECRET backend message' : null, errors: {}, data: status ? { message: 'SECRET backend message' } : null, ...extra },
  )

const detail = {
  learning_object: {
    id: 7,
    type: 'quiz',
    title: 'Kiểm tra 15 phút',
    description: '',
    total_questions: 2,
    quiz: { id: 1, time_limit_minutes: 25, passing_score: 60, total_questions: 2, questions: [] },
  },
}
const history = { attempts: [{ id: 1 }, { id: 2 }], latest_score: 50, best_score: 75 }
const startResponse = (draft = []) => ({
  attempt: {
    id: 11,
    attempt_number: 3,
    status: 'in_progress',
    started_at: '2026-10-30T06:53:46.000000Z',
    expires_at: '2026-10-30T07:18:46.000000Z',
    draft_answers: draft,
  },
  quiz: {
    learning_object_id: 7,
    title: 'Kiểm tra 15 phút',
    questions: [
      { id: 21, question_index: 0, question_text: 'Câu A', options: [{ id: 41, option_index: 0, option_text: 'A1' }, { id: 42, option_index: 1, option_text: 'A2' }] },
      { id: 22, question_index: 1, question_text: 'Câu B', options: [{ id: 43, option_index: 0, option_text: 'B1' }, { id: 44, option_index: 1, option_text: 'B2' }] },
    ],
  },
  server_time: '2026-10-30T06:53:46.370035Z',
})

// Đưa session tới intro (show + history thành công).
async function toIntro(fake, session) {
  const loading = session.loadIntro()
  fake.take('show').resolve(detail)
  fake.take('attemptHistory').resolve(history)
  await loading
}

async function toInProgress(fake, session, draft) {
  await toIntro(fake, session)
  const starting = session.start()
  fake.take('startAttempt').resolve(startResponse(draft))
  await starting
}

const newSession = (fake, scheduler = fakeScheduler()) =>
  createQuizSession({ courseId: 3, learningObjectId: 7, service: fake.service, scheduler })

test('QS01: loadIntro calls show and history only, never startAttempt', async () => {
  const fake = fakeService()
  const session = newSession(fake)
  assert.equal(session.state.phase, 'idle')
  const loading = session.loadIntro()
  assert.equal(session.state.phase, 'loading')
  assert.deepEqual(fake.calls, ['show', 'attemptHistory'])
  fake.take('show').resolve(detail)
  fake.take('attemptHistory').resolve(history)
  assert.equal(await loading, true)
  assert.equal(session.state.phase, 'intro')
  assert.deepEqual({ ...session.state.quiz }, { title: 'Kiểm tra 15 phút', description: '', totalQuestions: 2, timeLimitMinutes: 25, passingScore: 60 })
  assert.deepEqual({ ...session.state.history }, { completedCount: 2, latestScore: 50, bestScore: 75 })
  await settle()
  assert.equal(fake.calls.includes('startAttempt'), false)
})

test('QS02: a history failure keeps the quiz viewable and startable', async () => {
  const fake = fakeService()
  const session = newSession(fake)
  const loading = session.loadIntro()
  fake.take('show').resolve(detail)
  fake.take('attemptHistory').reject(apiError(500))
  await loading
  assert.equal(session.state.phase, 'intro')
  assert.equal(session.state.history, null)
  assert.equal(session.state.historyError, 'Không tải được lịch sử làm bài.')
})

test('QS03: intro errors: 404/403/invalid id are fatal, network errors allow a manual retry', async () => {
  for (const [err, message] of [
    [apiError(404), 'Không tìm thấy bài kiểm tra hoặc bài làm.'],
    [apiError(403), 'Bạn không có quyền thực hiện thao tác này.'],
    [new TypeError('courseId phải là số nguyên dương.'), 'Đường dẫn Quiz không hợp lệ.'],
  ]) {
    const fake = fakeService()
    const session = newSession(fake)
    const loading = session.loadIntro()
    fake.take('show').reject(err)
    fake.take('attemptHistory').reject(err)
    await loading
    assert.equal(session.state.phase, 'fatal_error')
    assert.deepEqual({ ...session.state.error }, { message, retry: null })
    assert.equal(await session.loadIntro(), false) // fatal: không tải lại
  }

  const fake = fakeService()
  const session = newSession(fake)
  let loading = session.loadIntro()
  fake.take('show').reject(apiError(0))
  fake.take('attemptHistory').reject(apiError(0))
  await loading
  assert.equal(session.state.phase, 'recoverable_error')
  assert.equal(session.state.error.retry, 'intro')
  assert.equal(session.state.error.message, 'Không thể kết nối tới máy chủ.')
  await settle()
  assert.equal(fake.calls.length, 2) // không tự retry

  loading = session.loadIntro()
  fake.take('show').resolve(detail)
  fake.take('attemptHistory').resolve(history)
  await loading
  assert.equal(session.state.phase, 'intro')
})

test('QS04: a learning object that is not a quiz is fatal', async () => {
  const fake = fakeService()
  const session = newSession(fake)
  const loading = session.loadIntro()
  fake.take('show').resolve({ learning_object: { id: 8, type: 'flashcard', quiz: null } })
  fake.take('attemptHistory').resolve(history)
  await loading
  assert.equal(session.state.phase, 'fatal_error')
  assert.equal(session.state.error.message, 'Không tìm thấy bài kiểm tra hoặc bài làm.')
})

test('QS05: start is blocked before intro and double clicks share one request', async () => {
  const fake = fakeService()
  const session = newSession(fake)
  assert.equal(await session.start(), false) // idle
  const loading = session.loadIntro()
  assert.equal(await session.start(), false) // loading
  fake.take('show').resolve(detail)
  fake.take('attemptHistory').resolve(history)
  await loading

  const first = session.start()
  const second = session.start()
  assert.equal(first, second)
  assert.equal(session.state.phase, 'starting')
  assert.equal(fake.calls.filter((c) => c === 'startAttempt').length, 1)
  fake.take('startAttempt').resolve(startResponse())
  assert.equal(await first, true)
  assert.equal(await session.start(), false) // in_progress: không start lại
  assert.equal(fake.calls.filter((c) => c === 'startAttempt').length, 1)
})

test('QS06: a successful start moves to in_progress with an empty answer map', async () => {
  const fake = fakeService()
  const session = newSession(fake)
  await toInProgress(fake, session)
  assert.equal(session.state.phase, 'in_progress')
  assert.deepEqual({ ...session.state.attempt }, {
    id: 11,
    attemptNumber: 3,
    status: 'in_progress',
    startedAt: '2026-10-30T06:53:46.000000Z',
    expiresAt: '2026-10-30T07:18:46.000000Z',
  })
  assert.deepEqual({ ...session.state.answers }, { 21: null, 22: null })
  assert.equal(session.answeredCount.value, 0)
  assert.equal(session.state.currentIndex, 0)
  assert.equal(session.dirty.value, false)
})

test('QS07: resume restores valid draft answers and ignores mismatched ones', async () => {
  const fake = fakeService()
  const session = newSession(fake)
  await toInProgress(fake, session, [
    { question_id: 21, selected_option_id: 42 },
    { question_id: 22, selected_option_id: 41 }, // lựa chọn của câu khác
    { question_id: 99, selected_option_id: 41 }, // câu không tồn tại
  ])
  assert.deepEqual({ ...session.state.answers }, { 21: 42, 22: null })
  assert.equal(session.state.ignoredDraftCount, 2)
  assert.equal(session.answeredCount.value, 1)
  assert.equal(session.dirty.value, false) // draft từ server được coi là đã lưu
})

test('QS08: select, change and clear answers update answeredCount and edit metadata', async () => {
  const fake = fakeService()
  const session = newSession(fake)
  await toInProgress(fake, session)

  assert.equal(session.selectAnswer(21, 41), true)
  assert.equal(session.state.answers[21], 41)
  assert.equal(session.answeredCount.value, 1)
  assert.equal(session.state.editSeq, 1)
  assert.equal(session.dirty.value, true)

  assert.equal(session.selectAnswer(21, 41), true) // chọn lại cùng lựa chọn: không đổi
  assert.equal(session.state.editSeq, 1)
  assert.equal(session.selectAnswer(21, 42), true)
  assert.equal(session.state.answers[21], 42)
  assert.equal(session.state.editSeq, 2)

  assert.equal(session.clearAnswer(21), true)
  assert.equal(session.state.answers[21], null)
  assert.equal(session.answeredCount.value, 0)
  assert.equal(session.state.editSeq, 3)
})

test('QS09: unknown questions, foreign options and null via selectAnswer are rejected', async () => {
  const fake = fakeService()
  const session = newSession(fake)
  await toInProgress(fake, session)
  assert.equal(session.selectAnswer(99, 41), false)
  assert.equal(session.selectAnswer(21, 43), false) // lựa chọn thuộc câu 22
  assert.equal(session.selectAnswer(21, null), false)
  assert.equal(session.selectAnswer('21', '41'), false)
  assert.equal(session.clearAnswer(99), false)
  assert.deepEqual({ ...session.state.answers }, { 21: null, 22: null })
  assert.equal(session.state.editSeq, 0)
})

test('QS10: answers and navigation cannot change outside in_progress', async () => {
  const fake = fakeService()
  const session = newSession(fake)
  assert.equal(session.selectAnswer(21, 41), false) // idle
  await toIntro(fake, session)
  assert.equal(session.selectAnswer(21, 41), false) // intro
  const starting = session.start()
  assert.equal(session.selectAnswer(21, 41), false) // starting
  fake.take('startAttempt').resolve(startResponse())
  await starting

  assert.equal(session.goTo(1), true)
  assert.equal(session.goTo(2), false)
  assert.equal(session.goTo(-1), false)
  assert.equal(session.state.currentIndex, 1)

  session.dispose()
  assert.equal(session.state.phase, 'disposed')
  assert.equal(session.selectAnswer(21, 41), false)
  assert.equal(session.clearAnswer(21), false)
  assert.equal(session.goTo(0), false)
  assert.equal(await session.start(), false)
  assert.equal(await session.loadIntro(), false)
})

test('QS11: snapshot lists every question in order with null for unanswered ones', async () => {
  const fake = fakeService()
  const session = newSession(fake)
  await toInProgress(fake, session)
  session.selectAnswer(22, 44)
  assert.deepEqual(session.snapshot(), {
    answers: [
      { question_id: 21, selected_option_id: null },
      { question_id: 22, selected_option_id: 44 },
    ],
  })
})

test('QS12: start errors are never retried automatically; uncertain failures are flagged', async () => {
  const fake = fakeService()
  const session = newSession(fake)
  await toIntro(fake, session)
  let starting = session.start()
  fake.take('startAttempt').reject(apiError(0))
  assert.equal(await starting, false)
  assert.equal(session.state.phase, 'recoverable_error')
  assert.deepEqual({ ...session.state.error }, { message: 'Không thể kết nối tới máy chủ.', retry: 'start' })
  assert.equal(session.state.startUncertain, true)
  await settle()
  assert.equal(fake.calls.filter((c) => c === 'startAttempt').length, 1)

  // Thử lại thủ công: FLTS resume bài đang dở nếu lần trước đã tạo.
  starting = session.start()
  fake.take('startAttempt').resolve(startResponse([{ question_id: 21, selected_option_id: 41 }]))
  assert.equal(await starting, true)
  assert.equal(session.state.startUncertain, false)
  assert.equal(session.state.answers[21], 41)

  const fatal = fakeService()
  const blocked = newSession(fatal)
  await toIntro(fatal, blocked)
  starting = blocked.start()
  fatal.take('startAttempt').reject(apiError(403))
  await starting
  assert.equal(blocked.state.phase, 'fatal_error')
  assert.equal(blocked.state.error.retry, null)
  assert.equal(blocked.state.startUncertain, false)
  assert.equal(await blocked.start(), false)
  assert.equal(fatal.calls.filter((c) => c === 'startAttempt').length, 1)
})

test('QS13: responses arriving after dispose do not change state', async () => {
  const fake = fakeService()
  const session = newSession(fake)
  const loading = session.loadIntro()
  session.dispose()
  fake.take('show').resolve(detail)
  fake.take('attemptHistory').resolve(history)
  assert.equal(await loading, false)
  assert.equal(session.state.phase, 'disposed')
  assert.equal(session.state.quiz, null)

  const fake2 = fakeService()
  const session2 = newSession(fake2)
  await toIntro(fake2, session2)
  const starting = session2.start()
  session2.dispose()
  fake2.take('startAttempt').resolve(startResponse([{ question_id: 21, selected_option_id: 41 }]))
  assert.equal(await starting, false)
  assert.equal(session2.state.phase, 'disposed')
  assert.equal(session2.state.attempt, null)
  assert.deepEqual(session2.state.questions, [])

  const fake3 = fakeService()
  const session3 = newSession(fake3)
  await toIntro(fake3, session3)
  const failing = session3.start()
  session3.dispose()
  fake3.take('startAttempt').reject(apiError(0))
  await failing
  assert.equal(session3.state.phase, 'disposed')
  assert.equal(session3.state.error, null)
})

test('QS14: correct answers, explanations and backend messages never reach the state', async () => {
  const fake = fakeService()
  const session = newSession(fake)
  await toIntro(fake, session)
  const leaky = startResponse()
  leaky.quiz.questions[0].explanation = 'SECRET_EXPLANATION'
  leaky.quiz.questions[0].citations = [{ source_locator: 'page 9' }]
  leaky.quiz.questions[0].correct_option_id = 42
  leaky.quiz.questions[0].options[1].is_correct = true
  const starting = session.start()
  fake.take('startAttempt').resolve(leaky)
  await starting
  const dump = JSON.stringify(session.state)
  for (const needle of ['SECRET_EXPLANATION', 'is_correct', 'correct_option', 'citations', 'page 9']) {
    assert.equal(dump.includes(needle), false, needle)
  }
  assert.deepEqual(Object.keys(session.state.questions[0]).sort(), ['id', 'index', 'options', 'text'])
  assert.deepEqual(Object.keys(session.state.questions[0].options[0]).sort(), ['id', 'index', 'text'])

  const failing = fakeService()
  const other = newSession(failing)
  await toIntro(failing, other)
  const start = other.start()
  failing.take('startAttempt').reject(apiError(500))
  await start
  assert.equal(JSON.stringify(other.state).includes('SECRET backend message'), false)
})

test('QS15: a completed attempt from start keeps inputs closed and does not start again', async () => {
  const fake = fakeService()
  const session = newSession(fake)
  await toIntro(fake, session)
  const done = startResponse()
  done.attempt.status = 'completed'
  done.attempt.score = 50
  done.attempt.total_correct = 1
  done.timed_out = true
  const starting = session.start()
  fake.take('startAttempt').resolve(done)
  await starting
  assert.equal(session.state.phase, 'completed')
  assert.deepEqual(JSON.parse(JSON.stringify(session.state.result)), {
    score: 50,
    totalCorrect: 1,
    autoSubmitted: false,
    timedOut: true,
    latestScore: null,
    bestScore: null,
    results: [],
  })
  assert.equal(session.selectAnswer(21, 41), false)
  assert.equal(await session.start(), false)
  assert.equal(fake.calls.filter((c) => c === 'startAttempt').length, 1)
})

test('QS16: an invalid start response is fatal and is not retried', async () => {
  const fake = fakeService()
  const session = newSession(fake)
  await toIntro(fake, session)
  const starting = session.start()
  fake.take('startAttempt').resolve({ attempt: { id: 11, status: 'in_progress' }, quiz: { questions: [] } })
  await starting
  assert.equal(session.state.phase, 'fatal_error')
  assert.equal(session.state.error.message, 'Dữ liệu bài làm không hợp lệ.')
  assert.equal(await session.start(), false)
})

test('QS17: prototype keys and string ids are rejected without touching answers or edit metadata', async () => {
  const fake = fakeService()
  const session = newSession(fake)
  await toInProgress(fake, session, [{ question_id: 21, selected_option_id: 41 }])
  for (const id of ['toString', '__proto__', 'constructor', 'hasOwnProperty', '21', 0, -21, 21.5, NaN, null, undefined]) {
    assert.equal(session.clearAnswer(id), false, `clearAnswer(${String(id)})`)
    assert.equal(session.selectAnswer(id, 41), false, `selectAnswer(${String(id)})`)
  }
  assert.equal(session.selectAnswer(21, '42'), false)
  assert.deepEqual(Object.keys(session.state.answers), ['21', '22'])
  assert.deepEqual({ ...session.state.answers }, { 21: 41, 22: null })
  assert.equal(Object.getPrototypeOf(session.state.answers), Object.prototype)
  assert.equal(session.state.editSeq, 0)
  assert.equal(session.dirty.value, false)
})

test('QS18: mutating a returned snapshot does not change the session', async () => {
  const fake = fakeService()
  const session = newSession(fake)
  await toInProgress(fake, session)
  const snap = session.snapshot()
  snap.answers[0].selected_option_id = 41
  snap.answers.push({ question_id: 99, selected_option_id: 1 })
  assert.deepEqual({ ...session.state.answers }, { 21: null, 22: null })
  assert.deepEqual(session.snapshot(), {
    answers: [
      { question_id: 21, selected_option_id: null },
      { question_id: 22, selected_option_id: null },
    ],
  })
  assert.notEqual(session.snapshot(), session.snapshot())
})

test('QS19: an unknown or missing attempt status never opens the inputs', async () => {
  for (const status of ['abandoned', '', undefined, null]) {
    const fake = fakeService()
    const session = newSession(fake)
    await toIntro(fake, session)
    const payload = startResponse([{ question_id: 21, selected_option_id: 41 }])
    payload.attempt.status = status
    const starting = session.start()
    fake.take('startAttempt').resolve(payload)
    assert.equal(await starting, false)
    assert.equal(session.state.phase, 'fatal_error', String(status))
    assert.deepEqual({ ...session.state.error }, { message: 'Dữ liệu bài làm không hợp lệ.', retry: null })
    assert.equal(session.state.attempt, null)
    assert.deepEqual(session.state.questions, [])
    assert.equal(session.selectAnswer(21, 42), false)
    assert.equal(await session.start(), false)
    assert.equal(fake.calls.filter((c) => c === 'startAttempt').length, 1)
  }
})

test('QS20: loadIntro called twice while loading shares one request', async () => {
  const fake = fakeService()
  const session = newSession(fake)
  const first = session.loadIntro()
  const second = session.loadIntro()
  assert.equal(first, second)
  assert.deepEqual(fake.calls, ['show', 'attemptHistory'])
  fake.take('show').resolve(detail)
  fake.take('attemptHistory').resolve(history)
  assert.equal(await first, true)
  assert.equal(await session.loadIntro(), false) // đã ở intro: không tải lại
  assert.deepEqual(fake.calls, ['show', 'attemptHistory'])
})

test('QS21: start failing with 401 or 422 is fatal, not uncertain and not retryable', async () => {
  for (const status of [401, 422]) {
    const fake = fakeService()
    const session = newSession(fake)
    await toIntro(fake, session)
    const starting = session.start()
    fake.take('startAttempt').reject(apiError(status))
    await starting
    assert.equal(session.state.phase, 'fatal_error', String(status))
    assert.equal(session.state.error.retry, null)
    assert.equal(session.state.startUncertain, false)
    assert.equal(await session.start(), false)
    assert.equal(fake.calls.filter((c) => c === 'startAttempt').length, 1)
  }
})

test('QS22: the exposed state is read-only for callers', async () => {
  const fake = fakeService()
  const session = newSession(fake)
  await toInProgress(fake, session)
  const warn = console.warn
  console.warn = () => {} // Vue cảnh báo khi ghi vào readonly; ở đây chỉ kiểm tra kết quả
  try {
    session.state.phase = 'completed'
    session.state.answers[21] = 41
    session.state.editSeq = 99
    session.state.questions.push({ id: 99, options: [] })
  } finally {
    console.warn = warn
  }
  assert.equal(session.state.phase, 'in_progress')
  assert.equal(session.state.answers[21], null)
  assert.equal(session.state.editSeq, 0)
  assert.equal(session.state.questions.length, 2)
})

// ---------- Autosave (B3) ----------

const saveOk = (overrides = {}) => ({
  attempt: { id: 11, status: 'in_progress', draft_answers: [] },
  server_time: '2026-10-30T07:00:15.000000Z',
  ...overrides,
})
const countOf = (fake, name) => fake.calls.filter((c) => c === name).length

async function autosaveSession(draft) {
  const fake = fakeService()
  const scheduler = fakeScheduler()
  const session = newSession(fake, scheduler)
  await toInProgress(fake, session, draft)
  return { fake, scheduler, session }
}

test('AS01: the scheduler starts once at in_progress and a clean session never sends PATCH', async () => {
  const fake = fakeService()
  const scheduler = fakeScheduler()
  const session = newSession(fake, scheduler)
  await toIntro(fake, session)
  assert.equal(scheduler.intervals.size, 0) // chưa vào in_progress
  const starting = session.start()
  fake.take('startAttempt').resolve(startResponse())
  await starting
  assert.equal(scheduler.intervals.size, 1)
  assert.equal([...scheduler.intervals.values()][0].ms, 15000)
  scheduler.tick()
  scheduler.tick()
  assert.equal(countOf(fake, 'saveDraft'), 0)
  assert.equal(session.state.save.status, 'idle')
})

test('AS02: a dirty session sends exactly one PATCH per tick with the full snapshot and a 20s timeout', async () => {
  const { fake, scheduler, session } = await autosaveSession()
  session.selectAnswer(21, 42)
  scheduler.tick()
  assert.equal(countOf(fake, 'saveDraft'), 1)
  const request = fake.take('saveDraft')
  assert.deepEqual(request.args, [
    3,
    7,
    11,
    { answers: [{ question_id: 21, selected_option_id: 42 }, { question_id: 22, selected_option_id: null }] },
    { timeout: 20000 },
  ])
  assert.equal(typeof request.args[4].timeout, 'number')
  assert.equal(session.state.save.status, 'saving')
  assert.equal(session.hasPendingSave(), true)

  // Hai tick khi request còn chờ: vẫn chỉ một PATCH.
  scheduler.tick()
  scheduler.tick()
  assert.equal(countOf(fake, 'saveDraft'), 1)
  request.resolve(saveOk())
  await settle()
  assert.equal(session.hasPendingSave(), false)
})

test('AS03: a 200 marks only the sent snapshot as saved; edits made meanwhile stay dirty and are saved next tick', async () => {
  const { fake, scheduler, session } = await autosaveSession()
  session.selectAnswer(21, 41) // editSeq 1
  scheduler.tick()
  const first = fake.take('saveDraft')
  session.selectAnswer(22, 43) // editSeq 2 khi PATCH đang chạy
  first.resolve(saveOk())
  await settle()
  assert.equal(session.state.savedSeq, 1)
  assert.equal(session.state.editSeq, 2)
  assert.equal(session.dirty.value, true)
  assert.equal(session.state.save.status, 'saved')
  assert.equal(session.state.save.failures, 0)
  assert.equal(session.state.save.lastSavedAt, '2026-10-30T07:00:15.000000Z')

  scheduler.tick()
  const second = fake.take('saveDraft')
  assert.deepEqual(second.args[3].answers, [
    { question_id: 21, selected_option_id: 41 },
    { question_id: 22, selected_option_id: 43 },
  ])
  second.resolve(saveOk({ server_time: 'not-a-date' }))
  await settle()
  assert.equal(session.state.savedSeq, 2)
  assert.equal(session.dirty.value, false)
  assert.equal(session.state.save.lastSavedAt, null) // server_time không hợp lệ thì không hiển thị
})

test('AS04: server and network failures keep savedSeq, retry on the next tick and stop after three', async () => {
  const { fake, scheduler, session } = await autosaveSession()
  session.selectAnswer(21, 41)
  for (const [round, err] of [[1, apiError(500)], [2, apiError(0)]]) {
    scheduler.tick()
    fake.take('saveDraft').reject(err)
    await settle()
    assert.equal(session.state.savedSeq, 0)
    assert.equal(session.dirty.value, true)
    assert.equal(session.state.save.status, 'retrying')
    assert.equal(session.state.save.failures, round)
  }
  scheduler.tick()
  fake.take('saveDraft').reject(apiError(503))
  await settle()
  assert.equal(session.state.save.status, 'stopped')
  assert.equal(session.state.save.reason, 'network')
  assert.equal(scheduler.intervals.size, 0)
  scheduler.tick()
  assert.equal(countOf(fake, 'saveDraft'), 3) // không có request vô hạn
  assert.equal(session.state.savedSeq, 0)
  assert.equal(session.canEdit.value, true) // lỗi mạng không khóa chỉnh sửa
})

test('AS05: a timeout is treated as unknown, keeps dirty and skips exactly one tick (cooldown)', async () => {
  const { fake, scheduler, session } = await autosaveSession()
  session.selectAnswer(21, 41)
  scheduler.tick()
  fake.take('saveDraft').reject(apiError(0, { code: 'ECONNABORTED' }))
  await settle()
  assert.equal(session.state.save.status, 'retrying')
  assert.equal(session.state.save.failures, 1)
  assert.equal(session.state.savedSeq, 0)
  assert.equal(session.dirty.value, true)

  scheduler.tick() // cooldown
  assert.equal(countOf(fake, 'saveDraft'), 1)
  scheduler.tick()
  assert.equal(countOf(fake, 'saveDraft'), 2)
  fake.take('saveDraft').resolve(saveOk())
  await settle()
  assert.equal(session.state.save.status, 'saved')
  assert.equal(session.state.save.failures, 0)
})

test('AS06: "save now" retries recoverable failures only and restarts the scheduler', async () => {
  const { fake, scheduler, session } = await autosaveSession()
  assert.equal(await session.saveNow(), false) // không có lỗi: không có gì để retry
  session.selectAnswer(21, 41)
  assert.equal(await session.saveNow(), false) // chỉ dirty, chưa lỗi: để tick xử lý
  for (let i = 0; i < 3; i++) {
    scheduler.tick()
    fake.take('saveDraft').reject(apiError(0, { code: 'ECONNABORTED' }))
    await settle()
    scheduler.tick() // cooldown
  }
  assert.equal(session.state.save.reason, 'network')
  assert.equal(scheduler.intervals.size, 0)

  const saving = session.saveNow()
  assert.equal(session.saveNow(), saving) // bấm liền hai lần: một request
  assert.equal(countOf(fake, 'saveDraft'), 4)
  assert.equal(scheduler.intervals.size, 1)
  fake.take('saveDraft').resolve(saveOk())
  assert.equal(await saving, true)
  assert.equal(session.state.save.status, 'saved')
  assert.equal(session.state.save.reason, null)

  // Đang retrying (chưa tới 3 lần) cũng cho lưu ngay.
  session.selectAnswer(21, 42)
  scheduler.tick()
  fake.take('saveDraft').reject(apiError(500))
  await settle()
  assert.equal(session.state.save.status, 'retrying')
  const again = session.saveNow()
  fake.take('saveDraft').resolve(saveOk())
  assert.equal(await again, true)
})

test('AS07: 422 with errors, 422 without errors and 409 stop autosave without a manual retry', async () => {
  const cases = [
    [apiError(422, { errors: { 'answers.0.question_id': ['bad'] } }), 'invalid_data', true],
    [apiError(422), 'needs_verification', false],
    [apiError(409), 'conflict', false],
  ]
  for (const [err, reason, editable] of cases) {
    const { fake, scheduler, session } = await autosaveSession([{ question_id: 22, selected_option_id: 43 }])
    session.selectAnswer(21, 41)
    scheduler.tick()
    fake.take('saveDraft').reject(err)
    await settle()
    assert.equal(session.state.save.status, 'stopped', reason)
    assert.equal(session.state.save.reason, reason)
    assert.equal(session.state.phase, 'in_progress')
    assert.equal(scheduler.intervals.size, 0)
    assert.equal(await session.saveNow(), false)
    scheduler.tick()
    assert.equal(countOf(fake, 'saveDraft'), 1)
    assert.equal(session.canEdit.value, editable)
    assert.equal(session.selectAnswer(21, 42), editable)
    // Đáp án vẫn giữ trong bộ nhớ dù bị khóa.
    assert.equal(session.state.answers[22], 43)
    assert.equal(session.state.savedSeq, 0)
    assert.equal(JSON.stringify(session.state).includes('SECRET backend message'), false)
  }
})

test('AS08: a timed_out or completed PATCH response ends the attempt and stops the scheduler', async () => {
  for (const response of [
    { attempt: { id: 11, status: 'completed', score: 50, total_correct: 1, auto_submitted: true }, latest_score: 50, best_score: 75, results: [{ question_id: 21, selected_option_id: 41, correct_option_id: 42, is_correct: false, explanation: 'x', citations: [{ document_name: 'doc.pdf', source_locator: 'page 9', vector_id: 'v' }] }], timed_out: true },
    { attempt: { id: 11, status: 'completed', score: 100, total_correct: 2 } },
  ]) {
    const { fake, scheduler, session } = await autosaveSession()
    session.selectAnswer(21, 41)
    scheduler.tick()
    fake.take('saveDraft').resolve(response)
    await settle()
    assert.equal(session.state.phase, 'completed')
    assert.equal(scheduler.intervals.size, 0)
    assert.equal(session.state.savedSeq, 0) // không đi qua nhánh 200 thông thường
    assert.equal(session.selectAnswer(21, 42), false)
    assert.equal(session.state.result.timedOut, response.timed_out === true)
    assert.equal(session.state.result.score, response.attempt.score)
  }
})

test('AS09: 403/404 are fatal, 401 stops autosave, other errors stop as client errors', async () => {
  for (const status of [403, 404]) {
    const { fake, scheduler, session } = await autosaveSession()
    session.selectAnswer(21, 41)
    scheduler.tick()
    fake.take('saveDraft').reject(apiError(status))
    await settle()
    assert.equal(session.state.phase, 'fatal_error')
    assert.equal(session.state.error.retry, null)
    assert.equal(scheduler.intervals.size, 0)
  }
  let { fake, scheduler, session } = await autosaveSession()
  session.selectAnswer(21, 41)
  scheduler.tick()
  fake.take('saveDraft').reject(apiError(401))
  await settle()
  assert.equal(session.state.save.reason, 'unauthorized')
  assert.equal(scheduler.intervals.size, 0)
  ;({ fake, scheduler, session } = await autosaveSession())
  session.selectAnswer(21, 41)
  scheduler.tick()
  fake.take('saveDraft').reject(new Error('unexpected'))
  await settle()
  assert.equal(session.state.save.reason, 'client_error')
})

test('AS10: invalid or mismatched PATCH responses stop autosave without marking anything saved', async () => {
  for (const response of [null, {}, { attempt: { id: 99, status: 'in_progress' } }, { attempt: { id: 11, status: 'abandoned' } }]) {
    const { fake, scheduler, session } = await autosaveSession()
    session.selectAnswer(21, 41)
    scheduler.tick()
    fake.take('saveDraft').resolve(response)
    await settle()
    assert.equal(session.state.save.reason, 'invalid_response', JSON.stringify(response))
    assert.equal(session.state.savedSeq, 0)
    assert.equal(session.state.phase, 'in_progress')
  }
})

test('AS11: a cancelled PATCH is neither a success nor a failure', async () => {
  const { fake, scheduler, session } = await autosaveSession()
  session.selectAnswer(21, 41)
  scheduler.tick()
  fake.take('saveDraft').reject(apiError(0, { code: 'ERR_CANCELED', canceled: true }))
  await settle()
  assert.equal(session.state.savedSeq, 0)
  assert.equal(session.state.save.failures, 0)
  assert.equal(session.state.save.status, 'idle')
  scheduler.tick()
  assert.equal(countOf(fake, 'saveDraft'), 2) // tick sau thử lại bình thường, không vòng lặp tức thì
})

test('AS12: dispose clears the interval and late PATCH results (success or failure) are ignored', async () => {
  for (const settleWith of ['resolve', 'reject']) {
    const { fake, scheduler, session } = await autosaveSession()
    session.selectAnswer(21, 41)
    scheduler.tick()
    const request = fake.take('saveDraft')
    session.dispose()
    assert.equal(scheduler.intervals.size, 0)
    assert.equal(session.hasPendingSave(), false)
    if (settleWith === 'resolve') request.resolve(saveOk())
    else request.reject(apiError(0))
    await settle()
    assert.equal(session.state.phase, 'disposed')
    assert.equal(session.state.savedSeq, 0)
    assert.equal(session.state.save.failures, 0)
    assert.equal(session.state.save.lastSavedAt, null)
    scheduler.tick()
    assert.equal(countOf(fake, 'saveDraft'), 1)
  }
})

test('AS13: a remounted player gets one fresh scheduler and the old one stays cleared', async () => {
  const fake = fakeService()
  const scheduler = fakeScheduler()
  const first = newSession(fake, scheduler)
  await toInProgress(fake, first)
  assert.equal(scheduler.intervals.size, 1)
  first.dispose()
  assert.equal(scheduler.intervals.size, 0)

  const second = newSession(fake, scheduler)
  await toIntro(fake, second)
  const starting = second.start()
  fake.take('startAttempt').resolve(startResponse())
  await starting
  assert.equal(scheduler.intervals.size, 1)
  second.selectAnswer(21, 41)
  scheduler.tick()
  assert.equal(countOf(fake, 'saveDraft'), 1)
})

test('AS14: stopAutosave and awaitPendingSave let a submit wait for a pending PATCH without hanging', async () => {
  const { fake, scheduler, session } = await autosaveSession()
  assert.equal(await session.awaitPendingSave(), true) // không có PATCH đang chạy

  session.selectAnswer(21, 41)
  scheduler.tick()
  const request = fake.take('saveDraft')
  session.stopAutosave()
  assert.equal(scheduler.intervals.size, 0)
  session.selectAnswer(21, 42)
  scheduler.tick()
  assert.equal(await session.saveNow(), false)
  assert.equal(countOf(fake, 'saveDraft'), 1) // không có PATCH mới sau stopAutosave

  const waiting = session.awaitPendingSave(25000)
  assert.equal([...scheduler.timeouts.values()][0].ms, 25000)
  request.resolve(saveOk())
  assert.equal(await waiting, true)
  assert.equal(session.state.savedSeq, 1) // PATCH đang chạy vẫn được ghi nhận
  assert.equal(scheduler.timeouts.size, 0)
  assert.deepEqual(session.snapshot().answers[0], { question_id: 21, selected_option_id: 42 })

  // PATCH treo: hết hạn chờ thì trả false, không chặn vĩnh viễn.
  const hung = await autosaveSession()
  hung.session.selectAnswer(21, 41)
  hung.scheduler.tick()
  hung.fake.take('saveDraft')
  hung.session.stopAutosave()
  const timedWait = hung.session.awaitPendingSave(1000)
  hung.scheduler.fireTimeouts()
  assert.equal(await timedWait, false)

  // Dispose giải phóng mọi lời chờ.
  const disposed = await autosaveSession()
  disposed.session.selectAnswer(21, 41)
  disposed.scheduler.tick()
  disposed.fake.take('saveDraft')
  const pendingWait = disposed.session.awaitPendingSave(1000)
  disposed.session.dispose()
  assert.equal(await pendingWait, false)
  assert.equal(disposed.scheduler.timeouts.size, 0)
})

test('AS15: autosave never calls startAttempt, whatever the PATCH outcome', async () => {
  for (const outcome of [saveOk(), apiError(0), apiError(422), apiError(409), apiError(500), { attempt: { id: 11, status: 'completed' }, timed_out: true }]) {
    const { fake, scheduler, session } = await autosaveSession()
    session.selectAnswer(21, 41)
    scheduler.tick()
    const request = fake.take('saveDraft')
    if (outcome instanceof Error) request.reject(outcome)
    else request.resolve(outcome)
    await settle()
    scheduler.tick()
    await settle()
    assert.equal(countOf(fake, 'startAttempt'), 1)
  }
})
