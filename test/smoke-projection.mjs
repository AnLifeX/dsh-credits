/**
 * 服务器端投影折叠逻辑测试: 验证 queryCreditsCost 单元的
 * Session v2 settlement、重试计费、模型归属、花费与 TPS。
 * 运行: node test/smoke-projection.mjs
 */
import { makeCostProjection, makeTpsProjection, resolveModelPrice } from '../src/index.js'
import { normalizePricingCurrency, officialV4ConfigPrices, PRICING_CURRENCIES } from '../src/pricing.js'
import assert from 'node:assert/strict'

let nextSeq = 1
const settlement = ({ type = 'assistant/message', time = Date.now(), turn = 0, step = 0, usage, stream }) => ({
  type,
  seq: nextSeq++,
  time,
  data: {
    turn,
    step,
    stream: stream ?? [{ type: 'chunk', time, chunk: { type: 'usage', usage } }],
    ...(type === 'assistant/message' ? { message: {}, usage } : {}),
  },
})

assert.deepEqual(Object.keys(officialV4ConfigPrices('CNY')), [
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  'deepseek-v4-flash-vision-exp',
], 'new installations must include the vision model in built-in prices')
assert.deepEqual(PRICING_CURRENCIES, ['CNY', 'USD'], 'pricing must only offer currencies with official price tables')
assert.equal(normalizePricingCurrency('EUR'), 'USD', 'legacy EUR reused USD numbers and must migrate to the truthful USD label')

const usdFlash = resolveModelPrice({
  currency: 'USD',
  prices: { 'deepseek-v4-flash': { cacheHit: 1, cacheMiss: 2, output: 3 } },
  defaultPrices: { cacheHit: 0, cacheMiss: 0, output: 0 },
}, 'deepseek-v4-flash', Date.parse('2026-08-17T05:30:00.000Z')) // 北京 13:30 非高峰
assert.equal(usdFlash.cacheMiss, 0.21, 'USD V4 must use official off-peak table, not config.prices or CNY numbers')

const usdChat = resolveModelPrice({
  currency: 'USD',
  prices: { 'deepseek-chat': { cacheHit: 1, cacheMiss: 2, output: 3 } },
  defaultPrices: { cacheHit: 0, cacheMiss: 0, output: 0 },
}, 'deepseek-chat')
assert.equal(usdChat.cacheMiss, 2, 'non-V4 models still use configured prices')

const config = {
  currency: 'CNY',
  prices: {
    'deepseek-chat': { cacheHit: 0.2, cacheMiss: 2, output: 8 },
    'deepseek-reasoner': { cacheHit: 0.5, cacheMiss: 4, output: 16 },
  },
  defaultPrices: { cacheHit: 0.2, cacheMiss: 2, output: 8 },
}
const def = makeCostProjection(config)
assert.ok(def.stateSchema, 'DSH Session v2 requires a persisted-state schema')
assert.ok(def.wire?.viewSchema && typeof def.wire.view === 'function', 'DSH Session v2 requires a client-visible wire view')
assert.equal(def.schema, undefined, 'removed legacy projection fields must not return')

let state = def.init()
def.stateSchema.parse(state)

// 无关事件必须返回同一引用(变更流靠 Object.is 把关)
const untouched = def.apply(state, { type: 'turn/start', data: { turn: 0 } })
assert.equal(untouched, state, 'unrelated event must keep same reference')

// 模型来自 request/header
state = def.apply(state, { type: 'request/header', data: { header: { config: { model: 'deepseek-chat' } } } })
assert.notEqual(state, untouched)

// 失败尝试来自 stream usage，retry-started 后的成功尝试必须另计。
state = def.apply(state, settlement({
  type: 'assistant/attempt',
  turn: 0,
  step: 0,
  usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 50, cacheWriteTokens: 0 },
}))
state = def.apply(state, { type: 'llm/retry-started', data: { turn: 0, step: 0 } })
state = def.apply(state, settlement({
  turn: 0,
  step: 0,
  usage: { inputTokens: 100, outputTokens: 60, cacheReadTokens: 60, cacheWriteTokens: 10 },
}))

// 模型切换: request/context 指向 reasoner, 新样本归入 reasoner
state = def.apply(state, { type: 'request/context', data: { provider: 'deepseek', model: 'deepseek-reasoner' } })
state = def.apply(state, settlement({
  turn: 0,
  step: 1,
  usage: { inputTokens: 200, outputTokens: 40, cacheReadTokens: 0, cacheWriteTokens: 0 },
}))

let view = def.wire.view(state)
def.wire.viewSchema.parse(view)
def.stateSchema.parse(state)
def.wire.viewSchema.parse(def.wire.view(state))
console.log('view:', JSON.stringify(view))

assert.deepEqual(view.tokens, { uncachedInput: 400, cacheRead: 110, cacheWrite: 10, output: 150 })
// chat: failed 610 + successful 712 (每 1M) → 0.001322
// reasoner: 200*4 + 0*0.5 + 40*16 = 800 + 640 = 1440 → 0.00144
assert.equal(view.costByModel['deepseek-chat'], 0.001322)
assert.equal(view.costByModel['deepseek/deepseek-reasoner'], 0.00144)
assert.equal(Math.round(view.cost * 1e6), 2762)
assert.deepEqual(view.models, ['deepseek-chat', 'deepseek/deepseek-reasoner'])
assert.equal(view.currency, 'CNY')
assert.deepEqual(view.tokensByModel['deepseek-chat'], { uncachedInput: 200, cacheRead: 110, cacheWrite: 10, output: 110 })
assert.deepEqual(view.tokensByModel['deepseek/deepseek-reasoner'], { uncachedInput: 200, cacheRead: 0, cacheWrite: 0, output: 40 })

// 未知名模型使用回退价(deepseek-chat 默认)
state = def.init()
state = def.apply(state, settlement({ usage: { inputTokens: 100, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } }))
view = def.wire.view(state)
def.wire.viewSchema.parse(view)
assert.equal(view.costByModel['unknown'], 0.0002)

let live = { ...config, currency: 'CNY', pricingEpoch: 0 }
const liveDef = makeCostProjection(() => live)
let liveState = liveDef.init()
liveState = liveDef.apply(liveState, settlement({ usage: { inputTokens: 1000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } }))
assert.equal(liveDef.wire.view(liveState).currency, 'CNY')
live = { ...live, currency: 'USD', pricingEpoch: 1 }
assert.equal(liveDef.wire.view(liveState).currency, 'USD', 'view must pick up currency without new session events')
assert.equal(liveDef.wire.view(liveState).pricingEpoch, 1)

const peak = Date.parse('2026-08-17T02:00:00.000Z') // 北京时间 10:00 高峰
const cnyPeak = resolveModelPrice({ currency: 'CNY' }, 'deepseek-v4-flash', peak)
const usdPeak = resolveModelPrice({ currency: 'USD' }, 'deepseek-v4-flash', peak)
assert.equal(cnyPeak.cacheMiss, 3)
assert.equal(usdPeak.cacheMiss, 0.42)
assert.equal(usdPeak.output, 1.26)

const weekend = Date.parse('2026-08-22T02:00:00.000Z') // 周六北京 10:00，仍为低谷
const weekendFlash = resolveModelPrice({ currency: 'CNY' }, 'deepseek-v4-flash', weekend)
assert.equal(weekendFlash.cacheMiss, 1.5, 'weekends must use off-peak prices all day')

const customPeak = resolveModelPrice({
  currency: 'CNY',
  prices: {
    'deepseek-v4-flash': {
      cacheHit: 0.1,
      cacheMiss: 3,
      output: 9,
      peak: { cacheHit: 1, cacheMiss: 10, output: 20 },
      offPeak: { cacheHit: 0.5, cacheMiss: 5, output: 10 },
    },
  },
}, 'deepseek-v4-flash', peak)
assert.equal(customPeak.cacheMiss, 10, 'configured peak/offPeak must override the official V4 table')

const visionOfficial = resolveModelPrice({ currency: 'CNY' }, 'deepseek-v4-flash-vision-exp', peak)
assert.equal(visionOfficial.cacheMiss, 3, 'unconfigured vision-exp still uses the official V4 table')

const visionFlat = resolveModelPrice({
  currency: 'CNY',
  prices: {
    'deepseek-v4-flash-vision-exp': { cacheHit: 0.2, cacheMiss: 4, output: 8 },
  },
}, 'deepseek-v4-flash-vision-exp', peak)
assert.equal(visionFlat.cacheMiss, 3, 'built-in vision-exp must stay on the official V4 table when only legacy flat fields are present')

const customFlat = resolveModelPrice({
  currency: 'CNY',
  prices: {
    'deepseek-v4-community': { cacheHit: 0.2, cacheMiss: 4, output: 8 },
  },
}, 'deepseek-v4-community', peak)
assert.equal(customFlat.cacheMiss, 4, 'custom model names with only three fields remain flat-rate prices')

const pinnedListed = resolveModelPrice({
  currency: 'CNY',
  prices: {
    'deepseek-v4-flash': { cacheHit: 0.02, cacheMiss: 1, output: 2 },
  },
}, 'deepseek-v4-flash', peak)
assert.equal(pinnedListed.cacheMiss, 3, 'pinned V4 with listed-only config still uses the official peak table')

let v4 = { currency: 'CNY', prices: {}, defaultPrices: { cacheHit: 0, cacheMiss: 0, output: 0 }, pricingEpoch: 0 }
const v4Def = makeCostProjection(() => v4)
let v4State = v4Def.init()
v4State = v4Def.apply(v4State, { type: 'request/header', data: { header: { config: { model: 'deepseek-v4-flash' } } } })
v4State = v4Def.apply(v4State, settlement({
  time: peak,
  turn: 0,
  step: 0,
  usage: { inputTokens: 1e6, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
}))
assert.equal(v4Def.wire.view(v4State).cost, 3, 'peak sample must stay at peak price even if viewed later')
const offPeak = Date.parse('2026-08-17T05:30:00.000Z') // 北京 13:30
v4State = v4Def.apply(v4State, settlement({
  time: offPeak,
  turn: 0,
  step: 1,
  usage: { inputTokens: 1e6, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
}))
assert.equal(v4Def.wire.view(v4State).cost, 4.5, 'session cost must sum peak 3 + off-peak 1.5, not reprice everything at now')
v4 = { ...v4, currency: 'USD', pricingEpoch: 1 }
assert.equal(v4Def.wire.view(v4State).cost, 0.63)
console.log('PROJECTION TEST PASSED')

// TPS 投影：从 Session v2 settlement 的压缩流与精确 usage 计算。
const tpsDef = makeTpsProjection()
assert.ok(tpsDef.stateSchema, 'TPS projection must expose its persisted-state schema')
assert.ok(tpsDef.wire?.viewSchema && typeof tpsDef.wire.view === 'function', 'TPS projection must be wired to the DSH client')
assert.equal(tpsDef.schema, undefined, 'removed legacy projection fields must not return')
let tpsState = tpsDef.init()
tpsDef.stateSchema.parse(tpsState)
tpsState = tpsDef.apply(tpsState, settlement({
  time: 3000,
  usage: { inputTokens: 100, outputTokens: 24, cacheReadTokens: 0, cacheWriteTokens: 0 },
  stream: [
    { type: 'text-chunks', time0: 1000, index: 0, dt: [1000], texts: ['a', 'b'] },
    { type: 'chunk', time: 3000, chunk: { type: 'usage', usage: { inputTokens: 100, outputTokens: 24, cacheReadTokens: 0, cacheWriteTokens: 0 } } },
  ],
}))
tpsDef.wire.viewSchema.parse(tpsDef.wire.view(tpsState))
tpsDef.stateSchema.parse(tpsState)
tpsDef.wire.viewSchema.parse(tpsDef.wire.view(tpsState))
assert.equal(tpsDef.wire.view(tpsState).tokensPerSecond, 12, 'settled compressed stream must expose exact TPS')

tpsState = tpsDef.apply(tpsState, settlement({
  type: 'assistant/attempt',
  time: 7000,
  step: 1,
  usage: { inputTokens: 100, outputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 0 },
  stream: [
    { type: 'reasoning-chunks', time0: 5000, index: 0, dt: [], texts: ['c'] },
    { type: 'chunk', time: 7000, chunk: { type: 'usage', usage: { inputTokens: 100, outputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 0 } } },
  ],
}))
assert.equal(tpsDef.wire.view(tpsState).tokensPerSecond, 15, 'failed attempts must also produce TPS')

tpsState = tpsDef.apply(tpsState, settlement({
  time: 9000,
  step: 2,
  usage: { inputTokens: 100, outputTokens: 15, cacheReadTokens: 0, cacheWriteTokens: 0 },
  stream: [
    { type: 'text-chunks', time0: 7000, index: 0, dt: [1000], texts: ['', 'first token'] },
    { type: 'chunk', time: 9000, chunk: { type: 'usage', usage: { inputTokens: 100, outputTokens: 15, cacheReadTokens: 0, cacheWriteTokens: 0 } } },
  ],
}))
assert.equal(tpsDef.wire.view(tpsState).tokensPerSecond, 15, 'empty deltas must not start the decode clock')
console.log('TPS PROJECTION TEST PASSED')
