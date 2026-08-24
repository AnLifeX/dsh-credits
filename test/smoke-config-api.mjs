/**
 * 后端可视化配置与连接测试 API 冒烟测试:
 * 验证 /query-credits/config 的 GET/POST 路由与动态修改机制。
 * 运行: node test/smoke-config-api.mjs
 */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import {
  apply,
  buildProviderQuotaAdapter,
  collectQuotaFields,
  matchQuotaTemplateForProvider,
  normalizeCustomMetrics,
  normalizeTemplateUsage,
  quotaSourceFromProvider,
  resolveProviderQuotaSource,
  resolveQuotaSource,
} from '../src/index.js'

// 模拟 webServer 上下文与注册表
const routes = new Map()

const mockCtx = {
  get(key) {
    if (key === 'credentials') {
      return {
        async resolve(ref) {
          if (ref === 'DEEPSEEK_API_KEY') return { value: 'sk-mock-key-from-credentials' }
          return undefined
        },
        async readRecord(key) {
          if (key === 'llm-pi-ai/opencode-go') return { kind: 'api-key', key: 'sk-mock-opencode-record' }
          if (key === 'llm-pi-ai/go-work') return { kind: 'api-key', key: 'sk-go-work' }
          if (key === 'llm-pi-ai/go-personal') return { kind: 'api-key', key: 'sk-go-personal' }
          return undefined
        },
      }
    }
    if (key === 'llm') {
      return {
        listProviders: () => [
          { id: 'opencode-go', name: 'OpenCode Go' },
          { id: 'go-work', name: 'Work Go' },
          { id: 'go-personal', name: 'Personal Go' },
          { id: 'unsupported-route', name: 'Unsupported Route' },
        ],
        listConfigurableProviders: () => [
          { provider: 'opencode-go', displayName: 'OpenCode Go', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'opencode-go'] },
          { provider: 'go-work', displayName: 'Work Go', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'go-work'] },
          { provider: 'go-personal', displayName: 'Personal Go', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'go-personal'] },
          { provider: 'unsupported-route', displayName: 'Unsupported Route', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'unsupported-route'] },
        ],
      }
    }
    if (key === 'settings') {
      return {
        get(ns) {
          if (ns === 'llm-pi-ai') return { providers: {
            'opencode-go': { baseURL: 'https://opencode.ai/zen/go/v1' },
            'go-work': { baseURL: 'https://opencode.ai/zen/go/v1' },
            'go-personal': { baseURL: 'https://opencode.ai/zen/go/v1' },
            'unsupported-route': { baseURL: 'https://example.invalid/v1' },
          } }
          return undefined
        },
      }
    }
    return undefined
  },
  logger: {
    warn() {},
    info() {},
    error() {},
  },
  on() {
    return () => {}
  },
  effect(fn) {
    fn()
  },
  inject(keys, fn) {
    if (keys.includes('webServer')) {
      const webCtx = {
        effect(cb) { cb() },
        webServer: {
          register(def) {
            routes.set(def.path, def.handler)
          },
        },
      }
      fn(webCtx)
    }
    if (keys.includes('sessionProjections')) {
      const projCtx = {
        sessionProjections: {
          register(proj) {
            assert.ok(proj.stateSchema, `${proj.key} must provide stateSchema for DSH 0.1.1-rc.1`)
            assert.ok(proj.wire?.viewSchema && typeof proj.wire.view === 'function', `${proj.key} must provide a client wire view`)
            proj.stateSchema.parse(proj.init())
            proj.wire.viewSchema.parse(proj.wire.view(proj.init()))
            mockCtx._projection = proj
          },
        },
      }
      fn(projCtx)
    }
  },
}

// 网络 stub: DeepSeek 返回余额, OpenCode Go 返回三个窗口用量。
globalThis.fetch = async (url, options = {}) => {
  const target = String(url)
  if (target.includes('opencode')) {
    const authorization = String(options.headers?.Authorization ?? '')
    const rollingPercent = authorization.includes('sk-go-work')
      ? 21
      : (authorization.includes('sk-go-personal') ? 34 : 9)
    return {
      ok: true,
      status: 200,
      json: async () => ({
        usage: {
          rolling: { status: 'ok', percent: rollingPercent, resetsAt: '2026-08-14T07:20:04.810Z' },
          weekly: { status: 'ok', percent: 12, resetsAt: '2026-08-17T00:00:00.810Z' },
          monthly: { status: 'ok', percent: 6, resetsAt: '2026-09-09T00:41:03.810Z' },
        },
      }),
    }
  }
  if (target.includes('custom.example.com')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        is_available: true,
        data: { remaining: 25, total: 100, resetsAt: '2026-08-17T00:00:00.000Z' },
      }),
    }
  }
  return {
    ok: true,
    status: 200,
    json: async () => ({
      is_available: true,
      balance_infos: [{ currency: 'CNY', total_balance: '88.50', granted_balance: '0', topped_up_balance: '88.50' }],
    }),
  }
}

const initialConfig = {
  provider: 'deepseek',
  apiKey: '',
  apiKeyRef: 'DEEPSEEK_API_KEY',
  baseUrl: 'https://api.deepseek.com',
  opencodeApiKey: '',
  opencodeApiKeyRef: 'OPENCODE_GO_API_KEY',
  opencodeBaseUrl: 'https://opencode.ai/zen/go/v1/usage',
  warningThreshold: 10,
  dangerThreshold: 5,
  refreshIntervalMs: 300000,
  clientPollIntervalMs: 30000,
  currency: 'CNY',
  prices: {
    'deepseek-chat': { cacheHit: 0.1, cacheMiss: 1, output: 2 },
  },
  defaultPrices: { cacheHit: 0.1, cacheMiss: 1, output: 2 },
}

apply(mockCtx, initialConfig)

// Helper: 模拟 HTTP 请求触发 handler
function invokeRoute(path, method, body = null, query = '') {
  return new Promise((resolve, reject) => {
    const handler = routes.get(path)
    if (!handler) return reject(new Error('Route not found: ' + path))

    const req = new EventEmitter()
    req.method = method
    req.url = path + (query ? '?' + query : '')
    req.headers = { 'content-type': 'application/json' }

    let statusCode = 200
    let headers = {}
    let resBody = ''

    const res = {
      writeHead(code, hdrs) {
        statusCode = code
        headers = hdrs
      },
      end(chunk) {
        if (chunk) resBody += chunk
        try {
          const parsed = resBody ? JSON.parse(resBody) : null
          resolve({ status: statusCode, headers, data: parsed, text: resBody })
        } catch {
          resolve({ status: statusCode, headers, text: resBody })
        }
      },
    }

    handler(req, res).catch(reject)

    if (body !== null) {
      req.emit('data', Buffer.from(JSON.stringify(body)))
    }
    req.emit('end')
  })
}

async function runTests() {
  console.log('Testing /query-credits routes...')

  // 1. GET /query-credits/config
  const resGetConfig = await invokeRoute('/query-credits/config', 'GET')
  assert.equal(resGetConfig.status, 200)
  assert.equal(resGetConfig.data.ok, true)
  assert.equal(resGetConfig.data.config.warningThreshold, 10)
  assert.equal(resGetConfig.data.config.dangerThreshold, 5)
  assert.equal(resGetConfig.data.config.currency, 'CNY')
  assert.equal(resGetConfig.data.config.provider, 'deepseek')
  assert.equal(resGetConfig.data.config.enabled, true)
  assert.equal(resGetConfig.data.config.quotaMode, 'follow')
  assert.equal(resGetConfig.data.config.showDock, true)
  assert.equal(resGetConfig.data.config.dockLayout, 'own')
assert.equal(resGetConfig.data.config.showCapsule, true)
assert.equal(resGetConfig.data.config.showPopover, true)
  assert.equal(resGetConfig.data.config.showTps, true)
  assert.equal(resGetConfig.data.config.opencodeBaseUrl, 'https://opencode.ai/zen/go/v1/usage')
  assert.ok(resGetConfig.data.config.quotaTemplates.some((template) => template.id === 'kimi-coding'))
  assert.ok(resGetConfig.data.config.quotaTemplates.some((template) => template.id === 'opencode-go'))
  assert.deepEqual(new Set(resGetConfig.data.config.dshProviders.map((provider) => provider.id)), new Set([
    'opencode-go', 'go-work', 'go-personal', 'unsupported-route',
  ]))
  assert.equal(resGetConfig.data.config.dshProviders.find((provider) => provider.id === 'opencode-go').credentialMode, 'record')
  assert.equal(resGetConfig.data.config.providerQuotas.find((binding) => binding.providerId === 'go-work').templateId, 'opencode-go')
  assert.equal(resGetConfig.data.config.providerQuotas.find((binding) => binding.providerId === 'unsupported-route').enabled, false)
  console.log('GET /query-credits/config passed')

  // 2. POST /query-credits/config 修改阈值与单价
  const resPostConfig = await invokeRoute('/query-credits/config', 'POST', {
    warningThreshold: 30,
    dangerThreshold: 15,
    currency: 'USD',
    clientPollIntervalMs: 15000,
    prices: {
      'deepseek-v4-flash': { cacheHit: 0.02, cacheMiss: 1, output: 2 }
    }
  })
  assert.equal(resPostConfig.status, 200)
  assert.equal(resPostConfig.data.ok, true)
  assert.equal(resPostConfig.data.config.warningThreshold, 30)
  assert.equal(resPostConfig.data.config.dangerThreshold, 15)
  assert.equal(resPostConfig.data.config.currency, 'USD')
  assert.equal(resPostConfig.data.config.clientPollIntervalMs, 15000)
  assert.deepEqual(Object.keys(resPostConfig.data.config.prices), ['deepseek-v4-flash'], 'prices should be completely replaced without deleted models')
  console.log('POST /query-credits/config passed (including model deletion test)')

  // 2.5 OpenCode Go: 切换 provider 并验证 usage 缓存与连通性测试
  const resOpenCode = await invokeRoute('/query-credits/config', 'POST', {
    provider: 'opencode-go',
    opencodeApiKey: 'sk-opencode-mock',
  })
  assert.equal(resOpenCode.status, 200)
  assert.equal(resOpenCode.data.ok, true)
  assert.equal(resOpenCode.data.config.provider, 'opencode-go')
  assert.equal(resOpenCode.data.config.hasOpencodeCustomKey, true)
  console.log('POST /query-credits/config (opencode-go) passed')

  const resOpenCodeQuota = await invokeRoute('/query-credits', 'GET')
  assert.ok(resOpenCodeQuota.data.provider.startsWith('provider:'))
  assert.ok(resOpenCodeQuota.data.defaultProvider.startsWith('provider:'))
  assert.equal(resOpenCodeQuota.data.providerQuotaMap['opencode-go'], 'provider:opencode-go')
  assert.equal(resOpenCodeQuota.data.providerQuotaMap['go-work'], 'provider:go-work')
  assert.equal(resOpenCodeQuota.data.providerQuotaMap['go-personal'], 'provider:go-personal')
  assert.equal(resOpenCodeQuota.data.providerQuotaMap['unsupported-route'], null)
  assert.equal(resOpenCodeQuota.data.usage.rolling.percent, 9)
  assert.equal(resOpenCodeQuota.data.usage.weekly.percent, 12)
  assert.equal(resOpenCodeQuota.data.usage.monthly.percent, 6)
  assert.equal(resOpenCodeQuota.data.views['provider:opencode-go'].usage.rolling.percent, 9)
  assert.equal(resOpenCodeQuota.data.views['provider:go-work'].usage.rolling.percent, 21)
  assert.equal(resOpenCodeQuota.data.views['provider:go-personal'].usage.rolling.percent, 34)
  console.log('GET /query-credits (opencode-go) passed')

  const resDeepseekView = await invokeRoute('/query-credits', 'GET', null, 'source=deepseek&force=1')
  assert.equal(resDeepseekView.data.provider, 'deepseek')
  assert.ok(resDeepseekView.data.defaultProvider.startsWith('provider:'))
  assert.ok(Array.isArray(resDeepseekView.data.balances))
  assert.equal(resDeepseekView.data.views['provider:opencode-go'].usage.rolling.percent, 9)
  console.log('GET /query-credits?source=deepseek passed')

  // 2.6 自定义 HTTP / JSONPath 额度源
  process.env.CUSTOM_QUOTA_KEY = 'sk-custom-mock'
  const resCustomPost = await invokeRoute('/query-credits/config', 'POST', {
    providerQuotas: [{
      providerId: 'unsupported-route',
      enabled: true,
      sourceType: 'custom',
      source: {
        id: 'custom-metric',
        name: 'Custom Metric',
        kind: 'metric',
        providerIds: [],
        default: false,
        enabled: true,
        request: {
          url: 'https://custom.example.com/quota',
          dshProvider: '',
          authRef: 'CUSTOM_QUOTA_KEY',
          authStyle: 'bearer',
          headers: { 'X-Api-Key': 'secret-header-value' },
        },
        response: {
          metrics: [{
            key: 'remaining',
            label: '剩余额度',
            valuePath: '$.data.remaining',
            totalPath: '$.data.total',
            unit: 'USD',
            resetsAtPath: '$.data.resetsAt',
          }],
        },
      },
    }],
  })
  assert.equal(resCustomPost.data.ok, true)
  assert.equal(resCustomPost.data.config.providerQuotas.find((binding) => binding.providerId === 'unsupported-route').source.request.headers['X-Api-Key'], '***', 'custom header secrets must be masked')
  console.log('POST /query-credits/config (custom-metric) passed')

  const resCustom = await invokeRoute('/query-credits', 'GET', null, 'source=provider%3Aunsupported-route')
  assert.equal(resCustom.data.provider, 'provider:unsupported-route')
  assert.equal(resCustom.data.kind, 'metric')
  assert.equal(resCustom.data.metrics[0].value, 25)
  assert.equal(resCustom.data.metrics[0].total, 100)
  assert.equal(resCustom.data.metrics[0].unit, 'USD')
  assert.equal(resCustom.data.views['provider:unsupported-route'].ok, true)
  assert.equal(resCustom.data.providerQuotaMap['unsupported-route'], 'provider:unsupported-route')
  console.log('GET /query-credits?source=provider:unsupported-route passed')

  const customBinding = resCustomPost.data.config.providerQuotas.find((binding) => binding.providerId === 'unsupported-route')
  const resCustomConn = await invokeRoute('/query-credits/test-connection', 'POST', { binding: customBinding })
  assert.equal(resCustomConn.status, 200)
  assert.equal(resCustomConn.data.ok, true)
  assert.equal(resCustomConn.data.metrics[0].value, 25)
  assert.ok(resCustomConn.data.availableFields.some((field) => field.path === '$.data.remaining'))
  console.log('POST /query-credits/test-connection (custom-metric) passed')

  // 清空显式绑定，恢复按 DSH 供应商自动识别。
  const resResetConfig = await invokeRoute('/query-credits/config', 'POST', {
    quotaSources: [],
    providerQuotas: [],
  })
  assert.equal(resResetConfig.data.ok, true)

  assert.equal(quotaSourceFromProvider('opencode-go'), 'opencode-go')
  assert.equal(quotaSourceFromProvider('OPENCODE-GO'), 'opencode-go')
  assert.equal(quotaSourceFromProvider('deepseek'), 'deepseek')
  assert.equal(quotaSourceFromProvider('anthropic'), 'deepseek')
  assert.equal(quotaSourceFromProvider('openai'), 'deepseek')
  assert.equal(quotaSourceFromProvider('opencode'), 'deepseek')
  assert.equal(resolveQuotaSource('opencode-go', { quotaMode: 'follow', provider: 'deepseek' }), 'opencode-go')
  assert.equal(resolveQuotaSource('anthropic', { quotaMode: 'follow', provider: 'opencode-go' }), 'opencode-go')
  assert.equal(resolveQuotaSource('anthropic', { quotaMode: 'custom', provider: 'opencode-go' }), 'opencode-go')
  assert.equal(resolveQuotaSource('opencode-go', { quotaMode: 'custom', provider: 'deepseek' }), 'deepseek')
  console.log('quotaSourceFromProvider / resolveQuotaSource mapping passed')

  const providerBindings = [
    { providerId: 'go-work', enabled: true, sourceType: 'auto', adapterId: 'provider:go-work' },
    { providerId: 'go-personal', enabled: true, sourceType: 'provider', sourceProviderId: 'go-work' },
    { providerId: 'disabled-go', enabled: false, sourceType: 'auto', adapterId: 'provider:disabled-go' },
  ]
  assert.equal(resolveProviderQuotaSource('go-work', providerBindings), 'provider:go-work')
  assert.equal(resolveProviderQuotaSource('go-personal', providerBindings), 'provider:go-work')
  assert.equal(resolveProviderQuotaSource('disabled-go', providerBindings), null)
  assert.equal(resolveProviderQuotaSource('unknown', providerBindings), null)
  const workAdapter = buildProviderQuotaAdapter({
    id: 'go-work', name: 'Work Go', baseURL: 'https://opencode.ai/zen/go/v1', templateId: 'opencode-go',
  }, { providerId: 'go-work', enabled: true, sourceType: 'auto' })
  assert.equal(workAdapter.id, 'provider:go-work')
  assert.equal(workAdapter.request.url, 'https://opencode.ai/zen/go/v1/usage')
  assert.equal(workAdapter.request.dshProvider, 'go-work')
  assert.equal(workAdapter.template, 'opencode-go')
  console.log('provider-centric quota binding / reuse passed')

  assert.deepEqual(matchQuotaTemplateForProvider('my-kimi-route', 'https://api.kimi.com/coding/v1'), { builtin: false, id: 'kimi-coding' })
  assert.deepEqual(matchQuotaTemplateForProvider('deepseek-official'), { builtin: true, id: 'deepseek' })
  assert.deepEqual(matchQuotaTemplateForProvider('openrouter'), { builtin: false, id: 'openrouter-balance' })
  assert.deepEqual(matchQuotaTemplateForProvider('custom-minimax', 'https://api.minimaxi.com/v1'), { builtin: false, id: 'minimax-cn-coding' })
  const kimi = normalizeTemplateUsage('kimi-coding', {
    limits: [{ detail: { limit: 100, remaining: 75, resetTime: 1787600000000 } }],
    usage: { limit: 1000, remaining: 900, resetTime: 1787800000000 },
  })
  assert.equal(kimi.rolling.percent, 25)
  assert.equal(kimi.weekly.percent, 10)
  const metrics = normalizeCustomMetrics({ used: 35, total: 100 }, {
    metrics: [{ key: 'quota', usedPath: '$.used', totalPath: '$.total', scale: 1 }],
  })
  assert.equal(metrics[0].value, 65)
  assert.equal(metrics[0].used, 35)
  const overdrawnMetrics = normalizeCustomMetrics({ used: 120, total: 100 }, {
    metrics: [{ key: 'quota', usedPath: '$.used', totalPath: '$.total', scale: 1 }],
  })
  assert.equal(overdrawnMetrics[0].value, -20)
  assert.deepEqual(collectQuotaFields({ data: { remaining: 20 }, access_token: 'must-not-leak' }), [
    { path: '$.data.remaining', value: 20, type: 'number' },
  ])
  console.log('quota template parsing / safe field preview passed')

  const resQuotaMode = await invokeRoute('/query-credits/config', 'POST', {
    enabled: false,
    quotaMode: 'custom',
    showDock: false,
    dockLayout: 'shared',
    showCapsule: true,
    showPopover: false,
    showTps: false,
    prices: {
      'deepseek-v4-flash': { cacheHit: 0.02, cacheMiss: 1, output: 2 },
      'disabled-price-test': { cacheHit: 0.03, cacheMiss: 0.4, output: 0.8 },
    },
    defaultPrices: { cacheHit: 0.04, cacheMiss: 0.5, output: 0.9 },
  })
  assert.equal(resQuotaMode.data.config.quotaMode, 'follow', 'disabled global switch should ignore other config updates')
  assert.equal(resQuotaMode.data.config.enabled, false)
  assert.equal(resQuotaMode.data.config.showDock, true)
  assert.equal(resQuotaMode.data.config.dockLayout, 'own')
  assert.equal(resQuotaMode.data.config.showCapsule, true)
  assert.equal(resQuotaMode.data.config.showPopover, true)
  assert.equal(resQuotaMode.data.config.showTps, true)
  assert.deepEqual(resQuotaMode.data.config.prices['disabled-price-test'], { cacheHit: 0.03, cacheMiss: 0.4, output: 0.8 }, 'disabled global switch should still allow model price updates')
  assert.deepEqual(resQuotaMode.data.config.defaultPrices, { cacheHit: 0.04, cacheMiss: 0.5, output: 0.9 }, 'disabled global switch should still allow default price updates')
  const resQuotaPayload = await invokeRoute('/query-credits', 'GET')
  assert.equal(resQuotaPayload.data.quotaMode, 'follow')
  assert.equal(resQuotaPayload.data.enabled, false)
  assert.equal(resQuotaPayload.data.showDock, true)
  assert.equal(resQuotaPayload.data.dockLayout, 'own')
  assert.equal(resQuotaPayload.data.showPopover, true)
  assert.equal(resQuotaPayload.data.showTps, true)
  console.log('quotaMode / display flags config passed')

  const resOpenCodeConn = await invokeRoute('/query-credits/test-connection', 'POST', {
    provider: 'opencode-go',
    opencodeApiKey: 'sk-opencode-conn-test',
    timeoutMs: 1000,
  })
  assert.equal(resOpenCodeConn.status, 200)
  assert.equal(resOpenCodeConn.data.ok, true)
  assert.equal(resOpenCodeConn.data.provider, 'opencode-go')
  assert.equal(resOpenCodeConn.data.usage.rolling.percent, 9)
  console.log('POST /query-credits/test-connection (opencode-go) passed')

  // 3. 验证动态配置生效到会话花费投影
  if (mockCtx._projection) {
    let state = mockCtx._projection.init()
    state = mockCtx._projection.apply(state, {
      type: 'request/header',
      data: { header: { config: { model: 'deepseek-chat' } } },
    })
    state = mockCtx._projection.apply(state, {
      type: 'assistant/message',
      data: {
        turn: 0,
        step: 0,
        usage: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
    })
    const view = mockCtx._projection.wire.view(state)
    mockCtx._projection.wire.viewSchema.parse(view)
    assert.equal(view.currency, 'USD', 'Projection should reflect updated currency')
    console.log('Dynamic projection config update passed')
  }

  // 4. 验证 /query-credits/test-connection 路由注册
  assert.ok(routes.has('/query-credits/test-connection'), 'test-connection route should be registered')

  const resSpend = await invokeRoute('/query-credits/spend', 'GET', null, 'range=today')
  assert.equal(resSpend.status, 200)
  assert.equal(resSpend.data.ok, true)
  assert.equal(resSpend.data.range, 'today')
  assert.equal(typeof resSpend.data.cost, 'number')
  console.log('GET /query-credits/spend passed')

  console.log('ALL CONFIG API TESTS PASSED')
  process.exit(0)
}

runTests().catch((err) => {
  console.error('Test failed:', err)
  process.exit(1)
})
