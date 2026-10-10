/**
 * dsh-credits — server half.
 *
 * 1. 额度服务: 按 `refreshIntervalMs` 并行缓存已启用的余额 / 订阅额度源，
 *    通过 HTTP 路由 `/query-credits` 提供给浏览器（浏览器只读缓存）。每个 DSH
 *    供应商通过 `providerQuotas` 独立选择额度来源、凭证与缓存；未配置时不显示额度。
 *    DeepSeek 密钥优先取 `apiKey`, 否则经 credentials 解析 `apiKeyRef`; OpenCode Go
 *    密钥优先取 `opencodeApiKey`, 再经 credentials/环境变量解析 `opencodeApiKeyRef`,
 *    最后回退读取 OpenCode CLI 的 `~/.local/share/opencode/auth.json`。
 * 2. 会话投影: 注册 `queryCreditsCost` 花费单元与 `liveTokenUsage` TPS 单元；二者
 *    从 Session v2 的 assistant settlement 及其压缩流读取精确用量和生成吞吐。
 *
 * 投影折叠规则与 dsh-token-meter 的 tokenUsage 一致：同一次尝试的 settlement
 * 替换，`llm/retry-started` 后的新尝试累加；模型取 request 事件(last-wins)。
 */
import Schema from '@deepseek-ai/schemastery'
import { z } from 'zod'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { priceBuckets, officialV4ConfigPrices, normalizePricingCurrency, HOLIDAY_CALENDAR } from './pricing.js'
import { buildPricingCandidates, fetchOfficialPricing } from './pricing-source.js'
import { applySpendEvent, aggregateSpend, initSpendFold, resolveSpendRange, usageOfSettlement } from './spend.js'

export { resolveModelPrice, resolveModelPriceInfo, familyModelFor } from './pricing.js'
export const name = 'dsh-credits'

/** 支持的额度数据源。 */
export const PROVIDERS = ['deepseek', 'opencode-go']
export const QUOTA_MODES = ['follow', 'custom']
export const DOCK_LAYOUTS = ['own', 'shared']
export const OPENCODE_GO_DEFAULT_BASE_URL = 'https://opencode.ai/zen/go/v1/usage'
export const DEFAULT_REFRESH_INTERVAL_MS = 300000

/** 默认阈值：百分比模式统一 30% / 10%；金额模式按计价货币给默认值（USD 2 / 0.5，其它 10 / 5）。 */
export const defaultThresholdsFor = (mode, currency) => {
  if (mode === 'percent') return { warning: 30, danger: 10 }
  return normalizePricingCurrency(currency) === 'USD'
    ? { warning: 2, danger: 0.5 }
    : { warning: 10, danger: 5 }
}

/**
 * 内置额度源适配器注册表。
 * - `kind: 'balance'` 表示余额型（DeepSeek /user/balance 风格）
 * - `kind: 'usage'` 表示订阅用量型（OpenCode Go 多窗口百分比风格）
 * - `providerIds` 是自动匹配时识别当前模型供应商的规则（阶段 3 会全面启用）
 * - `default: true` 表示无法识别当前模型时使用的默认额度源
 */
export const BUILTIN_QUOTA_ADAPTERS = [
  {
    id: 'deepseek',
    kind: 'balance',
    name: 'DeepSeek 官方余额',
    providerIds: ['deepseek', 'deepseek-official'],
    default: true,
  },
  {
    id: 'opencode-go',
    kind: 'usage',
    name: 'OpenCode Go 订阅用量',
    providerIds: ['opencode-go'],
    default: false,
  },
]
export const QUOTA_ADAPTER_IDS = BUILTIN_QUOTA_ADAPTERS.map((adapter) => adapter.id)

/**
 * 可在设置页一键创建的额度源模板。
 *
 * 模板只保存公开的接口形状，不保存密钥；`authRef` 指向 DSH credentials 或环境变量。
 * 套餐接口的响应结构不适合让用户手写 JSONPath，因此由 `template` 对应的解析器处理。
 */
export const QUOTA_SOURCE_TEMPLATES = [
  {
    id: 'deepseek',
    category: 'balance',
    name: 'DeepSeek 官方余额',
    description: '查询 DeepSeek 官方账户余额（CNY / USD）',
    builtin: true,
    source: {
      id: 'deepseek', name: 'DeepSeek 官方余额', kind: 'balance', providerIds: ['deepseek', 'deepseek-official'],
      request: { url: 'https://api.deepseek.com/user/balance', authRef: 'DEEPSEEK_API_KEY', authStyle: 'bearer' },
      template: 'deepseek',
    },
  },
  {
    id: 'deepseek-account',
    category: 'balance',
    name: 'DeepSeek 登录账号余额',
    description: '复用 DSH 登录账号，查询充值与赠送余额，无需 API Key',
    source: {
      id: 'deepseek-account', name: 'DeepSeek 登录账号余额', kind: 'balance', providerIds: ['deepseek-account'],
      template: 'deepseek-account',
    },
  },
  {
    id: 'opencode-go',
    category: 'subscription',
    name: 'OpenCode Go 订阅用量',
    description: '查询 OpenCode Go 的 5 小时、每周与每月用量窗口',
    builtin: true,
    source: {
      id: 'opencode-go', name: 'OpenCode Go 订阅用量', kind: 'usage', providerIds: ['opencode-go'],
      request: { url: OPENCODE_GO_DEFAULT_BASE_URL, authRef: 'OPENCODE_GO_API_KEY', authStyle: 'bearer' },
      template: 'opencode-go',
    },
  },
  {
    id: 'stepfun-balance',
    category: 'balance',
    name: 'StepFun 余额',
    description: '查询阶跃星辰账户余额（CNY）',
    source: {
      id: 'stepfun', name: 'StepFun 余额', kind: 'metric', providerIds: ['stepfun'],
      request: { url: 'https://api.stepfun.com/v1/accounts', authRef: 'STEPFUN_API_KEY', authStyle: 'bearer' },
      response: { metrics: [{ key: 'balance', label: '账户余额', calculation: 'direct', valuePath: '$.balance', unit: 'CNY' }] },
    },
  },
  {
    id: 'openrouter-balance',
    category: 'balance',
    name: 'OpenRouter 余额',
    description: '用总充值减去总用量得到可用余额（USD）',
    source: {
      id: 'openrouter', name: 'OpenRouter 余额', kind: 'metric', providerIds: ['openrouter'],
      request: { url: 'https://openrouter.ai/api/v1/credits', authRef: 'OPENROUTER_API_KEY', authStyle: 'bearer' },
      response: { metrics: [{ key: 'credits', label: '可用余额', calculation: 'subtract', usedPath: '$.data.total_usage', totalPath: '$.data.total_credits', unit: 'USD' }] },
    },
  },
  {
    id: 'novita-balance',
    category: 'balance',
    name: 'Novita AI 余额',
    description: '查询 Novita AI 可用余额（USD）',
    source: {
      id: 'novita', name: 'Novita AI 余额', kind: 'metric', providerIds: ['novita', 'novita-ai'],
      request: { url: 'https://api.novita.ai/v3/user/balance', authRef: 'NOVITA_API_KEY', authStyle: 'bearer' },
      response: { metrics: [{ key: 'balance', label: '可用余额', calculation: 'direct', valuePath: '$.availableBalance', scale: 0.0001, unit: 'USD' }] },
    },
  },
  {
    id: 'kimi-coding',
    category: 'subscription',
    name: 'Kimi For Coding',
    description: '自动解析 5 小时与周用量窗口',
    source: {
      id: 'kimi-coding', name: 'Kimi For Coding 套餐', kind: 'usage', providerIds: ['kimi', 'kimi-coding'],
      request: { url: 'https://api.kimi.com/coding/v1/usages', authRef: 'KIMI_API_KEY', authStyle: 'bearer' },
    },
  },
  {
    id: 'zhipu-cn-coding',
    category: 'subscription',
    name: '智谱 GLM Coding',
    description: '解析国内站 5 小时与周用量窗口',
    source: {
      id: 'zhipu-coding', name: '智谱 GLM Coding 套餐', kind: 'usage', providerIds: ['zhipu', 'glm', 'bigmodel'],
      request: { url: 'https://open.bigmodel.cn/api/monitor/usage/quota/limit', authRef: 'ZHIPU_API_KEY', authStyle: 'header', authHeader: 'Authorization' },
    },
  },
  {
    id: 'zhipu-en-coding',
    category: 'subscription',
    name: 'Z.AI Coding Plan',
    description: '解析国际站 5 小时与周用量窗口',
    source: {
      id: 'zai-coding', name: 'Z.AI Coding Plan', kind: 'usage', providerIds: ['zai', 'z.ai'],
      request: { url: 'https://api.z.ai/api/monitor/usage/quota/limit', authRef: 'ZAI_API_KEY', authStyle: 'header', authHeader: 'Authorization' },
    },
  },
  {
    id: 'minimax-cn-coding',
    category: 'subscription',
    name: 'MiniMax Coding Plan（国内）',
    description: '解析国内站 5 小时与周用量窗口',
    source: {
      id: 'minimax-coding', name: 'MiniMax Coding Plan', kind: 'usage', providerIds: ['minimax', 'minimaxi'],
      request: { url: 'https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains', authRef: 'MINIMAX_API_KEY', authStyle: 'bearer' },
    },
  },
  {
    id: 'minimax-en-coding',
    category: 'subscription',
    name: 'MiniMax Coding Plan（国际）',
    description: '解析国际站 5 小时与周用量窗口',
    source: {
      id: 'minimax-en-coding', name: 'MiniMax Coding Plan', kind: 'usage', providerIds: ['minimax-en'],
      request: { url: 'https://api.minimax.io/v1/api/openplatform/coding_plan/remains', authRef: 'MINIMAX_API_KEY', authStyle: 'bearer' },
    },
  },
]

export const getQuotaSourceTemplate = (id) =>
  QUOTA_SOURCE_TEMPLATES.find((template) => template.id === id) ?? null

/** DSH 供应商路由 / Base URL → 本插件额度模板。 */
export const matchQuotaTemplateForProvider = (provider, baseURL = '') => {
  const id = normalizeProvider(provider)
  if (id === 'deepseek-account') return { builtin: false, id: 'deepseek-account' }
  let url
  try { url = new URL(baseURL) } catch { /* No recognized endpoint: fall back to provider ID. */ }
  const host = url?.hostname.toLowerCase()
  const byUrl = [
    ['api.deepseek.com', 'deepseek'],
    ['opencode.ai', 'opencode-go', '/zen/go'],
    ['api.stepfun.com', 'stepfun-balance'],
    ['openrouter.ai', 'openrouter-balance'],
    ['api.novita.ai', 'novita-balance'],
    ['api.kimi.com', 'kimi-coding', '/coding'],
    ['open.bigmodel.cn', 'zhipu-cn-coding'],
    ['api.z.ai', 'zhipu-en-coding'],
    ['api.minimaxi.com', 'minimax-cn-coding'],
    ['api.minimax.io', 'minimax-en-coding'],
  ].find(([domain, , prefix]) => host === domain && (!prefix || url.pathname === prefix || url.pathname.startsWith(prefix + '/')))
  if (byUrl) return { builtin: ['deepseek', 'opencode-go'].includes(byUrl[1]), id: byUrl[1] }
  const direct = QUOTA_SOURCE_TEMPLATES.find((template) =>
    (template.source.providerIds ?? []).some((candidate) => normalizeProvider(candidate) === id))
  return direct ? { builtin: direct.builtin === true, id: direct.id } : null
}

const mergeQuotaSourceTemplate = (source = {}) => {
  const template = getQuotaSourceTemplate(source.template)
  if (!template) return source
  const defaults = template.source
  return {
    ...defaults,
    ...source,
    template: template.id,
    providerIds: source.providerIds ?? defaults.providerIds ?? [],
    providerPatterns: source.providerPatterns ?? defaults.providerPatterns ?? [],
    request: { ...(defaults.request ?? {}), ...(source.request ?? {}) },
    response: {
      ...(defaults.response ?? {}),
      ...(source.response ?? {}),
      metrics: source.response?.metrics ?? defaults.response?.metrics ?? [],
      windows: source.response?.windows ?? defaults.response?.windows ?? [],
    },
  }
}

const normalizeQuotaSourceConfig = (source) => {
  if (!source || typeof source !== 'object') throw new Error('quota-source-invalid')
  const merged = mergeQuotaSourceTemplate(source)
  const id = String(merged.id ?? '').trim()
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(id)) throw new Error('quota-source-id-invalid')
  const kind = String(merged.kind ?? '').trim().toLowerCase()
  if (!['balance', 'usage', 'metric'].includes(kind)) throw new Error('quota-source-kind-invalid')
  const rawUrl = String(merged.request?.url ?? '').trim()
  let parsed
  try { parsed = new URL(rawUrl) } catch { throw new Error('quota-url-invalid') }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('quota-url-invalid')
  if (parsed.username || parsed.password) throw new Error('quota-url-credentials-forbidden')
  const authStyle = String(merged.request?.authStyle ?? 'none').trim().toLowerCase()
  if (!['bearer', 'token', 'basic', 'header', 'cookie', 'query', 'json', 'form', 'none'].includes(authStyle)) {
    throw new Error('quota-auth-style-invalid')
  }
  const bodyType = String(merged.request?.bodyType ?? 'none').trim().toLowerCase()
  if (!['none', 'json', 'form', 'raw'].includes(bodyType)) throw new Error('quota-body-type-invalid')
  const headers = merged.request?.headers && typeof merged.request.headers === 'object' && !Array.isArray(merged.request.headers)
    ? Object.fromEntries(Object.entries(merged.request.headers).map(([key, value]) => [String(key).trim(), String(value)]).filter(([key]) => key))
    : {}
  let credentialMode = ['provider', 'reference', 'direct', 'none'].includes(merged.request?.credentialMode)
    ? merged.request.credentialMode
    : (merged.request?.dshProvider ? 'provider' : (merged.request?.authValue ? 'direct' : (authStyle === 'none' ? 'none' : 'reference')))
  // 旧设置页默认创建了一个空的“凭证引用”；它没有可用信息，升级后直接转为密码框。
  if (credentialMode === 'reference' && !String(merged.request?.authRef ?? '').trim() && authStyle !== 'none') credentialMode = 'direct'
  const normalized = {
    ...merged,
    id,
    name: String(merged.name || id).trim(),
    kind,
    providerIds: Array.isArray(merged.providerIds)
      ? merged.providerIds.map((value) => String(value).trim()).filter(Boolean)
      : [],
    providerPatterns: Array.isArray(merged.providerPatterns)
      ? merged.providerPatterns.map((value) => String(value).trim()).filter(Boolean)
      : [],
    enabled: merged.enabled !== false,
    request: {
      ...(merged.request ?? {}),
      method: String(merged.request?.method || 'GET').trim().toUpperCase(),
      url: rawUrl,
      dshProvider: String(merged.request?.dshProvider ?? '').trim(),
      credentialMode,
      authRef: String(merged.request?.authRef ?? '').trim(),
      authValue: String(merged.request?.authValue ?? ''),
      authStyle,
      authHeader: String(merged.request?.authHeader || 'Authorization').trim() || 'Authorization',
      authParam: String(merged.request?.authParam || 'api_key').trim() || 'api_key',
      headers,
      bodyType,
      body: String(merged.request?.body ?? ''),
    },
    response: { ...(merged.response ?? {}) },
  }
  delete normalized.request.credentialConfigured
  delete normalized.manual
  return normalized
}

const isSensitiveHeader = (name) => /authorization|proxy-authorization|token|api[-_]?key|secret|cookie|set-cookie|session/i.test(String(name))

/** 敏感请求头持久化后，运行时配置里只保留这个引用，不在 YAML / 浏览器中出现明文。 */
const HEADER_CREDENTIAL_MARKER = '@credential:'

/** POST/测试时将前端回传的 `***` 恢复成服务端已保存值。 */
const mergeMaskedQuotaRequest = (previous = {}, incoming = {}) => {
  const headers = Object.hasOwn(incoming, 'headers') ? {} : { ...(previous.headers ?? {}) }
  for (const [key, value] of Object.entries(incoming.headers ?? {})) {
    const previousKey = Object.keys(previous.headers ?? {}).find((name) => name.toLowerCase() === key.toLowerCase())
    headers[key] = value === '***' && previousKey !== undefined ? previous.headers[previousKey] : value
  }
  return {
    ...incoming,
    authValue: !Object.hasOwn(incoming, 'authValue')
      ? (previous.authValue ?? '')
      : (incoming.authValue === '***' ? (previous.authValue ?? '') : (incoming.authValue ?? '')),
    headers,
  }
}

/**
 * 为设置页直接填写的额度凭证生成稳定、合法且不易碰撞的 DSH credential ref。
 * 原始 provider/source id 只参与生成引用名，不包含任何秘密。
 */
const quotaCredentialRef = (scope) => {
  const raw = String(scope ?? 'quota')
  const stem = raw.toUpperCase().replace(/[^A-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'QUOTA'
  let hash = 2166136261
  for (let i = 0; i < raw.length; i += 1) {
    hash ^= raw.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `DSH_CREDITS_${stem}_${(hash >>> 0).toString(16).toUpperCase().padStart(8, '0')}`
}

export const providerQuotaAdapterId = (providerId) => `provider:${String(providerId ?? '').trim()}`

const normalizeProviderQuotaConfig = (binding) => {
  if (!binding || typeof binding !== 'object') throw new Error('provider-quota-invalid')
  const providerId = String(binding.providerId ?? '').trim()
  if (!providerId) throw new Error('provider-quota-provider-required')
  const sourceType = String(binding.sourceType ?? 'auto').trim().toLowerCase()
  if (!['auto', 'template', 'custom', 'provider'].includes(sourceType)) throw new Error('provider-quota-source-type-invalid')
  const normalized = {
    providerId,
    enabled: binding.enabled !== false,
    sourceType,
    templateId: String(binding.templateId ?? '').trim(),
    sourceProviderId: String(binding.sourceProviderId ?? '').trim(),
    thresholdsEnabled: true,
    thresholdMode: binding.thresholdMode === 'value'
      ? 'value'
      : (binding.thresholdMode === 'percent' ? 'percent' : null),
    warningThreshold: Number.isFinite(Number(binding.warningThreshold)) && Number(binding.warningThreshold) > 0
      ? Number(binding.warningThreshold)
      : null,
    dangerThreshold: Number.isFinite(Number(binding.dangerThreshold)) && Number(binding.dangerThreshold) > 0
      ? Number(binding.dangerThreshold)
      : null,
    refreshIntervalMs: Number.isFinite(Number(binding.refreshIntervalMs)) && Number(binding.refreshIntervalMs) >= 1000
      ? Number(binding.refreshIntervalMs)
      : null,
  }
  if (sourceType === 'template' && !getQuotaSourceTemplate(normalized.templateId)) throw new Error('provider-quota-template-invalid')
  if (sourceType === 'provider' && !normalized.sourceProviderId) throw new Error('provider-quota-source-provider-required')
  if (sourceType === 'custom') {
    normalized.source = normalizeQuotaSourceConfig(binding.source)
  }
  if (!normalized.thresholdMode) {
    const template = sourceType === 'template' || sourceType === 'auto'
      ? getQuotaSourceTemplate(normalized.templateId)
      : null
    const kind = template?.category || (sourceType === 'custom' ? normalized.source?.kind : '')
    normalized.thresholdMode = (template?.category === 'subscription' || kind === 'usage') ? 'percent' : 'value'
  }
  return normalized
}

const providerTemplateUrl = (provider, sourceType, templateId, defaultUrl) => {
  if (sourceType !== 'auto') return defaultUrl
  const baseURL = String(provider?.baseURL ?? '').trim().replace(/\/+$/, '')
  if (!baseURL) return defaultUrl
  if (templateId === 'deepseek') {
    const url = new URL(baseURL)
    if (!/\/user\/balance$/i.test(url.pathname)) url.pathname = `${url.pathname.replace(/\/v1$/i, '').replace(/\/+$/, '')}/user/balance`
    return url.toString()
  }
  if (templateId === 'opencode-go') return /\/usage$/i.test(baseURL) ? baseURL : `${baseURL}/usage`
  return defaultUrl
}

/** 将一个供应商绑定物化为独立适配器，确保同模板的多个账号不共享缓存或凭证。 */
export const buildProviderQuotaAdapter = (provider, rawBinding = {}) => {
  const providerId = String(rawBinding.providerId ?? provider?.id ?? '').trim()
  if (!providerId || rawBinding.enabled === false || rawBinding.sourceType === 'provider') return null
  const sourceType = String(rawBinding.sourceType ?? 'auto').trim().toLowerCase()
  if (sourceType === 'custom') {
    const source = normalizeQuotaSourceConfig(rawBinding.source)
    const requestDshProvider = rawBinding.source?.request?.dshProvider
    return {
      ...source,
      id: providerQuotaAdapterId(providerId),
      name: String(provider?.name || source.name || providerId),
      providerIds: [providerId],
      providerPatterns: [],
      default: false,
      builtin: false,
      providerId,
      sourceType,
      request: {
        ...(source.request ?? {}),
        dshProvider: requestDshProvider === '' ? '' : (requestDshProvider || providerId),
      },
      thresholdsEnabled: true,
      thresholdMode: rawBinding.thresholdMode === 'value' ? 'value' : (rawBinding.thresholdMode === 'percent' ? 'percent' : null),
      warningThreshold: Number.isFinite(Number(rawBinding.warningThreshold)) && Number(rawBinding.warningThreshold) > 0 ? Number(rawBinding.warningThreshold) : null,
      dangerThreshold: Number.isFinite(Number(rawBinding.dangerThreshold)) && Number(rawBinding.dangerThreshold) > 0 ? Number(rawBinding.dangerThreshold) : null,
      refreshIntervalMs: Number.isFinite(Number(rawBinding.refreshIntervalMs)) && Number(rawBinding.refreshIntervalMs) >= 1000 ? Number(rawBinding.refreshIntervalMs) : null,
    }
  }
  const templateId = sourceType === 'template'
    ? String(rawBinding.templateId ?? '').trim()
    : String(provider?.templateId ?? rawBinding.templateId ?? '').trim()
  const template = getQuotaSourceTemplate(templateId)
  if (!template) return null
  const source = mergeQuotaSourceTemplate({ template: templateId })
  return {
    ...source,
    id: providerQuotaAdapterId(providerId),
    name: String(provider?.name || source.name || providerId),
    providerIds: [providerId],
    providerPatterns: [],
    default: false,
    builtin: false,
    providerId,
    sourceType,
    quotaTemplateName: template.name,
    request: {
      ...(source.request ?? {}),
      url: providerTemplateUrl(provider, sourceType, templateId, source.request?.url),
      dshProvider: providerId,
    },
    thresholdsEnabled: true,
    thresholdMode: rawBinding.thresholdMode === 'value' ? 'value' : (rawBinding.thresholdMode === 'percent' ? 'percent' : null),
    warningThreshold: Number.isFinite(Number(rawBinding.warningThreshold)) && Number(rawBinding.warningThreshold) > 0 ? Number(rawBinding.warningThreshold) : null,
    dangerThreshold: Number.isFinite(Number(rawBinding.dangerThreshold)) && Number(rawBinding.dangerThreshold) > 0 ? Number(rawBinding.dangerThreshold) : null,
    refreshIntervalMs: Number.isFinite(Number(rawBinding.refreshIntervalMs)) && Number(rawBinding.refreshIntervalMs) >= 1000 ? Number(rawBinding.refreshIntervalMs) : null,
  }
}

/** 当前模型供应商 → 该供应商独立绑定的适配器；未配置时明确返回 null。 */
export const resolveProviderQuotaSource = (modelProvider, bindings = []) => {
  const byProvider = new Map((bindings ?? []).map((binding) => [normalizeProvider(binding?.providerId), binding]))
  const visit = (providerId, seen = new Set()) => {
    const normalized = normalizeProvider(providerId)
    if (!normalized || seen.has(normalized)) return null
    seen.add(normalized)
    const binding = byProvider.get(normalized)
    if (!binding || binding.enabled === false) return null
    if (binding.sourceType === 'provider') return visit(binding.sourceProviderId, seen)
    return binding.adapterId || providerQuotaAdapterId(binding.providerId)
  }
  return visit(modelProvider)
}

/** 按适配器 id 查内置适配器。 */
export const getBuiltinQuotaAdapter = (id) =>
  BUILTIN_QUOTA_ADAPTERS.find((adapter) => adapter.id === id) ?? null

/** own=额度单独一行; shared=与底部已有统计同一行靠后。 */
export const normalizeDockLayout = (value) =>
  String(value ?? 'own').trim().toLowerCase() === 'shared' ? 'shared' : 'own'

const normalizeProvider = (value) => String(value ?? '').trim().toLowerCase()

const providerMatchesAdapter = (adapter, provider) => {
  const p = normalizeProvider(provider)
  if (!p) return false
  if (normalizeProvider(adapter.id) === p) return true
  if ((adapter.providerIds ?? []).some((id) => normalizeProvider(id) === p)) return true
  return (adapter.providerPatterns ?? []).some((pattern) => {
    try {
      return new RegExp(pattern, 'i').test(p)
    } catch {
      return false
    }
  })
}

/** 在给定适配器列表中匹配一个 provider / 适配器 id。 */
export const matchQuotaAdapter = (provider, adapters = BUILTIN_QUOTA_ADAPTERS) =>
  adapters.find((adapter) => providerMatchesAdapter(adapter, provider)) ?? null

/** 返回默认额度源。 */
export const defaultQuotaAdapter = (adapters = BUILTIN_QUOTA_ADAPTERS) =>
  adapters.find((adapter) => adapter.default === true) ?? adapters[0] ?? null

/** 对话模型供应商 → 额度展示。未命中内置列表时回退 deepseek。 */
export const quotaSourceFromProvider = (provider) =>
  matchQuotaAdapter(provider, BUILTIN_QUOTA_ADAPTERS)?.id ?? 'deepseek'

/** follow: 跟当前模型; custom: 固定用 config.provider, 忽略当前模型。 */
export const resolveQuotaSource = (modelProvider, config = {}, adapters = BUILTIN_QUOTA_ADAPTERS) => {
  if (String(config.quotaMode ?? 'follow').trim().toLowerCase() === 'custom') {
    return matchQuotaAdapter(config.provider, adapters)?.id ?? quotaSourceFromProvider(config.provider)
  }
  if (modelProvider !== null && modelProvider !== undefined && normalizeProvider(modelProvider) !== '') {
    return matchQuotaAdapter(modelProvider, adapters)?.id
      ?? matchQuotaAdapter(config.provider, adapters)?.id
      ?? defaultQuotaAdapter(adapters)?.id
      ?? 'deepseek'
  }
  return matchQuotaAdapter(config.provider, adapters)?.id ?? defaultQuotaAdapter(adapters)?.id ?? 'deepseek'
}

/** 一组命中 / 未命中 / 输出单价(每 1M token)。 */
const TokenRate = Schema.object({
  cacheHit: Schema.number().min(0),
  cacheMiss: Schema.number().min(0),
  output: Schema.number().min(0),
})

const PriceSchedule = Schema.object({
  from: Schema.string().default(''),
  to: Schema.string().default(''),
  cacheHit: Schema.number().min(0),
  cacheMiss: Schema.number().min(0),
  output: Schema.number().min(0),
})

const RateInput = z.object({ cacheHit: z.number().finite().nonnegative(), cacheMiss: z.number().finite().nonnegative(), output: z.number().finite().nonnegative() })
const ScheduleInput = RateInput.extend({
  from: z.iso.datetime({ offset: true }).or(z.literal('')).optional(),
  to: z.iso.datetime({ offset: true }).or(z.literal('')).optional(),
}).refine((entry) => !entry.from || !entry.to || Date.parse(entry.from) < Date.parse(entry.to), 'invalid-price-schedule-range')
const PriceInput = RateInput.extend({
  peak: RateInput.optional(), offPeak: RateInput.optional(), schedules: z.array(ScheduleInput).optional(),
}).superRefine((price, ctx) => {
  if (Boolean(price.peak) !== Boolean(price.offPeak)) ctx.addIssue({ code: 'custom', message: 'price-tiers-require-both' })
  const entries = [...(price.schedules ?? [])].sort((a, b) => (a.from ? Date.parse(a.from) : -Infinity) - (b.from ? Date.parse(b.from) : -Infinity))
  for (let i = 1; i < entries.length; i++) {
    if ((entries[i].from ? Date.parse(entries[i].from) : -Infinity) < (entries[i - 1].to ? Date.parse(entries[i - 1].to) : Infinity)) {
      ctx.addIssue({ code: 'custom', message: 'price-schedules-overlap' })
    }
  }
})
const PricesInput = z.record(z.string(), PriceInput)

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
  /** ISO 时间，含时区；起点包含，终点不包含，留空表示无限界。 */
  schedules: Schema.array(PriceSchedule).default([]),
})

/** 自定义额度源请求配置。 */
const QuotaRequest = Schema.object({
  method: Schema.string().default('GET'),
  url: Schema.string().default(''),
  /** 复用 DSH 模型供应商已有凭证；存在时优先于 authRef。 */
  dshProvider: Schema.string().default(''),
  credentialMode: Schema.union(['provider', 'reference', 'direct', 'none']).default('direct'),
  authRef: Schema.string().default(''),
  /** 仅接收设置页本次写入的直接凭证；保存后迁移到 DSH credentials，不进入配置或响应。 */
  authValue: Schema.string().default(''),
  authStyle: Schema.union(['bearer', 'token', 'basic', 'header', 'cookie', 'query', 'json', 'form', 'none']).default('none'),
  authHeader: Schema.string().default('Authorization'),
  authParam: Schema.string().default('api_key'),
  headers: Schema.dict(Schema.string()).default({}),
  bodyType: Schema.union(['none', 'json', 'form', 'raw']).default('none'),
  body: Schema.string().default(''),
})

/** 自定义额度源单条指标映射。 */
const QuotaMetric = Schema.object({
  key: Schema.string(),
  label: Schema.string().default(''),
  /** 空值仅用于兼容旧配置；运行时会根据已填写字段推断。 */
  calculation: Schema.union(['', 'direct', 'subtract']).default(''),
  valuePath: Schema.string().default(''),
  usedPath: Schema.string().default(''),
  totalPath: Schema.string().default(''),
  resetsAtPath: Schema.string().default(''),
  unit: Schema.string().default(''),
  aggregate: Schema.union(['value', 'sum', 'count', 'min', 'max']).default('value'),
  scale: Schema.number().default(1),
  offset: Schema.number().default(0),
})

/** 自定义订阅用量窗口映射。 */
const QuotaWindow = Schema.object({
  key: Schema.string(),
  label: Schema.string().default(''),
  percentPath: Schema.string().default(''),
  resetsAtPath: Schema.string().default(''),
  statusPath: Schema.string().default(''),
})

/** 自定义额度源响应映射。 */
const QuotaResponse = Schema.object({
  balancesPath: Schema.string().default('$.balance_infos'),
  currencyPath: Schema.string().default('$.currency'),
  totalPath: Schema.string().default('$.total_balance'),
  grantedPath: Schema.string().default('$.granted_balance'),
  toppedUpPath: Schema.string().default('$.topped_up_balance'),
  usagePath: Schema.string().default('$.usage'),
  metrics: Schema.array(QuotaMetric).default([]),
  windows: Schema.array(QuotaWindow).default([]),
})

/** 自定义额度源适配器。 */
const QuotaSource = Schema.object({
  id: Schema.string().min(1),
  template: Schema.string().default(''),
  name: Schema.string().default(''),
  kind: Schema.union(['balance', 'usage', 'metric']),
  providerIds: Schema.array(Schema.string()).default([]),
  providerPatterns: Schema.array(Schema.string()).default([]),
  default: Schema.boolean().default(false),
  enabled: Schema.boolean().default(true),
  request: QuotaRequest.default({}),
  response: QuotaResponse.default({}),
})

/** 以 DSH 供应商实例为主体的额度绑定。 */
const ProviderQuota = Schema.object({
  providerId: Schema.string().min(1),
  enabled: Schema.boolean().default(true),
  sourceType: Schema.union(['auto', 'template', 'custom', 'provider']).default('auto'),
  templateId: Schema.string().default(''),
  sourceProviderId: Schema.string().default(''),
  source: QuotaSource,
  /** 兼容旧配置保留字段；现在始终使用本供应商自己的阈值，不再有“继承全局”模式。 */
  thresholdsEnabled: Schema.boolean().default(true),
  /** percent=百分比比较; value=直接按指标数值比较。 */
  thresholdMode: Schema.union(['percent', 'value']).default('percent'),
  warningThreshold: Schema.union([Schema.number().min(0), Schema.const(null)]).default(null),
  dangerThreshold: Schema.union([Schema.number().min(0), Schema.const(null)]).default(null),
  /** 本供应商独立查询频率；null 时使用默认 300000ms。 */
  refreshIntervalMs: Schema.union([Schema.number().min(1000), Schema.const(null)]).default(null),
})

export const Config = Schema.object({
  /** 旧版兼容字段；新设置页使用 providerQuotas，不再暴露全局查询模式。 */
  quotaMode: Schema.union(QUOTA_MODES).default('follow'),
  /** 底部统计条是否展示额度读数 */
  showDock: Schema.boolean().default(true),
  /** own=独立换行; shared=与底部已有统计共用一行 */
  dockLayout: Schema.union(DOCK_LAYOUTS).default('own'),
  /** 右下角累计消耗胶囊 */
  showCapsule: Schema.boolean().default(true),
  /** 悬停额度/花费详情气泡 */
  showPopover: Schema.boolean().default(true),
  /** 底部统计条是否展示最近一次生成吞吐 TPS */
  showTps: Schema.boolean().default(true),
  /** 旧版兼容字段；仅在没有 providerQuotas 的旧配置中作为默认源。 */
  provider: Schema.string().default('deepseek'),
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
  providerPrices: Schema.dict(Schema.dict(ModelPrice)).default({}),
  /** 余额预警阈值(DeepSeek: 余额低于此值; OpenCode Go: 剩余额度低于此百分比) */
  warningThreshold: Schema.number().min(0).default(10),
  /** 余额告急阈值(DeepSeek: 余额低于此值; OpenCode Go: 剩余额度低于此百分比) */
  dangerThreshold: Schema.number().min(0).default(5),
  /** 未列出的模型的回退单价 */
  defaultPrices: ModelPrice.default({ cacheHit: 0.1, cacheMiss: 1, output: 2 }),
  /** 旧版额度源列表；会按 providerIds 迁移为 providerQuotas 绑定。 */
  quotaSources: Schema.array(QuotaSource).default([]),
  /** 每个 DSH 供应商实例独立选择额度来源。 */
  providerQuotas: Schema.array(ProviderQuota).default([]),
})

/** 归一化 DeepSeek 余额响应中的金额字符串。 */
const toAmount = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/**
 * 轻量 JSONPath 取值：支持 `$`、点路径、数组下标、引号属性与 `[*]`。
 * 含通配符时返回所有命中的数组；普通路径保持旧版的单值返回行为。
 */
const jsonPathTokens = (path) => {
  const source = String(path ?? '').trim().replace(/^\$\.?/, '')
  if (!source) return []
  const tokens = []
  const matcher = /(?:^|\.)([^.[\]]+)|\[(?:(\d+)|"([^"]+)"|'([^']+)'|(\*))\]/g
  for (const match of source.matchAll(matcher)) {
    if (match[1] !== undefined) tokens.push(match[1])
    else if (match[2] !== undefined) tokens.push(Number(match[2]))
    else if (match[3] !== undefined) tokens.push(match[3])
    else if (match[4] !== undefined) tokens.push(match[4])
    else if (match[5] !== undefined) tokens.push('*')
  }
  return tokens
}

export const getByPath = (obj, path) => {
  if (obj === null || obj === undefined || typeof path !== 'string' || path.trim() === '') return obj
  const tokens = jsonPathTokens(path)
  if (tokens.length === 0) return obj
  const wildcard = tokens.includes('*')
  let values = [obj]
  for (const token of tokens) {
    const next = []
    for (const value of values) {
      if (value === null || value === undefined) continue
      if (token === '*') {
        if (Array.isArray(value)) next.push(...value)
        else if (typeof value === 'object') next.push(...Object.values(value))
        continue
      }
      const hit = value?.[token]
      if (hit !== undefined) next.push(hit)
    }
    values = next
  }
  return wildcard ? values : values[0]
}

const hasHeader = (headers, name) => Object.keys(headers).some((key) => key.toLowerCase() === name.toLowerCase())
const setHeader = (headers, name, value) => {
  const current = Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase())
  headers[current || name] = value
}

/** 将通用鉴权配置物化为 fetch URL / init，供运行时和测试共同使用。 */
export const buildCustomHttpRequest = (request = {}, credential = '') => {
  let url = String(request.url ?? '').trim()
  if (!url) throw new Error('quota-url-missing')
  const parsedUrl = new URL(url)
  if (parsedUrl.username || parsedUrl.password) throw new Error('quota-url-credentials-forbidden')
  const method = String(request.method || 'GET').trim().toUpperCase()
  const style = normalizeProvider(request.authStyle ?? 'none')
  const authHeader = String(request.authHeader || 'Authorization').trim() || 'Authorization'
  const authParam = String(request.authParam || 'api_key').trim() || 'api_key'
  const headers = { Accept: 'application/json', ...(request.headers ?? {}) }

  if (credential) {
    if (style === 'bearer') setHeader(headers, authHeader, `Bearer ${credential}`)
    else if (style === 'token') setHeader(headers, authHeader, `Token ${credential}`)
    else if (style === 'basic') setHeader(headers, authHeader, `Basic ${Buffer.from(credential, 'utf8').toString('base64')}`)
    else if (style === 'header') setHeader(headers, authHeader, credential)
    else if (style === 'cookie') setHeader(headers, 'Cookie', credential)
    else if (style === 'query') {
      const parsed = new URL(url)
      parsed.searchParams.set(authParam, credential)
      url = parsed.toString()
    }
  }

  let body
  const permitsBody = method !== 'GET' && method !== 'HEAD'
  let bodyType = normalizeProvider(request.bodyType ?? 'none')
  if (style === 'json') bodyType = 'json'
  if (style === 'form') bodyType = 'form'
  if (!permitsBody && (style === 'json' || style === 'form' || (bodyType !== 'none' && String(request.body ?? '') !== ''))) {
    throw new Error('quota-request-body-method-invalid')
  }
  if (permitsBody && bodyType === 'json') {
    let parsed = {}
    if (String(request.body ?? '').trim()) {
      try { parsed = JSON.parse(request.body) } catch { throw new Error('quota-request-json-invalid') }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('quota-request-json-object-required')
    if (style === 'json' && credential) parsed[authParam] = credential
    body = JSON.stringify(parsed)
    if (!hasHeader(headers, 'Content-Type')) setHeader(headers, 'Content-Type', 'application/json')
  } else if (permitsBody && bodyType === 'form') {
    const form = new URLSearchParams(String(request.body ?? ''))
    if (style === 'form' && credential) form.set(authParam, credential)
    body = form.toString()
    if (!hasHeader(headers, 'Content-Type')) setHeader(headers, 'Content-Type', 'application/x-www-form-urlencoded')
  } else if (permitsBody && bodyType === 'raw' && String(request.body ?? '') !== '') {
    body = String(request.body)
  }

  return { url, init: { method, headers, ...(body === undefined ? {} : { body }) } }
}

const HTTP_DIAGNOSTIC_BODY_LIMIT = 32768
const redactKnownSecrets = (value, secrets = []) => secrets
  .map((secret) => String(secret ?? ''))
  .filter((secret) => secret.length > 0)
  .sort((a, b) => b.length - a.length)
  .reduce((text, secret) => text.replaceAll(secret, '***'), String(value ?? ''))

const credentialDiagnosticSecrets = (credential, authStyle) => {
  const raw = String(credential ?? '')
  if (!raw) return []
  const secrets = [raw]
  if (normalizeProvider(authStyle) === 'cookie') {
    for (const part of raw.split(';')) {
      const value = part.includes('=') ? part.slice(part.indexOf('=') + 1).trim() : ''
      if (value) secrets.push(value)
    }
  }
  if (normalizeProvider(authStyle) === 'basic') secrets.push(Buffer.from(raw).toString('base64'))
  return [...new Set(secrets)]
}

const redactDiagnosticValue = (value, extraSensitiveKeys = new Set(), secrets = []) => {
  if (Array.isArray(value)) return value.map((item) => redactDiagnosticValue(item, extraSensitiveKeys, secrets))
  if (typeof value === 'string') return redactKnownSecrets(value, secrets)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    isSensitiveHeader(key) || extraSensitiveKeys.has(key.toLowerCase())
      ? '***'
      : redactDiagnosticValue(child, extraSensitiveKeys, secrets),
  ]))
}

const diagnosticHeaders = (headers, extraSensitiveKeys = [], secrets = []) => {
  const sensitive = new Set(extraSensitiveKeys.map((key) => String(key).toLowerCase()))
  const entries = []
  if (headers?.forEach) headers.forEach((value, key) => entries.push([key, value]))
  else entries.push(...Object.entries(headers ?? {}))
  return Object.fromEntries(entries.map(([key, value]) => [
    key,
    isSensitiveHeader(key) || sensitive.has(String(key).toLowerCase())
      ? '***'
      : redactKnownSecrets(value, secrets),
  ]))
}

const limitDiagnosticBody = (value) => {
  const text = String(value ?? '')
  if (text.length <= HTTP_DIAGNOSTIC_BODY_LIMIT) return { text, truncated: false }
  return { text: `${text.slice(0, HTTP_DIAGNOSTIC_BODY_LIMIT)}\n…[truncated]`, truncated: true }
}

const diagnosticBody = (body, contentType = '', extraSensitiveKeys = [], secrets = []) => {
  const raw = redactKnownSecrets(body, secrets)
  if (!raw) return { text: '', truncated: false }
  const sensitive = new Set(extraSensitiveKeys.map((key) => String(key).toLowerCase()))
  try {
    if (/json/i.test(contentType) || /^[\s]*[\[{]/.test(raw)) {
      return limitDiagnosticBody(JSON.stringify(redactDiagnosticValue(JSON.parse(raw), sensitive, secrets), null, 2))
    }
    if (/x-www-form-urlencoded/i.test(contentType)) {
      const form = new URLSearchParams(raw)
      for (const key of [...form.keys()]) {
        if (isSensitiveHeader(key) || sensitive.has(key.toLowerCase())) form.set(key, '***')
      }
      return limitDiagnosticBody(form.toString())
    }
  } catch {
    /* 保留无法解析的上游文本，仍受长度限制。 */
  }
  return limitDiagnosticBody(raw)
}

const diagnosticUrl = (rawUrl, request, secrets = []) => {
  try {
    const parsed = new URL(rawUrl)
    if (parsed.username) parsed.username = '***'
    if (parsed.password) parsed.password = '***'
    const authParam = String(request?.authParam || 'api_key').toLowerCase()
    for (const key of [...parsed.searchParams.keys()]) {
      if (isSensitiveHeader(key) || key.toLowerCase() === authParam) parsed.searchParams.set(key, '***')
    }
    return redactKnownSecrets(parsed.toString(), secrets)
  } catch {
    return redactKnownSecrets(rawUrl, secrets)
  }
}

const buildHttpDiagnostics = (customRequest, request, response, responseBody, secrets = []) => {
  const authStyle = normalizeProvider(request?.authStyle)
  const authHeader = authStyle === 'header' ? [String(request?.authHeader || 'Authorization')] : []
  const requestHeaders = diagnosticHeaders(customRequest.init?.headers, authHeader, secrets)
  const requestContentType = Object.entries(requestHeaders).find(([key]) => key.toLowerCase() === 'content-type')?.[1] ?? ''
  const authParam = ['json', 'form', 'query'].includes(authStyle)
    ? [String(request?.authParam || 'api_key')]
    : []
  const safeRequestBody = diagnosticBody(customRequest.init?.body, requestContentType, authParam, secrets)
  const responseHeaders = diagnosticHeaders(response?.headers, [], secrets)
  const responseContentType = Object.entries(responseHeaders).find(([key]) => key.toLowerCase() === 'content-type')?.[1] ?? ''
  const safeResponseBody = diagnosticBody(responseBody, responseContentType, [], secrets)
  return {
    redacted: true,
    request: {
      method: String(customRequest.init?.method || 'GET'),
      url: diagnosticUrl(customRequest.url, request, secrets),
      headers: requestHeaders,
      body: safeRequestBody.text,
      bodyTruncated: safeRequestBody.truncated,
    },
    response: {
      status: Number(response?.status ?? 0),
      statusText: String(response?.statusText ?? ''),
      headers: responseHeaders,
      body: safeResponseBody.text,
      bodyTruncated: safeResponseBody.truncated,
    },
  }
}

export const MAX_QUOTA_RESPONSE_BYTES = 1024 * 1024
export const readFetchResponseBody = async (response) => {
  if (Number(response?.headers?.get?.('content-length')) > MAX_QUOTA_RESPONSE_BYTES) {
    await response.body?.cancel?.()
    throw new Error('quota-response-too-large')
  }
  if (response?.body?.getReader) {
    const reader = response.body.getReader()
    const chunks = []
    let size = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > MAX_QUOTA_RESPONSE_BYTES) {
          await reader.cancel()
          throw new Error('quota-response-too-large')
        }
        chunks.push(value)
      }
      return Buffer.concat(chunks, size).toString('utf8')
    } finally {
      reader.releaseLock()
    }
  }
  const text = typeof response?.text === 'function' ? await response.text()
    : (typeof response?.json === 'function' ? JSON.stringify(await response.json()) : '')
  if (Buffer.byteLength(text, 'utf8') > MAX_QUOTA_RESPONSE_BYTES) throw new Error('quota-response-too-large')
  return text
}

const upstreamErrorSummary = (body) => {
  const text = String(body ?? '').trim()
  if (!text) return ''
  try {
    const data = JSON.parse(text)
    const candidate = data?.message ?? data?.msg ?? data?.detail ?? data?.error?.message ?? data?.error ?? data?.code
    if (candidate !== undefined && candidate !== null) {
      return String(typeof candidate === 'object' ? JSON.stringify(candidate) : candidate).replace(/\s+/g, ' ').slice(0, 240)
    }
  } catch {
    /* 非 JSON 错误体直接摘要。 */
  }
  return text.replace(/\s+/g, ' ').slice(0, 240)
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

/** 归一化自定义余额响应。 */
export const normalizeCustomBalances = (data, response = {}) => {
  const raw = getByPath(data, response.balancesPath ?? '$.balance_infos')
  const items = Array.isArray(raw)
    ? raw
    : (Array.isArray(data?.balance_infos) ? data.balance_infos : [])
  return items.map((item) => {
    const currency = getByPath(item, response.currencyPath ?? '$.currency')
    return {
      currency: typeof currency === 'string' && currency !== '' ? currency : 'CNY',
      total: toAmount(getByPath(item, response.totalPath ?? '$.total_balance')),
      granted: toAmount(getByPath(item, response.grantedPath ?? '$.granted_balance')),
      toppedUp: toAmount(getByPath(item, response.toppedUpPath ?? '$.topped_up_balance')),
    }
  })
}

/** 归一化自定义订阅用量响应。 */
export const normalizeCustomUsage = (data, response = {}) => {
  const root = response.usagePath ? getByPath(data, response.usagePath) : data
  const windows = {}
  for (const w of response.windows ?? []) {
    const source = getByPath(root, w.percentPath ?? `$.${w.key}`) ?? getByPath(root, w.key)
    const sourceObj = source && typeof source === 'object' ? source : null
    const pctRaw = sourceObj ? getByPath(sourceObj, w.percentPath || '$.percent') : source
    const resetsRaw = sourceObj
      ? getByPath(sourceObj, w.resetsAtPath || '$.resetsAt')
      : getByPath(root, w.resetsAtPath ?? '')
    const statusRaw = sourceObj ? getByPath(sourceObj, w.statusPath || '$.status') : null
    const n = Number(pctRaw)
    windows[w.key] = {
      status: statusRaw && typeof statusRaw === 'string' ? statusRaw : null,
      percent: Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null,
      resetsAt: normalizeResetTime(resetsRaw),
    }
  }
  if (Object.keys(windows).length === 0) return normalizeOpencodeUsage(data)
  return windows
}

/** 把上游重置时间统一成 ISO 字符串：兼容 ISO、Unix 秒与 Unix 毫秒。 */
const normalizeResetTime = (value) => {
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return value
    value = numeric
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  const millis = value < 1e12 ? value * 1000 : value
  const date = new Date(millis)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** 归一化自定义单值/多指标额度响应。 */
export const normalizeCustomMetrics = (data, response = {}) => {
  const metrics = response.metrics ?? []
  return metrics.flatMap((metric) => {
    const scale = Number.isFinite(Number(metric.scale)) ? Number(metric.scale) : 1
    const offset = Number.isFinite(Number(metric.offset)) ? Number(metric.offset) : 0
    const aggregate = ['sum', 'count', 'min', 'max'].includes(metric.aggregate) ? metric.aggregate : 'value'
    const readAmount = (path) => {
      if (!path) return null
      const raw = getByPath(data, path)
      if (raw === null || raw === undefined) return null
      const values = Array.isArray(raw) ? raw : [raw]
      if (aggregate === 'count') return values.filter((value) => value !== null && value !== undefined).length
      const numbers = values
        .map((value) => typeof value === 'string' && value.trim() === '' ? Number.NaN : Number(value))
        .filter(Number.isFinite)
      if (numbers.length === 0) return null
      if (aggregate === 'sum') return numbers.reduce((sum, value) => sum + value, 0)
      if (aggregate === 'min') return Math.min(...numbers)
      if (aggregate === 'max') return Math.max(...numbers)
      return numbers[0]
    }
    const calculation = metric.calculation === 'subtract'
      ? 'subtract'
      : metric.calculation === 'direct'
        ? 'direct'
        : (!metric.valuePath && metric.usedPath && metric.totalPath ? 'subtract' : 'direct')
    const rawTotal = metric.totalPath ? readAmount(metric.totalPath) : null
    const rawUsed = calculation === 'subtract' && metric.usedPath ? readAmount(metric.usedPath) : null
    const rawValue = calculation === 'direct' && metric.valuePath ? readAmount(metric.valuePath) : null
    if ((calculation === 'direct' && rawValue === null) || (calculation === 'subtract' && (rawUsed === null || rawTotal === null))) {
      return []
    }
    const total = rawTotal === null ? 0 : rawTotal * scale
    const used = rawUsed === null ? 0 : rawUsed * scale
    const value = calculation === 'direct' ? rawValue * scale + offset : total - used + offset
    return [{
      key: metric.key,
      label: metric.label || metric.key || '额度',
      value,
      used,
      total,
      unit: metric.unit || '',
      resetsAt: metric.resetsAtPath ? normalizeResetTime(getByPath(data, metric.resetsAtPath)) : null,
    }]
  })
}

const clampPercent = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null
}

const usageWindow = (percent, resetsAt = null, status = null) => ({
  status: typeof status === 'string' && status ? status : null,
  percent: clampPercent(percent),
  resetsAt: normalizeResetTime(resetsAt),
})

/** 解析内置订阅模板，输出与 OpenCode Go 相同的动态窗口结构。 */
export const normalizeTemplateUsage = (templateId, data) => {
  if (templateId === 'opencode-go') return normalizeOpencodeUsage(data)

  if (templateId === 'kimi-coding') {
    const windows = {}
    const detail = Array.isArray(data?.limits)
      ? data.limits.map((item) => item?.detail).find((item) => item && typeof item === 'object')
      : null
    if (detail) {
      const limit = toAmount(detail.limit)
      const remaining = toAmount(detail.remaining)
      windows.rolling = usageWindow(limit > 0 ? ((limit - remaining) / limit) * 100 : 0, detail.resetTime)
    }
    if (data?.usage && typeof data.usage === 'object') {
      const limit = toAmount(data.usage.limit)
      const remaining = toAmount(data.usage.remaining)
      windows.weekly = usageWindow(limit > 0 ? ((limit - remaining) / limit) * 100 : 0, data.usage.resetTime)
    }
    return windows
  }

  if (templateId === 'zhipu-cn-coding' || templateId === 'zhipu-en-coding') {
    const limits = Array.isArray(data?.data?.limits) ? data.data.limits.filter((item) => {
      const type = String(item?.type ?? '').toUpperCase()
      return type === 'TOKENS_LIMIT' || type === 'CREDIT_LIMIT'
    }) : []
    const windows = {}
    const unclassified = []
    for (const item of limits) {
      const window = usageWindow(item?.percentage, item?.nextResetTime)
      if (Number(item?.unit) === 3 && !windows.rolling) windows.rolling = window
      else if (Number(item?.unit) === 6 && !windows.weekly) windows.weekly = window
      else unclassified.push({ item, window })
    }
    unclassified.sort((a, b) => toAmount(a.item?.nextResetTime) - toAmount(b.item?.nextResetTime))
    for (const entry of unclassified) {
      if (!windows.rolling) windows.rolling = entry.window
      else if (!windows.weekly) windows.weekly = entry.window
    }
    return windows
  }

  if (templateId === 'minimax-cn-coding' || templateId === 'minimax-en-coding') {
    const item = Array.isArray(data?.model_remains)
      ? data.model_remains.find((entry) => entry?.model_name === 'general')
      : null
    if (!item) return {}
    const windows = {}
    if (Number.isFinite(Number(item.current_interval_remaining_percent))) {
      windows.rolling = usageWindow(100 - Number(item.current_interval_remaining_percent), item.end_time)
    }
    if (Number(item.current_weekly_status) === 1 && Number.isFinite(Number(item.current_weekly_remaining_percent))) {
      windows.weekly = usageWindow(100 - Number(item.current_weekly_remaining_percent), item.weekly_end_time)
    }
    return windows
  }

  return normalizeCustomUsage(data, {})
}

/**
 * 测试自定义接口时只回传可映射的叶子字段，避免把整个上游响应（可能含隐私）送到浏览器。
 */
export const collectQuotaFields = (data, maxFields = 80) => {
  const fields = []
  const visit = (value, path, depth) => {
    if (fields.length >= maxFields || depth > 6 || value === null || value === undefined) return
    if (Array.isArray(value)) {
      if (value.length > 0) visit(value[0], `${path}[*]`, depth + 1)
      value.slice(0, 5).forEach((entry, index) => visit(entry, `${path}[${index}]`, depth + 1))
      return
    }
    if (typeof value === 'object') {
      for (const [key, entry] of Object.entries(value)) {
        visit(entry, `${path}.${key}`, depth + 1)
      }
      return
    }
    if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
      const preview = typeof value === 'string' && value.length > 80 ? `${value.slice(0, 77)}…` : value
      fields.push({ path, value: preview, type: typeof value })
    }
  }
  visit(data, '$', 0)
  return fields
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
      provider: z.string().nullable().optional(),
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
    currentProvider: z.string().nullable().optional(),
    last: z.object({
      turn: z.number().int().nonnegative(),
      step: z.number().int().nonnegative(),
      key: z.string(),
      model: z.string(),
      provider: z.string().nullable().optional(),
    }).strict().nullable(),
    samples: z.record(z.string(), z.object({
      t: z.number(),
      model: z.string(),
      provider: z.string().nullable().optional(),
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
        const provider = sample.provider ?? ''
        const modelKey = provider ? `${provider}/${model}` : model
        tokens.uncachedInput += b.uncachedInputTokens
        tokens.cacheRead += b.cacheReadTokens
        tokens.cacheWrite += b.cacheWriteTokens
        tokens.output += b.outputTokens
        const prevTok = tokensByModel[modelKey] ?? { uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
        tokensByModel[modelKey] = {
          uncachedInput: prevTok.uncachedInput + b.uncachedInputTokens,
          cacheRead: prevTok.cacheRead + b.cacheReadTokens,
          cacheWrite: prevTok.cacheWrite + b.cacheWriteTokens,
          output: prevTok.output + b.outputTokens,
        }
        const c = priceBuckets(cfg, model, b, sample.t, provider)
        if (c > 0) costByModel[modelKey] = (costByModel[modelKey] ?? 0) + c
        cost += c
        legs.push({
          t: sample.t,
          model,
          ...(provider ? { provider } : {}),
          uncachedInput: b.uncachedInputTokens,
          cacheRead: b.cacheReadTokens,
          cacheWrite: b.cacheWriteTokens,
          output: b.outputTokens,
        })
      }
      return {
        models: state.modelOrder ?? [],
        cost: round6(cost),
        costByModel: Object.fromEntries(Object.entries(costByModel).map(([key, value]) => [key, round6(value)])),
        tokens,
        tokensByModel,
        legs,
        currency: normalizePricingCurrency(cfg.currency),
        pricingEpoch: Number(cfg.pricingEpoch ?? 0),
      }
    }

  return {
    key: 'queryCreditsCost',
    stateSchema,
    init: () => ({ currentModel: null, currentProvider: null, last: null, samples: {}, modelOrder: [] }),
    apply: (state, event) => {
      let nextModel = state.currentModel
      let nextProvider = state.currentProvider
      if (event.type === 'request/header') {
        const model = event.data.header?.config?.model
        const provider = event.data.provider ?? event.data.header?.provider ?? event.data.header?.config?.provider
        if (typeof model === 'string' && model !== '') nextModel = model
        if (typeof provider === 'string' && provider !== '') nextProvider = provider
      } else if (event.type === 'request/context') {
        const model = event.data.model
        const provider = event.data.provider
        if (typeof model === 'string' && model !== '') nextModel = model
        if (typeof provider === 'string' && provider !== '') nextProvider = provider
      }
      if (event.type === 'llm/retry-started' && state.last?.turn === event.data?.turn && state.last.step === event.data?.step) {
        return { ...state, currentModel: nextModel, currentProvider: nextProvider, last: null }
      }
      const changedModel = nextModel !== state.currentModel || nextProvider !== state.currentProvider
      const usage = usageOfSettlement(event)
      if (usage === undefined) {
        return changedModel ? { ...state, currentModel: nextModel, currentProvider: nextProvider } : state
      }
      const { turn, step } = event.data
      const model = nextModel ?? 'unknown'
      const provider = nextProvider ?? ''
      const buckets = bucketsOf(usage)
      const t = eventTime(event)
      const key = state.last?.turn === turn && state.last.step === step
        ? state.last.key
        : String(event.seq)
      const previous = state.samples?.[key]
      if (previous && previous.model === model && previous.provider === provider && bucketsEqual(previous.buckets, buckets) && previous.t === t) {
        return changedModel ? { ...state, currentModel: nextModel, currentProvider: nextProvider } : state
      }
      const modelKey = provider ? `${provider}/${model}` : model
      const isNewModel = !(state.modelOrder ?? []).includes(modelKey)
      return {
        currentModel: nextModel,
        currentProvider: nextProvider,
        last: { turn, step, key, model, ...(provider ? { provider } : {}) },
        samples: { ...(state.samples ?? {}), [key]: { t, model, ...(provider ? { provider } : {}), buckets } },
        modelOrder: isNewModel ? [...(state.modelOrder ?? []), modelKey] : state.modelOrder,
      }
    },
    // 状态结构变更时升版，让旧缓存失效重折。单价在 view() 时按每笔事件的时间计算，
    // 改价不需要重挂投影。
    stateVersion: 5,
    wire: { viewSchema, view },
  }
}

/**
 * 压缩流里真实产出 token 的时间窗（首个非空增量 → 最后一个非空增量）。
 * 两端都用 token 自身的时间，不用结算到达时间，避免把收尾等待算进分母。
 */
const streamWindow = (stream) => {
  let first
  let last
  const mark = (time) => {
    const t = Number(time)
    if (!Number.isFinite(t)) return
    if (first === undefined) first = t
    if (last === undefined || t > last) last = t
  }
  for (const record of Array.isArray(stream) ? stream : []) {
    if (record?.type === 'text-chunks' || record?.type === 'reasoning-chunks') {
      const texts = record.texts ?? []
      let time = Number(record.time0)
      for (let index = 0; index < texts.length; index += 1) {
        if (index > 0) time += Number(record.dt?.[index - 1] ?? 0)
        if (texts[index] !== '' && texts[index] !== undefined) mark(time)
      }
    } else if (record?.type === 'tool-call-chunks') {
      if (record.name !== undefined) mark(record.time0)
      const args = record.args ?? []
      let time = Number(record.time0)
      for (let index = 0; index < args.length; index += 1) {
        if (index > 0) time += Number(record.dt?.[index - 1] ?? 0)
        if (args[index] !== '' && args[index] !== undefined) mark(time)
      }
    } else if (record?.type === 'chunk') {
      const chunk = record.chunk
      if ((chunk?.type === 'text-delta' || chunk?.type === 'reasoning-delta') && chunk.text !== '') mark(record.time)
      else if (chunk?.type === 'tool-call-delta' && (chunk.name !== undefined || chunk.argumentsDelta !== '')) mark(record.time)
    }
  }
  return { first, last }
}

/** 估算输出 token 用的字符/token 比。 */
const CHARS_PER_TOKEN = 3
/** CJK 字符的 token 权重。 */
const CJK_TOKEN_WEIGHT = 2.7
/** 低于该窗口（ms）的样本不作为速率展示，避免毫秒级抖动被放大。 */
const MIN_RATE_WINDOW_MS = 200
/** CJK 按 CJK_TOKEN_WEIGHT 计，其余按 CHARS_PER_TOKEN 折算。 */
const estimateTokens = (text) => {
  if (typeof text !== 'string' || text === '') return 0
  let cjk = 0
  let total = 0
  for (const char of text) {
    total += 1
    const code = char.codePointAt(0)
    if (code >= 0x2e80 && code <= 0x9fff) cjk += 1
    else if (code >= 0xf900 && code <= 0xfaff) cjk += 1
    else if (code >= 0xff00 && code <= 0xff60) cjk += 1
    else if (code >= 0x20000 && code <= 0x2ffff) cjk += 1
  }
  const rest = total - cjk
  return cjk * CJK_TOKEN_WEIGHT + rest / CHARS_PER_TOKEN
}

/**
 * 一段 chunks 记录展开成 `{ text, time }[]`。
 * `time0` 在事件根上，`dt` / `texts`（或 `args`）在 `data` 里；缺 `time0` 时退回事件根的 `time`。
 */
const expandChunks = (event) => {
  const data = event?.data ?? {}
  const texts = data.texts ?? data.args ?? []
  const start = Number(event?.time0)
  const base = Number.isFinite(start) ? start : Number(event?.time)
  const out = []
  let time = base
  for (let index = 0; index < texts.length; index += 1) {
    if (index > 0) {
      const dt = Number(data.dt?.[index - 1] ?? 0)
      time += Number.isFinite(dt) ? dt : 0
    }
    out.push({ text: texts[index], time })
  }
  return out.filter((item) => typeof item.text === 'string' && item.text !== '')
}

/**
 * 会话实时输出吞吐投影。
 *
 * 消费 DSH Session v2 的两种事件：
 * - 流式 `text-chunks` / `reasoning-chunks` / `tool-call-chunks` / `assistant/chunk`：
 *   按段累加字符数估算输出 token，用段自身的时间轴推进 `latestOutputTime`，实时刷新速率。
 * - `assistant/message` / `assistant/attempt` settlement（或流内 `usage` chunk）：
 *   用 provider 精确 `outputTokens` 替换估算值，`exact = true`，之后同一步的增量不再计入。
 *
 * 速率口径：本步从首个输出 token 到最后一个输出 token 的平均值
 * （`outputTokens * 1000 / (latest - first)`），完成后常驻为最近一次速率。
 */
export const makeTpsProjection = () => {
  const viewSchema = z.object({
    tokensPerSecond: z.number().nonnegative().optional(),
    estimate: z.boolean().optional(),
    pending: z.boolean().optional(),
  }).strict()
  const activeSchema = z.object({
    turn: z.number(),
    step: z.number(),
    outputTokens: z.number().nonnegative(),
    firstOutputTime: z.number().nullable(),
    latestOutputTime: z.number().nullable(),
    exact: z.boolean(),
  }).strict()
  const stateSchema = z.object({
    active: activeSchema.nullable(),
    last: z.object({ tokensPerSecond: z.number().nonnegative() }).strict().nullable(),
  }).strict()

  const emptyActive = (turn, step) => ({
    turn,
    step,
    outputTokens: 0,
    firstOutputTime: null,
    latestOutputTime: null,
    exact: false,
  })

  const rateOf = (active) => {
    if (!active || active.firstOutputTime === null || active.latestOutputTime === null) return undefined
    const elapsed = active.latestOutputTime - active.firstOutputTime
    if (!Number.isFinite(elapsed) || elapsed <= 0 || active.outputTokens <= 0) return undefined
    // 窗口过短时速率会被 1~2ms 的抖动放大成几十万 tok/s：这种样本不可信，
    // 宁可不显示（或保留上一段的稳定值），也不要给出离谱数字。
    if (elapsed < MIN_RATE_WINDOW_MS) return undefined
    return active.outputTokens * 1000 / elapsed
  }

  /** 累加一段产出；时间早于首 token 的异常值直接忽略，避免负时长。 */
  const withOutput = (active, tokens, time) => {
    if (!(tokens > 0) || !Number.isFinite(time)) return active
    const first = active.firstOutputTime ?? time
    const latest = active.latestOutputTime === null ? time : Math.max(active.latestOutputTime, time)
    return {
      ...active,
      outputTokens: active.outputTokens + tokens,
      firstOutputTime: first,
      latestOutputTime: latest,
    }
  }

  /**
   * 用一次完整 usage 覆盖成精确值；时间窗两端尽量取 token 自身的产出时间，
   * 拿不到才退回调用方给的兜底时间。
   */
  const withExact = (active, outputTokens, window) => {
    const start = Number.isFinite(window?.first) ? window.first : undefined
    const end = Number.isFinite(window?.last) ? window.last : undefined
    const firstOutputTime = active.firstOutputTime ?? start ?? null
    let latestOutputTime = active.latestOutputTime
    if (end !== undefined) latestOutputTime = latestOutputTime === null ? end : Math.max(latestOutputTime, end)
    return {
      ...active,
      outputTokens: outputTokens > 0 ? outputTokens : 0,
      exact: true,
      firstOutputTime,
      latestOutputTime,
    }
  }

  const ensureActive = (state, turn, step) => (
    state.active && state.active.turn === turn && state.active.step === step
      ? state.active
      : emptyActive(turn, step)
  )

  return {
    key: 'liveTokenUsage',
    stateSchema,
    init: () => ({ active: null, last: null }),
    apply: (state, event) => {
      const type = event?.type

      if (type === 'step/start') {
        return { ...state, active: emptyActive(Number(event.data?.turn) || 0, Number(event.data?.step) || 0) }
      }

      // 本步结束：把速率定稿到 last，清空 active，之后视图继续显示最近一次速率。
      if (type === 'step/end') {
        if (state.active === null) return state
        const rate = rateOf(state.active)
        return {
          active: null,
          last: Number.isFinite(rate) ? { tokensPerSecond: rate } : state.last,
        }
      }

      // 流式记录：`time0` 在事件根上，`texts` / `dt` 在 data 里（Session v2 压缩后的形态）。
      if (type === 'text-chunks' || type === 'reasoning-chunks' || type === 'tool-call-chunks') {
        const turn = Number(event.data?.turn) || 0
        const step = Number(event.data?.step) || 0
        const active = ensureActive(state, turn, step)
        if (active.exact) return state.active === active ? state : { ...state, active }
        let next = active
        for (const piece of expandChunks(event)) {
          next = withOutput(next, estimateTokens(piece.text), piece.time)
        }
        return next === active ? (state.active === active ? state : { ...state, active }) : { ...state, active: next }
      }

      // 未压缩的逐 delta 形态（保留兼容）。
      if (type === 'assistant/chunk') {
        const turn = Number(event.data?.turn) || 0
        const step = Number(event.data?.step) || 0
        const time = Number(event.time)
        const chunk = event.data?.chunk ?? {}
        const active = ensureActive(state, turn, step)

        if (chunk.type === 'usage') {
          const outputTokens = Math.max(0, Number(chunk.usage?.outputTokens) || 0)
          return { ...state, active: withExact(active, outputTokens, time) }
        }
        if (active.exact) return state.active === active ? state : { ...state, active }

        let text = null
        if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') text = chunk.text
        else if (chunk.type === 'tool-call-delta') text = (chunk.name ?? '') + (chunk.argumentsDelta ?? '')
        // block-end 是"这段已经结束"的收尾事件，到达时刻远晚于 token 真正产出的时刻，
        // 只累加字符数、不推进 latestOutputTime，否则会把窗口压缩成几毫秒。
        else if (chunk.type === 'block-end') {
          const blob = (() => { try { return JSON.stringify(chunk.block ?? '') } catch { return '' } })()
          const grew = estimateTokens(blob)
          return grew > 0
            ? { ...state, active: { ...active, outputTokens: active.outputTokens + grew } }
            : (state.active === active ? state : { ...state, active })
        }
        if (text === null) return state.active === active ? state : { ...state, active }
        const next = withOutput(active, estimateTokens(text), Number.isFinite(time) ? time : undefined)
        return next === active ? (state.active === active ? state : { ...state, active }) : { ...state, active: next }
      }

      // settlement：用官方精确 outputTokens 收敛；时间窗取自压缩流里 token 自身的产出时间。
      const usage = usageOfSettlement(event)
      if (usage === undefined) return state
      const turn = Number(event.data?.turn) || 0
      const step = Number(event.data?.step) || 0
      const active = ensureActive(state, turn, step)
      const window = streamWindow(event.data?.stream)
      const settledAt = Number(event.time)
      const outputTokens = Math.max(0, Number(usage.outputTokens) || 0)
      // 没有流记录时，两端都退回结算时间（此时无法给出有意义的时长，速率会被抑制）。
      const fallback = Number.isFinite(settledAt) ? { first: settledAt, last: settledAt } : {}
      const merged = {
        first: Number.isFinite(window.first) ? window.first : fallback.first,
        last: Number.isFinite(window.last) ? window.last : fallback.last,
      }
      return { ...state, active: withExact(active, outputTokens, merged) }
    },
    // 状态结构变更时升版，让旧缓存失效重折。
    stateVersion: 5,
    wire: {
      viewSchema,
      view: (state) => {
        // 本步已有可算的数值（结算精确值，或流式累加出的估算值）。
        const live = rateOf(state.active)
        if (Number.isFinite(live)) {
          return state.active.exact === false
            ? { tokensPerSecond: live, estimate: true }
            : { tokensPerSecond: live }
        }
        // 本步还在进行、又算不出数值：沿用上一步的已结算速率，并标 pending 让 UI 弱化显示。
        const last = state.last?.tokensPerSecond
        if (!Number.isFinite(last)) return {}
        return state.active === null
          ? { tokensPerSecond: last }
          : { tokensPerSecond: last, pending: true }
      },
    },
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
  PricesInput.parse(config.prices ?? {})
  z.record(z.string(), PricesInput).parse(config.providerPrices ?? {})
  // 运行时可变配置（优先使用用户在设置面板中动态修改的值）
  let runtimeConfig = {
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
    currency: normalizePricingCurrency(config.currency),
    pricingEpoch: 0,
    warningThreshold: config.warningThreshold ?? 10,
    dangerThreshold: config.dangerThreshold ?? 5,
    prices: { ...(config.prices ?? {}) },
    providerPrices: { ...(config.providerPrices ?? {}) },
    defaultPrices: { ...(config.defaultPrices ?? { cacheHit: 0.1, cacheMiss: 1, output: 2 }) },
    quotaSources: Array.isArray(config.quotaSources) ? config.quotaSources.map((s) => ({ ...s })) : [],
    providerQuotas: Array.isArray(config.providerQuotas) ? config.providerQuotas.map((binding) => ({ ...binding })) : [],
  }

  const getConfig = () => runtimeConfig
  const legacyKeyRef = (field, entryId = ctx.fiber?.entry?.options?.id ?? name) =>
    quotaCredentialRef(`legacy:${ctx.get('profileContext')?.name ?? 'default'}:${entryId}:${field}`)
  let configWriteQueue = Promise.resolve()

  ctx.on('internal/update', function (nextConfig) {
    PricesInput.parse(nextConfig.prices ?? {})
    z.record(z.string(), PricesInput).parse(nextConfig.providerPrices ?? {})
    this.config = nextConfig
    runtimeConfig = { ...nextConfig, pricingEpoch: Number(runtimeConfig.pricingEpoch ?? 0) + 1 }
    resetLoop()
    void refresh()
  })

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
    const inheritedThrough = cur.inheritedThrough ?? incoming.inheritedThrough ?? -1
    spendFolds.set(key, {
      currentModel: cur.currentModel ?? incoming.currentModel,
      currentProvider: cur.currentProvider ?? incoming.currentProvider,
      inheritedThrough,
      last: [cur.last, incoming.last].find((last) => last && Number(last.key) > inheritedThrough) ?? null,
      samples: Object.fromEntries(Object.entries({ ...(incoming.samples ?? {}), ...(cur.samples ?? {}) })
        .filter(([seq]) => Number(seq) > inheritedThrough)),
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

  const readPath = (value, path = []) => path.reduce((current, key) => current?.[key], value)

  /**
   * 读取 DSH 自己的供应商目录与设置。这里仅返回路由、地址和凭证引用，不读取密钥值。
   */
  const getDshProviders = () => {
    const llm = ctx.get('llm')
    const settings = ctx.get('settings')
    const live = new Map((llm?.listProviders?.() ?? []).map((provider) => [provider.id, provider]))
    const directory = llm?.listConfigurableProviders?.() ?? []
    const rows = new Map()
    for (const entry of directory) {
      const section = settings?.get?.(entry.settingsNs)
      const profile = readPath(section, entry.settingsPath) ?? {}
      const baseURL = typeof profile?.baseURL === 'string' ? profile.baseURL : ''
      const template = matchQuotaTemplateForProvider(entry.provider, baseURL)
      const quotaTemplate = template ? getQuotaSourceTemplate(template.id) : null
      rows.set(entry.provider, {
        id: entry.provider,
        name: live.get(entry.provider)?.name || entry.displayName || profile?.displayName || entry.provider,
        configured: live.has(entry.provider),
        settingsNs: entry.settingsNs,
        baseURL,
        authRef: typeof profile?.apiKeyEnv === 'string' ? profile.apiKeyEnv : '',
        credentialMode: typeof profile?.apiKeyEnv === 'string' ? 'reference' : 'record',
        templateId: template?.id ?? '',
        builtin: template?.builtin === true,
        quotaSupported: template !== null,
        quotaAutoEnabled: quotaTemplate?.autoEnable !== false,
      })
    }
    for (const provider of live.values()) {
      if (rows.has(provider.id)) continue
      const template = matchQuotaTemplateForProvider(provider.id)
      const quotaTemplate = template ? getQuotaSourceTemplate(template.id) : null
      rows.set(provider.id, {
        id: provider.id,
        name: provider.name || provider.id,
        configured: true,
        settingsNs: '',
        baseURL: '',
        authRef: '',
        credentialMode: 'record',
        templateId: template?.id ?? '',
        builtin: template?.builtin === true,
        quotaSupported: template !== null,
        quotaAutoEnabled: quotaTemplate?.autoEnable !== false,
      })
    }
    const deepseek = settings?.get?.('llm-deepseek')
    if (deepseek && typeof deepseek === 'object') {
      rows.set('deepseek-official', {
        id: 'deepseek-official',
        name: live.get('deepseek-official')?.name || 'DeepSeek Official',
        configured: live.has('deepseek-official'),
        settingsNs: 'llm-deepseek',
        baseURL: typeof deepseek.baseURL === 'string' ? deepseek.baseURL : 'https://api.deepseek.com',
        authRef: typeof deepseek.apiKeyEnv === 'string' ? deepseek.apiKeyEnv : 'DEEPSEEK_API_KEY',
        credentialMode: 'reference',
        templateId: 'deepseek',
        builtin: true,
        quotaSupported: true,
        quotaAutoEnabled: true,
      })
    }
    return [...rows.values()].sort((a, b) => Number(b.configured) - Number(a.configured) || a.name.localeCompare(b.name))
  }

  /**
   * 显式配置优先；旧 quotaSources 按 providerIds 迁移；能识别的 DSH 供应商默认自动绑定。
   * 不支持且未配置的供应商保留在列表中，但不会生成额度请求。
   */
  const getEffectiveProviderQuotas = () => {
    const directory = getDshProviders()
    const providers = new Map(directory.map((provider) => [normalizeProvider(provider.id), provider]))
    const explicit = new Map()
    for (const raw of runtimeConfig.providerQuotas ?? []) {
      try {
        const binding = normalizeProviderQuotaConfig(raw)
        explicit.set(normalizeProvider(binding.providerId), binding)
      } catch (error) {
        ctx.logger.warn(`[dsh-credits] ignored invalid provider quota (${raw?.providerId ?? ''}): ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const legacy = new Map()
    for (const source of runtimeConfig.quotaSources ?? []) {
      if (!source || source.enabled === false) continue
      for (const providerId of source.providerIds ?? []) {
        const key = normalizeProvider(providerId)
        if (!key || explicit.has(key) || legacy.has(key)) continue
        legacy.set(key, {
          providerId: String(providerId),
          enabled: true,
          sourceType: 'custom',
          templateId: String(source.template ?? ''),
          sourceProviderId: '',
          source,
          migrated: true,
        })
      }
    }
    const bindings = []
    for (const provider of directory) {
      const key = normalizeProvider(provider.id)
      let binding = explicit.get(key) ?? legacy.get(key) ?? {
        providerId: provider.id,
        enabled: provider.configured === true && provider.quotaSupported === true && provider.quotaAutoEnabled !== false,
        sourceType: provider.quotaSupported === true ? 'auto' : 'custom',
        templateId: provider.templateId || '',
        sourceProviderId: '',
        implicit: true,
      }
      const staleTemplate = binding.sourceType === 'template' && !getQuotaSourceTemplate(binding.templateId)
      if ((binding.sourceType === 'auto' && provider.quotaSupported !== true) || staleTemplate) {
        binding = {
          ...binding,
          enabled: false,
          sourceType: 'custom',
          templateId: '',
          sourceProviderId: '',
          staleTemplate: true,
        }
      }
      bindings.push({ ...binding, providerId: provider.id, provider })
      explicit.delete(key)
      legacy.delete(key)
    }
    for (const binding of [...explicit.values(), ...legacy.values()]) {
      const provider = providers.get(normalizeProvider(binding.providerId)) ?? {
        id: binding.providerId,
        name: binding.providerId,
        configured: false,
        baseURL: '',
        templateId: binding.templateId || '',
        quotaSupported: Boolean(binding.templateId),
        missing: true,
      }
      bindings.push({ ...binding, provider })
    }
    return bindings.map((binding) => ({
      ...binding,
      adapterId: binding.enabled !== false && binding.sourceType !== 'provider'
        ? providerQuotaAdapterId(binding.providerId)
        : '',
    }))
  }

  const getProviderQuotaMap = () => {
    const bindings = getEffectiveProviderQuotas()
    return Object.fromEntries(bindings.map((binding) => [binding.providerId, resolveProviderQuotaSource(binding.providerId, bindings)]))
  }

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

  /**
   * 设置页允许直接输入 Token/Cookie，但持久配置中只保留引用名。
   * 旧版本曾把 authValue 留在运行时配置；用户下一次保存时一并迁移。
   */
  const persistDirectQuotaCredential = async (previousRequest, incomingRequest, scope, writes) => {
    const merged = mergeMaskedQuotaRequest(previousRequest ?? {}, incomingRequest ?? {})
    const credentials = ctx.get('credentials')

    const profileScope = ctx.get('profileContext')?.name ? `${scope}:profile:${ctx.get('profileContext').name}` : scope
    const persistSecret = (ref, value) => {
      if (!credentials?.set) throw new Error('quota-credential-store-unavailable')
      writes.set(ref, value)
    }

    // 1. 直接填写的额度凭证 → DSH credentials，运行时只保留引用。
    if (merged.credentialMode === 'direct' && typeof merged.authValue !== 'object' && typeof merged.authRef !== 'object') {
      const previousRef = previousRequest?.credentialMode === 'direct' ? String(previousRequest.authRef ?? '').trim() : ''
      const ref = String(merged.authRef ?? '').trim() || previousRef || quotaCredentialRef(profileScope)
      const entered = String(incomingRequest?.authValue ?? '')
      const legacy = previousRequest?.credentialMode === 'direct' ? String(previousRequest.authValue ?? '') : ''
      const valueToStore = entered && entered !== '***'
        ? entered
        : (!previousRef && legacy && legacy !== '***' ? legacy : '')
      if (valueToStore) await persistSecret(ref, valueToStore)
      merged.dshProvider = ''
      merged.authRef = ref
      merged.authValue = ''
    }

    // 2. 敏感请求头同样持久化到 DSH credentials；YAML 只保留 @credential:<ref>。
    const headers = { ...(merged.headers ?? {}) }
    for (const [name, value] of Object.entries(headers)) {
      if (!isSensitiveHeader(name) || typeof value !== 'string' || value === '' || value === '***') continue
      if (value.startsWith(HEADER_CREDENTIAL_MARKER)) continue
      const ref = quotaCredentialRef(`${profileScope}:header:${name}`)
      await persistSecret(ref, value)
      headers[name] = `${HEADER_CREDENTIAL_MARKER}${ref}`
    }
    merged.headers = headers
    return merged
  }

  const persistConfigPatch = async (patch) => {
    const editor = ctx.get('configEditor')
    const entry = editor?.entries?.().find((row) => ctx.fiber ? row.fiber === ctx.fiber : row.options.id === name)
    if (!entry || !editor.edit) throw new Error('config-persistence-unavailable')
    const before = structuredClone(entry.options.config ?? {})
    const saved = { ...before, ...patch }
    const writes = new Map()
    for (const [field, refField] of [['apiKey', 'apiKeyRef'], ['opencodeApiKey', 'opencodeApiKeyRef']]) {
      if (typeof saved[field] !== 'string' || !saved[field]) continue
      const credentials = ctx.get('credentials')
      if (!credentials?.set) throw new Error('quota-credential-store-unavailable')
      const ref = legacyKeyRef(field, entry.options.id)
      writes.set(ref, saved[field])
      saved[refField] = ref
      saved[field] = ''
    }
    const secureSource = async (source, scope) => {
      if (!source?.request) return source
      const rawRequest = { ...source.request, credentialMode: source.request.credentialMode || (source.request.dshProvider ? 'provider' : source.request.authValue ? 'direct' : source.request.authStyle === 'none' ? 'none' : 'reference') }
      const request = await persistDirectQuotaCredential(rawRequest, rawRequest, scope, writes)
      // Credentials embedded in legacy URLs cannot safely be copied into a profile patch.
      if (typeof request.url === 'string' && request.url) {
        try {
          const url = new URL(request.url)
          if (url.username || url.password) throw new Error('quota-url-credentials-forbidden')
        } catch { throw new Error('quota-url-invalid-or-credentials-forbidden') }
      }
      if (typeof request.authValue !== 'object') delete request.authValue
      delete request.credentialConfigured
      return { ...source, request }
    }
    if (Array.isArray(saved.quotaSources)) saved.quotaSources = await Promise.all(saved.quotaSources.map((source) => secureSource(source, `source:${source.id}`)))
    if (Array.isArray(saved.providerQuotas)) saved.providerQuotas = await Promise.all(saved.providerQuotas.map(async (binding) => ({
      ...binding,
      ...(binding.source ? { source: await secureSource(binding.source, `provider:${binding.providerId}`) } : {}),
    })))
    const credentials = ctx.get('credentials')
    const previousSecrets = new Map()
    try {
      for (const [ref, value] of writes) {
        previousSecrets.set(ref, await credentials.resolve(ref))
        await credentials.set(ref, value)
      }
      await editor.edit(entry, (current) => {
        if (JSON.stringify(current) !== JSON.stringify(before)) throw new Error('config-changed-during-save')
        return saved
      })
    } catch (error) {
      for (const [ref, previous] of previousSecrets) {
        try {
          if (previous?.value) await credentials.set(ref, previous.value)
          else await credentials.unset?.(ref)
        } catch { ctx.logger.warn('dsh-credits: credential rollback failed') }
      }
      throw error
    }
    return saved
  }

  /** 复用 DSH 供应商已保存的 credential-ref 或 llm-pi-ai API-key record。 */
  const resolveDshProviderCredential = async (providerId) => {
    const id = String(providerId ?? '').trim()
    if (!id) return ''
    const profile = getDshProviders().find((provider) => provider.id === id)
    if (profile?.authRef) {
      const byRef = await resolveCredential(profile.authRef)
      if (byRef) return byRef
    }
    const credentials = ctx.get('credentials')
    if (credentials?.readRecord) {
      try {
        const record = await credentials.readRecord(`llm-pi-ai/${id}`)
        if (record?.kind === 'api-key' && typeof record.key === 'string' && record.key) return record.key
        const payload = record?.kind === 'grant' ? record.payload : null
        const access = payload?.access ?? payload?.access_token ?? payload?.token
        if (typeof access === 'string' && access) return access
      } catch {
        /* 不是可寻址的 DSH record，继续走模板自己的 authRef */
      }
    }
    return ''
  }

  /** 解析 DeepSeek 余额密钥。 */
  const resolveKey = async (overrideKey = null) => {
    if (typeof overrideKey === 'string' && overrideKey !== '') return overrideKey
    if (runtimeConfig.apiKey !== '') return runtimeConfig.apiKey
    if (runtimeConfig.apiKeyRef === legacyKeyRef('apiKey')) return resolveCredential(runtimeConfig.apiKeyRef)
    const fromDsh = await resolveDshProviderCredential('deepseek-official') || await resolveDshProviderCredential('deepseek')
    return fromDsh || resolveCredential(runtimeConfig.apiKeyRef)
  }

  /** 解析 OpenCode Go 订阅密钥(含 auth.json 回退, 覆盖 Windows 相对目录)。 */
  const resolveOpencodeKey = async (overrideKey = null) => {
    if (typeof overrideKey === 'string' && overrideKey !== '') return overrideKey
    if (runtimeConfig.opencodeApiKey !== '') return runtimeConfig.opencodeApiKey
    if (runtimeConfig.opencodeApiKeyRef === legacyKeyRef('opencodeApiKey')) return resolveCredential(runtimeConfig.opencodeApiKeyRef)
    const fromDsh = await resolveDshProviderCredential('opencode-go')
    if (fromDsh !== '') return fromDsh
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

  const getRuntimeAdapters = () => {
    const merged = new Map()
    for (const adapter of BUILTIN_QUOTA_ADAPTERS) merged.set(adapter.id, adapter)
    for (const source of runtimeConfig.quotaSources ?? []) {
      if (!source || typeof source.id !== 'string' || source.id.trim() === '') continue
      if (source.enabled === false) {
        merged.delete(source.id)
        continue
      }
      try {
        const normalized = normalizeQuotaSourceConfig(source)
        merged.set(normalized.id, { ...normalized, builtin: false })
      } catch (error) {
        ctx.logger.warn(`[dsh-credits] ignored invalid quota source (${source.id}): ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    for (const binding of getEffectiveProviderQuotas()) {
      try {
        const adapter = buildProviderQuotaAdapter(binding.provider, binding)
        if (adapter) merged.set(adapter.id, adapter)
      } catch (error) {
        ctx.logger.warn(`[dsh-credits] ignored provider quota adapter (${binding.providerId}): ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return [...merged.values()]
  }

  const getQuotaAdapter = (providerOrId) => matchQuotaAdapter(providerOrId, getRuntimeAdapters()) ?? null
  const getRuntimeAdapterIds = () => getRuntimeAdapters().map((adapter) => adapter.id)
  const getActiveRuntimeAdapterIds = () => {
    const ids = [...new Set(Object.values(getProviderQuotaMap()).filter(Boolean))]
    return ids.length > 0 ? ids : getRuntimeAdapterIds()
  }
  const resolveRuntimeQuotaSource = (modelProvider = null) => {
    const bindings = getEffectiveProviderQuotas()
    if (modelProvider !== null && modelProvider !== undefined && normalizeProvider(modelProvider)) {
      return resolveProviderQuotaSource(modelProvider, bindings)
    }
    const first = bindings.map((binding) => resolveProviderQuotaSource(binding.providerId, bindings)).find(Boolean)
    return first ?? resolveQuotaSource(null, runtimeConfig, getRuntimeAdapters())
  }

  const emptyQuotaCache = () => ({ state: 'empty', payload: null, error: null, errorKind: null, fetchedAt: 0, lastErrorAt: 0, retryable: false, fastRetryCount: 0 })
  const caches = new Map()
  const inflights = new Map()
  const consecutiveFailures = new Map()
  let accountEpoch = 0

  const ensureCache = (id) => {
    if (!caches.has(id)) caches.set(id, emptyQuotaCache())
    if (!inflights.has(id)) inflights.set(id, null)
    if (!consecutiveFailures.has(id)) consecutiveFailures.set(id, 0)
  }

  const isTransientQuotaError = (error) => {
    const name = error?.name
    const message = error instanceof Error ? error.message : String(error)
    return name === 'AbortError'
      || /aborted|timeout|timed out|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND/i.test(message)
  }

  const fetchCustomQuota = async (adapter, options = {}) => {
    if (adapter.template === 'deepseek-account') {
      const account = ctx.get('deepseekAccount')
      if (!account?.getBalance) throw new Error('deepseek-account-unavailable')
      let version = ''
      try {
        const manifest = createRequire(import.meta.url).resolve('@deepseek-ai/dsh-credentials/package.json')
        version = JSON.parse(await readFile(manifest, 'utf8')).version
      } catch { /* 未提供版本元数据的宿主不冒充插件版本。 */ }
      const result = await account.getBalance({
        version,
        locale: Intl.DateTimeFormat().resolvedOptions().locale,
        timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
      })
      if (result === null) throw new Error('deepseek-account-signed-out')
      if (result?.status !== 'ready') throw new Error('deepseek-account-balance-failed')
      const balances = [...new Set([
        ...result.value.map((wallet) => wallet.currency),
        ...result.bonusWallets.map((wallet) => wallet.currency),
      ])].map((currency) => {
        const sum = (wallets) => wallets.filter((wallet) => wallet.currency === currency)
          .reduce((total, wallet) => total + toAmount(wallet.balance), 0)
        const toppedUp = sum(result.value)
        const granted = sum(result.bonusWallets)
        return { currency, total: toppedUp + granted, granted, toppedUp }
      })
      return { provider: adapter.id, kind: 'balance', isAvailable: true, balances }
    }
    const request = adapter.request ?? {}
    const url = String(request.url ?? '').trim()
    if (!url) throw new Error('quota-url-missing')
    let key = request.authValue && request.authValue !== '***' ? String(request.authValue) : ''
    if (!key && request.dshProvider) key = await resolveDshProviderCredential(request.dshProvider)
    if (request.authRef) {
      key ||= await resolveCredential(request.authRef)
    }
    const authStyle = normalizeProvider(request.authStyle ?? 'none')
    if (authStyle !== 'none' && key === '') throw new Error('quota-credential-missing')
    const runtimeHeaders = {}
    for (const [name, value] of Object.entries(request.headers ?? {})) {
      const headerValue = String(value ?? '')
      if (!headerValue.startsWith(HEADER_CREDENTIAL_MARKER)) {
        runtimeHeaders[name] = headerValue
        continue
      }
      const ref = headerValue.slice(HEADER_CREDENTIAL_MARKER.length)
      const resolved = ref ? await resolveCredential(ref) : ''
      if (!resolved) throw new Error(`quota-header-credential-missing: ${name}`)
      runtimeHeaders[name] = resolved
    }
    const customRequest = buildCustomHttpRequest({ ...request, headers: runtimeHeaders }, key)
    const diagnosticSecrets = credentialDiagnosticSecrets(key, authStyle)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), runtimeConfig.timeoutMs)
    try {
      const res = await fetch(customRequest.url, {
        ...customRequest.init,
        signal: controller.signal,
      })
      const responseBody = await readFetchResponseBody(res)
      if (!res.ok) {
        const statusLabel = `${res.status}${res.statusText ? ` ${res.statusText}` : ''}`
        const diagnostics = buildHttpDiagnostics(customRequest, request, res, responseBody, diagnosticSecrets)
        const summary = upstreamErrorSummary(diagnostics.response.body)
        const error = new Error(`${adapter.name || adapter.id} API HTTP ${statusLabel}${summary ? `：${summary}` : ''}`)
        error.diagnostics = diagnostics
        throw error
      }
      let data
      try {
        data = responseBody ? JSON.parse(responseBody) : null
      } catch {
        const error = new Error('quota-invalid-json')
        error.diagnostics = buildHttpDiagnostics(customRequest, request, res, responseBody, diagnosticSecrets)
        throw error
      }
      const preview = options.includePreview === true ? { availableFields: collectQuotaFields(data) } : {}
      if (adapter.kind === 'balance') {
        if (adapter.template === 'deepseek') {
          return {
            provider: adapter.id,
            kind: 'balance',
            isAvailable: data?.is_available === true,
            balances: normalizeBalances(data),
            ...preview,
          }
        }
        const balances = normalizeCustomBalances(data, adapter.response)
        return {
          provider: adapter.id,
          kind: 'balance',
          // 多数自定义余额接口没有 is_available 字段；有余额就视为可用。
          isAvailable: data?.is_available !== false && balances.length > 0,
          balances,
          ...preview,
        }
      }
      if (adapter.kind === 'usage') {
        return {
          provider: adapter.id,
          kind: 'usage',
          usage: adapter.template
            ? normalizeTemplateUsage(adapter.template, data)
            : normalizeCustomUsage(data, adapter.response),
          ...preview,
        }
      }
      if (adapter.kind === 'metric') {
        return {
          provider: adapter.id,
          kind: 'metric',
          metrics: normalizeCustomMetrics(data, adapter.response),
          ...preview,
        }
      }
      return { provider: adapter.id, kind: adapter.kind || 'metric', ...preview }
    } finally {
      clearTimeout(timer)
    }
  }

  const fetchBuiltinQuota = async (adapter) => {
    const key = adapter.kind === 'usage' ? await resolveOpencodeKey() : await resolveKey()
    if (key === '') throw new Error('api-key-missing')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), runtimeConfig.timeoutMs)
    try {
      if (adapter.kind === 'usage') {
        const res = await fetch(runtimeConfig.opencodeBaseUrl.replace(/\/+$/, ''), {
          headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
          signal: controller.signal,
        })
        if (!res.ok) throw new Error(`OpenCode Go API HTTP ${res.status}`)
        const data = await res.json()
        return {
          provider: adapter.id,
          kind: 'usage',
          usage: normalizeOpencodeUsage(data),
        }
      }
      const res = await fetch(`${runtimeConfig.baseUrl.replace(/\/+$/, '')}/user/balance`, {
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(`DeepSeek API HTTP ${res.status}`)
      const data = await res.json()
      return {
        provider: adapter.id,
        kind: 'balance',
        isAvailable: data?.is_available === true,
        balances: normalizeBalances(data),
      }
    } finally {
      clearTimeout(timer)
    }
  }

  const refreshOne = (provider) => {
    const adapter = getQuotaAdapter(provider)
    if (!adapter) return Promise.resolve()
    ensureCache(adapter.id)
    if (inflights.get(adapter.id) !== null) return inflights.get(adapter.id)
    inflights.set(adapter.id, (async () => {
      const epoch = accountEpoch
      try {
        const payload = adapter.builtin === false
          ? await fetchCustomQuota(adapter)
          : await fetchBuiltinQuota(adapter)
        if (adapter.template === 'deepseek-account' && epoch !== accountEpoch) return
        caches.set(adapter.id, {
          state: 'ok',
          payload,
          error: null,
          errorKind: null,
          fetchedAt: Date.now(),
          lastErrorAt: 0,
          retryable: false,
          fastRetryCount: 0,
        })
        consecutiveFailures.set(adapter.id, 0)
      } catch (error) {
        if (adapter.template === 'deepseek-account' && epoch !== accountEpoch) return
        const message = error instanceof Error ? error.message : String(error)
        const transient = isTransientQuotaError(error)
        const prev = adapter.template === 'deepseek-account' ? emptyQuotaCache() : (caches.get(adapter.id) ?? emptyQuotaCache())
        const fastRetryCount = prev.fastRetryCount ?? 0
        const retryable = transient && fastRetryCount === 0
        const errorKind = transient
          ? 'quota-timeout'
          : ((message === 'api-key-missing' || message === 'quota-credential-missing') ? message : null)
        consecutiveFailures.set(adapter.id, (consecutiveFailures.get(adapter.id) ?? 0) + 1)
        if (consecutiveFailures.get(adapter.id) === 1) ctx.logger.warn(`[dsh-credits] quota fetch failed (${adapter.id}): ${message}`)
        caches.set(adapter.id, {
          state: prev.state === 'ok' ? 'ok' : 'error',
          payload: prev.payload,
          error: message,
          errorKind,
          fetchedAt: prev.fetchedAt,
          lastErrorAt: Date.now(),
          retryable,
          fastRetryCount: transient ? 1 : 0,
        })
      }
    })().finally(() => {
      inflights.set(adapter.id, null)
    }))
    return inflights.get(adapter.id)
  }

  const refresh = (provider = null) => {
    if (provider) return refreshOne(provider)
    return Promise.all(getActiveRuntimeAdapterIds().map((id) => refreshOne(id)))
  }

  ctx.inject(['deepseekAccount'], (accountCtx) => {
    accountCtx.effect(() => {
      const controller = new AbortController()
      const watch = async () => {
        for await (const _state of accountCtx.deepseekAccount.watch(controller.signal)) {
          accountEpoch++
          const ids = getRuntimeAdapters().filter((adapter) => adapter.template === 'deepseek-account').map((adapter) => adapter.id)
          for (const id of ids) caches.set(id, emptyQuotaCache())
          Promise.all(ids.map(async (id) => {
            await inflights.get(id)
            if (!controller.signal.aborted) await refreshOne(id)
          })).catch(() => ctx.logger.warn('dsh-credits: account refresh failed'))
        }
      }
      watch().catch(() => { if (!controller.signal.aborted) ctx.logger.warn('dsh-credits: account state watch failed') })
      return () => {
        controller.abort()
        accountEpoch++
        for (const adapter of getRuntimeAdapters()) {
          if (adapter.template === 'deepseek-account') caches.set(adapter.id, emptyQuotaCache())
        }
      }
    }, 'dsh-credits: account changes')
  })

  const adapterRefreshInterval = (id) => {
    const adapter = getQuotaAdapter(id)
    const interval = Number(adapter?.refreshIntervalMs)
    return Number.isFinite(interval) && interval >= 1000 ? interval : DEFAULT_REFRESH_INTERVAL_MS
  }
  const nextRefreshDelay = () => {
    const now = Date.now()
    const ids = getActiveRuntimeAdapterIds()
    if (ids.length === 0) return DEFAULT_REFRESH_INTERVAL_MS
    let delay = DEFAULT_REFRESH_INTERVAL_MS
    for (const id of ids) {
      const cache = caches.get(id)
      if (cache && cache.state !== 'ok') {
        const retryMs = cache.retryable === true ? 3000 : (cache.error === 'api-key-missing' || cache.error === 'quota-credential-missing' ? 5000 : adapterRefreshInterval(id))
        const dueIn = Math.max(0, Number(cache.lastErrorAt || 0) + retryMs - now)
        if (dueIn < delay) delay = dueIn
        continue
      }
      const interval = adapterRefreshInterval(id)
      const fetchedAt = Number(cache?.fetchedAt) || 0
      const dueIn = Math.max(0, fetchedAt + interval - now)
      if (dueIn < delay) delay = dueIn
    }
    return Math.max(1000, delay)
  }
  let loopTimer = null
  const resetLoop = () => {
    if (loopTimer !== null) {
      clearTimeout(loopTimer)
      loopTimer = null
    }
    const run = () => {
      const now = Date.now()
      const ids = getActiveRuntimeAdapterIds()
      const due = ids.filter((id) => {
        const cache = caches.get(id)
        if (!cache) return true
        if (cache.state !== 'ok') {
          const retryMs = cache?.retryable === true ? 3000 : (cache?.error === 'api-key-missing' || cache?.error === 'quota-credential-missing' ? 5000 : adapterRefreshInterval(id))
          return now - Number(cache.lastErrorAt || 0) >= retryMs
        }
        return now - Number(cache.fetchedAt || 0) >= adapterRefreshInterval(id)
      })
      void Promise.all(due.map((id) => refreshOne(id))).then(() => {
        const allMissing = ids.length > 0 && ids.every((id) => {
          const cache = caches.get(id)
          return cache?.state === 'error' && (cache?.error === 'api-key-missing' || cache?.error === 'quota-credential-missing')
        })
        const delay = allMissing ? 5000 : nextRefreshDelay()
        loopTimer = setTimeout(run, delay)
      })
    }
    loopTimer = setTimeout(run, 3000)
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

  const describeQuotaCredential = async (request) => {
    if (request?.credentialMode !== 'direct') return false
    if (request?.authValue && request.authValue !== '***') return true
    const ref = String(request?.authRef ?? '').trim()
    if (!ref) return false
    const credentials = ctx.get('credentials')
    if (credentials?.describe) {
      try {
        const info = await credentials.describe(ref)
        return info?.configured === true
      } catch {
        return false
      }
    }
    return Boolean(process.env[ref])
  }

  const sanitizeQuotaSource = async (rawSource) => {
    const source = mergeQuotaSourceTemplate(rawSource)
    return {
      ...source,
      request: {
        ...(source.request ?? {}),
        url: (() => {
          if (!source.request?.url) return source.request?.url
          try {
            const url = new URL(source.request.url)
            if (!url.username && !url.password) return source.request.url
            if (url.username) url.username = '***'
            if (url.password) url.password = '***'
            return url.toString()
          } catch {
            return ''
          }
        })(),
        authValue: '',
        credentialConfigured: await describeQuotaCredential(source.request),
        headers: Object.fromEntries(
          Object.entries(source.request?.headers ?? {})
            .map(([k, v]) => [
              k,
              String(v).startsWith(HEADER_CREDENTIAL_MARKER)
                ? String(v)
                : (isSensitiveHeader(k) ? '***' : String(v)),
            ]),
        ),
      },
    }
  }

  const sanitizeCustomQuotaSources = () => Promise.all((runtimeConfig.quotaSources ?? []).map(sanitizeQuotaSource))

  const sanitizeProviderQuotas = async () => {
    const bindings = getEffectiveProviderQuotas()
    return Promise.all(bindings.map(async (binding) => ({
      providerId: binding.providerId,
      enabled: binding.enabled !== false,
      sourceType: binding.sourceType,
      templateId: binding.templateId || binding.provider?.templateId || '',
      sourceProviderId: binding.sourceProviderId || '',
      thresholdsEnabled: true,
      thresholdMode: binding.thresholdMode === 'value' ? 'value' : (binding.thresholdMode === 'percent' ? 'percent' : null),
      warningThreshold: binding.warningThreshold ?? null,
      dangerThreshold: binding.dangerThreshold ?? null,
      refreshIntervalMs: binding.refreshIntervalMs ?? null,
      ...(binding.source ? { source: await sanitizeQuotaSource(binding.source) } : {}),
      adapterId: resolveProviderQuotaSource(binding.providerId, bindings),
      implicit: binding.implicit === true,
      migrated: binding.migrated === true,
    })))
  }

  const getSanitizedConfig = async () => {
    return {
      quotaMode: runtimeConfig.quotaMode === 'custom' ? 'custom' : 'follow',
      showDock: runtimeConfig.showDock !== false,
      dockLayout: normalizeDockLayout(runtimeConfig.dockLayout),
      showCapsule: runtimeConfig.showCapsule !== false,
      showPopover: runtimeConfig.showPopover !== false,
      showTps: runtimeConfig.showTps !== false,
      provider: runtimeConfig.provider,
      hasCustomKey: Boolean(runtimeConfig.apiKey) || runtimeConfig.apiKeyRef === legacyKeyRef('apiKey'),
      apiKeyMasked: maskKey(runtimeConfig.apiKey),
      apiKeyRef: runtimeConfig.apiKeyRef,
      baseUrl: runtimeConfig.baseUrl,
      hasOpencodeCustomKey: Boolean(runtimeConfig.opencodeApiKey) || runtimeConfig.opencodeApiKeyRef === legacyKeyRef('opencodeApiKey'),
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
      providerPrices: { ...runtimeConfig.providerPrices },
      defaultPrices: { ...runtimeConfig.defaultPrices },
      quotaSources: await sanitizeCustomQuotaSources(),
      providerQuotas: await sanitizeProviderQuotas(),
      quotaTemplates: QUOTA_SOURCE_TEMPLATES.map((template) => ({
        id: template.id,
        category: template.category,
        name: template.name,
        description: template.description,
        autoEnable: template.autoEnable !== false,
        source: mergeQuotaSourceTemplate({ template: template.id }),
      })),
      dshProviders: getDshProviders(),
    }
  }

  // 可选 webServer: 提供浏览器读取的缓存端点与设置端点
  ctx.inject(['webServer'], (webCtx) => {
    const serializeView = (source) => {
      const adapter = getQuotaAdapter(source)
      if (!adapter) {
        return {
          ok: false,
          provider: String(source ?? ''),
          kind: 'metric',
          name: String(source ?? ''),
          error: 'quota-source-not-found',
          fetchedAt: 0,
        }
      }
      const cache = caches.get(adapter.id) ?? emptyQuotaCache()
      const adapterThresholdMode = adapter.thresholdMode
        || (adapter.kind === 'usage' ? 'percent' : (adapter.kind === 'metric' && (adapter.response?.metrics ?? []).some((metric) => metric.totalPath || metric.calculation === 'subtract') ? 'percent' : 'value'))
      const base = {
        ok: false,
        provider: adapter.id,
        providerId: adapter.providerId ?? '',
        kind: adapter.kind,
        name: adapter.name,
        template: adapter.template ?? '',
        fetchedAt: cache.fetchedAt,
        refreshIntervalMs: adapter.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS,
        thresholdsEnabled: adapter.thresholdsEnabled === true,
        thresholdMode: adapterThresholdMode,
        thresholds: {
          warning: adapter.warningThreshold ?? defaultThresholdsFor(adapterThresholdMode, runtimeConfig.currency).warning,
          danger: adapter.dangerThreshold ?? defaultThresholdsFor(adapterThresholdMode, runtimeConfig.currency).danger,
          mode: adapterThresholdMode,
        },
      }
      if (cache.state !== 'ok' || cache.payload?.provider !== adapter.id) {
        return {
          ...base,
          error: cache.error ?? 'unknown',
          ...(cache.errorKind ? { errorKind: cache.errorKind } : {}),
        }
      }
      return {
        ...base,
        ok: true,
        ...(cache.payload.usage !== undefined ? { usage: cache.payload.usage } : {}),
        ...(cache.payload.metrics !== undefined ? { metrics: cache.payload.metrics } : {}),
        ...(cache.payload.isAvailable !== undefined ? { isAvailable: cache.payload.isAvailable } : {}),
        ...(cache.payload.balances !== undefined ? { balances: cache.payload.balances } : {}),
        ...(cache.error !== null ? { error: cache.error, stale: true, ...(cache.errorKind ? { errorKind: cache.errorKind } : {}) } : {}),
      }
    }

    const serialize = (source = resolveRuntimeQuotaSource(null)) => {
      const adapters = getRuntimeAdapters()
      const defaultAdapter = defaultQuotaAdapter(adapters)
      const picked = getQuotaAdapter(source)?.id ?? defaultAdapter?.id ?? 'deepseek'
      const view = serializeView(picked)
      const views = Object.fromEntries(getRuntimeAdapterIds().map((id) => [id, serializeView(id)]))
      return {
        ok: view.ok,
        provider: picked,
        kind: view.kind,
        sourceName: view.name,
        defaultProvider: resolveRuntimeQuotaSource(null),
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
        holidayCalendar: HOLIDAY_CALENDAR,
        thresholds: {
          warning: runtimeConfig.warningThreshold,
          danger: runtimeConfig.dangerThreshold,
        },
        // 直接透出配置价；内置官方模型的实际单价由客户端按每笔事件时间解析，
        // 不再在这里替换成“此刻”的单值（会丢掉 peak/offPeak 与历史时间表）。
        prices: { ...runtimeConfig.prices },
        providerPrices: { ...runtimeConfig.providerPrices },
        defaultPrices: runtimeConfig.defaultPrices,
        quotaSources: adapters.map((adapter) => ({
          id: adapter.id,
          kind: adapter.kind,
          name: adapter.name,
          providerIds: adapter.providerIds,
          providerPatterns: adapter.providerPatterns,
          default: adapter.default,
          enabled: adapter.enabled !== false,
        })),
        providerQuotaMap: getProviderQuotaMap(),
        views,
        ...(view.usage ? { usage: view.usage } : {}),
        ...(view.metrics ? { metrics: view.metrics } : {}),
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
        const defaultAdapter = defaultQuotaAdapter(getRuntimeAdapters())
        const source = sourceParam
          ? (getQuotaAdapter(sourceParam)?.id ?? defaultAdapter?.id ?? 'deepseek')
          : resolveRuntimeQuotaSource(null)
        if (force) {
          const now = Date.now()
          const targets = sourceParam ? [source] : getRuntimeAdapterIds()
          await Promise.all(targets.map((p) => {
            const c = caches.get(p)
            if (!c || now - c.fetchedAt > 2000 || c.state !== 'ok') return refreshOne(p)
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
            config: await getSanitizedConfig(),
          })
          return
        }
        if (req.method === 'POST') {
          try {
            const body = await readJsonBody(req)
            await (configWriteQueue = configWriteQueue.catch(() => {}).then(async () => {
              const nextConfig = { ...runtimeConfig }
              // 局部合并与类型校验
              if (typeof body.quotaMode === 'string' && QUOTA_MODES.includes(body.quotaMode)) nextConfig.quotaMode = body.quotaMode
              if (typeof body.showDock === 'boolean') nextConfig.showDock = body.showDock
              if (typeof body.dockLayout === 'string' && DOCK_LAYOUTS.includes(body.dockLayout)) nextConfig.dockLayout = body.dockLayout
              if (typeof body.showCapsule === 'boolean') nextConfig.showCapsule = body.showCapsule
              if (typeof body.showPopover === 'boolean') nextConfig.showPopover = body.showPopover
              if (typeof body.showTps === 'boolean') nextConfig.showTps = body.showTps
              if (typeof body.provider === 'string' && body.provider.trim()) nextConfig.provider = body.provider.trim()
              if (typeof body.apiKey === 'string') {
                nextConfig.apiKey = body.apiKey.trim()
                if (!nextConfig.apiKey && !body.apiKeyRef && nextConfig.apiKeyRef === legacyKeyRef('apiKey')) nextConfig.apiKeyRef = 'DEEPSEEK_API_KEY'
              }
              if (typeof body.apiKeyRef === 'string' && body.apiKeyRef.trim()) nextConfig.apiKeyRef = body.apiKeyRef.trim()
              if (typeof body.baseUrl === 'string' && body.baseUrl.trim()) nextConfig.baseUrl = body.baseUrl.trim()
              if (typeof body.opencodeApiKey === 'string') {
                nextConfig.opencodeApiKey = body.opencodeApiKey.trim()
                if (!nextConfig.opencodeApiKey && !body.opencodeApiKeyRef && nextConfig.opencodeApiKeyRef === legacyKeyRef('opencodeApiKey')) nextConfig.opencodeApiKeyRef = 'OPENCODE_GO_API_KEY'
              }
              if (typeof body.opencodeApiKeyRef === 'string' && body.opencodeApiKeyRef.trim()) nextConfig.opencodeApiKeyRef = body.opencodeApiKeyRef.trim()
              if (typeof body.opencodeBaseUrl === 'string' && body.opencodeBaseUrl.trim()) nextConfig.opencodeBaseUrl = body.opencodeBaseUrl.trim()
              if (Array.isArray(body.quotaSources)) {
                const prevSources = nextConfig.quotaSources ?? []
                const nextSources = []
                for (const s of body.quotaSources) {
                  const prev = prevSources.find((p) => p.id === s.id)
                  const request = mergeMaskedQuotaRequest(prev?.request, s.request)
                  nextSources.push(normalizeQuotaSourceConfig({
                    ...s,
                    request,
                  }))
                }
                if (new Set(nextSources.map((source) => source.id)).size !== nextSources.length) {
                  throw new Error('quota-source-id-duplicate')
                }
                nextConfig.quotaSources = nextSources
              }
              if (Array.isArray(body.providerQuotas)) {
                const prevBindings = nextConfig.providerQuotas ?? []
                const nextBindings = []
                for (const rawBinding of body.providerQuotas) {
                  const prev = prevBindings.find((binding) => normalizeProvider(binding.providerId) === normalizeProvider(rawBinding?.providerId))
                  if (rawBinding?.sourceType !== 'custom' || !rawBinding.source) {
                    nextBindings.push(normalizeProviderQuotaConfig(rawBinding))
                    continue
                  }
                  const request = mergeMaskedQuotaRequest(
                    prev?.source?.request,
                    rawBinding.source.request,
                  )
                  nextBindings.push(normalizeProviderQuotaConfig({
                    ...rawBinding,
                    source: {
                      ...rawBinding.source,
                      request,
                    },
                  }))
                }
                const normalizedProviderIds = nextBindings.map((binding) => normalizeProvider(binding.providerId))
                if (new Set(normalizedProviderIds).size !== normalizedProviderIds.length) {
                  throw new Error('provider-quota-provider-duplicate')
                }
                nextConfig.providerQuotas = nextBindings
              }
              if (typeof body.warningThreshold === 'number' && body.warningThreshold >= 0) nextConfig.warningThreshold = body.warningThreshold
              if (typeof body.dangerThreshold === 'number' && body.dangerThreshold >= 0) nextConfig.dangerThreshold = body.dangerThreshold
              if (typeof body.refreshIntervalMs === 'number' && body.refreshIntervalMs >= 1000) nextConfig.refreshIntervalMs = body.refreshIntervalMs
              if (typeof body.clientPollIntervalMs === 'number' && body.clientPollIntervalMs >= 1000) nextConfig.clientPollIntervalMs = body.clientPollIntervalMs
              if (typeof body.timeoutMs === 'number' && body.timeoutMs >= 1000) nextConfig.timeoutMs = body.timeoutMs
              if (typeof body.currency === 'string' && body.currency.trim()) nextConfig.currency = normalizePricingCurrency(body.currency)
              if (body.prices !== undefined) nextConfig.prices = PricesInput.parse(body.prices)
              if (body.providerPrices !== undefined) nextConfig.providerPrices = z.record(z.string(), PricesInput).parse(body.providerPrices)
              if (body.defaultPrices !== undefined) {
                if (!body.defaultPrices || typeof body.defaultPrices !== 'object' || Array.isArray(body.defaultPrices)) throw new Error('default-prices-invalid')
                nextConfig.defaultPrices = PriceInput.parse({ ...nextConfig.defaultPrices, ...body.defaultPrices })
              }
              const patch = Object.fromEntries(Object.keys(body).filter((key) => Object.hasOwn(nextConfig, key) && key !== 'pricingEpoch').map((key) => [key, nextConfig[key]]))
              for (const field of ['apiKeyRef', 'opencodeApiKeyRef']) {
                if (nextConfig[field] !== runtimeConfig[field]) patch[field] = nextConfig[field]
              }
              const saved = await persistConfigPatch(patch)
              runtimeConfig = { ...nextConfig, ...(ctx.fiber?.config ?? saved), pricingEpoch: Number(nextConfig.pricingEpoch ?? 0) + 1 }
            }))
            // 单价在 view() 时动态读取 getConfig()，改价无需重挂投影；重挂反而会清空
            // 本会话的 TPS，并在宿主拒绝同 key 重注册时留下空注册。

            // 配置变更后重设刷新循环并立即拉取一次最新数据
            resetLoop()
            await refresh()

            sendJson(res, 200, {
              ok: true,
              message: 'Config updated successfully',
              config: await getSanitizedConfig(),
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
          let rawDraftBinding = body.binding && typeof body.binding === 'object' ? body.binding : null
          if (rawDraftBinding?.sourceType === 'custom' && rawDraftBinding.source?.request) {
            const saved = (runtimeConfig.providerQuotas ?? []).find((binding) =>
              normalizeProvider(binding?.providerId) === normalizeProvider(rawDraftBinding.providerId))
            if (saved?.source?.request) {
              rawDraftBinding = {
                ...rawDraftBinding,
                source: {
                  ...rawDraftBinding.source,
                  request: mergeMaskedQuotaRequest(saved.source.request, rawDraftBinding.source.request),
                },
              }
            }
          }
          const draftBinding = rawDraftBinding ? normalizeProviderQuotaConfig(rawDraftBinding) : null
          const bindingProvider = draftBinding
            ? (getDshProviders().find((provider) => normalizeProvider(provider.id) === normalizeProvider(draftBinding.providerId)) ?? {
                id: draftBinding.providerId,
                name: draftBinding.providerId,
                baseURL: '',
                templateId: draftBinding.templateId || '',
              })
            : null
          let rawDraftSource = body.source && typeof body.source === 'object' ? body.source : null
          if (rawDraftSource?.request) {
            const saved = (runtimeConfig.quotaSources ?? []).find((source) => source?.id === rawDraftSource.id)
            if (saved?.request) rawDraftSource = { ...rawDraftSource, request: mergeMaskedQuotaRequest(saved.request, rawDraftSource.request) }
          }
          const draftRequested = rawDraftBinding !== null || rawDraftSource !== null
          const draftAdapter = draftBinding
            ? buildProviderQuotaAdapter(bindingProvider, { ...draftBinding, enabled: true })
            : (rawDraftSource
                ? { ...normalizeQuotaSourceConfig(rawDraftSource), builtin: false }
                : null)
          if (draftRequested && !draftAdapter) {
            sendJson(res, 400, { ok: false, error: 'quota-source-draft-invalid' })
            return
          }
          const adapter = draftRequested ? draftAdapter : (typeof body.provider === 'string' && getQuotaAdapter(body.provider)
            ? getQuotaAdapter(body.provider)
            : (getQuotaAdapter(runtimeConfig.provider) ?? defaultQuotaAdapter(getRuntimeAdapters())))
          if (!adapter) {
            sendJson(res, 400, { ok: false, error: 'quota-source-not-found' })
            return
          }
          if (adapter.builtin === false) {
            const payload = await fetchCustomQuota(adapter, { includePreview: true })
            sendJson(res, 200, { ok: true, provider: adapter.id, kind: adapter.kind, ...payload })
            return
          }
          if (adapter.kind === 'usage') {
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
                provider: adapter.id,
                kind: adapter.kind,
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
              provider: adapter.id,
              kind: adapter.kind,
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
            ...(err?.diagnostics ? { diagnostics: err.diagnostics } : {}),
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

    // 官方定价检查：抓官方页 → 与内置表比对 → 返回候选。不写任何配置，失败也不影响计价。
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: '/query-credits/pricing/check',
      async handler(req, res) {
        if (req.method !== 'POST') {
          res.writeHead(405, { Allow: 'POST' })
          res.end()
          return
        }
        let result
        try {
          result = await fetchOfficialPricing()
        } catch (error) {
          result = { ok: false, error: String(error?.message ?? error) }
        }
        if (!result.ok) {
          sendJson(res, 200, { ok: false, error: result.error })
          return
        }
        sendJson(res, 200, {
          ok: true,
          fetchedAt: result.fetchedAt,
          candidates: buildPricingCandidates(result.prices, (currency) => officialV4ConfigPrices(currency)),
          ...(result.errors?.length ? { errors: result.errors } : {}),
        })
      },
    }), 'dsh-credits: pricing check route')
  })

  // 可选 sessionProjections: 会话花费投影 (使用动态 getter)
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    let disposers = []
    const registerUnit = (unit) => {
      const ret = projectionCtx.sessionProjections.register(unit)
      if (typeof ret === 'function') return ret
      if (ret && typeof ret.dispose === 'function') return () => ret.dispose()
      return null
    }
    // 事务式挂载：先把新单元全部注册成功，再释放旧单元；任何一步失败都回滚到旧单元，
    // 避免出现“旧单元已 dispose、新单元没注册上”导致 TPS / 花费整段消失。
    const mount = () => {
      const next = []
      try {
        for (const unit of [makeTpsProjection(), makeCostProjection(getConfig)]) {
          const dispose = registerUnit(unit)
          if (dispose) next.push(dispose)
        }
      } catch (error) {
        for (const dispose of next) {
          try { dispose() } catch { /* 回滚失败也保留旧单元 */ }
        }
        ctx.logger?.warn?.('dsh-credits: 注册 session projection 失败，已保留旧单元', error)
        return false
      }
      const previous = disposers
      disposers = next
      for (const dispose of previous) {
        try { dispose() } catch { /* 新单元已生效，旧单元卸载失败无碍 */ }
      }
      return true
    }
    mount()
  })
}
