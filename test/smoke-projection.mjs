/**
 * 服务器端投影折叠逻辑测试: 验证 queryCreditsCost 单元的
 * 同步骤替换语义、模型归属、花费计算与 schema 校验。
 * 运行: node test/smoke-projection.mjs
 */
import { makeCostProjection, makeTpsProjection, resolveModelPrice } from '../src/index.js'
import assert from 'node:assert/strict'

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

let state = def.init()

// 无关事件必须返回同一引用(变更流靠 Object.is 把关)
const untouched = def.apply(state, { type: 'turn/start', data: { turn: 0 } })
assert.equal(untouched, state, 'unrelated event must keep same reference')

// 模型来自 request/header
state = def.apply(state, { type: 'request/header', data: { header: { config: { model: 'deepseek-chat' } } } })
assert.notEqual(state, untouched)

// usage chunk(早期样本)
state = def.apply(state, {
  type: 'assistant/chunk',
  data: { turn: 0, step: 0, chunk: { type: 'usage', usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 50, cacheWriteTokens: 0 } } },
})
// 同 (turn,step) 的 assistant/message 替换样本, 不得重复计数
state = def.apply(state, {
  type: 'assistant/message',
  data: { turn: 0, step: 0, message: {}, usage: { inputTokens: 100, outputTokens: 60, cacheReadTokens: 60, cacheWriteTokens: 10 } },
})

// 模型切换: request/context 指向 reasoner, 新样本归入 reasoner
state = def.apply(state, { type: 'request/context', data: { provider: 'deepseek', model: 'deepseek-reasoner' } })
state = def.apply(state, {
  type: 'assistant/message',
  data: { turn: 0, step: 1, message: {}, usage: { inputTokens: 200, outputTokens: 40, cacheReadTokens: 0, cacheWriteTokens: 0 } },
})

let view = def.view(state)
def.schema.parse(view) // schema 校验
console.log('view:', JSON.stringify(view))

assert.deepEqual(view.tokens, { uncachedInput: 300, cacheRead: 60, cacheWrite: 10, output: 100 })
// chat: (100+10)*2 + 60*0.2 + 60*8 = 220 + 12 + 480 = 712 (每 1M) → 0.000712
// reasoner: 200*4 + 0*0.5 + 40*16 = 800 + 640 = 1440 → 0.00144
assert.equal(view.costByModel['deepseek-chat'], 0.000712)
assert.equal(view.costByModel['deepseek-reasoner'], 0.00144)
assert.equal(Math.round(view.cost * 1e6), 2152)
assert.deepEqual(view.models, ['deepseek-chat', 'deepseek-reasoner'])
assert.equal(view.currency, 'CNY')
assert.deepEqual(view.tokensByModel['deepseek-chat'], { uncachedInput: 100, cacheRead: 60, cacheWrite: 10, output: 60 })
assert.deepEqual(view.tokensByModel['deepseek-reasoner'], { uncachedInput: 200, cacheRead: 0, cacheWrite: 0, output: 40 })

// 未知名模型使用回退价(deepseek-chat 默认)
state = def.init()
state = def.apply(state, { type: 'assistant/message', data: { turn: 0, step: 0, message: {}, usage: { inputTokens: 100, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } } })
view = def.view(state)
def.schema.parse(view)
assert.equal(view.costByModel['unknown'], 0.0002)

let live = { ...config, currency: 'CNY', pricingEpoch: 0 }
const liveDef = makeCostProjection(() => live)
let liveState = liveDef.init()
liveState = liveDef.apply(liveState, {
  type: 'assistant/message',
  data: { turn: 0, step: 0, message: {}, usage: { inputTokens: 1000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } },
})
assert.equal(liveDef.view(liveState).currency, 'CNY')
live = { ...live, currency: 'USD', pricingEpoch: 1 }
assert.equal(liveDef.view(liveState).currency, 'USD', 'view must pick up currency without new session events')
assert.equal(liveDef.view(liveState).pricingEpoch, 1)

const peak = Date.parse('2026-08-17T02:00:00.000Z') // 北京时间 10:00 高峰
const cnyPeak = resolveModelPrice({ currency: 'CNY' }, 'deepseek-v4-flash', peak)
const usdPeak = resolveModelPrice({ currency: 'USD' }, 'deepseek-v4-flash', peak)
assert.equal(cnyPeak.cacheMiss, 3)
assert.equal(usdPeak.cacheMiss, 0.42)
assert.equal(usdPeak.output, 1.26)

let v4 = { currency: 'CNY', prices: {}, defaultPrices: { cacheHit: 0, cacheMiss: 0, output: 0 }, pricingEpoch: 0 }
const v4Def = makeCostProjection(() => v4)
let v4State = v4Def.init()
v4State = v4Def.apply(v4State, { type: 'request/header', data: { header: { config: { model: 'deepseek-v4-flash' } } } })
v4State = v4Def.apply(v4State, {
  type: 'assistant/message',
  time: peak,
  data: { turn: 0, step: 0, usage: { inputTokens: 1e6, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } },
})
assert.equal(v4Def.view(v4State).cost, 3, 'peak sample must stay at peak price even if viewed later')
const offPeak = Date.parse('2026-08-17T05:30:00.000Z') // 北京 13:30
v4State = v4Def.apply(v4State, {
  type: 'assistant/message',
  time: offPeak,
  data: { turn: 0, step: 1, usage: { inputTokens: 1e6, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } },
})
assert.equal(v4Def.view(v4State).cost, 4.5, 'session cost must sum peak 3 + off-peak 1.5, not reprice everything at now')
v4 = { ...v4, currency: 'USD', pricingEpoch: 1 }
assert.equal(v4Def.view(v4State).cost, 0.63)
console.log('PROJECTION TEST PASSED')

// 实时 TPS 投影：流式输出按字符估算，step/end 后保留最近一次速率。
const tpsDef = makeTpsProjection()
let tpsState = tpsDef.init()
tpsState = tpsDef.apply(tpsState, {
  type: 'step/start',
  time: 1000,
  data: { turn: 0, step: 0 },
})
tpsState = tpsDef.apply(tpsState, {
  type: 'assistant/chunk',
  time: 1000,
  data: { turn: 0, step: 0, chunk: { type: 'text-delta', index: 0, text: 'a'.repeat(40) } },
})
tpsState = tpsDef.apply(tpsState, {
  type: 'assistant/chunk',
  time: 3000,
  data: { turn: 0, step: 0, chunk: { type: 'text-delta', index: 0, text: 'b'.repeat(40) } },
})
assert.equal(tpsDef.view(tpsState).tokensPerSecond, 12, 'streaming output should expose estimated TPS')
tpsState = tpsDef.apply(tpsState, {
  type: 'step/end',
  time: 3000,
  data: { turn: 0, step: 0 },
})
tpsDef.schema.parse(tpsDef.view(tpsState))
assert.equal(tpsDef.view(tpsState).tokensPerSecond, 12, 'last TPS should remain visible after step end')

// provider 精确 usage 替换流式估算，但保留首个输出时间用于速率计算。
tpsState = tpsDef.apply(tpsState, {
  type: 'step/start',
  time: 5000,
  data: { turn: 0, step: 1 },
})
tpsState = tpsDef.apply(tpsState, {
  type: 'assistant/chunk',
  time: 5000,
  data: { turn: 0, step: 1, chunk: { type: 'text-delta', index: 0, text: 'c'.repeat(20) } },
})
tpsState = tpsDef.apply(tpsState, {
  type: 'assistant/chunk',
  time: 7000,
  data: { turn: 0, step: 1, chunk: { type: 'usage', usage: { inputTokens: 100, outputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 0 } } },
})
assert.equal(tpsDef.view(tpsState).tokensPerSecond, 15, 'exact usage should replace estimated output for TPS')
console.log('TPS PROJECTION TEST PASSED')
