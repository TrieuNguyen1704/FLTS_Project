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

test('PLAYER01: quiz skeleton shows quiz info, a disabled start button and never starts an attempt', async () => {
  serve({ 'GET /api/courses/1/learning-objects/7': [200, quizDetail()] })
  const page = await open('/student/courses/1/quizzes/7')
  assert.deepEqual(sentRequests(), ['GET /api/courses/1/learning-objects/7'])
  assert.match(page.text(), /Kiểm tra 15 phút/)
  assert.equal(textOf(page.find('total-questions')[0]).trim(), '8')
  assert.match(page.text(), /25 phút/)
  assert.match(page.text(), /60%/)
  const start = page.find('start')[0]
  assert.equal('disabled' in start.props, true)
  assert.equal(start.props.onClick, undefined)
  click(start)
  await flush()
  assert.equal(calls.every((c) => c.method === 'get'), true)
  assert.equal(calls.some((c) => api.getUri(c).includes('quiz-attempts')), false)
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
  page.unmount()

  serve({ 'GET /api/courses/1/learning-objects/8': [200, { learning_object: { id: 8, type: 'flashcard', title: 'Bộ thẻ', quiz: null } }] })
  page = await open('/student/courses/1/quizzes/8')
  assert.match(page.text(), /Không tìm thấy bài kiểm tra hoặc bài làm/)
  page.unmount()

  serve({ 'GET /api/courses/1/learning-objects/7': [404, { message: 'No query results for model [App\\Models\\LearningObject] 7' }] })
  page = await open('/student/courses/1/quizzes/7')
  assert.equal(page.find('error').length, 1)
  assert.match(page.text(), /Không tìm thấy bài kiểm tra hoặc bài làm/)
  assert.doesNotMatch(page.text(), /App\\Models/)
  assert.equal(page.find('retry').length, 1)
})

test('FLOW01: sidebar → courses → quiz list → quiz skeleton uses GET requests only', async () => {
  serve({
    'GET /api/courses': [200, courseList],
    'GET /api/courses/1': [200, { course: courseList.courses[0] }],
    'GET /api/courses/1/learning-objects': [200, learningObjectList],
    'GET /api/courses/1/learning-objects/7': [200, quizDetail()],
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
  assert.equal(sentRequests().some((r) => r.includes('quiz-attempts')), false)
})
