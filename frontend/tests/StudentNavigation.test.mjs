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
// createWebHistory chỉ cần các phần tối thiểu này của window khi chạy ngoài trình duyệt.
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
const { courses, CoursesApiError } = await import('../src/services/courses.js')
const { default: router } = await import('../src/router/index.js')
const { createPinia } = await import('pinia')
const { RouterView } = await import('vue-router')
const { mountApp, flush, click, textOf } = await import('./helpers/mountApp.mjs')

let calls
let routes
let mounted

// Adapter giả theo URL; giá trị là [status, body] hoặc hàm trả Promise để giữ request ở trạng thái chờ.
function serve(table) {
  routes = table
  api.defaults.adapter = async (config) => {
    calls.push(config)
    const url = api.getUri(config)
    const entry = routes[`${config.method.toUpperCase()} ${url}`]
    const [status, body] = typeof entry === 'function' ? await entry() : entry ?? [404, { message: 'not stubbed' }]
    const response = { data: JSON.stringify(body), status, statusText: '', headers: {}, config }
    if (status >= 200 && status < 300) return response
    throw new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', config, {}, response)
  }
}

function loginAs(role) {
  storage.clear()
  if (!role) return
  storage.set('flts_token', 'test-token')
  storage.set('flts_user', JSON.stringify({ id: 2, name: 'Demo Student', role }))
}

async function open(path) {
  await router.push(path)
  mounted = mountApp(RouterView, [createPinia(), router])
  await flush()
  return mounted
}

function findLink(node, target) {
  if (node.tag === 'a' && node.props.href === target) return node
  for (const child of node.children) {
    const hit = findLink(child, target)
    if (hit) return hit
  }
  return null
}

const sentRequests = () => calls.map((c) => `${c.method.toUpperCase()} ${api.getUri(c)}`)
const href = (node) => node.props.href

const courseList = {
  courses: [
    {
      id: 1,
      lecturer_id: 1,
      name: 'Flipped Learning Foundations',
      code: 'FLIP-101',
      enrollment_code: 'FLTS-ZHRBWS',
      is_enrollment_open: true,
      description: 'Khóa học mẫu',
      lecturer: { id: 1, name: 'Demo Lecturer', email: 'lecturer@example.test' },
    },
  ],
}
const learningObjectList = {
  learning_objects: [
    { id: 7, course_id: 1, type: 'quiz', title: 'Kiểm tra 15 phút', status: 'published', total_questions: 8 },
    { id: 8, course_id: 1, type: 'flashcard', title: 'Bộ thẻ', status: 'published', total_questions: null },
    { id: 9, course_id: 1, type: 'quiz', title: 'Quiz nháp', status: 'draft', total_questions: 5 },
  ],
}
const quizDetail = (quiz = {}) => ({
  learning_object: {
    id: 7,
    course_id: 1,
    type: 'quiz',
    title: 'Kiểm tra 15 phút',
    description: '',
    status: 'published',
    total_questions: 8,
    quiz: { id: 1, time_limit_minutes: 25, passing_score: 60, total_questions: 8, questions: [], ...quiz },
  },
})

const quizHistory = { attempts: [{ id: 1, score: 50 }], latest_score: 50, best_score: 50 }
// Response start theo shape FLTS; cố ý thêm field đáp án để kiểm tra view không hiển thị chúng.
const startPayload = (draft = []) => ({
  attempt: { id: 11, attempt_number: 2, status: 'in_progress', started_at: null, expires_at: null, draft_answers: draft },
  quiz: {
    learning_object_id: 7,
    title: 'Kiểm tra 15 phút',
    questions: [
      {
        id: 21,
        question_index: 0,
        question_text: 'Câu hỏi thứ nhất',
        explanation: 'SECRET_EXPLANATION',
        options: [
          { id: 41, option_index: 0, option_text: 'Lựa chọn A' },
          { id: 42, option_index: 1, option_text: 'Lựa chọn B', is_correct: true },
        ],
      },
      { id: 22, question_index: 1, question_text: 'Câu hỏi thứ hai', options: [{ id: 43, option_index: 0, option_text: 'Lựa chọn C' }] },
    ],
  },
  server_time: '2026-10-30T06:53:46.370035Z',
})
const PLAYER = '/api/courses/1/learning-objects/7'
const change = (node) => node.props.onChange()

beforeEach(() => {
  calls = []
  loginAs('student')
  serve({})
})

afterEach(() => {
  mounted?.unmount()
  mounted = null
})

test('NAV01: student routes have the expected names, paths and student-only metadata', () => {
  const byName = Object.fromEntries(router.getRoutes().map((r) => [r.name, r]))
  for (const [name, path] of [
    ['student-courses', '/student/courses'],
    ['student-course', '/student/courses/:courseId'],
    ['student-quiz', '/student/courses/:courseId/quizzes/:learningObjectId'],
  ]) {
    assert.equal(byName[name]?.path, path)
    assert.equal(byName[name].meta.requiresAuth, true)
    assert.equal(byName[name].meta.role, 'student')
  }
  // Route lecturer giữ nguyên
  assert.equal(byName['course-detail'].path, '/courses/:id')
  assert.equal(byName['course-detail'].meta.role, 'lecturer')
})

test('NAV02: the existing guard keeps other roles and guests out of student routes', async () => {
  loginAs('lecturer')
  await router.push('/student/courses/1/quizzes/7')
  assert.equal(router.currentRoute.value.name, 'lecturer-dashboard')

  loginAs('admin')
  await router.push('/student/courses')
  assert.equal(router.currentRoute.value.name, 'admin-dashboard')

  loginAs(null)
  await router.push('/student/courses/1')
  assert.equal(router.currentRoute.value.name, 'login')
  assert.equal(router.currentRoute.value.query.redirect, '/student/courses/1')

  loginAs('student')
  await router.push('/student/courses/1/quizzes/7')
  assert.equal(router.currentRoute.value.name, 'student-quiz')
  assert.deepEqual(router.currentRoute.value.params, { courseId: '1', learningObjectId: '7' })
})

test('SVC01: courses.list and courses.show send GET with the Bearer interceptor and return data unchanged', async () => {
  serve({ 'GET /api/courses': [200, courseList], 'GET /api/courses/1': [200, { course: courseList.courses[0] }] })
  assert.deepEqual(await courses.list(), courseList)
  assert.deepEqual(await courses.show('1'), { course: courseList.courses[0] })
  assert.deepEqual(sentRequests(), ['GET /api/courses', 'GET /api/courses/1'])
  assert.equal(calls[0].headers.Authorization, 'Bearer test-token')
})

test('SVC02: courses.show rejects invalid ids before any request is sent', async () => {
  for (const id of [undefined, null, 'abc', 0, -1, 1.5, '1a']) {
    await assert.rejects(courses.show(id), TypeError)
  }
  assert.equal(calls.length, 0)
})

test('SVC03: course errors keep status and a safe message, without token or backend body', async () => {
  serve({ 'GET /api/courses/1': [403, { message: 'You are not authorized for this action.', trace: ['/var/www/x.php'] }] })
  await assert.rejects(courses.show(1), (err) => {
    assert.ok(err instanceof CoursesApiError)
    assert.equal(err.status, 403)
    assert.equal(err.message, 'Bạn chưa tham gia khóa học này.')
    assert.equal(err.cause, undefined)
    assert.equal(JSON.stringify(Object.entries(err)).includes('test-token'), false)
    assert.equal(JSON.stringify(Object.entries(err)).includes('/var/www'), false)
    return true
  })
  serve({ 'GET /api/courses': [500, { message: 'SQLSTATE[HY000]' }] })
  await assert.rejects(courses.list(), { status: 500, message: 'Máy chủ đang gặp sự cố. Vui lòng thử lại sau.' })
})

test('VIEW01: student courses page shows loading, then real courses without private fields', async () => {
  let release
  serve({ 'GET /api/courses': () => new Promise((resolve) => { release = () => resolve([200, courseList]) }) })
  const page = await open('/student/courses')
  assert.equal(page.find('loading').length, 1)

  release()
  await flush()
  assert.equal(page.find('loading').length, 0)
  const links = page.find('course-link')
  assert.equal(links.length, 1)
  assert.equal(href(links[0]), '/student/courses/1')
  assert.match(page.text(), /FLIP-101/)
  assert.match(page.text(), /Flipped Learning Foundations/)
  assert.match(page.text(), /Giảng viên: Demo Lecturer/)
  assert.doesNotMatch(page.text(), /FLTS-ZHRBWS|lecturer@example\.test/)
})

test('VIEW02: student courses page shows the empty state', async () => {
  serve({ 'GET /api/courses': [200, { courses: [] }] })
  const page = await open('/student/courses')
  assert.equal(page.find('empty').length, 1)
  assert.equal(page.find('course-link').length, 0)
})

test('VIEW03: student courses page shows a safe error and retries only when asked', async () => {
  serve({ 'GET /api/courses': [500, { message: 'SQLSTATE[HY000] secret' }] })
  const page = await open('/student/courses')
  assert.equal(page.find('error').length, 1)
  assert.match(page.text(), /Máy chủ đang gặp sự cố/)
  assert.doesNotMatch(page.text(), /SQLSTATE/)
  assert.equal(calls.length, 1)

  serve({ 'GET /api/courses': [200, courseList] })
  click(page.find('retry')[0])
  await flush()
  assert.equal(calls.length, 2)
  assert.equal(page.find('course-link').length, 1)
})

test('VIEW04: the sidebar "Khóa học của tôi" item links to the student courses page', async () => {
  const page = await open('/dashboard/student')
  const link = findLink(page.root, '/student/courses')
  assert.ok(link)
  assert.match(textOf(link), /Khóa học của tôi/)
})

test('VIEW08: "Khóa học của tôi" stays active on all three student routes and only there', async () => {
  serve({
    'GET /api/courses': [200, { courses: [] }],
    'GET /api/courses/1': [200, { course: courseList.courses[0] }],
    'GET /api/courses/1/learning-objects': [200, learningObjectList],
    'GET /api/courses/1/learning-objects/7': [200, quizDetail()],
  })
  const isActive = (link) => link.props.class.split(' ').includes('bg-indigo-600')
  for (const path of ['/student/courses', '/student/courses/1', '/student/courses/1/quizzes/7']) {
    const page = await open(path)
    assert.equal(isActive(findLink(page.root, '/student/courses')), true, path)
    assert.equal(isActive(findLink(page.root, '/dashboard/student')), false, path)
    page.unmount()
  }
  const page = await open('/dashboard/student')
  assert.equal(isActive(findLink(page.root, '/student/courses')), false)
  assert.equal(isActive(findLink(page.root, '/dashboard/student')), true)
  assert.equal(isActive(findLink(page.root, '/dashboard/student#practice')), false)
})

test('VIEW05: course page lists only published quizzes and links to the quiz player', async () => {
  serve({
    'GET /api/courses/1': [200, { course: courseList.courses[0] }],
    'GET /api/courses/1/learning-objects': [200, learningObjectList],
  })
  const page = await open('/student/courses/1')
  assert.deepEqual(sentRequests().sort(), ['GET /api/courses/1', 'GET /api/courses/1/learning-objects'])
  const links = page.find('quiz-link')
  assert.equal(links.length, 1)
  assert.equal(href(links[0]), '/student/courses/1/quizzes/7')
  assert.match(page.text(), /Kiểm tra 15 phút/)
  assert.match(page.text(), /8 câu/)
  assert.doesNotMatch(page.text(), /Bộ thẻ|Quiz nháp|FLTS-ZHRBWS|lecturer@example\.test/)
  assert.equal(href(page.find('back')[0]), '/student/courses')
})

test('VIEW06: course page shows empty and error states', async () => {
  serve({
    'GET /api/courses/1': [200, { course: courseList.courses[0] }],
    'GET /api/courses/1/learning-objects': [200, { learning_objects: [learningObjectList.learning_objects[1]] }],
  })
  let page = await open('/student/courses/1')
  assert.equal(page.find('empty').length, 1)
  page.unmount()

  serve({
    'GET /api/courses/1': [403, { message: 'You are not authorized for this action.' }],
    'GET /api/courses/1/learning-objects': [403, { message: 'You are not authorized for this action.' }],
  })
  page = await open('/student/courses/1')
  assert.equal(page.find('error').length, 1)
  assert.match(page.text(), /Bạn chưa tham gia khóa học này\.|Bạn không có quyền thực hiện thao tác này\./)
  assert.doesNotMatch(page.text(), /not authorized/)
})

test('VIEW07: invalid course id shows an error without sending requests', async () => {
  const page = await open('/student/courses/abc')
  assert.equal(page.find('error').length, 1)
  assert.match(page.text(), /Đường dẫn khóa học không hợp lệ/)
  assert.equal(calls.length, 0)
})

test('PLAYER01: quiz intro shows quiz info and history without starting an attempt', async () => {
  serve({ [`GET ${PLAYER}`]: [200, quizDetail()], [`GET ${PLAYER}/quiz-attempts`]: [200, quizHistory] })
  const page = await open('/student/courses/1/quizzes/7')
  assert.deepEqual(sentRequests(), [`GET ${PLAYER}`, `GET ${PLAYER}/quiz-attempts`])
  assert.match(page.text(), /Kiểm tra 15 phút/)
  assert.equal(textOf(page.find('total-questions')[0]).trim(), '8')
  assert.match(page.text(), /25 phút/)
  assert.match(page.text(), /60%/)
  assert.match(textOf(page.find('history')[0]), /Số lượt đã hoàn thành: 1/)
  assert.match(textOf(page.find('history')[0]), /Điểm gần nhất: 50%/)
  const start = page.find('start')[0]
  assert.equal('disabled' in start.props, false)
  await flush()
  assert.equal(calls.some((c) => c.method !== 'get'), false)
  assert.equal(href(page.find('back')[0]), '/student/courses/1')
})

test('PLAYER02: quiz without time limit shows "Không giới hạn"', async () => {
  serve({ 'GET /api/courses/1/learning-objects/7': [200, quizDetail({ time_limit_minutes: null })] })
  const page = await open('/student/courses/1/quizzes/7')
  assert.match(page.text(), /Không giới hạn/)
})

test('PLAYER03: invalid ids, non-quiz objects and API errors show safe error states', async () => {
  let page = await open('/student/courses/1/quizzes/abc')
  assert.match(page.text(), /Đường dẫn Quiz không hợp lệ/)
  assert.equal(calls.length, 0)
  assert.equal(page.find('retry').length, 0)
  page.unmount()

  serve({ 'GET /api/courses/1/learning-objects/8': [200, { learning_object: { id: 8, type: 'flashcard', title: 'Bộ thẻ', quiz: null } }] })
  page = await open('/student/courses/1/quizzes/8')
  assert.match(page.text(), /Không tìm thấy bài kiểm tra hoặc bài làm/)
  page.unmount()

  // 404 là lỗi không thể thử lại; message debug của backend không được hiển thị.
  serve({ [`GET ${PLAYER}`]: [404, { message: 'No query results for model [App\\Models\\LearningObject] 7' }] })
  page = await open('/student/courses/1/quizzes/7')
  assert.equal(page.find('error').length, 1)
  assert.match(page.text(), /Không tìm thấy bài kiểm tra hoặc bài làm/)
  assert.doesNotMatch(page.text(), /App\\Models/)
  assert.equal(page.find('retry').length, 0)
  page.unmount()

  // Lỗi máy chủ cho phép thử lại thủ công; lịch sử lỗi không chặn intro.
  serve({ [`GET ${PLAYER}`]: [500, { message: 'SQLSTATE[HY000]' }], [`GET ${PLAYER}/quiz-attempts`]: [500, {}] })
  page = await open('/student/courses/1/quizzes/7')
  assert.match(page.text(), /Máy chủ đang gặp sự cố/)
  assert.doesNotMatch(page.text(), /SQLSTATE/)
  serve({ [`GET ${PLAYER}`]: [200, quizDetail()], [`GET ${PLAYER}/quiz-attempts`]: [500, {}] })
  await click(page.find('retry')[0])
  await flush()
  assert.equal(page.find('quiz-info').length, 1)
  assert.match(textOf(page.find('history-error')[0]), /Không tải được lịch sử làm bài/)
  assert.equal(page.find('start').length, 1)
})

test('PLAYER04: start runs only on click, once for a double click, and the student can answer', async () => {
  let release
  serve({
    [`GET ${PLAYER}`]: [200, quizDetail()],
    [`GET ${PLAYER}/quiz-attempts`]: [200, quizHistory],
    [`POST ${PLAYER}/quiz-attempts`]: () => new Promise((resolve) => { release = () => resolve([201, startPayload([{ question_id: 22, selected_option_id: 43 }])]) }),
  })
  const page = await open('/student/courses/1/quizzes/7')
  const startButton = page.find('start')[0]
  click(startButton)
  click(startButton)
  await flush()
  assert.equal(sentRequests().filter((r) => r === `POST ${PLAYER}/quiz-attempts`).length, 1)
  assert.match(textOf(page.find('start')[0]), /Đang mở bài làm/)
  assert.equal('disabled' in page.find('start')[0].props, true)

  release()
  await flush()
  assert.equal(page.find('attempt').length, 1)
  assert.equal(page.find('unsaved-notice').length, 0) // banner "chưa có autosave" của B2 đã bỏ
  assert.equal(page.find('save-chip')[0].props['data-save'], 'clean')
  assert.match(textOf(page.find('progress')[0]), /Đã trả lời 1\/2 câu/) // draft được khôi phục
  assert.match(textOf(page.find('question')[0]), /Câu 1\. Câu hỏi thứ nhất/)

  change(page.find('option-42')[0])
  await flush()
  assert.equal(page.find('option-42')[0].props.checked, true)
  assert.match(textOf(page.find('progress')[0]), /Đã trả lời 2\/2 câu/)
  change(page.find('option-41')[0])
  await flush()
  assert.equal(page.find('option-41')[0].props.checked, true)
  assert.equal(page.find('option-42')[0].props.checked, undefined)
  await click(page.find('clear')[0])
  await flush()
  assert.match(textOf(page.find('progress')[0]), /Đã trả lời 1\/2 câu/)

  await click(page.find('nav-2')[0])
  await flush()
  assert.match(textOf(page.find('question')[0]), /Câu 2\. Câu hỏi thứ hai/)
  assert.equal(page.find('option-43')[0].props.checked, true)

  // Không lộ đáp án/giải thích, nút nộp chưa hoạt động, chỉ có một POST start.
  assert.doesNotMatch(page.text(), /SECRET_EXPLANATION/)
  assert.equal('disabled' in page.find('submit')[0].props, true)
  assert.equal(page.find('submit')[0].props.onClick, undefined)
  assert.deepEqual(calls.filter((c) => c.method !== 'get').map((c) => `${c.method} ${api.getUri(c)}`), [`post ${PLAYER}/quiz-attempts`])
})

test('PLAYER05: remounting the player goes back to intro and never starts on its own', async () => {
  serve({
    [`GET ${PLAYER}`]: [200, quizDetail()],
    [`GET ${PLAYER}/quiz-attempts`]: [200, quizHistory],
    [`POST ${PLAYER}/quiz-attempts`]: [201, startPayload()],
  })
  let page = await open('/student/courses/1/quizzes/7')
  await click(page.find('start')[0])
  await flush()
  assert.equal(page.find('attempt').length, 1)
  page.unmount()

  page = await open('/student/courses/1/quizzes/7')
  assert.equal(page.find('quiz-info').length, 1)
  assert.equal(page.find('attempt').length, 0)
  await flush()
  assert.equal(sentRequests().filter((r) => r.startsWith('POST')).length, 1)
})

test('PLAYER06: a failed start is not retried automatically and warns before a manual retry', async () => {
  serve({
    [`GET ${PLAYER}`]: [200, quizDetail()],
    [`GET ${PLAYER}/quiz-attempts`]: [200, quizHistory],
    [`POST ${PLAYER}/quiz-attempts`]: [503, { message: 'Gemini quota exceeded at /var/www/app.php' }],
  })
  const page = await open('/student/courses/1/quizzes/7')
  await click(page.find('start')[0])
  await flush()
  assert.match(textOf(page.find('error')[0]), /Máy chủ đang gặp sự cố/)
  assert.match(textOf(page.find('start-uncertain')[0]), /hệ thống sẽ tiếp tục đúng bài làm đó/)
  assert.doesNotMatch(page.text(), /Gemini|\/var\/www/)
  await flush()
  assert.equal(sentRequests().filter((r) => r.startsWith('POST')).length, 1)

  serve({ ...routes, [`POST ${PLAYER}/quiz-attempts`]: [201, startPayload()] })
  await click(page.find('retry')[0])
  await flush()
  assert.equal(sentRequests().filter((r) => r.startsWith('POST')).length, 2)
  assert.equal(page.find('attempt').length, 1)
})

test('FLOW01: sidebar → courses → quiz list → quiz intro uses GET requests only', async () => {
  serve({
    'GET /api/courses': [200, courseList],
    'GET /api/courses/1': [200, { course: courseList.courses[0] }],
    'GET /api/courses/1/learning-objects': [200, learningObjectList],
    'GET /api/courses/1/learning-objects/7': [200, quizDetail()],
    'GET /api/courses/1/learning-objects/7/quiz-attempts': [200, quizHistory],
  })
  const page = await open('/dashboard/student')
  const sidebarLink = findLink(page.root, '/student/courses')

  await click(sidebarLink)
  await flush()
  assert.equal(router.currentRoute.value.name, 'student-courses')

  await click(page.find('course-link')[0])
  await flush()
  assert.equal(router.currentRoute.value.name, 'student-course')

  await click(page.find('quiz-link')[0])
  await flush()
  assert.equal(router.currentRoute.value.name, 'student-quiz')
  assert.equal(page.find('quiz-info').length, 1)

  assert.equal(calls.every((c) => c.method === 'get'), true)
  assert.equal(sentRequests().some((r) => r.startsWith('POST')), false)
})

test('PLAYER07: query or hash changes keep the in-progress session, answers and send no extra GET', async () => {
  serve({
    [`GET ${PLAYER}`]: [200, quizDetail()],
    [`GET ${PLAYER}/quiz-attempts`]: [200, quizHistory],
    [`POST ${PLAYER}/quiz-attempts`]: [201, startPayload()],
  })
  const page = await open('/student/courses/1/quizzes/7')
  await click(page.find('start')[0])
  await flush()
  change(page.find('option-42')[0])
  await flush()
  const requestsBefore = sentRequests()

  for (const path of ['/student/courses/1/quizzes/7?ref=email', '/student/courses/1/quizzes/7?ref=email#top']) {
    await router.push(path)
    await flush()
    assert.equal(page.find('attempt').length, 1, path)
    assert.equal(page.find('quiz-info').length, 0, path)
    assert.equal(page.find('option-42')[0].props.checked, true, path)
    assert.match(textOf(page.find('progress')[0]), /Đã trả lời 1\/2 câu/)
  }
  assert.deepEqual(sentRequests(), requestsBefore)
})

test('PLAYER08: a real course or quiz change replaces the session and ignores the old late response', async () => {
  let releaseOld
  const otherQuiz = '/api/courses/1/learning-objects/9'
  serve({
    [`GET ${PLAYER}`]: () => new Promise((resolve) => { releaseOld = () => resolve([200, quizDetail()]) }),
    [`GET ${PLAYER}/quiz-attempts`]: [200, quizHistory],
    [`GET ${otherQuiz}`]: [200, { learning_object: { ...quizDetail().learning_object, id: 9, title: 'Quiz chương 2' } }],
    [`GET ${otherQuiz}/quiz-attempts`]: [200, { attempts: [], latest_score: null, best_score: null }],
    'GET /api/courses/2/learning-objects/9': [200, { learning_object: { ...quizDetail().learning_object, id: 9, title: 'Quiz khóa 2' } }],
    'GET /api/courses/2/learning-objects/9/quiz-attempts': [200, { attempts: [] }],
  })
  const page = await open('/student/courses/1/quizzes/7')
  await router.push('/student/courses/1/quizzes/9')
  await flush()
  assert.match(page.text(), /Quiz chương 2/)

  releaseOld() // response của quiz 7 về muộn sau khi đã đổi sang quiz 9
  await flush()
  assert.match(page.text(), /Quiz chương 2/)
  assert.doesNotMatch(page.text(), /Kiểm tra 15 phút/)

  await router.push('/student/courses/2/quizzes/9')
  await flush()
  assert.match(page.text(), /Quiz khóa 2/)
  assert.deepEqual(sentRequests(), [
    `GET ${PLAYER}`,
    `GET ${PLAYER}/quiz-attempts`,
    `GET ${otherQuiz}`,
    `GET ${otherQuiz}/quiz-attempts`,
    'GET /api/courses/2/learning-objects/9',
    'GET /api/courses/2/learning-objects/9/quiz-attempts',
  ])
  assert.equal(calls.some((c) => c.method !== 'get'), false)
})

test('PLAYER09: beforeunload warns only while there are unsaved answer changes', async () => {
  const listeners = new Map()
  const { addEventListener, removeEventListener } = globalThis.window
  globalThis.window.addEventListener = (type, handler) => listeners.set(type, handler)
  globalThis.window.removeEventListener = (type, handler) => { if (listeners.get(type) === handler) listeners.delete(type) }
  const fire = () => {
    const event = { prevented: false, returnValue: undefined, preventDefault() { this.prevented = true } }
    listeners.get('beforeunload')(event)
    return event.prevented
  }
  try {
    serve({
      [`GET ${PLAYER}`]: [200, quizDetail()],
      [`GET ${PLAYER}/quiz-attempts`]: [200, quizHistory],
      [`POST ${PLAYER}/quiz-attempts`]: [201, startPayload([{ question_id: 21, selected_option_id: 41 }])],
    })
    const page = await open('/student/courses/1/quizzes/7')
    assert.equal(fire(), false) // intro
    await click(page.find('start')[0])
    await flush()
    assert.equal(fire(), false) // draft từ server chưa bị đổi
    change(page.find('option-42')[0])
    await flush()
    assert.equal(fire(), true)
    page.unmount()
    mounted = null
    assert.equal(listeners.has('beforeunload'), false)
  } finally {
    globalThis.window.addEventListener = addEventListener
    globalThis.window.removeEventListener = removeEventListener
  }
})

// ---------- Autosave UI (B3) ----------
// View tạo session với scheduler mặc định (globalThis.setInterval), nên dùng mock.timers để điều khiển nhịp 15 giây.

const saveResponse = (serverTime = '2026-10-30T07:00:15.000000Z') => ({
  attempt: { id: 11, status: 'in_progress', draft_answers: [] },
  server_time: serverTime,
})
const chip = (page) => page.find('save-chip')[0]
const patches = () => calls.filter((c) => c.method === 'patch')

async function openAttempt(extraRoutes) {
  serve({
    [`GET ${PLAYER}`]: [200, quizDetail()],
    [`GET ${PLAYER}/quiz-attempts`]: [200, quizHistory],
    [`POST ${PLAYER}/quiz-attempts`]: [201, startPayload()],
    ...extraRoutes,
  })
  const page = await open('/student/courses/1/quizzes/7')
  await click(page.find('start')[0])
  await flush()
  return page
}

async function withFakeTimers(run) {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  try {
    await run()
  } finally {
    mounted?.unmount()
    mounted = null
    mock.timers.reset()
  }
}

test('PLAYER10: choosing an answer shows "Chưa lưu", autosave runs after 15s and shows "Đã lưu"', async () => {
  await withFakeTimers(async () => {
    const page = await openAttempt({ [`PATCH ${PLAYER}/quiz-attempts/11`]: [200, saveResponse()] })
    assert.equal(chip(page).props['data-save'], 'clean')
    assert.match(textOf(chip(page)), /Chưa có thay đổi/)

    change(page.find('option-42')[0])
    await flush()
    assert.equal(chip(page).props['data-save'], 'dirty')
    assert.match(textOf(chip(page)), /Chưa lưu/)

    mock.timers.tick(14999)
    await flush()
    assert.equal(patches().length, 0)
    mock.timers.tick(1)
    await flush()
    assert.equal(patches().length, 1)
    assert.equal(patches()[0].timeout, 20000)
    assert.deepEqual(JSON.parse(patches()[0].data), {
      answers: [
        { question_id: 21, selected_option_id: 42 },
        { question_id: 22, selected_option_id: null },
      ],
    })
    assert.equal(chip(page).props['data-save'], 'saved')
    assert.match(textOf(chip(page)), /Đã lưu/)
    assert.match(textOf(page.find('last-saved')[0]), /Lần lưu gần nhất:/)
    assert.equal(page.find('save-now').length, 0)

    mock.timers.tick(15000) // không còn thay đổi: không PATCH thêm
    await flush()
    assert.equal(patches().length, 1)
    assert.equal(calls.filter((c) => c.method === 'post').length, 1) // chỉ có POST start ban đầu
  })
})

test('PLAYER11: a failed autosave shows a safe warning and "Lưu ngay" retries once', async () => {
  await withFakeTimers(async () => {
    const page = await openAttempt({ [`PATCH ${PLAYER}/quiz-attempts/11`]: [500, { message: 'SQLSTATE[HY000] at /var/www/app.php', trace: ['x'] }] })
    change(page.find('option-41')[0])
    await flush()
    mock.timers.tick(15000)
    await flush()
    assert.equal(chip(page).props['data-save'], 'retrying')
    assert.match(textOf(chip(page)), /Lưu thất bại, sẽ thử lại/)
    assert.match(textOf(page.find('save-retrying')[0]), /Chưa lưu được câu trả lời lên máy chủ/)
    assert.doesNotMatch(page.text(), /SQLSTATE|\/var\/www|trace/)
    assert.equal(page.find('save-now').length, 1)

    serve({ ...routes, [`PATCH ${PLAYER}/quiz-attempts/11`]: [200, saveResponse()] })
    click(page.find('save-now')[0])
    click(page.find('save-now')[0])
    await flush()
    assert.equal(patches().length, 2)
    assert.equal(chip(page).props['data-save'], 'saved')
    assert.equal(page.find('save-now').length, 0)
    assert.equal(page.find('save-retrying').length, 0)
  })
})

test('PLAYER12: beforeunload warns while dirty or saving, and stops warning once the server confirmed', async () => {
  const listeners = new Map()
  const { addEventListener, removeEventListener } = globalThis.window
  globalThis.window.addEventListener = (type, handler) => listeners.set(type, handler)
  globalThis.window.removeEventListener = (type, handler) => { if (listeners.get(type) === handler) listeners.delete(type) }
  const warns = () => {
    const event = { prevented: false, preventDefault() { this.prevented = true } }
    listeners.get('beforeunload')(event)
    return event.prevented
  }
  try {
    await withFakeTimers(async () => {
      let release
      const page = await openAttempt({
        [`PATCH ${PLAYER}/quiz-attempts/11`]: () => new Promise((resolve) => { release = () => resolve([200, saveResponse()]) }),
      })
      assert.equal(warns(), false)
      change(page.find('option-42')[0])
      await flush()
      assert.equal(warns(), true) // dirty
      mock.timers.tick(15000)
      await flush()
      assert.equal(chip(page).props['data-save'], 'saving')
      assert.match(textOf(chip(page)), /Đang lưu\.\.\./)
      assert.equal(warns(), true) // PATCH đang chạy
      release()
      await flush()
      assert.equal(chip(page).props['data-save'], 'saved')
      assert.equal(warns(), false)
    })
  } finally {
    globalThis.window.addEventListener = addEventListener
    globalThis.window.removeEventListener = removeEventListener
  }
})

test('PLAYER13: a 422 without validation errors locks the inputs with a safe message and no retry button', async () => {
  await withFakeTimers(async () => {
    const page = await openAttempt({
      [`PATCH ${PLAYER}/quiz-attempts/11`]: [422, { message: 'This attempt has already been submitted.', exception: 'HttpException', file: '/var/www/x.php' }],
    })
    change(page.find('option-42')[0])
    await flush()
    mock.timers.tick(15000)
    await flush()
    assert.equal(chip(page).props['data-save'], 'stopped')
    assert.match(textOf(chip(page)), /Tự động lưu đã dừng/)
    assert.match(textOf(page.find('save-stopped')[0]), /cần kiểm tra lại trạng thái bài/)
    assert.match(textOf(page.find('save-stopped')[0]), /chưa được lưu lên máy chủ/)
    assert.doesNotMatch(page.text(), /already been submitted|HttpException|\/var\/www/)
    assert.equal(page.find('save-now').length, 0)
    assert.equal('disabled' in page.find('option-41')[0].props, true)
    assert.equal('disabled' in page.find('clear')[0].props, true)
    assert.equal(page.find('option-42')[0].props.checked, true) // đáp án vẫn giữ trên màn hình
    mock.timers.tick(45000)
    await flush()
    assert.equal(patches().length, 1)
  })
})

test('PLAYER14: a timed_out autosave response ends the attempt without editable inputs or answers shown', async () => {
  await withFakeTimers(async () => {
    const page = await openAttempt({
      [`PATCH ${PLAYER}/quiz-attempts/11`]: [200, {
        attempt: { id: 11, status: 'completed', score: 0, total_correct: 0, auto_submitted: true },
        latest_score: 0,
        best_score: 50,
        results: [{ question_id: 21, selected_option_id: null, correct_option_id: 42, is_correct: false, explanation: 'SECRET_EXPLANATION', citations: [] }],
        timed_out: true,
      }],
    })
    change(page.find('option-41')[0])
    await flush()
    mock.timers.tick(15000)
    await flush()
    assert.equal(page.find('completed').length, 1)
    assert.match(textOf(page.find('timed-out')[0]), /tự động nộp bài do hết thời gian/)
    assert.equal(page.find('attempt').length, 0)
    assert.equal(page.find('option-41').length, 0)
    assert.doesNotMatch(page.text(), /SECRET_EXPLANATION/)
    mock.timers.tick(30000)
    await flush()
    assert.equal(patches().length, 1)
  })
})
