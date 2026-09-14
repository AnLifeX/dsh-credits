/**
 * 累计消耗折叠与时间窗口测试。
 * 运行: node test/smoke-spend.mjs
 */
import assert from 'node:assert/strict'
import { applySpendEvent, aggregateSpend, foldSpendEvents, initSpendFold, resolveSpendRange } from '../src/spend.js'

let nextSeq = 1
const settlement = ({ type = 'assistant/message', time, turn = 0, step = 0, usage }) => ({
  type,
  seq: nextSeq++,
  time,
  data: {
    turn,
    step,
    stream: [{ type: 'chunk', time, chunk: { type: 'usage', usage } }],
    ...(type === 'assistant/message' ? { message: {}, usage } : {}),
  },
})

const cfg = {
  currency: 'CNY',
  prices: { 'deepseek-chat': { cacheHit: 0.2, cacheMiss: 2, output: 8 } },
  defaultPrices: { cacheHit: 0.2, cacheMiss: 2, output: 8 },
}

const monday = new Date('2026-08-17T10:00:00').getTime() // 周一
const todayStart = (() => {
  const d = new Date(monday)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
})()

const today = resolveSpendRange('today', null, null, monday)
assert.equal(today.ok, true)
assert.equal(today.from, todayStart)
assert.equal(today.to, monday)

const yesterday = resolveSpendRange('yesterday', null, null, monday)
assert.equal(yesterday.to, todayStart - 1)
assert.equal(yesterday.from, todayStart - 86400000)

const week = resolveSpendRange('week', null, null, monday)
assert.equal(week.from, todayStart) // 周一即本周起始

const month = resolveSpendRange('month', null, null, monday)
assert.equal(new Date(month.from).getDate(), 1)

const custom = resolveSpendRange('custom', '2026-08-01', '2026-08-02', monday)
assert.equal(custom.ok, true)
assert.ok(custom.to > custom.from)

const bad = resolveSpendRange('custom', null, null, monday)
assert.equal(bad.ok, false)

let state = initSpendFold()
state = applySpendEvent(state, {
  type: 'request/header',
  time: monday,
  data: { header: { config: { model: 'deepseek-chat' } } },
})
state = applySpendEvent(state, settlement({
  type: 'assistant/attempt',
  time: monday,
  usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 },
}))
state = applySpendEvent(state, { type: 'llm/retry-started', data: { turn: 0, step: 0 } })
state = applySpendEvent(state, settlement({
  time: monday + 1000,
  usage: { inputTokens: 100, outputTokens: 60, cacheReadTokens: 0, cacheWriteTokens: 0 },
}))
const samples = Object.values(state.samples)
assert.equal(samples.length, 2, 'failed and retried settlements must both count')
assert.equal(samples.reduce((sum, sample) => sum + sample.buckets.outputTokens, 0), 110)

const tagged = foldSpendEvents([
  settlement({ time: monday, usage: { inputTokens: 1e6, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } }),
]).map((s) => ({ ...s, sessionId: 's1' }))

const agg = aggregateSpend(tagged, cfg, today.from, today.to)
assert.equal(agg.cost, 2)
assert.equal(agg.calls, 1)
assert.equal(agg.sessions, 1)
assert.equal(agg.currency, 'CNY')

const empty = aggregateSpend(tagged, cfg, yesterday.from, yesterday.to)
assert.equal(empty.cost, 0)
assert.equal(empty.calls, 0)

const usd = aggregateSpend(tagged, { ...cfg, currency: 'USD', prices: { 'unknown': { cacheHit: 0.1, cacheMiss: 0.1, output: 1 } }, defaultPrices: { cacheHit: 0.1, cacheMiss: 0.1, output: 1 } }, today.from, today.to)
assert.equal(usd.currency, 'USD')
assert.equal(usd.cost, 0.1)

const peak = Date.parse('2026-08-17T02:00:00.000Z')
const v4Samples = [{
  t: peak,
  model: 'deepseek-v4-flash',
  sessionId: 's1',
  buckets: { uncachedInputTokens: 1e6, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
}]
const v4Cny = aggregateSpend(v4Samples, { currency: 'CNY', prices: {}, defaultPrices: { cacheHit: 0, cacheMiss: 0, output: 0 } }, peak - 1000, peak + 1000)
const v4Usd = aggregateSpend(v4Samples, { currency: 'USD', prices: {}, defaultPrices: { cacheHit: 0, cacheMiss: 0, output: 0 } }, peak - 1000, peak + 1000)
assert.equal(v4Cny.cost, 3)
assert.equal(v4Usd.cost, 0.44)
console.log('SPEND TEST PASSED')
