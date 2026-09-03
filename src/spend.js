/**
 * 跨会话累计消耗: 从会话事件折叠出带时间戳的用量样本, 再按区间聚合。
 * 样本只存 token, 查询时用当前单价/货币重算, 切换计价货币后累计金额会跟着变。
 */
import { priceBuckets } from './pricing.js'

const round6 = (n) => Math.round(n * 1e6) / 1e6

const zeroBuckets = () => ({
  uncachedInputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
})

const bucketsOf = (usage) => ({
  uncachedInputTokens: usage.inputTokens,
  cacheReadTokens: usage.cacheReadTokens ?? 0,
  cacheWriteTokens: usage.cacheWriteTokens ?? 0,
  outputTokens: usage.outputTokens,
})

const bucketsEqual = (a, b) =>
  a.uncachedInputTokens === b.uncachedInputTokens &&
  a.cacheReadTokens === b.cacheReadTokens &&
  a.cacheWriteTokens === b.cacheWriteTokens &&
  a.outputTokens === b.outputTokens

export const RANGE_PRESETS = ['today', 'yesterday', 'week', 'month']

const startOfDay = (ms) => {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

const startOfWeekMonday = (ms) => {
  const d = new Date(startOfDay(ms))
  const day = d.getDay() // 0 Sun .. 6 Sat
  const back = day === 0 ? 6 : day - 1
  d.setDate(d.getDate() - back)
  return d.getTime()
}

const startOfMonth = (ms) => {
  const d = new Date(ms)
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

const parseBound = (value, endOfDay) => {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const raw = String(value).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const d = new Date(raw + (endOfDay ? 'T23:59:59.999' : 'T00:00:00'))
    const t = d.getTime()
    return Number.isNaN(t) ? null : t
  }
  const t = Date.parse(raw)
  return Number.isNaN(t) ? null : t
}

/**
 * 解析统计窗口。week = 本周一 00:00 起; custom 需要 from/to (日期或 ISO 时间)。
 */
export const resolveSpendRange = (range, fromValue, toValue, now = Date.now()) => {
  const kind = typeof range === 'string' && range !== '' ? range : 'today'
  if (kind === 'custom') {
    const from = parseBound(fromValue, false)
    const to = parseBound(toValue, true)
    if (from === null || to === null) {
      return { ok: false, error: 'custom-range-requires-from-to' }
    }
    if (to < from) return { ok: false, error: 'invalid-range' }
    return { ok: true, range: 'custom', from, to }
  }
  if (kind === 'yesterday') {
    const today = startOfDay(now)
    return { ok: true, range: kind, from: today - 86400000, to: today - 1 }
  }
  if (kind === 'week') {
    return { ok: true, range: kind, from: startOfWeekMonday(now), to: now }
  }
  if (kind === 'month') {
    return { ok: true, range: kind, from: startOfMonth(now), to: now }
  }
  return { ok: true, range: 'today', from: startOfDay(now), to: now }
}

export const initSpendFold = () => ({ currentModel: null, currentProvider: null, last: null, samples: {} })

export const applySpendEvent = (state, event) => {
  let nextModel = state.currentModel
  let nextProvider = state.currentProvider
  if (event.type === 'request/header') {
    const model = event.data?.header?.config?.model
    const provider = event.data?.provider ?? event.data?.header?.provider ?? event.data?.header?.config?.provider
    if (typeof model === 'string' && model !== '') nextModel = model
    if (typeof provider === 'string' && provider !== '') nextProvider = provider
  } else if (event.type === 'request/context') {
    const model = event.data?.model
    const provider = event.data?.provider
    if (typeof model === 'string' && model !== '') nextModel = model
    if (typeof provider === 'string' && provider !== '') nextProvider = provider
  }

  let usage = null
  let turn = 0
  let step = 0
  if (event.type === 'assistant/chunk' && event.data?.chunk?.type === 'usage') {
    ({ turn, step } = event.data)
    usage = event.data.chunk.usage
  } else if (event.type === 'assistant/message' && event.data?.usage !== undefined) {
    ({ turn, step, usage } = event.data)
  }

  const changedModel = nextModel !== state.currentModel || nextProvider !== state.currentProvider
  if (usage === null) {
    return changedModel ? { ...state, currentModel: nextModel, currentProvider: nextProvider } : state
  }

  const model = nextModel ?? 'unknown'
  const provider = nextProvider ?? ''
  const buckets = bucketsOf(usage)
  const key = `${turn}:${step}`
  const previous = state.samples[key]
  if (previous && previous.model === model && previous.provider === provider && bucketsEqual(previous.buckets, buckets) && previous.t === (event.time ?? previous.t)) {
    return changedModel ? { ...state, currentModel: nextModel, currentProvider: nextProvider } : state
  }

  return {
    currentModel: nextModel,
    currentProvider: nextProvider,
    last: { turn, step, model, provider },
    samples: {
      ...state.samples,
      [key]: { t: Number(event.time) || 0, model, provider, buckets },
    },
  }
}

export const foldSpendEvents = (events) => {
  let state = initSpendFold()
  for (const event of events ?? []) state = applySpendEvent(state, event)
  return Object.values(state.samples)
}

export const aggregateSpend = (samples, cfg, from, to) => {
  const tokens = { uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
  const costByModel = {}
  const sessionIds = new Set()
  let cost = 0
  let calls = 0
  const inRange = []
  for (const sample of samples) {
    const t = Number(sample.t)
    if (!Number.isFinite(t) || t < from || t > to) continue
    const b = sample.buckets ?? zeroBuckets()
    tokens.uncachedInput += b.uncachedInputTokens
    tokens.cacheRead += b.cacheReadTokens
    tokens.cacheWrite += b.cacheWriteTokens
    tokens.output += b.outputTokens
    const model = sample.model ?? 'unknown'
    const provider = sample.provider ?? ''
    const modelKey = provider ? `${provider}/${model}` : model
    const c = priceBuckets(cfg, model, b, t)
    cost += c
    if (c > 0) costByModel[modelKey] = round6((costByModel[modelKey] ?? 0) + c)
    if (sample.sessionId) sessionIds.add(sample.sessionId)
    calls += 1
    inRange.push({ ...sample, cost: round6(c) })
  }
  return {
    cost: round6(cost),
    costByModel,
    tokens,
    calls,
    sessions: sessionIds.size,
    currency: cfg.currency ?? 'CNY',
    samples: inRange,
  }
}

export const attachSessionId = (samples, sessionId) =>
  samples.map((s) => ({ ...s, sessionId }))
