import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, unlink } from 'node:fs/promises'
import { createPinia, setActivePinia } from 'pinia'
import { readLoginSession } from '../src/stores/authSession.js'

// Nạp store thật: thay alias '@/services/api' (chỉ Vite hiểu) bằng API giả.
// API giả đọc globalThis.__authTestApi lúc post() được gọi, không phải lúc import module.
const storeUrl = new URL('../src/stores/auth.js', import.meta.url)
const sessionUrl = new URL('../src/stores/authSession.js', import.meta.url)
const storeSource = await readFile(storeUrl, 'utf8')
const generatedUrl = new URL(`.auth-store-${process.pid}.mjs`, import.meta.url)
let useAuthStore
try {
  await writeFile(generatedUrl, storeSource
    .replace("import api from '@/services/api'", 'const api = { post: (...args) => globalThis.__authTestApi.post(...args) }')
    .replace("'./authSession.js'", `'${sessionUrl.href}'`))
  useAuthStore = (await import(generatedUrl.href)).useAuthStore
} finally {
  await unlink(generatedUrl).catch(() => {})
}

function setupStore(responseData) {
  const storage = new Map()
  globalThis.localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  }
  const calls = []
  globalThis.__authTestApi = {
    post: async (...args) => {
      calls.push(args)
      return { data: responseData }
    },
  }
  setActivePinia(createPinia())
  return { store: useAuthStore(), storage, calls }
}

const credentials = { email: 'l@test.dev', password: 'Password123!' }

const user = { id: 1, name: 'Lecturer', role: 'lecturer' }

test('TC01: valid { token, user } response is read correctly', () => {
  assert.deepEqual(readLoginSession({ token: 'abc123', user }), { token: 'abc123', user })
})

test('TC02: legacy { bearer_token, user } response is rejected', () => {
  assert.equal(readLoginSession({ bearer_token: 'abc123', user }), null)
})

test('TC03: missing, null, non-string, empty or whitespace token is rejected', () => {
  assert.equal(readLoginSession({ user }), null)
  for (const token of [undefined, null, 123, true, {}, [], '', '   ', '\t\n']) {
    assert.equal(readLoginSession({ token, user }), null, `token=${JSON.stringify(token)}`)
  }
  assert.equal(readLoginSession(undefined), null)
  assert.equal(readLoginSession(null), null)
})

test('TC04: missing, null, array or non-object user is rejected', () => {
  assert.equal(readLoginSession({ token: 'abc123' }), null)
  for (const badUser of [undefined, null, [], [user], 'lecturer', 1, true]) {
    assert.equal(readLoginSession({ token: 'abc123', user: badUser }), null, `user=${JSON.stringify(badUser)}`)
  }
})

test('TC05: invalid login response never stores the string "undefined"', async () => {
  for (const data of [{ bearer_token: 'abc123', user }, { user }, { token: '  ', user }, { token: 'abc123', user: null }, {}]) {
    const { store, storage, calls } = setupStore(data)
    const result = await store.login(credentials.email, credentials.password)
    assert.deepEqual(calls, [['/auth/login', credentials]], `data=${JSON.stringify(data)}`)
    assert.equal(result.success, false)
    assert.equal(storage.has('flts_token'), false)
    assert.equal(storage.has('flts_user'), false)
    assert.equal(store.token, null)
    assert.equal(store.isAuthenticated, false)
    assert.ok(store.error)
  }
})

test('TC06: login() stores the token from the { token, user } contract', async () => {
  assert.match(storeSource, /readLoginSession\(response\.data\)/)
  assert.doesNotMatch(storeSource, /bearer_token/)

  const { store, storage, calls } = setupStore({ token: 'abc123', user })
  const result = await store.login(credentials.email, credentials.password)
  assert.deepEqual(calls, [['/auth/login', credentials]])
  assert.deepEqual(result, { success: true, user })
  assert.equal(storage.get('flts_token'), 'abc123')
  assert.deepEqual(JSON.parse(storage.get('flts_user')), user)
  assert.equal(store.token, 'abc123')
  assert.equal(store.isAuthenticated, true)
  assert.equal(store.isLecturer, true)
})
