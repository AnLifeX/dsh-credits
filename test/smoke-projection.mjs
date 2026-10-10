/**
 * 服务器端投影折叠逻辑测试: 验证 queryCreditsCost 单元的
 * Session v2 settlement、重试计费、模型归属、花费与 TPS。
 * 运行: node test/smoke-projection.mjs
 */
import { makeCostProjection, makeTpsProjection, resolveModelPrice, resolveModelPriceInfo, familyModelFor } from '../src/index.js'
import { normalizePricingCurrency, officialV4ConfigPrices, PRICING_CURRENCIES, V41_FLASH_CUTOFF_MS, isPeakBeijing, HOLIDAY_CALENDAR } from '../src/pricing.js'
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
  'deepseek-flash',
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  'deepseek-v4-flash-vision-exp',
], 'new installations must include V4.1 Flash and its aliases in built-in prices')
assert.deepEqual(PRICING_CURRENCIES, ['CNY', 'USD'], 'pricing must only offer currencies with official price tables')

const scheduledPrice = { cacheHit: 0, cacheMiss: 2, output: 0, schedules: [
  { from: '2026-08-01T00:00:00Z', to: '2026-09-01T00:00:00Z', cacheHit: 0, cacheMiss: 0.5, output: 0 },
] }
const channelConfig = { currency: 'CNY', prices: { 'deepseek-v4-pro': scheduledPrice }, providerPrices: {
  work: { 'deepseek-v4-pro': { ...scheduledPrice, cacheMiss: 0.2, schedules: [] } },
} }
const scheduleStart = Date.parse(scheduledPrice.schedules[0].from)
const scheduleEnd = Date.parse(scheduledPrice.schedules[0].to)
assert.equal(resolveModelPrice(channelConfig, 'deepseek-v4-pro', scheduleStart, 'work').cacheMiss, 0.2, 'explicit channel prices override official and shared prices')
assert.equal(resolveModelPrice(channelConfig, 'deepseek-v4-pro', scheduleStart, 'personal').cacheMiss, 0.5, 'schedule start is inclusive')
assert.notEqual(resolveModelPrice(channelConfig, 'deepseek-v4-pro', scheduleEnd, 'personal').cacheMiss, 0.5, 'schedule end is exclusive')
assert.equal(resolveModelPrice({ ...channelConfig, providerPrices: {} }, 'deepseek-v4-pro', scheduleStart).cacheMiss, 0.5, 'explicit schedules override pinned official pricing')
const tinyProjection = makeCostProjection({ currency: 'CNY', providerPrices: { work: { custom: { cacheHit: 0, cacheMiss: 0.2, output: 0 } } } })
const tinyState = tinyProjection.init()
for (let i = 0; i < 100; i++) tinyState.samples[i] = { t: scheduleStart, model: 'custom', provider: 'work', buckets: { uncachedInputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 } }
assert.equal(tinyProjection.wire.view(tinyState).costByModel['work/custom'], 0.00002)
assert.equal(normalizePricingCurrency('EUR'), 'USD', 'legacy EUR reused USD numbers and must migrate to the truthful USD label')

// V4.1 Flash 时间表：9/10 12:00 前走旧 V4 Flash，之后走新表。
// V4 Pro 不做路由——官方撤销了下线计划，继续按自己的 V4 价目计费。
const flashCutoff = V41_FLASH_CUTOFF_MS
const flashBeforePeak = Date.parse('2026-09-10T02:00:00.000Z') // 北京 10:00 高峰，早于 12:00 切换
const flashAfterOffPeak = Date.parse('2026-09-10T04:00:00.000Z') // 北京 12:00 低谷
const flashAfterPeak = Date.parse('2026-09-11T01:00:00.000Z') // 北京 09:00 高峰
const proBeforePeak = Date.parse('2026-09-14T01:00:00.000Z') // 北京 09:00 高峰
const proAfterOffPeak = Date.parse('2026-09-14T04:00:00.000Z') // 北京 12:00 低谷
const proWellAfter = Date.parse('2026-10-08T01:00:00.000Z') // 国庆假期后普通工作日高峰
assert.equal(resolveModelPrice({ currency: 'CNY' }, 'deepseek-flash', flashBeforePeak).cacheMiss, 3, 'deepseek-flash still uses the old V4 Flash price before 9/10 12:00')
assert.equal(resolveModelPrice({ currency: 'CNY' }, 'deepseek-flash', flashAfterOffPeak).cacheMiss, 1, 'deepseek-flash must use V4.1 Flash off-peak after 9/10 12:00')
assert.equal(resolveModelPrice({ currency: 'CNY' }, 'deepseek-flash', flashAfterPeak).cacheMiss, 2, 'deepseek-flash must use V4.1 Flash peak after 9/10 12:00')
assert.equal(resolveModelPrice({ currency: 'USD' }, 'deepseek-flash', flashAfterOffPeak).cacheMiss, 0.15, 'V4.1 Flash USD must be the official value, not CNY x 0.14')
assert.equal(resolveModelPrice({ currency: 'CNY' }, 'deepseek-v4-flash', flashAfterOffPeak).cacheMiss, 1, 'legacy deepseek-v4-flash is served by V4.1 Flash')
assert.equal(resolveModelPrice({ currency: 'CNY' }, 'deepseek-v4-pro', proBeforePeak).cacheMiss, 9, 'V4 Pro keeps its own peak price')
assert.equal(resolveModelPrice({ currency: 'CNY' }, 'deepseek-v4-pro', proAfterOffPeak).cacheMiss, 4.5, 'V4 Pro keeps its own off-peak price even after the originally planned 9/14 cutoff')
assert.equal(resolveModelPrice({ currency: 'CNY' }, 'deepseek-v4-pro', proWellAfter).cacheMiss, 9, 'the V4 Pro delisting was revoked, so it must never be routed to V4.1 Flash pricing')
assert.equal(resolveModelPrice({ currency: 'CNY' }, 'deepseek-v4-pro', proWellAfter).output, 27, 'V4 Pro output stays on its own table')
assert.equal(officialV4ConfigPrices('CNY', proWellAfter)['deepseek-v4-pro'].cacheMiss, 9, 'built-in defaults must not advertise V4.1 Flash prices for V4 Pro')
assert.ok(flashCutoff < proWellAfter, 'the flash cutoff still precedes later timestamps')

assert.deepEqual(HOLIDAY_CALENDAR.years, [2026])
for (const date of ['2026-09-25', '2026-10-01', '2026-10-07']) {
  for (const hour of ['09', '11', '14', '17']) {
    const time = Date.parse(`${date}T${hour}:00:00+08:00`)
    assert.equal(isPeakBeijing(time), false, `${date} must be off-peak throughout the holiday`)
    assert.equal(resolveModelPrice({ currency: 'CNY' }, 'deepseek-v4-pro', time).cacheMiss, 4.5)
  }
}
for (const date of ['2026-09-20', '2026-10-10']) {
  assert.equal(isPeakBeijing(Date.parse(`${date}T10:00:00+08:00`)), false, 'make-up work weekends must remain off-peak')
}
for (const [time, peak] of [['08:59:59', false], ['09:00:00', true], ['12:00:00', false], ['14:00:00', true], ['18:00:00', false]]) {
  assert.equal(isPeakBeijing(Date.parse(`2026-10-08T${time}+08:00`)), peak)
}
assert.equal(isPeakBeijing(Date.parse('2026-10-08T00:30:00Z')), false, 'use Beijing time rather than UTC')
assert.equal(isPeakBeijing(NaN), false)

// 配置里保存的是历史官方价（例如升级前落盘的旧 V4 峰谷）时，仍要按内置时间表重算，
// 不能把旧价套到新时段，也不能把它当成用户自定义价。
const staleOfficial = resolveModelPrice({
  currency: 'CNY',
  prices: {
    'deepseek-v4-flash': {
      cacheHit: 0.05, cacheMiss: 1.5, output: 4.5,
      peak: { cacheHit: 0.10, cacheMiss: 3.0, output: 9.0 },
      offPeak: { cacheHit: 0.05, cacheMiss: 1.5, output: 4.5 },
    },
  },
}, 'deepseek-v4-flash', flashAfterOffPeak)
assert.equal(staleOfficial.cacheMiss, 1, 'a persisted old official snapshot must still follow the new V4.1 table')

// 未来新模型没有精确价表时按名字回退到默认 Flash / Pro；非 DeepSeek 模型不回退。
assert.equal(familyModelFor('deepseek-v5-flash-preview'), 'deepseek-flash')
assert.equal(familyModelFor('deepseek-v5-pro-preview'), 'deepseek-v4-pro')
assert.equal(familyModelFor('deepseek-next'), 'deepseek-flash')
assert.equal(familyModelFor('glm-4.6'), null)
const fallbackFlash = resolveModelPriceInfo({ currency: 'CNY' }, 'deepseek-v5-flash-preview', flashAfterPeak)
assert.equal(fallbackFlash.source, 'family')
assert.equal(fallbackFlash.fallbackModel, 'deepseek-flash')
assert.equal(fallbackFlash.rate.cacheMiss, 2, 'flash-like models fall back to the default Flash table')
const fallbackPro = resolveModelPriceInfo({ currency: 'CNY' }, 'deepseek-v5-pro-preview', proBeforePeak)
assert.equal(fallbackPro.source, 'family')
assert.equal(fallbackPro.fallbackModel, 'deepseek-v4-pro')
assert.equal(fallbackPro.rate.cacheMiss, 9, 'pro-like models fall back to the default Pro table')
const noPrice = resolveModelPriceInfo({ currency: 'CNY', defaultPrices: { cacheHit: 1, cacheMiss: 2, output: 3 } }, 'glm-4.6', flashAfterPeak)
assert.equal(noPrice.source, 'none', 'non-DeepSeek models without pricing must be reported as unpriced')
assert.equal(noPrice.rate, undefined)
const configuredGlm = resolveModelPriceInfo({ currency: 'CNY', prices: { 'glm-4.6': { cacheHit: 0.1, cacheMiss: 1, output: 2 } } }, 'glm-4.6', flashAfterPeak)
assert.equal(configuredGlm.source, 'configured', 'an explicit price must win over the family fallback')
assert.equal(configuredGlm.rate.cacheMiss, 1)
assert.equal(resolveModelPrice({ currency: 'CNY', defaultPrices: { cacheHit: 1, cacheMiss: 2, output: 3 } }, 'glm-4.6', flashAfterPeak).cacheMiss, 2, 'server-side best effort still uses defaultPrices for unpriced models')

const usdFlash = resolveModelPrice({
  currency: 'USD',
  prices: { 'deepseek-v4-flash': { cacheHit: 1, cacheMiss: 2, output: 3 } },
  defaultPrices: { cacheHit: 0, cacheMiss: 0, output: 0 },
}, 'deepseek-v4-flash', Date.parse('2026-08-17T05:30:00.000Z')) // 北京 13:30 非高峰
assert.equal(usdFlash.cacheMiss, 0.22, 'USD V4 must use the official USD table, not config.prices or a CNY conversion')
assert.equal(usdFlash.cacheHit, 0.007, 'USD V4 cache-hit must also come from the official USD table')
assert.equal(usdFlash.output, 0.66, 'USD V4 output must also come from the official USD table')

// 官方美元表与人民币表是两套独立价目：换算会系统性偏低，必须逐项照官方值。
const usdV4Tables = [
  ['deepseek-v4-pro', '2026-08-17T05:30:00.000Z', { cacheHit: 0.022, cacheMiss: 0.66, output: 1.98 }],
  ['deepseek-v4-pro', '2026-08-17T01:30:00.000Z', { cacheHit: 0.044, cacheMiss: 1.32, output: 3.96 }],
  ['deepseek-v4-flash', '2026-08-17T01:30:00.000Z', { cacheHit: 0.014, cacheMiss: 0.44, output: 1.32 }],
]
for (const [model, iso, expected] of usdV4Tables) {
  const got = resolveModelPrice({ currency: 'USD', prices: {} }, model, Date.parse(iso))
  assert.deepEqual(
    { cacheHit: got.cacheHit, cacheMiss: got.cacheMiss, output: got.output },
    expected,
    `USD ${model} at ${iso} must match the official USD table exactly`,
  )
}

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
assert.equal(def.stateVersion, 5, 'cost projection version 5 must invalidate the poisoned version 4 rows')

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
assert.equal(usdPeak.cacheMiss, 0.44)
assert.equal(usdPeak.output, 1.32)

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
assert.equal(v4Def.wire.view(v4State).cost, 0.66, 'USD session cost must sum peak 0.44 + off-peak 0.22 from the official USD table')
console.log('PROJECTION TEST PASSED')

// ---------- TPS 投影：流式实时估算 + settlement 精确收敛 ----------
const tpsDef = makeTpsProjection()
assert.ok(tpsDef.stateSchema, 'TPS projection must expose its persisted-state schema')
assert.ok(tpsDef.wire?.viewSchema && typeof tpsDef.wire.view === 'function', 'TPS projection must be wired to the DSH client')
assert.equal(tpsDef.schema, undefined, 'removed legacy projection fields must not return')
assert.equal(tpsDef.stateVersion, 5, 'TPS projection version 5 must not collide with historical ver=4 rows whose flat shape predates live streaming')
assert.throws(() => tpsDef.stateSchema.parse({ tokensPerSecond: 12 }), 'old flat TPS states must be rejected')
assert.throws(() => tpsDef.stateSchema.parse({ settled: {}, last: null }), 'legacy TPS states with the wrong shape must be rejected')

// 真实 DSH Session v2 形态：`time0` 在事件根上，`texts` / `dt` 在 data 里。
const streamChunks = ({ type = 'text-chunks', time0, texts, dt, turn = 0, step = 0 }) => ({
  type,
  seq0: nextSeq++,
  time0,
  data: { turn, step, index: 0, dt, texts },
})

let tpsState = tpsDef.init()
tpsDef.stateSchema.parse(tpsState)
tpsState = tpsDef.apply(tpsState, { type: 'step/start', seq: nextSeq++, time: 1000, data: { turn: 1, step: 1 } })
assert.deepEqual(tpsDef.wire.view(tpsState), {}, 'a freshly started step shows no rate yet')

// 头两段流式 chunk 就能实时出数（不必等 settlement）；单个 chunk 只有起点，窗口为 0 故不出数。
tpsState = tpsDef.apply(tpsState, streamChunks({
  time0: 2000, texts: ['hello world'], dt: [], turn: 1, step: 1,
}))
assert.deepEqual(tpsDef.wire.view(tpsState), {}, 'a single chunk only establishes the start point, so no rate yet')
tpsState = tpsDef.apply(tpsState, streamChunks({
  time0: 3000, texts: ['more text here'], dt: [], turn: 1, step: 1,
}))
const firstTick = tpsDef.wire.view(tpsState)
assert.ok(firstTick.tokensPerSecond > 0, 'live streaming chunks must produce a rate before settlement')
assert.equal(firstTick.estimate, true, 'a rate derived from characters must be flagged as an estimate')
tpsDef.wire.viewSchema.parse(firstTick)

// 后续 chunk 推进时间轴：速率应随时间变化，而不是 flatline。
tpsState = tpsDef.apply(tpsState, streamChunks({
  time0: 4000, texts: ['yet another segment of output'], dt: [], turn: 1, step: 1,
}))
const secondTick = tpsDef.wire.view(tpsState)
assert.ok(secondTick.tokensPerSecond > 0, 'later chunks must keep the live rate alive')
assert.notEqual(secondTick.tokensPerSecond, firstTick.tokensPerSecond, 'the rate must track additional streamed output, not flatline')

// data.dt 是段间增量，必须逐段累加（time0 只在根上）。
tpsState = tpsDef.apply(tpsState, streamChunks({
  time0: 5000, texts: ['a', 'b', 'c'], dt: [500, 500], turn: 1, step: 1,
}))
const thirdTick = tpsDef.wire.view(tpsState)
assert.ok(thirdTick.tokensPerSecond > 0, 'per-segment dt must advance the time axis')
assert.equal(thirdTick.estimate, true, 'still estimating until the provider usage arrives')

// settlement 收敛为官方精确值，并去掉 estimate 标记。
// 这里的 settlement 流与上面的实时 chunk 是同一批数据（2000 → 6000），所以时间窗保持
// 4000 ms：60 tok / 4000 ms = 15 tok/s，且与结算前的实时值连贯（不会因为结算而跳变）。
tpsState = tpsDef.apply(tpsState, settlement({
  time: 6000,
  turn: 1,
  step: 1,
  usage: { inputTokens: 100, outputTokens: 60, cacheReadTokens: 0, cacheWriteTokens: 0 },
  stream: [
    { type: 'text-chunks', time0: 2000, index: 0, dt: [1000], texts: ['hello world', 'more text here'] },
    { type: 'text-chunks', time0: 5000, index: 0, dt: [500, 500], texts: ['a', 'b', 'c'] },
    { type: 'chunk', time: 6000, chunk: { type: 'usage', usage: { inputTokens: 100, outputTokens: 60, cacheReadTokens: 0, cacheWriteTokens: 0 } } },
  ],
}))
const exactTick = tpsDef.wire.view(tpsState)
assert.equal(exactTick.tokensPerSecond, 15, 'settlement must keep the live window (60 tok / 4000 ms) rather than jumping when it arrives')
assert.equal(exactTick.estimate, undefined, 'an exact rate must not be flagged as an estimate')
tpsDef.stateSchema.parse(tpsState)
tpsDef.wire.viewSchema.parse(exactTick)

// 回放历史日志时没有实时 chunk 事件，时间窗必须从压缩流里还原成"首 token → 末 token"，
// 而不是"首 token → 结算到达"。后者会把收尾等待算进分母，明显压低速率。
let replayOnly = tpsDef.init()
replayOnly = tpsDef.apply(replayOnly, { type: 'step/start', seq: nextSeq++, time: 1000, data: { turn: 8, step: 1 } })
replayOnly = tpsDef.apply(replayOnly, settlement({
  time: 6000,
  turn: 8,
  step: 1,
  usage: { inputTokens: 100, outputTokens: 60, cacheReadTokens: 0, cacheWriteTokens: 0 },
  stream: [
    { type: 'text-chunks', time0: 2000, index: 0, dt: [1000], texts: ['hello world', 'more text here'] },
    { type: 'chunk', time: 6000, chunk: { type: 'usage', usage: { inputTokens: 100, outputTokens: 60, cacheReadTokens: 0, cacheWriteTokens: 0 } } },
  ],
}))
assert.equal(
  tpsDef.wire.view(replayOnly).tokensPerSecond,
  60,
  'a replay with no live chunks must use the token window (2000->3000 = 1000 ms), not the settlement arrival time (which would give 15)',
)

// 精确之后同一 step 的尾随 chunk 不得再改写已定稿的精确值。
const afterExact = tpsDef.apply(tpsState, streamChunks({
  time0: 8000, texts: ['late chunk that must be ignored'], dt: [], turn: 1, step: 1,
}))
assert.equal(tpsDef.wire.view(afterExact).tokensPerSecond, 15, 'chunks arriving after the exact usage must not move the rate')

// step/end 把本步速率常驻为 last，active 清空后仍显示最近一次速率。
tpsState = tpsDef.apply(afterExact, { type: 'step/end', seq: nextSeq++, time: 6100, data: { turn: 1, step: 1 } })
assert.equal(tpsDef.wire.view(tpsState).tokensPerSecond, 15, 'step/end must retain the last exact rate')
assert.equal(tpsState.active, null, 'step/end must clear the in-progress attempt')

// 本步进行中、还没算出数值时沿用上一步速率，并标 pending 让 UI 用斜体表示"不是本步的值"。
tpsState = tpsDef.apply(tpsState, { type: 'step/start', seq: nextSeq++, time: 7000, data: { turn: 1, step: 2 } })
const carried = tpsDef.wire.view(tpsState)
assert.equal(carried.tokensPerSecond, 15, 'a fresh step must still show the last settled rate')
assert.equal(carried.pending, true, 'a rate carried over from the previous step must be flagged pending')
assert.equal(carried.estimate, undefined, 'a carried-over settled rate is not an estimate')
tpsDef.wire.viewSchema.parse(carried)

// 本步结算后去掉 pending，恢复正体显示。
tpsState = tpsDef.apply(tpsState, settlement({
  time: 9000,
  turn: 1,
  step: 2,
  usage: { inputTokens: 100, outputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 0 },
  stream: [
    { type: 'text-chunks', time0: 7000, index: 0, dt: [2000], texts: ['a', 'b'] },
    { type: 'chunk', time: 9000, chunk: { type: 'usage', usage: { inputTokens: 100, outputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 0 } } },
  ],
}))
const settledAgain = tpsDef.wire.view(tpsState)
assert.equal(settledAgain.tokensPerSecond, 15, 'the current step value must replace the carried-over one')
assert.equal(settledAgain.pending, undefined, 'once the current step settles the reading is no longer pending')

// 空闲（没有进行中的步骤）时显示最近值，且不带 pending。
const idleState = tpsDef.apply(tpsState, { type: 'step/end', seq: nextSeq++, time: 9100, data: { turn: 1, step: 2 } })
assert.equal(tpsDef.wire.view(idleState).tokensPerSecond, 15)
assert.equal(tpsDef.wire.view(idleState).pending, undefined, 'an idle reading must not be flagged pending')

// 窗口过短时必须抑制离谱速率（历史上出现过 10 万+ tok/s 的脏读数）。
let shortWindow = tpsDef.init()
shortWindow = tpsDef.apply(shortWindow, { type: 'step/start', seq: nextSeq++, time: 1000, data: { turn: 2, step: 1 } })
shortWindow = tpsDef.apply(shortWindow, streamChunks({
  time0: 2000, texts: ['x'.repeat(400)], dt: [], turn: 2, step: 1,
}))
shortWindow = tpsDef.apply(shortWindow, settlement({
  time: 2001,
  turn: 2,
  step: 1,
  usage: { inputTokens: 10, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 },
}))
const suppressed = tpsDef.wire.view(shortWindow).tokensPerSecond
assert.ok(suppressed === undefined || suppressed < 1000, 'a 1ms window must not yield an absurd tok/s reading')

// 失败尝试（assistant/attempt）同样要有 TPS。
let attemptState = tpsDef.init()
attemptState = tpsDef.apply(attemptState, { type: 'step/start', seq: nextSeq++, time: 1000, data: { turn: 3, step: 1 } })
attemptState = tpsDef.apply(attemptState, settlement({
  type: 'assistant/attempt',
  time: 7000,
  turn: 3,
  step: 1,
  usage: { inputTokens: 100, outputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 0 },
  stream: [
    { type: 'reasoning-chunks', time0: 5000, index: 0, dt: [1000], texts: ['c', 'd'] },
    { type: 'chunk', time: 7000, chunk: { type: 'usage', usage: { inputTokens: 100, outputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 0 } } },
  ],
}))
assert.equal(tpsDef.wire.view(attemptState).tokensPerSecond, 30, 'failed attempts must also produce TPS')

// 只有 settlement、没有流式事件时，时间窗仍从压缩流里还原：首个空增量不算起点。
let bareState = tpsDef.init()
bareState = tpsDef.apply(bareState, { type: 'step/start', seq: nextSeq++, time: 1000, data: { turn: 4, step: 1 } })
bareState = tpsDef.apply(bareState, settlement({
  time: 9000,
  turn: 4,
  step: 1,
  usage: { inputTokens: 100, outputTokens: 15, cacheReadTokens: 0, cacheWriteTokens: 0 },
  stream: [{ type: 'text-chunks', time0: 7000, index: 0, dt: [1000, 500], texts: ['', 'first token', 'second token'] }],
}))
// 起点是第一个非空增量 8000，终点是最后一个 8500 => 15 tok / 500 ms = 30 tok/s。
assert.equal(tpsDef.wire.view(bareState).tokensPerSecond, 30, 'empty deltas must not start the decode clock')

// 完全没有流记录时无法得到时长，必须抑制而不是编一个数。
let noStreamState = tpsDef.init()
noStreamState = tpsDef.apply(noStreamState, { type: 'step/start', seq: nextSeq++, time: 1000, data: { turn: 7, step: 1 } })
noStreamState = tpsDef.apply(noStreamState, settlement({
  time: 9000,
  turn: 7,
  step: 1,
  usage: { inputTokens: 10, outputTokens: 40, cacheReadTokens: 0, cacheWriteTokens: 0 },
  stream: [],
}))
assert.equal(tpsDef.wire.view(noStreamState).tokensPerSecond, undefined, 'a settlement without any stream timing must not invent a rate')

// 未压缩的逐 delta 形态仍要兼容。
let deltaState = tpsDef.init()
deltaState = tpsDef.apply(deltaState, { type: 'step/start', seq: nextSeq++, time: 1000, data: { turn: 5, step: 1 } })
deltaState = tpsDef.apply(deltaState, { type: 'assistant/chunk', seq: nextSeq++, time: 2000, data: { turn: 5, step: 1, chunk: { type: 'text-delta', index: 0, text: 'streaming delta text' } } })
deltaState = tpsDef.apply(deltaState, { type: 'assistant/chunk', seq: nextSeq++, time: 3000, data: { turn: 5, step: 1, chunk: { type: 'text-delta', index: 0, text: ' and more delta text' } } })
assert.ok(tpsDef.wire.view(deltaState).tokensPerSecond > 0, 'uncompressed text-delta events must still drive the live rate')
assert.equal(tpsDef.wire.view(deltaState).estimate, true, 'delta-based rates are estimates too')

// CJK 与 ASCII 混排：中文按更高 token 权重估算，避免低估中文吞吐。
const rateFor = (start, step, first, second) => {
  let s = tpsDef.apply(tpsDef.init(), { type: 'step/start', seq: nextSeq++, time: start, data: { turn: 6, step } })
  s = tpsDef.apply(s, streamChunks({ time0: start + 1000, texts: [first], dt: [], turn: 6, step }))
  s = tpsDef.apply(s, streamChunks({ time0: start + 2000, texts: [second], dt: [], turn: 6, step }))
  return tpsDef.wire.view(s).tokensPerSecond
}
const cjkRate = rateFor(1000, 1, '中文字符测试内容', '再来一段中文内容')
const asciiRate = rateFor(1000, 1, 'abcdefghijklmno', 'pqrstuvwxyzabcd')
assert.ok(cjkRate > asciiRate, 'CJK output must be estimated at a higher token density than the same number of ASCII characters')
console.log('TPS PROJECTION TEST PASSED (LIVE STREAMING)')
