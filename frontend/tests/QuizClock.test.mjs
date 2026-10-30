import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServerClock, formatRemaining, parseServerTime } from '../src/quiz/quizClock.js'

test('CLK01: the offset uses the midpoint of the request round-trip', () => {
  let client = 1000
  const clock = createServerClock(() => client)
  // Request gửi lúc 1000, response về lúc 1400 (client); server_time ứng với điểm giữa 1200.
  assert.equal(clock.sync(new Date(61200).toISOString(), 1000, 1400), true)
  assert.equal(clock.offset, 60000)
  assert.equal(clock.synced, true)
  client = 2000
  assert.equal(clock.now(), 62000)
  assert.equal(clock.remainingMs(new Date(72000).toISOString()), 10000)
})

test('CLK02: invalid server times or timestamps do not change the offset', () => {
  const clock = createServerClock(() => 0)
  clock.sync('1970-01-01T00:00:05.000Z', 0, 0)
  for (const [serverTime, start, end] of [[null, 0, 0], ['not-a-date', 0, 0], [12345, 0, 0], ['1970-01-01T00:00:09Z', NaN, 0], ['1970-01-01T00:00:09Z', 0, undefined]]) {
    assert.equal(clock.sync(serverTime, start, end), false)
  }
  assert.equal(clock.offset, 5000)
})

test('CLK03: remainingMs is null without a deadline and accepts Laravel microsecond timestamps', () => {
  const clock = createServerClock(() => Date.parse('2026-10-30T06:53:46.370Z'))
  assert.equal(clock.remainingMs(null), null)
  assert.equal(clock.remainingMs(undefined), null)
  assert.equal(clock.remainingMs('garbage'), null)
  assert.equal(clock.remainingMs('2026-10-30T07:18:46.000000Z'), 1499630)
  assert.equal(parseServerTime('2026-10-30T06:53:46.370035Z'), Date.parse('2026-10-30T06:53:46.370Z'))
})

test('CLK04: formatRemaining shows mm:ss (h:mm:ss over an hour), rounds up and never goes negative', () => {
  assert.equal(formatRemaining(0), '00:00')
  assert.equal(formatRemaining(-5000), '00:00')
  assert.equal(formatRemaining(1), '00:01')
  assert.equal(formatRemaining(59100), '01:00')
  assert.equal(formatRemaining(61000), '01:01')
  assert.equal(formatRemaining(25 * 60 * 1000), '25:00')
  assert.equal(formatRemaining(3661000), '1:01:01')
  assert.equal(formatRemaining(NaN), '')
  assert.equal(formatRemaining(null), '')
})
