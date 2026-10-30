import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { AxiosError } from 'axios'
import api from '../src/services/api.js'
import { learningObjects } from '../src/services/learningObjects.js'
import {
  fromApi,
  toPatchPayload,
  validate,
  cloneForm,
  isDirty,
  serverErrorsFrom,
  editorAccess,
  quizStatusBadge,
} from '../src/quiz/quizEditorModel.js'
import { splitMath, renderMathText, escapeHtml, hasMath } from '../src/quiz/mathRender.js'

// ===== Fixtures theo shape detail của Giảng viên (LearningObjectController@detail) =====
const citation = { vector_id: 'v-1', source_locator: 'Trang 3', document_id: 4, document_name: 'Unit_1.pdf' }
const question = (n, id = n) => ({
  id,
  question_index: n,
  question_text: `Câu hỏi số ${n}`,
  question_type: 'single_choice',
  explanation: `Giải thích ${n}`,
  citations: [{ ...citation, extra: 'bỏ' }],
  options: ['A', 'B', 'C', 'D'].map((text, i) => ({ id: id && id * 10 + i, option_index: i, option_text: `${text}${n}`, is_correct: i === 1 })),
})
const detail = (overrides = {}, questionIds = [1, 2, 3]) => ({
  id: 7,
  type: 'quiz',
  title: 'Quiz: Thì hiện tại',
  description: null,
  status: 'draft',
  current_version: 1,
  has_unpublished_changes: true,
  generation: { status: 'completed' },
  quiz: { id: 1, time_limit_minutes: 25, passing_score: 60, total_questions: 3, questions: questionIds.map((id, n) => question(n, id)) },
  ...overrides,
})

// ===== quizEditorModel =====
test('fromApi → toPatchPayload: đúng contract PATCH (options string[], correct_index, citations giữ nguyên)', () => {
  const form = fromApi(detail())
  assert.equal(form.unlimited_time, false)
  assert.equal(form.time_limit_minutes, '25')
  const payload = toPatchPayload(form)
  assert.deepEqual(payload, {
    title: 'Quiz: Thì hiện tại',
    description: null,
    time_limit_minutes: 25,
    passing_score: 60,
    questions: [0, 1, 2].map((n) => ({
      question_text: `Câu hỏi số ${n}`,
      explanation: `Giải thích ${n}`,
      options: [`A${n}`, `B${n}`, `C${n}`, `D${n}`],
      correct_index: 1,
      citations: [citation],
    })),
  })
  // Round-trip: dựng lại response từ payload rồi đọc lại cho cùng form.
  const echoed = detail({ quiz: { ...detail().quiz, questions: payload.questions.map((q) => ({
    id: null,
    question_text: q.question_text,
    explanation: q.explanation,
    citations: q.citations,
    options: q.options.map((text, i) => ({ id: null, option_text: text, is_correct: i === q.correct_index })),
  })) } })
  assert.deepEqual(fromApi(echoed), form)
})

test('fromApi: id null (sau PATCH) và không giới hạn thời gian vẫn ổn; thiếu quiz trả null', () => {
  const form = fromApi(detail({ quiz: { ...detail().quiz, time_limit_minutes: null } }, [null, null, null]))
  assert.equal(form.questions.length, 3)
  assert.equal(form.unlimited_time, true)
  assert.equal(toPatchPayload(form).time_limit_minutes, null)
  assert.equal(fromApi(detail({ quiz: null })), null)
})

test('validate: biên hợp lệ và lỗi theo câu/lựa chọn', () => {
  const form = fromApi(detail())
  assert.deepEqual(validate(form), {})

  const bad = cloneForm(form)
  bad.title = '   '
  bad.passing_score = '101'
  bad.time_limit_minutes = '0'
  bad.questions[0].question_text = 'ab'
  bad.questions[1].options[2] = '  '
  bad.questions[1].explanation = ''
  bad.questions[2].correct_index = -1
  bad.questions[2].citations = []
  assert.deepEqual(Object.keys(validate(bad)).sort(), [
    'passing_score',
    'questions.0.question_text',
    'questions.1.explanation',
    'questions.1.options.2',
    'questions.2.citations',
    'questions.2.correct_index',
    'time_limit_minutes',
    'title',
  ])

  const edge = cloneForm(form)
  edge.passing_score = '0'
  edge.time_limit_minutes = '480'
  edge.questions[0].question_text = 'abc'
  assert.deepEqual(validate(edge), {})
  edge.unlimited_time = true
  edge.time_limit_minutes = ''
  assert.deepEqual(validate(edge), {})

  const few = cloneForm(form)
  few.questions.pop()
  assert.ok(validate(few).questions)
  const threeOptions = cloneForm(form)
  threeOptions.questions[0].options.pop()
  assert.ok(validate(threeOptions)['questions.0.options'])
})

test('isDirty và serverErrorsFrom', () => {
  const form = fromApi(detail())
  const baseline = cloneForm(form)
  assert.equal(isDirty(form, baseline), false)
  form.questions[1].options[0] = 'Khác'
  assert.equal(isDirty(form, baseline), true)
  form.questions[1].options[0] = 'A1'
  assert.equal(isDirty(form, baseline), false)
  assert.equal(isDirty(null, baseline), false)
  assert.deepEqual(serverErrorsFrom({ 'questions.0.options.1': ['x', 'y'], title: 'z' }), { 'questions.0.options.1': 'x', title: 'z' })
})

test('editorAccess: sửa được chỉ khi nháp; published/archived/đang tạo/không có quiz thì chỉ đọc', () => {
  assert.equal(editorAccess(detail()).editable, true)
  const published = editorAccess(detail({ status: 'published', has_unpublished_changes: false }))
  assert.deepEqual([published.editable, published.canPublish, published.canArchive], [false, false, true])
  assert.match(published.reason, /đã xuất bản/)
  assert.equal(editorAccess(detail({ status: 'published', has_unpublished_changes: true })).editable, true)
  assert.equal(editorAccess(detail({ status: 'archived' })).editable, false)
  assert.equal(editorAccess(detail({ status: 'archived' })).canArchive, false)
  assert.equal(editorAccess(detail({ generation: { status: 'generating' } })).editable, false)
  const failed = editorAccess(detail({ quiz: null, generation: { status: 'failed', error_message: 'Lỗi AI' } }))
  assert.equal(failed.reason, 'Lỗi AI')
})

test('quizStatusBadge: đủ các trạng thái', () => {
  const cases = [
    [{ status: 'draft', generation: { status: 'completed' }, current_version: 1 }, 'Nháp'],
    [{ status: 'published', has_unpublished_changes: false }, 'Đã xuất bản'],
    [{ status: 'published', has_unpublished_changes: true }, 'Đã xuất bản · có bản nháp mới'],
    [{ status: 'archived' }, 'Lưu trữ'],
    [{ status: 'draft', generation: { status: 'queued' } }, 'Đang tạo'],
    [{ status: 'draft', generation: { status: 'generating' } }, 'Đang tạo'],
    [{ status: 'draft', generation: { status: 'failed' }, current_version: 0 }, 'Tạo lỗi'],
  ]
  for (const [object, label] of cases) assert.equal(quizStatusBadge(object).label, label)
})

// ===== mathRender =====
const hasExecutableMarkup = (html) =>
  /<script|<img|<iframe|<svg[^>]*onload|<[^>]+\son\w+\s*=|href\s*=\s*["']?\s*javascript:/i.test(html)

test('splitMath: inline, block, \\( \\), \\[ \\] và nhiều công thức', () => {
  const segments = splitMath('Cho $x^2$ và $$\\frac{a}{b}$$, \\(y\\) rồi \\[z\\].')
  assert.deepEqual(segments.map((s) => [s.type, s.value, s.display ?? null]), [
    ['text', 'Cho ', null],
    ['math', 'x^2', false],
    ['text', ' và ', null],
    ['math', '\\frac{a}{b}', true],
    ['text', ', ', null],
    ['math', 'y', false],
    ['text', ' rồi ', null],
    ['math', 'z', true],
    ['text', '.', null],
  ])
  const html = renderMathText('Cho $x^2$ và $$\\frac{a}{b}$$')
  assert.equal((html.match(/class="katex"/g) || []).length, 2)
  assert.match(html, /katex-display/)
})

test('splitMath: $ đơn lẻ / tiền tệ / \\$ giữ nguyên là chữ', () => {
  for (const text of ['Giá $5 và $10', 'Chỉ một $ thôi', 'Còn $ 5 $ nữa', 'Trả \\$3 cho $x']) {
    assert.equal(hasMath(text), false, text)
  }
  assert.equal(renderMathText('Giá $5 và $10'), 'Giá $5 và $10')
  assert.equal(renderMathText('Trả \\$3'), 'Trả $3')
  assert.equal(renderMathText('$$ chưa đóng'), '$$ chưa đóng')
})

test('renderMathText: công thức lỗi không ném lỗi và hiển thị nguyên văn đã escape', () => {
  const html = renderMathText('Lỗi: $\\frac{<b>$ hết')
  assert.match(html, /katex-error/)
  assert.match(html, /&lt;b&gt;/)
  assert.equal(hasExecutableMarkup(html), false)
  assert.match(html, /hết$/)
})

test('renderMathText: XSS trong chữ thường và trong công thức không tạo thẻ thực thi', () => {
  const payloads = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    'Văn bản <img src=x onerror=alert(1)> và $x$',
    '$<img src=x onerror=alert(1)>$',
    '$\\href{javascript:alert(1)}{bấm}$',
    '$\\url{javascript:alert(1)}$',
    '$$\\htmlClass{x}{y}\\includegraphics{x.png}$$',
    '\\(<script>alert(1)</script>\\)',
    '"><svg onload=alert(1)>',
  ]
  for (const payload of payloads) {
    const html = renderMathText(payload)
    assert.equal(hasExecutableMarkup(html), false, `${payload} → ${html.slice(0, 200)}`)
  }
  assert.equal(renderMathText('<b>"x" & \'y\'</b>'), '&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;')
  assert.equal(escapeHtml('<>&'), '&lt;&gt;&amp;')
})

// ===== Service: updateQuiz / publish / archive =====
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

test('updateQuiz: PATCH learning object với body nguyên vẹn, timeout 20 giây', async () => {
  respond(200, { learning_object: detail() })
  const payload = toPatchPayload(fromApi(detail()))
  await learningObjects.updateQuiz(3, 7, payload)
  assert.equal(calls[0].method, 'patch')
  assert.equal(api.getUri(calls[0]), B)
  assert.deepEqual(JSON.parse(calls[0].data), payload)
  assert.equal(calls[0].timeout, 20000)
})

test('publish / archive: POST không body, timeout 20 giây', async () => {
  respond(200, { learning_object: detail({ status: 'published' }), message: 'Quiz published.' })
  await learningObjects.publish(3, 7)
  respond(200, { learning_object: detail({ status: 'archived' }) })
  await learningObjects.archive('3', '7')
  assert.deepEqual(calls.map((c) => [c.method, api.getUri(c), c.data, c.timeout]), [
    ['post', `${B}/publish`, undefined, 20000],
    ['post', `${B}/archive`, undefined, 20000],
  ])
})

test('lỗi editor: thông báo tiếng Việt theo status và câu nghiệp vụ đã biết', async () => {
  const cases = [
    [403, {}, 'Bạn không có quyền chỉnh sửa quiz này.'],
    [404, {}, 'Không tìm thấy quiz.'],
    [409, { message: '' }, 'Quiz đang được tạo hoặc đang bị khóa, thử lại sau.'],
    [422, { message: 'Create or restore a draft version before editing.' }, 'Quiz đã xuất bản nên không sửa trực tiếp được. Cần tạo phiên bản nháp mới (chưa hỗ trợ ở bước này).'],
    [422, { message: 'This version is already published.' }, 'Phiên bản này đã được xuất bản.'],
    [422, { message: 'x', errors: { title: ['bad'] } }, 'Dữ liệu gửi lên không hợp lệ.'],
  ]
  for (const [status, body, message] of cases) {
    respond(status, body)
    const err = await rejection(learningObjects.updateQuiz(3, 7, {}))
    assert.equal(err.message, message, `status ${status}`)
  }
  api.defaults.adapter = async (config) => { throw new AxiosError('Network Error', 'ERR_NETWORK', config) }
  const err = await rejection(learningObjects.publish(3, 7))
  assert.equal(err.status, 0)
  assert.match(err.message, /Không thể kết nối/)
})
