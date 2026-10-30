import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { AxiosError } from 'axios'
import api from '../src/services/api.js'
import { learningObjects } from '../src/services/learningObjects.js'
import {
  normalizeResults,
  bucketScores,
  median,
  formatDuration,
  formatScore,
  filterStudents,
  sortStudents,
} from '../src/quiz/quizResultsModel.js'
import { resultsFixture } from './helpers/quizResultsFixture.mjs'

// ===== Model =====
test('normalizeResults: tổng quan, thấp nhất/trung vị từ attempts, đạt theo lần gần nhất', () => {
  const r = normalizeResults(resultsFixture)
  assert.equal(r.quiz.passingScore, 60)
  assert.deepEqual(r.summary, {
    enrolledStudents: 3,
    participants: 2,
    totalAttempts: 3,
    averageScore: 53.33,
    highestScore: 100,
    lowestScore: 25,
    medianScore: 25,
    passRate: 50,
  })
  assert.deepEqual(r.distribution.map((b) => b.count), [0, 2, 0, 0, 1])
  const [demo, hung] = r.students
  assert.equal(demo.passed, false)
  assert.equal(hung.passed, true)
  assert.equal(demo.latestDurationSeconds, 600)
  assert.equal(demo.attempts[1].autoSubmitted, true)
})

test('normalizeResults: chưa có bài nộp → rỗng, không lỗi', () => {
  const r = normalizeResults({
    quiz: { learning_object_id: 7, title: 'Q', passing_score: 60, total_questions: 3, time_limit_minutes: null },
    summary: { enrolled_students: 1, participants: 0, total_attempts: 0, average_score: null, highest_score: null, pass_rate: null },
    students: [],
  })
  assert.equal(r.students.length, 0)
  assert.equal(r.summary.lowestScore, null)
  assert.equal(r.summary.medianScore, null)
  assert.deepEqual(r.distribution.map((b) => b.count), [0, 0, 0, 0, 0])
  assert.equal(normalizeResults(undefined).students.length, 0)
})

test('bucketScores: biên 0, 19.99, 20, 59.99, 60, 79.99, 80, 100', () => {
  assert.deepEqual(bucketScores([0, 19.99, 20, 59.99, 60, 79.99, 80, 100]).map((b) => [b.label, b.count]), [
    ['0–19', 2], ['20–39', 1], ['40–59', 1], ['60–79', 2], ['80–100', 2],
  ])
  assert.deepEqual(bucketScores([null, NaN, -1]).map((b) => b.count), [0, 0, 0, 0, 0])
})

test('median, formatScore, formatDuration', () => {
  assert.equal(median([]), null)
  assert.equal(median([3, 1, 2]), 2)
  assert.equal(median([25, 25, 100, 50]), 37.5)
  assert.equal(formatScore(25), '25%')
  assert.equal(formatScore(53.33), '53.33%')
  assert.equal(formatScore(62.5), '62.5%')
  assert.equal(formatScore(null), '—')
  assert.equal(formatDuration(null), '—')
  assert.equal(formatDuration(45), '45 giây')
  assert.equal(formatDuration(600), '10 phút')
  assert.equal(formatDuration(1505), '25 phút 5 giây')
  assert.equal(formatDuration(3720), '1 giờ 2 phút')
  assert.equal(formatDuration(0), '0 giây')
})

test('filterStudents (không dấu, email) và sortStudents (null ở cuối, không đổi mảng gốc)', () => {
  const { students } = normalizeResults(resultsFixture)
  assert.deepEqual(filterStudents(students, 'hung').map((s) => s.id), [5])
  assert.deepEqual(filterStudents(students, 'STUDENT@').map((s) => s.id), [2])
  assert.equal(filterStudents(students, '  ').length, 2)

  assert.deepEqual(sortStudents(students, 'latestScore', 'desc').map((s) => s.id), [5, 2])
  assert.deepEqual(sortStudents(students, 'latestScore', 'asc').map((s) => s.id), [2, 5])
  assert.deepEqual(sortStudents(students, 'name', 'asc').map((s) => s.id), [2, 5])
  assert.deepEqual(sortStudents(students, 'lastSubmittedAt', 'desc').map((s) => s.id), [2, 5])
  const withNull = [...students, { ...students[0], id: 9, latestScore: null }]
  assert.deepEqual(sortStudents(withNull, 'latestScore', 'desc').map((s) => s.id), [5, 2, 9])
  assert.deepEqual(sortStudents(withNull, 'latestScore', 'asc').map((s) => s.id), [2, 5, 9])
  assert.deepEqual(students.map((s) => s.id), [2, 5])
})

// ===== Service =====
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
  setGlobal('window', { location: { href: '/lecturer' } })
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
    const response = { data: JSON.stringify(body), status, statusText: '', headers: {}, config }
    if (status >= 200 && status < 300) return response
    throw new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', config, {}, response)
  }
}

async function rejection(promise) {
  try {
    await promise
  } catch (err) {
    return err
  }
  assert.fail('expected rejection')
}

const B = '/api/courses/3/learning-objects/7'

test('lecturerQuizResults / lecturerAttemptDetail: GET đúng path, timeout 20 giây', async () => {
  respond(200, resultsFixture)
  assert.deepEqual(await learningObjects.lecturerQuizResults(3, '7'), resultsFixture)
  await learningObjects.lecturerAttemptDetail(3, 7, 12)
  assert.deepEqual(calls.map((c) => [c.method, api.getUri(c), c.timeout]), [
    ['get', `${B}/quiz-results`, 20000],
    ['get', `${B}/quiz-results/attempts/12`, 20000],
  ])
  await assert.rejects(learningObjects.lecturerAttemptDetail(3, 7, 'abc'), TypeError)
})

test('lỗi kết quả: 403/404/mạng có thông báo tiếng Việt', async () => {
  respond(403, {})
  assert.equal((await rejection(learningObjects.lecturerQuizResults(3, 7))).message, 'Bạn không có quyền xem kết quả quiz này.')
  respond(404, { message: '' })
  assert.equal((await rejection(learningObjects.lecturerAttemptDetail(3, 7, 1))).message, 'Không tìm thấy quiz hoặc bài làm.')
  api.defaults.adapter = async (config) => { throw new AxiosError('Network Error', 'ERR_NETWORK', config) }
  const err = await rejection(learningObjects.lecturerQuizResults(3, 7))
  assert.equal(err.status, 0)
  assert.match(err.message, /Không thể kết nối/)
})
