/**
 * 后端可视化配置与连接测试 API 冒烟测试:
 * 验证 /query-credits/config 的 GET/POST 路由与动态修改机制。
 * 运行: node test/smoke-config-api.mjs
 */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { apply } from '../src/index.js'

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
      }
    }
    return undefined
  },
  logger: {
    warn() {},
    info() {},
    error() {},
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
            mockCtx._projection = proj
          },
        },
      }
      fn(projCtx)
    }
  },
}

// 网络 stub: DeepSeek 返回余额, OpenCode Go 返回三个窗口用量。
globalThis.fetch = async (url) => {
  const target = String(url)
  if (target.includes('opencode')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        usage: {
          rolling: { status: 'ok', percent: 9, resetsAt: '2026-08-14T07:20:04.810Z' },
          weekly: { status: 'ok', percent: 12, resetsAt: '2026-08-17T00:00:00.810Z' },
          monthly: { status: 'ok', percent: 6, resetsAt: '2026-09-09T00:41:03.810Z' },
        },
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
  assert.equal(resGetConfig.data.config.opencodeBaseUrl, 'https://opencode.ai/zen/go/v1/usage')
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
  assert.equal(resOpenCodeQuota.data.provider, 'opencode-go')
  assert.equal(resOpenCodeQuota.data.usage.rolling.percent, 9)
  assert.equal(resOpenCodeQuota.data.usage.weekly.percent, 12)
  assert.equal(resOpenCodeQuota.data.usage.monthly.percent, 6)
  console.log('GET /query-credits (opencode-go) passed')

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
    const view = mockCtx._projection.view(state)
    assert.equal(view.currency, 'USD', 'Projection should reflect updated currency')
    console.log('Dynamic projection config update passed')
  }

  // 4. 验证 /query-credits/test-connection 路由注册
  assert.ok(routes.has('/query-credits/test-connection'), 'test-connection route should be registered')

  console.log('ALL CONFIG API TESTS PASSED')
  process.exit(0)
}

runTests().catch((err) => {
  console.error('Test failed:', err)
  process.exit(1)
})

