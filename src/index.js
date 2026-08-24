/**
 * dsh-credits — server half.
 *
 * 1. 额度服务: 按 `refreshIntervalMs` 并行缓存 DeepSeek 官方余额与 OpenCode Go
 *    订阅用量, 通过 HTTP 路由 `/query-credits` 提供给浏览器(浏览器只读缓存,
 *    不打上游 API)。底部读数跟随当前对话模型供应商: 仅 `opencode-go` 显示订阅
 *    用量, 其余供应商(含 DeepSeek 官方)显示官方余额。配置里的 `provider` 只在
 *    无法识别当前模型时作为默认。
 *    DeepSeek 密钥优先取 `apiKey`, 否则经 credentials 解析 `apiKeyRef`; OpenCode Go
 *    密钥优先取 `opencodeApiKey`, 再经 credentials/环境变量解析 `opencodeApiKeyRef`,
 *    最后回退读取 OpenCode CLI 的 `~/.local/share/opencode/auth.json`。
 * 2. 会话投影: 注册 `queryCreditsCost` 花费单元与 `liveTokenUsage` TPS 单元；前者
 *    在已提交的会话事件上按模型折叠 token 用量并计价，后者从流式输出事件估算
 *    生成吞吐，收到 provider usage 后替换为精确输出 token。
 *
 * 投影折叠规则与 dsh-token-meter 的 tokenUsage 一致(同 (turn,step) 的样本替换
 * 而非重复计数); 模型取自 `request/header` / `request/context`(last-wins)。
 */
import Schema from '@deepseek-ai/schemastery'
import { z } from 'zod'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolveModelPrice, priceBuckets, officialV4ConfigPrices } from './pricing.js'
import { applySpendEvent, aggregateSpend, initSpendFold, resolveSpendRange } from './spend.js'

export { resolveModelPrice } from './pricing.js'
export const name = 'dsh-credits'

/** 支持的额度数据源。 */
export const PROVIDERS = ['deepseek', 'opencode-go']
export const QUOTA_MODES = ['follow', 'custom']
export const DOCK_LAYOUTS = ['own', 'shared']
export const OPENCODE_GO_DEFAULT_BASE_URL = 'https://opencode.ai/zen/go/v1/usage'

/** own=额度单独一行; shared=与底部已有统计同一行靠后。 */
export const normalizeDockLayout = (value) =>
  String(value ?? 'own').trim().toLowerCase() === 'shared' ? 'shared' : 'own'

/** 对话模型供应商 → 额度展示。仅 OpenCode Go 走订阅用量, 其余一律官方余额。 */
export const quotaSourceFromProvider = (provider) =>
  String(provider ?? '').trim().toLowerCase() === 'opencode-go' ? 'opencode-go' : 'deepseek'

/** follow: 跟当前模型; custom: 固定用 config.provider, 忽略当前模型。 */
export const resolveQuotaSource = (modelProvider, config = {}) => {
  const selected = quotaSourceFromProvider(config.provider)
  if (String(config.quotaMode ?? 'follow').trim().toLowerCase() === 'custom') return selected
  return quotaSourceFromProvider(modelProvider ?? config.provider)
}

/** 一组命中 / 未命中 / 输出单价(每 1M token)。 */
const TokenRate = Schema.object({
  cacheHit: Schema.number().min(0),
  cacheMiss: Schema.number().min(0),
  output: Schema.number().min(0),
})

/** 每个模型每 100 万 token 的价格(以 `currency` 计价)。V4 另可配 peak / offPeak。 */
const ModelPrice = Schema.object({
  /** 缓存命中输入价(无峰谷时使用; 有峰谷时与高峰价对齐) */
  cacheHit: Schema.number().min(0).default(0.2),
  /** 缓存未命中输入价(含缓存写入) */
  cacheMiss: Schema.number().min(0).default(2),
  /** 输出价 */
  output: Schema.number().min(0).default(8),
  /** 高峰时段单价; 缺省则 V4 走内置官方表 */
  peak: TokenRate,
  /** 低谷时段单价; 缺省则 V4 走内置官方表 */
  offPeak: TokenRate,
})

export const Config = Schema.object({
  /** 整个额度功能总开关；关闭后不查询额度且前端隐藏所有额度 UI */
  enabled: Schema.boolean().default(true),
  /** follow=跟随当前对话模型; custom=固定使用 provider */
  quotaMode: Schema.union(QUOTA_MODES).default('follow'),
  /** 底部统计条是否展示额度读数 */
  showDock: Schema.boolean().default(true),
  /** own=独立换行; shared=与底部已有统计共用一行 */
  dockLayout: Schema.union(DOCK_LAYOUTS).default('own'),
  /** 右下角累计消耗胶囊 */
  showCapsule: Schema.boolean().default(true),
  /** 悬停额度/花费详情气泡 */
  showPopover: Schema.boolean().default(true),
  /** 底部统计条是否展示实时生成吞吐 TPS */
  showTps: Schema.boolean().default(true),
  /** 自定义模式的数据源; 跟随模式下仅在无法识别当前模型时作为回退 */
  provider: Schema.union(PROVIDERS).default('deepseek'),
  /** 显式 DeepSeek API 密钥; 留空则走 apiKeyRef(credentials / 环境变量) */
  apiKey: Schema.string().default(''),
  /** DeepSeek credentials / 环境变量引用名 */
  apiKeyRef: Schema.string().default('DEEPSEEK_API_KEY'),
  /** DeepSeek API 基址 */
  baseUrl: Schema.string().default('https://api.deepseek.com'),
  /** 显式 OpenCode Go API 密钥; 留空则自动解析 opencodeApiKeyRef / auth.json */
  opencodeApiKey: Schema.string().default(''),
  /** OpenCode Go credentials / 环境变量引用名 */
  opencodeApiKeyRef: Schema.string().default('OPENCODE_GO_API_KEY'),
  /** OpenCode Go usage 接口基址(完整 URL, 含 /v1/usage) */
  opencodeBaseUrl: Schema.string().default(OPENCODE_GO_DEFAULT_BASE_URL),
  /** 服务器向上游查询额度的频率(单位: 毫秒 ms) —— 真正的"查询频率" */
  refreshIntervalMs: Schema.number().min(1000).default(300000),
  /** 浏览器刷新显示读取缓存的频率(单位: 毫秒 ms) */
  clientPollIntervalMs: Schema.number().min(5000).default(30000),
  /** 单次请求超时时间(单位: 毫秒 ms) */
  timeoutMs: Schema.number().min(1000).default(8000),
  /** 花费估算的计价货币(与 prices 一致) */
  currency: Schema.string().default('CNY'),
  prices: Schema.dict(ModelPrice).default(officialV4ConfigPrices('CNY')),
  /** 余额预警阈值(DeepSeek: 余额低于此值; OpenCode Go: 剩余额度低于此百分比) */
  warningThreshold: Schema.number().min(0).default(10),
  /** 余额告急阈值(DeepSeek: 余额低于此值; OpenCode Go: 剩余额度低于此百分比) */
  dangerThreshold: Schema.number().min(0).default(5),
  /** 未列出的模型的回退单价 */
  defaultPrices: ModelPrice.default({ cacheHit: 0.1, cacheMiss: 1, output: 2 }),
})

/** 归一化 DeepSeek 余额响应中的金额字符串。 */
const toAmount = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** 归一化 `/user/balance` 响应体。 */
const normalizeBalances = (data) => {
  const infos = Array.isArray(data?.balance_infos) ? data.balance_infos : []
  return infos.map((info) => ({
    currency: typeof info?.currency === 'string' && info.currency !== '' ? info.currency : 'CNY',
    total: toAmount(info?.total_balance),
    granted: toAmount(info?.granted_balance),
    toppedUp: toAmount(info?.topped_up_balance),
  }))
}

/** 归一化 OpenCode Go `/zen/go/v1/usage` 响应体(percent 统一裁剪到 0~100)。 */
export const normalizeOpencodeUsage = (data) => {
  const source = data && typeof data === 'object' && data.usage && typeof data.usage === 'object' ? data.usage : data
  const pickWindow = (w) => {
    const n = Number(w?.percent)
    return {
      status: w && typeof w.status === 'string' ? w.status : null,
      percent: Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null,
      resetsAt: w && typeof w.resetsAt === 'string' ? w.resetsAt : null,
    }
  }
  return {
    rolling: pickWindow(source?.rolling),
    weekly: pickWindow(source?.weekly),
    monthly: pickWindow(source?.monthly),
  }
}

/** 构造会话花费投影单元。样本带事件时间, view 按当时峰谷价计价。 */
export const makeCostProjection = (configOrGetter) => {
  const getConfig = () => typeof configOrGetter === 'function' ? configOrGetter() : configOrGetter
  const zero = () => ({ uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 })
  const bucketsOf = (usage) => ({
    uncachedInputTokens: usage.inputTokens,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
    outputTokens: usage.outputTokens,
  })
  const bucketsEqual = (a, b) =>
    a.uncachedInputTokens === b.uncachedInputTokens && a.cacheReadTokens === b.cacheReadTokens &&
    a.cacheWriteTokens === b.cacheWriteTokens && a.outputTokens === b.outputTokens
  const eventTime = (event) => {
    const t = Number(event?.time)
    return Number.isFinite(t) && t > 0 ? t : Date.now()
  }
  const round6 = (n) => Math.round(n * 1e6) / 1e6

  const viewSchema = z.object({
    models: z.array(z.string()),
    cost: z.number().nonnegative(),
    costByModel: z.record(z.string(), z.number().nonnegative()),
    tokens: z.object({
      uncachedInput: z.number().int().nonnegative(),
      cacheRead: z.number().int().nonnegative(),
      cacheWrite: z.number().int().nonnegative(),
      output: z.number().int().nonnegative(),
    }).strict(),
    tokensByModel: z.record(z.string(), z.object({
      uncachedInput: z.number().int().nonnegative(),
      cacheRead: z.number().int().nonnegative(),
      cacheWrite: z.number().int().nonnegative(),
      output: z.number().int().nonnegative(),
    }).strict()),
    legs: z.array(z.object({
      t: z.number(),
      model: z.string(),
      uncachedInput: z.number().int().nonnegative(),
      cacheRead: z.number().int().nonnegative(),
      cacheWrite: z.number().int().nonnegative(),
      output: z.number().int().nonnegative(),
    }).strict()),
    currency: z.string(),
    pricingEpoch: z.number().int().nonnegative(),
  }).strict()
  const bucketSchema = z.object({
    uncachedInputTokens: z.number().int().nonnegative(),
    cacheReadTokens: z.number().int().nonnegative(),
    cacheWriteTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }).strict()
  const stateSchema = z.object({
    currentModel: z.string().nullable(),
    last: z.object({
      turn: z.number().int().nonnegative(),
      step: z.number().int().nonnegative(),
      model: z.string(),
    }).strict().nullable(),
    samples: z.record(z.string(), z.object({
      t: z.number(),
      model: z.string(),
      buckets: bucketSchema,
    }).strict()),
    modelOrder: z.array(z.string()),
  }).strict()
  const view = (state) => {
      const cfg = getConfig()
      const tokens = { uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
      const tokensByModel = {}
      const costByModel = {}
      const legs = []
      let cost = 0
      for (const sample of Object.values(state.samples ?? {})) {
        const b = sample.buckets ?? zero()
        const model = sample.model ?? 'unknown'
        tokens.uncachedInput += b.uncachedInputTokens
        tokens.cacheRead += b.cacheReadTokens
        tokens.cacheWrite += b.cacheWriteTokens
        tokens.output += b.outputTokens
        const prevTok = tokensByModel[model] ?? { uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
        tokensByModel[model] = {
          uncachedInput: prevTok.uncachedInput + b.uncachedInputTokens,
          cacheRead: prevTok.cacheRead + b.cacheReadTokens,
          cacheWrite: prevTok.cacheWrite + b.cacheWriteTokens,
          output: prevTok.output + b.outputTokens,
        }
        const c = priceBuckets(cfg, model, b, sample.t)
        if (c > 0) costByModel[model] = round6((costByModel[model] ?? 0) + c)
        cost += c
        legs.push({
          t: sample.t,
          model,
          uncachedInput: b.uncachedInputTokens,
          cacheRead: b.cacheReadTokens,
          cacheWrite: b.cacheWriteTokens,
          output: b.outputTokens,
        })
      }
      return {
        models: state.modelOrder ?? [],
        cost: round6(cost),
        costByModel,
        tokens,
        tokensByModel,
        legs,
        currency: cfg.currency,
        pricingEpoch: Number(cfg.pricingEpoch ?? 0),
      }
    }

  return {
    key: 'queryCreditsCost',
    stateSchema,
    schema: viewSchema,
    init: () => ({ currentModel: null, last: null, samples: {}, modelOrder: [] }),
    apply: (state, event) => {
      let nextModel = state.currentModel
      if (event.type === 'request/header') {
        const model = event.data.header?.config?.model
        if (typeof model === 'string' && model !== '') nextModel = model
      } else if (event.type === 'request/context') {
        const model = event.data.model
        if (typeof model === 'string' && model !== '') nextModel = model
      }
      let usage = null
      let turn = 0
      let step = 0
      if (event.type === 'assistant/chunk' && event.data.chunk.type === 'usage') {
        ({ turn, step } = event.data)
        usage = event.data.chunk.usage
      } else if (event.type === 'assistant/message' && event.data.usage !== undefined) {
        ({ turn, step, usage } = event.data)
      }
      if (usage === null) {
        return nextModel === state.currentModel ? state : { ...state, currentModel: nextModel }
      }
      const model = nextModel ?? 'unknown'
      const buckets = bucketsOf(usage)
      const t = eventTime(event)
      const key = `${turn}:${step}`
      const previous = state.samples?.[key]
      if (previous && previous.model === model && bucketsEqual(previous.buckets, buckets) && previous.t === t) {
        return nextModel === state.currentModel ? state : { ...state, currentModel: nextModel }
      }
      const isNewModel = !(state.modelOrder ?? []).includes(model)
      return {
        currentModel: nextModel,
        last: { turn, step, model },
        samples: { ...(state.samples ?? {}), [key]: { t, model, buckets } },
        modelOrder: isNewModel ? [...(state.modelOrder ?? []), model] : state.modelOrder,
      }
    },
    view,
    stateVersion: 2,
    wire: { viewSchema, view },
  }
}

/**
 * 会话实时输出吞吐投影。
 *
 * 仅消费 DSH 会话事件，不访问网络：流式 chunk 阶段按字符数估算输出 token，
 * 收到 provider usage 后替换为精确 outputTokens；步骤结束时用首个/最后一个
 * 输出事件的墙钟时间计算 tokensPerSecond，并把最近一次速率常驻到视图中。
 */
export const makeTpsProjection = () => {
  const charsPerToken = 4
  const roleOverhead = 4
  const eventTime = (event) => {
    const t = Number(event?.time)
    return Number.isFinite(t) && t > 0 ? t : Date.now()
  }
  const emptyActive = (turn = 0, step = 0) => ({
    turn,
    step,
    blocks: {},
    outputTokens: 0,
    firstOutputTime: null,
    latestOutputTime: null,
    exact: false,
  })
  const blockTokens = (block) => {
    if (!block) return 0
    if (block.kind === 'fixed') return Math.max(0, Number(block.tokens) || 0)
    if (block.kind === 'tool-call') {
      return Math.ceil((Math.max(0, Number(block.nameCharacters) || 0) + Math.max(0, Number(block.argumentCharacters) || 0)) / charsPerToken)
    }
    return Math.ceil(Math.max(0, Number(block.characters) || 0) / charsPerToken)
  }
  const outputFromBlocks = (blocks) => {
    const entries = Object.values(blocks ?? {})
    if (entries.length === 0) return 0
    return entries.reduce((sum, block) => sum + blockTokens(block), 0) + roleOverhead
  }
  const rateOf = (active) => {
    if (!active || active.firstOutputTime === null || active.latestOutputTime === null) return undefined
    const elapsed = active.latestOutputTime - active.firstOutputTime
    if (elapsed <= 0 || active.outputTokens <= 0) return undefined
    return active.outputTokens * 1000 / elapsed
  }
  const withOutputTime = (active, outputTokens, time) => {
    if (outputTokens <= 0) return { ...active, outputTokens }
    return {
      ...active,
      outputTokens,
      firstOutputTime: active.firstOutputTime ?? time,
      latestOutputTime: time,
    }
  }
  const ensureActive = (state, turn, step) => {
    if (state.active && state.active.turn === turn && state.active.step === step) return state.active
    return emptyActive(turn, step)
  }

  const viewSchema = z.object({
    tokensPerSecond: z.number().nonnegative().optional(),
  }).strict()
  const stateSchema = z.object({
    active: z.object({
      turn: z.number().int().nonnegative(),
      step: z.number().int().nonnegative(),
      blocks: z.record(z.string(), z.union([
        z.object({ kind: z.literal('text'), characters: z.number().int().nonnegative() }).strict(),
        z.object({ kind: z.literal('reasoning'), characters: z.number().int().nonnegative() }).strict(),
        z.object({ kind: z.literal('tool-call'), nameCharacters: z.number().int().nonnegative(), argumentCharacters: z.number().int().nonnegative() }).strict(),
        z.object({ kind: z.literal('fixed'), tokens: z.number().int().nonnegative() }).strict(),
      ])),
      outputTokens: z.number().int().nonnegative(),
      firstOutputTime: z.number().nullable(),
      latestOutputTime: z.number().nullable(),
      exact: z.boolean(),
    }).strict().nullable(),
    last: z.object({ tokensPerSecond: z.number().nonnegative() }).strict().nullable(),
  }).strict()
  const view = (state) => {
      const rate = rateOf(state.active) ?? state.last?.tokensPerSecond
      return Number.isFinite(rate) ? { tokensPerSecond: rate } : {}
    }

  return {
    key: 'liveTokenUsage',
    stateSchema,
    schema: viewSchema,
    init: () => ({ active: null, last: null }),
    apply: (state, event) => {
      if (event.type === 'step/start') {
        return {
          ...state,
          active: emptyActive(Number(event.data?.turn) || 0, Number(event.data?.step) || 0),
        }
      }

      if (event.type === 'assistant/chunk') {
        const turn = Number(event.data?.turn) || 0
        const step = Number(event.data?.step) || 0
        const time = eventTime(event)
        const chunk = event.data?.chunk ?? {}
        const active = ensureActive(state, turn, step)
        if (chunk.type === 'usage') {
          const outputTokens = Math.max(0, Number(chunk.usage?.outputTokens) || 0)
          return {
            ...state,
            active: {
              ...active,
              outputTokens,
              exact: true,
              ...(outputTokens > 0
                ? { firstOutputTime: active.firstOutputTime ?? time, latestOutputTime: time }
                : {}),
              blocks: {},
            },
          }
        }
        if (active.exact) return state.active === active ? state : { ...state, active }

        const index = String(chunk.index ?? 0)
        const previous = active.blocks[index]
        let nextBlock = null
        if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
          const text = typeof chunk.text === 'string' ? chunk.text : ''
          if (text === '') return state.active === active ? state : { ...state, active }
          nextBlock = {
            kind: chunk.type === 'reasoning-delta' ? 'reasoning' : 'text',
            characters: (previous?.kind === (chunk.type === 'reasoning-delta' ? 'reasoning' : 'text') ? previous.characters : 0) + text.length,
          }
        } else if (chunk.type === 'tool-call-delta') {
          const argumentDelta = typeof chunk.argumentsDelta === 'string' ? chunk.argumentsDelta : ''
          if (chunk.name === undefined && argumentDelta === '') return state.active === active ? state : { ...state, active }
          nextBlock = {
            kind: 'tool-call',
            nameCharacters: typeof chunk.name === 'string' ? chunk.name.length : (previous?.nameCharacters ?? 0),
            argumentCharacters: (previous?.argumentCharacters ?? 0) + argumentDelta.length,
          }
        } else if (chunk.type === 'block-end') {
          let tokens = 0
          try { tokens = Math.ceil(JSON.stringify(chunk.block ?? null).length / charsPerToken) + roleOverhead } catch { tokens = roleOverhead }
          nextBlock = { kind: 'fixed', tokens }
        }
        if (nextBlock === null) return state.active === active ? state : { ...state, active }
        const blocks = { ...active.blocks, [index]: nextBlock }
        const outputTokens = outputFromBlocks(blocks)
        return { ...state, active: withOutputTime({ ...active, blocks }, outputTokens, time) }
      }

      if (event.type === 'assistant/message') {
        const turn = Number(event.data?.turn) || 0
        const step = Number(event.data?.step) || 0
        const time = eventTime(event)
        const active = ensureActive(state, turn, step)
        if (event.data?.usage !== undefined) {
          const outputTokens = Math.max(0, Number(event.data.usage?.outputTokens) || 0)
          return {
            ...state,
            active: {
              ...active,
              outputTokens,
              exact: true,
              ...(outputTokens > 0
                ? { firstOutputTime: active.firstOutputTime ?? time, latestOutputTime: time }
                : {}),
              blocks: {},
            },
          }
        }
        return active.outputTokens > 0
          ? { ...state, active: { ...active, latestOutputTime: time } }
          : { ...state, active }
      }

      if (event.type === 'step/end' && state.active !== null) {
        const rate = rateOf(state.active)
        return {
          active: null,
          last: Number.isFinite(rate) ? { tokensPerSecond: rate } : state.last,
        }
      }

      return state
    },
    view,
    stateVersion: 1,
    wire: { viewSchema, view },
  }
}

/** 读取 HTTP POST JSON Body */
const readJsonBody = (req) => new Promise((resolve, reject) => {
  let body = ''
  req.on('data', (chunk) => {
    body += chunk
    if (body.length > 1e6) {
      req.destroy()
      reject(new Error('Payload too large'))
    }
  })
  req.on('end', () => {
    try {
      resolve(body ? JSON.parse(body) : {})
    } catch {
      reject(new Error('Invalid JSON'))
    }
  })
  req.on('error', reject)
})

export function apply(ctx, config) {
  // 运行时可变配置（优先使用用户在设置面板中动态修改的值）
  let runtimeConfig = {
    enabled: config.enabled !== false,
    quotaMode: config.quotaMode === 'custom' ? 'custom' : 'follow',
    showDock: config.showDock !== false,
    dockLayout: normalizeDockLayout(config.dockLayout),
    showCapsule: config.showCapsule !== false,
    showPopover: config.showPopover !== false,
    showTps: config.showTps !== false,
    provider: config.provider ?? 'deepseek',
    apiKey: config.apiKey ?? '',
    apiKeyRef: config.apiKeyRef ?? 'DEEPSEEK_API_KEY',
    baseUrl: config.baseUrl ?? 'https://api.deepseek.com',
    opencodeApiKey: config.opencodeApiKey ?? '',
    opencodeApiKeyRef: config.opencodeApiKeyRef ?? 'OPENCODE_GO_API_KEY',
    opencodeBaseUrl: config.opencodeBaseUrl ?? OPENCODE_GO_DEFAULT_BASE_URL,
    refreshIntervalMs: config.refreshIntervalMs ?? 300000,
    clientPollIntervalMs: config.clientPollIntervalMs ?? 30000,
    timeoutMs: config.timeoutMs ?? 8000,
    currency: config.currency ?? 'CNY',
    pricingEpoch: 0,
    warningThreshold: config.warningThreshold ?? 10,
    dangerThreshold: config.dangerThreshold ?? 5,
    prices: { ...(config.prices ?? {}) },
    defaultPrices: { ...(config.defaultPrices ?? { cacheHit: 0.1, cacheMiss: 1, output: 2 }) },
  }

  const getConfig = () => runtimeConfig
  let remountCostProjection = () => {}

  const spendFolds = new Map()
  const spendFile = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'storages', 'dsh-credits-spend.json')
  let spendSaveTimer = null
  const scheduleSaveSpend = () => {
    if (spendSaveTimer !== null) return
    spendSaveTimer = setTimeout(() => {
      spendSaveTimer = null
      const sessions = {}
      for (const [sessionId, state] of spendFolds) sessions[sessionId] = state
      mkdir(dirname(spendFile), { recursive: true })
        .then(() => writeFile(spendFile, JSON.stringify({ version: 1, savedAt: Date.now(), sessions })))
        .catch(() => { /* 磁盘不可写时累计仍在内存中 */ })
    }, 800)
  }
  const mergeSpendFold = (sessionId, incoming) => {
    const key = String(sessionId)
    const cur = spendFolds.get(key)
    if (!cur) {
      spendFolds.set(key, incoming)
      return
    }
    spendFolds.set(key, {
      currentModel: cur.currentModel ?? incoming.currentModel,
      last: cur.last ?? incoming.last,
      samples: { ...(incoming.samples ?? {}), ...(cur.samples ?? {}) },
    })
  }
  const ingestSessionEvents = (sessionId, events) => {
    if (!sessionId) return
    let state = initSpendFold()
    for (const event of events ?? []) state = applySpendEvent(state, event)
    spendFolds.set(String(sessionId), state)
    scheduleSaveSpend()
  }
  const ingestLiveEvent = (session, event) => {
    const id = session?.id ?? session?.header?.id
    if (!id || !event) return
    const key = String(id)
    spendFolds.set(key, applySpendEvent(spendFolds.get(key) ?? initSpendFold(), event))
    scheduleSaveSpend()
  }
  const allSpendSamples = () => {
    const out = []
    for (const [sessionId, state] of spendFolds) {
      for (const sample of Object.values(state.samples ?? {})) out.push({ ...sample, sessionId })
    }
    return out
  }

  ctx.effect(() => {
    const off = ctx.on('session/event', (session, event) => ingestLiveEvent(session, event), { global: true })
    return typeof off === 'function' ? off : undefined
  }, 'dsh-credits: spend live')

  ctx.effect(() => {
    let cancelled = false
    void (async () => {
      try {
        const raw = JSON.parse(await readFile(spendFile, 'utf8'))
        if (cancelled) return
        for (const [sessionId, state] of Object.entries(raw.sessions ?? {})) {
          if (state && typeof state === 'object') mergeSpendFold(sessionId, state)
        }
      } catch {
        /* 首次运行没有落盘文件 */
      }
    })()
    return () => { cancelled = true }
  }, 'dsh-credits: spend hydrate')

  ctx.inject(['sessionQuery'], (queryCtx) => {
    queryCtx.effect(() => {
      let cancelled = false
      void (async () => {
        try {
          const records = await queryCtx.sessionQuery.listSessions()
          for (const rec of records ?? []) {
            if (cancelled) return
            const id = rec.header?.id ?? rec.id
            if (!id) continue
            try {
              const snap = await queryCtx.sessionQuery.readSession(id)
              ingestSessionEvents(id, snap.events ?? [])
            } catch {
              /* 单会话回放失败不影响其它 */
            }
          }
        } catch {
          /* 列出会话失败时仍可从 live session/event 累计 */
        }
      })()
      return () => { cancelled = true }
    }, 'dsh-credits: spend backfill')
  })

  /** 经 credentials seam / 环境变量解析一个密钥引用。 */
  const resolveCredential = async (ref) => {
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      try {
        const hit = await credentials.resolve(ref)
        if (hit !== undefined && typeof hit.value === 'string' && hit.value !== '') return hit.value
      } catch {
        /* 解析失败视为未配置 */
      }
    }
    return process.env[ref] ?? ''
  }

  /** 解析 DeepSeek 余额密钥。 */
  const resolveKey = async (overrideKey = null) => {
    if (typeof overrideKey === 'string' && overrideKey !== '') return overrideKey
    if (runtimeConfig.apiKey !== '') return runtimeConfig.apiKey
    return resolveCredential(runtimeConfig.apiKeyRef)
  }

  /** 解析 OpenCode Go 订阅密钥(含 auth.json 回退, 覆盖 Windows 相对目录)。 */
  const resolveOpencodeKey = async (overrideKey = null) => {
    if (typeof overrideKey === 'string' && overrideKey !== '') return overrideKey
    if (runtimeConfig.opencodeApiKey !== '') return runtimeConfig.opencodeApiKey
    const fromCredential = await resolveCredential(runtimeConfig.opencodeApiKeyRef)
    if (fromCredential !== '') return fromCredential
    try {
      const authPath = join(homedir(), '.local', 'share', 'opencode', 'auth.json')
      const raw = JSON.parse(await readFile(authPath, 'utf8'))
      const entry = raw['opencode-go'] ?? raw['opencode']
      if (entry && entry.type === 'api' && typeof entry.key === 'string' && entry.key !== '') return entry.key
    } catch {
      /* 没有 auth.json / 没有 Go 条目: 视为未配置 */
    }
    return ''
  }

  const emptyQuotaCache = () => ({ state: 'empty', payload: null, error: null, fetchedAt: 0, lastErrorAt: 0 })
  const caches = {
    deepseek: emptyQuotaCache(),
    'opencode-go': emptyQuotaCache(),
  }
  const inflights = { deepseek: null, 'opencode-go': null }
  const consecutiveFailures = { deepseek: 0, 'opencode-go': 0 }

  const refreshOne = (provider) => {
    const source = quotaSourceFromProvider(provider)
    if (inflights[source] !== null) return inflights[source]
    inflights[source] = (async () => {
      const key = source === 'opencode-go' ? await resolveOpencodeKey() : await resolveKey()
      if (key === '') {
        caches[source] = { state: 'error', payload: null, error: 'api-key-missing', fetchedAt: 0, lastErrorAt: Date.now() }
        consecutiveFailures[source]++
        return
      }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), runtimeConfig.timeoutMs)
      try {
        if (source === 'opencode-go') {
          const res = await fetch(runtimeConfig.opencodeBaseUrl.replace(/\/+$/, ''), {
            headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
            signal: controller.signal,
          })
          if (!res.ok) throw new Error(`OpenCode Go API HTTP ${res.status}`)
          const data = await res.json()
          caches[source] = {
            state: 'ok',
            payload: { provider: 'opencode-go', usage: normalizeOpencodeUsage(data) },
            error: null,
            fetchedAt: Date.now(),
            lastErrorAt: 0,
          }
        } else {
          const res = await fetch(`${runtimeConfig.baseUrl.replace(/\/+$/, '')}/user/balance`, {
            headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
            signal: controller.signal,
          })
          if (!res.ok) throw new Error(`DeepSeek API HTTP ${res.status}`)
          const data = await res.json()
          caches[source] = {
            state: 'ok',
            payload: {
              provider: 'deepseek',
              isAvailable: data?.is_available === true,
              balances: normalizeBalances(data),
            },
            error: null,
            fetchedAt: Date.now(),
            lastErrorAt: 0,
          }
        }
        consecutiveFailures[source] = 0
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        consecutiveFailures[source]++
        if (consecutiveFailures[source] === 1) ctx.logger.warn(`[dsh-credits] quota fetch failed (${source}): ${message}`)
        const prev = caches[source]
        caches[source] = {
          state: prev.state === 'ok' ? 'ok' : 'error',
          payload: prev.payload,
          error: message,
          fetchedAt: prev.fetchedAt,
          lastErrorAt: Date.now(),
        }
      } finally {
        clearTimeout(timer)
      }
    })().finally(() => {
      inflights[source] = null
    })
    return inflights[source]
  }

  const refresh = (provider = null) => {
    if (runtimeConfig.enabled === false) return Promise.resolve()
    if (provider) return refreshOne(provider)
    return Promise.all([refreshOne('deepseek'), refreshOne('opencode-go')])
  }

  let loopTimer = null
  const resetLoop = () => {
    if (loopTimer !== null) {
      clearTimeout(loopTimer)
      loopTimer = null
    }
    const run = () => {
      if (runtimeConfig.enabled === false) {
        loopTimer = null
        return
      }
      void refresh().then(() => {
        const bothMissing = PROVIDERS.every((p) => caches[p].state === 'error' && caches[p].error === 'api-key-missing')
        const delay = bothMissing ? 5000 : runtimeConfig.refreshIntervalMs
        loopTimer = setTimeout(run, delay)
      })
    }
    loopTimer = setTimeout(run, 1000)
  }

  ctx.effect(() => {
    resetLoop()
    return () => {
      if (loopTimer !== null) clearTimeout(loopTimer)
    }
  }, 'dsh-credits: refresh loop')

  const maskKey = (k) => {
    if (!k || typeof k !== 'string') return ''
    if (k.length <= 8) return '********'
    return k.slice(0, 4) + '****' + k.slice(-4)
  }

  const getSanitizedConfig = () => {
    return {
      enabled: runtimeConfig.enabled !== false,
      quotaMode: runtimeConfig.quotaMode === 'custom' ? 'custom' : 'follow',
      showDock: runtimeConfig.showDock !== false,
      dockLayout: normalizeDockLayout(runtimeConfig.dockLayout),
      showCapsule: runtimeConfig.showCapsule !== false,
      showPopover: runtimeConfig.showPopover !== false,
      showTps: runtimeConfig.showTps !== false,
      provider: runtimeConfig.provider,
      hasCustomKey: Boolean(runtimeConfig.apiKey),
      apiKeyMasked: maskKey(runtimeConfig.apiKey),
      apiKeyRef: runtimeConfig.apiKeyRef,
      baseUrl: runtimeConfig.baseUrl,
      hasOpencodeCustomKey: Boolean(runtimeConfig.opencodeApiKey),
      opencodeApiKeyMasked: maskKey(runtimeConfig.opencodeApiKey),
      opencodeApiKeyRef: runtimeConfig.opencodeApiKeyRef,
      opencodeBaseUrl: runtimeConfig.opencodeBaseUrl,
      refreshIntervalMs: runtimeConfig.refreshIntervalMs,
      clientPollIntervalMs: runtimeConfig.clientPollIntervalMs,
      timeoutMs: runtimeConfig.timeoutMs,
      currency: runtimeConfig.currency,
      warningThreshold: runtimeConfig.warningThreshold,
      dangerThreshold: runtimeConfig.dangerThreshold,
      prices: { ...runtimeConfig.prices },
      defaultPrices: { ...runtimeConfig.defaultPrices },
    }
  }

  // 可选 webServer: 提供浏览器读取的缓存端点与设置端点
  ctx.inject(['webServer'], (webCtx) => {
    const serializeView = (source) => {
      const cache = caches[source]
      if (cache.state === 'ok' && cache.payload?.provider === source) {
        if (source === 'opencode-go') {
          return {
            ok: true,
            provider: source,
            usage: cache.payload.usage,
            fetchedAt: cache.fetchedAt,
            ...(cache.error !== null ? { error: cache.error, stale: true } : {}),
          }
        }
        return {
          ok: true,
          provider: source,
          isAvailable: cache.payload.isAvailable,
          balances: cache.payload.balances,
          fetchedAt: cache.fetchedAt,
          ...(cache.error !== null ? { error: cache.error, stale: true } : {}),
        }
      }
      return {
        ok: false,
        provider: source,
        error: cache.error ?? 'unknown',
        fetchedAt: cache.fetchedAt,
      }
    }

    const serialize = (source = quotaSourceFromProvider(runtimeConfig.provider)) => {
      const picked = quotaSourceFromProvider(source)
      const view = serializeView(picked)
      return {
        ok: view.ok,
        enabled: runtimeConfig.enabled !== false,
        provider: picked,
        defaultProvider: quotaSourceFromProvider(runtimeConfig.provider),
        quotaMode: runtimeConfig.quotaMode === 'custom' ? 'custom' : 'follow',
        showDock: runtimeConfig.showDock !== false,
        dockLayout: normalizeDockLayout(runtimeConfig.dockLayout),
        showCapsule: runtimeConfig.showCapsule !== false,
        showPopover: runtimeConfig.showPopover !== false,
        showTps: runtimeConfig.showTps !== false,
        fetchedAt: view.fetchedAt,
        refreshIntervalMs: runtimeConfig.refreshIntervalMs,
        clientPollIntervalMs: runtimeConfig.clientPollIntervalMs,
        currency: runtimeConfig.currency,
        pricingEpoch: Number(runtimeConfig.pricingEpoch ?? 0),
        thresholds: {
          warning: runtimeConfig.warningThreshold,
          danger: runtimeConfig.dangerThreshold,
        },
        prices: {
          ...runtimeConfig.prices,
          'deepseek-v4-flash': resolveModelPrice(runtimeConfig, 'deepseek-v4-flash'),
          'deepseek-v4-pro': resolveModelPrice(runtimeConfig, 'deepseek-v4-pro'),
        },
        defaultPrices: runtimeConfig.defaultPrices,
        views: {
          deepseek: serializeView('deepseek'),
          'opencode-go': serializeView('opencode-go'),
        },
        ...(view.usage ? { usage: view.usage } : {}),
        ...(view.balances ? { isAvailable: view.isAvailable, balances: view.balances } : {}),
        ...(view.error ? { error: view.error, ...(view.stale ? { stale: true } : {}) } : {}),
      }
    }

    const sendJson = (res, statusCode, data) => {
      const body = JSON.stringify(data)
      res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(body),
      })
      res.end(body)
    }

    // 1. 余额查询缓存路由
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: '/query-credits',
      async handler(req, res) {
        if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST') {
          res.writeHead(405, { Allow: 'GET, HEAD, POST' })
          res.end()
          return
        }
        const parsedUrl = new URL(req.url ?? '/', 'http://127.0.0.1')
        const force = parsedUrl.searchParams.get('force') === '1' || parsedUrl.searchParams.get('force') === 'true' || req.method === 'POST'
        const sourceParam = parsedUrl.searchParams.get('source')
        const source = sourceParam
          ? quotaSourceFromProvider(sourceParam)
          : quotaSourceFromProvider(runtimeConfig.provider)
        if (force) {
          const now = Date.now()
          const targets = sourceParam ? [source] : PROVIDERS
          await Promise.all(targets.map((p) => {
            const c = caches[p]
            if (now - c.fetchedAt > 2000 || c.state !== 'ok') return refreshOne(p)
            return Promise.resolve()
          }))
        }
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
          res.end()
          return
        }
        sendJson(res, 200, serialize(source))
      },
    }), 'dsh-credits: route')

    // 2. 可视化配置读写路由 (/query-credits/config)
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: '/query-credits/config',
      async handler(req, res) {
        if (req.method === 'GET') {
          sendJson(res, 200, {
            ok: true,
            config: getSanitizedConfig(),
          })
          return
        }
        if (req.method === 'POST') {
          try {
            const body = await readJsonBody(req)
            // 局部合并与类型校验
            if (typeof body.enabled === 'boolean') runtimeConfig.enabled = body.enabled
            if (runtimeConfig.enabled !== false) {
              if (typeof body.quotaMode === 'string' && QUOTA_MODES.includes(body.quotaMode)) runtimeConfig.quotaMode = body.quotaMode
              if (typeof body.showDock === 'boolean') runtimeConfig.showDock = body.showDock
              if (typeof body.dockLayout === 'string' && DOCK_LAYOUTS.includes(body.dockLayout)) runtimeConfig.dockLayout = body.dockLayout
              if (typeof body.showCapsule === 'boolean') runtimeConfig.showCapsule = body.showCapsule
              if (typeof body.showPopover === 'boolean') runtimeConfig.showPopover = body.showPopover
              if (typeof body.showTps === 'boolean') runtimeConfig.showTps = body.showTps
              if (typeof body.provider === 'string' && PROVIDERS.includes(body.provider)) runtimeConfig.provider = body.provider
              if (typeof body.apiKey === 'string') runtimeConfig.apiKey = body.apiKey.trim()
              if (typeof body.apiKeyRef === 'string' && body.apiKeyRef.trim()) runtimeConfig.apiKeyRef = body.apiKeyRef.trim()
              if (typeof body.baseUrl === 'string' && body.baseUrl.trim()) runtimeConfig.baseUrl = body.baseUrl.trim()
              if (typeof body.opencodeApiKey === 'string') runtimeConfig.opencodeApiKey = body.opencodeApiKey.trim()
              if (typeof body.opencodeApiKeyRef === 'string' && body.opencodeApiKeyRef.trim()) runtimeConfig.opencodeApiKeyRef = body.opencodeApiKeyRef.trim()
              if (typeof body.opencodeBaseUrl === 'string' && body.opencodeBaseUrl.trim()) runtimeConfig.opencodeBaseUrl = body.opencodeBaseUrl.trim()
              if (typeof body.warningThreshold === 'number' && body.warningThreshold >= 0) runtimeConfig.warningThreshold = body.warningThreshold
              if (typeof body.dangerThreshold === 'number' && body.dangerThreshold >= 0) runtimeConfig.dangerThreshold = body.dangerThreshold
              if (typeof body.refreshIntervalMs === 'number' && body.refreshIntervalMs >= 1000) runtimeConfig.refreshIntervalMs = body.refreshIntervalMs
              if (typeof body.clientPollIntervalMs === 'number' && body.clientPollIntervalMs >= 1000) runtimeConfig.clientPollIntervalMs = body.clientPollIntervalMs
              if (typeof body.timeoutMs === 'number' && body.timeoutMs >= 1000) runtimeConfig.timeoutMs = body.timeoutMs
              if (typeof body.currency === 'string' && body.currency.trim()) runtimeConfig.currency = body.currency.trim().toUpperCase()
            }
            // 总开关只停用额度相关功能；模型单价与 YAML 导出仍然可独立使用。
            if (body.prices && typeof body.prices === 'object') {
              runtimeConfig.prices = { ...body.prices }
            }
            if (body.defaultPrices && typeof body.defaultPrices === 'object') {
              runtimeConfig.defaultPrices = { ...runtimeConfig.defaultPrices, ...body.defaultPrices }
            }
            runtimeConfig.pricingEpoch = Number(runtimeConfig.pricingEpoch ?? 0) + 1
            try { remountCostProjection() } catch { /* 宿主可能拒绝同 key 重挂; 客户端按最新单价重算 */ }

            // 配置变更后重设刷新循环并立即拉取一次最新数据
            resetLoop()
            await refresh()

            sendJson(res, 200, {
              ok: true,
              message: 'Config updated successfully',
              config: getSanitizedConfig(),
            })
          } catch (err) {
            sendJson(res, 400, {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            })
          }
          return
        }
        res.writeHead(405, { Allow: 'GET, POST' })
        res.end()
      },
    }), 'dsh-credits: config route')

    // 3. API 连通性测试路由 (/query-credits/test-connection)
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: '/query-credits/test-connection',
      async handler(req, res) {
        if (req.method !== 'POST') {
          res.writeHead(405, { Allow: 'POST' })
          res.end()
          return
        }
        try {
          const body = await readJsonBody(req)
          const provider = typeof body.provider === 'string' && PROVIDERS.includes(body.provider)
            ? body.provider
            : runtimeConfig.provider
          if (provider === 'opencode-go') {
            const targetUrl = (typeof body.opencodeBaseUrl === 'string' && body.opencodeBaseUrl.trim() ? body.opencodeBaseUrl.trim() : runtimeConfig.opencodeBaseUrl).replace(/\/+$/, '')
            const key = await resolveOpencodeKey(typeof body.opencodeApiKey === 'string' && body.opencodeApiKey ? body.opencodeApiKey.trim() : null)
            if (!key) {
              sendJson(res, 400, { ok: false, error: 'opencode-api-key-missing' })
              return
            }
            const timeout = typeof body.timeoutMs === 'number' && body.timeoutMs > 0 ? body.timeoutMs : runtimeConfig.timeoutMs
            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), timeout)
            try {
              const apiRes = await fetch(targetUrl, {
                headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
                signal: controller.signal,
              })
              if (!apiRes.ok) {
                sendJson(res, 200, { ok: false, error: `OpenCode Go API HTTP ${apiRes.status}` })
                return
              }
              const data = await apiRes.json()
              sendJson(res, 200, {
                ok: true,
                provider: 'opencode-go',
                usage: normalizeOpencodeUsage(data),
              })
            } finally {
              clearTimeout(timer)
            }
            return
          }
          const targetUrl = (typeof body.baseUrl === 'string' && body.baseUrl.trim() ? body.baseUrl.trim() : runtimeConfig.baseUrl).replace(/\/+$/, '')
          const key = await resolveKey(typeof body.apiKey === 'string' && body.apiKey ? body.apiKey.trim() : null)
          if (!key) {
            sendJson(res, 400, { ok: false, error: 'api-key-missing' })
            return
          }
          const timeout = typeof body.timeoutMs === 'number' && body.timeoutMs > 0 ? body.timeoutMs : runtimeConfig.timeoutMs
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), timeout)
          try {
            const apiRes = await fetch(`${targetUrl}/user/balance`, {
              headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
              signal: controller.signal,
            })
            if (!apiRes.ok) {
              sendJson(res, 200, { ok: false, error: `DeepSeek API HTTP ${apiRes.status}` })
              return
            }
            const data = await apiRes.json()
            sendJson(res, 200, {
              ok: true,
              provider: 'deepseek',
              isAvailable: data?.is_available === true,
              balances: normalizeBalances(data),
            })
          } finally {
            clearTimeout(timer)
          }
        } catch (err) {
          sendJson(res, 200, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      },
    }), 'dsh-credits: test connection route')

    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: '/query-credits/spend',
      async handler(req, res) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405, { Allow: 'GET, HEAD' })
          res.end()
          return
        }
        const parsedUrl = new URL(req.url ?? '/', 'http://127.0.0.1')
        const window = resolveSpendRange(
          parsedUrl.searchParams.get('range'),
          parsedUrl.searchParams.get('from'),
          parsedUrl.searchParams.get('to'),
        )
        if (!window.ok) {
          sendJson(res, 400, { ok: false, error: window.error })
          return
        }
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
          res.end()
          return
        }
        const agg = aggregateSpend(allSpendSamples(), getConfig(), window.from, window.to)
        sendJson(res, 200, {
          ok: true,
          range: window.range,
          from: window.from,
          to: window.to,
          currency: agg.currency,
          cost: agg.cost,
          costByModel: agg.costByModel,
          tokens: agg.tokens,
          calls: agg.calls,
          sessions: agg.sessions,
        })
      },
    }), 'dsh-credits: spend route')
  })

  // 可选 sessionProjections: 会话花费投影 (使用动态 getter)
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    let disposers = []
    let stateVersion = 2
    const mount = () => {
      for (const dispose of disposers) {
        if (typeof dispose === 'function') {
          try { dispose() } catch { /* 旧单元卸载失败时仍注册新单元 */ }
        }
      }
      disposers = []
      // 保持 queryCreditsCost 最后注册，兼容宿主按最近注册单元读取的旧实现。
      for (const unit of [makeTpsProjection(), makeCostProjection(getConfig)]) {
        unit.stateVersion = stateVersion
        const ret = projectionCtx.sessionProjections.register(unit)
        const dispose = typeof ret === 'function'
          ? ret
          : (ret && typeof ret.dispose === 'function' ? () => ret.dispose() : null)
        if (dispose) disposers.push(dispose)
      }
    }
    remountCostProjection = () => {
      stateVersion += 1
      mount()
    }
    mount()
  })
}
