/**
 * dsh-credits — server half.
 *
 * 1. 额度服务: 按 `refreshIntervalMs` 从所选数据源拉取额度并缓存, 通过 HTTP 路由
 *    `/query-credits` 提供给浏览器(浏览器只读缓存, 不打上游 API)。
 *    - provider=deepseek:      DeepSeek `/user/balance` 官方余额
 *    - provider=opencode-go:   OpenCode Go 订阅用量 `/zen/go/v1/usage`
 *    DeepSeek 密钥优先取 `apiKey`, 否则经 credentials 解析 `apiKeyRef`; OpenCode Go
 *    密钥优先取 `opencodeApiKey`, 再经 credentials/环境变量解析 `opencodeApiKeyRef`,
 *    最后回退读取 OpenCode CLI 的 `~/.local/share/opencode/auth.json`。
 * 2. 会话花费投影: 注册 `sessionProjections` 单元 `queryCreditsCost`, 在已提交的
 *    会话事件上按模型折叠 token 用量, 用配置中的单价估算本会话消耗。
 *
 * 投影折叠规则与 dsh-token-meter 的 tokenUsage 一致(同 (turn,step) 的样本替换
 * 而非重复计数); 模型取自 `request/header` / `request/context`(last-wins)。
 */
import Schema from '@deepseek-ai/schemastery'
import { z } from 'zod'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolveModelPrice, priceBuckets } from './pricing.js'
import { applySpendEvent, aggregateSpend, initSpendFold, resolveSpendRange } from './spend.js'

export { resolveModelPrice } from './pricing.js'
export const name = 'dsh-credits'

/** 支持的额度数据源。 */
export const PROVIDERS = ['deepseek', 'opencode-go']
export const OPENCODE_GO_DEFAULT_BASE_URL = 'https://opencode.ai/zen/go/v1/usage'

/** 每个模型每 100 万 token 的价格(以 `currency` 计价)。 */
const ModelPrice = Schema.object({
  /** 缓存命中输入价 */
  cacheHit: Schema.number().min(0).default(0.2),
  /** 缓存未命中输入价(含缓存写入) */
  cacheMiss: Schema.number().min(0).default(2),
  /** 输出价 */
  output: Schema.number().min(0).default(8),
})

export const Config = Schema.object({
  /** 额度数据源: deepseek = DeepSeek 官方余额; opencode-go = OpenCode Go 订阅用量 */
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
  prices: Schema.dict(ModelPrice).default({
    'deepseek-v4-flash': { cacheHit: 0.02, cacheMiss: 1, output: 2 },
    'deepseek-v4-pro': { cacheHit: 0.025, cacheMiss: 3, output: 6 },
  }),
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

  return {
    key: 'queryCreditsCost',
    schema: z.object({
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
    }).strict(),
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
    view: (state) => {
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
    },
    stateVersion: 2,
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

  let cache = { state: 'empty', payload: null, error: null, fetchedAt: 0, lastErrorAt: 0 }
  let inflight = null
  let consecutiveFailures = 0

  const refresh = () => {
    if (inflight !== null) return inflight
    inflight = (async () => {
      const provider = runtimeConfig.provider === 'opencode-go' ? 'opencode-go' : 'deepseek'
      const key = provider === 'opencode-go' ? await resolveOpencodeKey() : await resolveKey()
      if (key === '') {
        cache = { state: 'error', payload: null, error: 'api-key-missing', fetchedAt: 0, lastErrorAt: Date.now() }
        consecutiveFailures++
        return
      }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), runtimeConfig.timeoutMs)
      try {
        if (provider === 'opencode-go') {
          const res = await fetch(runtimeConfig.opencodeBaseUrl.replace(/\/+$/, ''), {
            headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
            signal: controller.signal,
          })
          if (!res.ok) throw new Error(`OpenCode Go API HTTP ${res.status}`)
          const data = await res.json()
          cache = {
            state: 'ok',
            payload: {
              provider: 'opencode-go',
              usage: normalizeOpencodeUsage(data),
            },
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
          cache = {
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
        consecutiveFailures = 0
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        consecutiveFailures++
        if (consecutiveFailures === 1) ctx.logger.warn(`[dsh-credits] quota fetch failed (${provider}): ${message}`)
        // 保留上次成功值(stale-while-error), 仅标记错误。
        cache = {
          state: cache.state === 'ok' ? 'ok' : 'error',
          payload: cache.payload,
          error: message,
          fetchedAt: cache.fetchedAt,
          lastErrorAt: Date.now(),
        }
      } finally {
        clearTimeout(timer)
      }
    })().finally(() => {
      inflight = null
    })
    return inflight
  }

  let loopTimer = null
  const resetLoop = () => {
    if (loopTimer !== null) {
      clearTimeout(loopTimer)
      loopTimer = null
    }
    const run = () => {
      void refresh().then(() => {
        const missingKey = cache.state === 'error' && cache.error === 'api-key-missing'
        const delay = missingKey ? 5000 : runtimeConfig.refreshIntervalMs
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
    const serialize = () => {
      const provider = runtimeConfig.provider === 'opencode-go' ? 'opencode-go' : 'deepseek'
      const base = {
        ok: cache.state === 'ok',
        provider,
        fetchedAt: cache.fetchedAt,
        refreshIntervalMs: runtimeConfig.refreshIntervalMs,
        clientPollIntervalMs: runtimeConfig.clientPollIntervalMs,
        currency: runtimeConfig.currency,
        pricingEpoch: Number(runtimeConfig.pricingEpoch ?? 0),
        thresholds: {
          warning: runtimeConfig.warningThreshold,
          danger: runtimeConfig.dangerThreshold,
        },
        // 定价表随响应动态下发 (内置 8月17日谷峰费率自动切换规则), 供客户端 "?" 图标展示
        prices: {
          ...runtimeConfig.prices,
          'deepseek-v4-flash': resolveModelPrice(runtimeConfig, 'deepseek-v4-flash'),
          'deepseek-v4-pro': resolveModelPrice(runtimeConfig, 'deepseek-v4-pro'),
        },
        defaultPrices: runtimeConfig.defaultPrices,
      }
      if (cache.state === 'ok' && cache.payload?.provider === provider) {
        if (cache.payload.provider === 'opencode-go') {
          return {
            ...base,
            usage: cache.payload.usage,
            ...(cache.error !== null ? { error: cache.error, stale: true } : {}),
          }
        }
        return {
          ...base,
          isAvailable: cache.payload.isAvailable,
          balances: cache.payload.balances,
          ...(cache.error !== null ? { error: cache.error, stale: true } : {}),
        }
      }
      return { ...base, error: cache.error ?? 'unknown' }
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
        if (force) {
          // 冷却防刷保护: 距离上次主动拉取至少间隔 2000ms
          const now = Date.now()
          if (now - cache.fetchedAt > 2000 || cache.state !== 'ok') {
            await refresh()
          }
        }
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
          res.end()
          return
        }
        sendJson(res, 200, serialize())
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
    let dispose = null
    let stateVersion = 2
    const mount = () => {
      if (typeof dispose === 'function') {
        try { dispose() } catch { /* 旧单元卸载失败时仍注册新单元 */ }
      }
      const unit = makeCostProjection(getConfig)
      unit.stateVersion = stateVersion
      const ret = projectionCtx.sessionProjections.register(unit)
      dispose = typeof ret === 'function'
        ? ret
        : (ret && typeof ret.dispose === 'function' ? () => ret.dispose() : null)
    }
    remountCostProjection = () => {
      stateVersion += 1
      mount()
    }
    mount()
  })
}

