/**
 * 客户端 bundle 冒烟测试: 内置零依赖 React Mock 与桩 loader 执行 client/client.js,
 * 验证: 模块注册、注入点、组件渲染、红黄绿状态小控件及 Tooltip 逻辑。
 * 运行: node test/smoke-client.mjs
 */
import { readFileSync } from 'node:fs'

const bundlePath = new URL('../client/client.js', import.meta.url)

let captured = null
globalThis.window = {
  __ModuleLoader__: {
    load(entry) {
      captured = entry
    },
  },
}

// 模拟 DOM 环境 (注入 CSS 及 visibility 处理)
globalThis.document = {
  hidden: false,
  addEventListener() {},
  removeEventListener() {},
  querySelector: () => null,
  createElement: () => ({ dataset: {}, set textContent(v) { this._t = v } }),
  head: { appendChild: () => {} },
}

const localStore = {}
globalThis.localStorage = {
  getItem(key) { return Object.prototype.hasOwnProperty.call(localStore, key) ? localStore[key] : null },
  setItem(key, value) { localStore[key] = String(value) },
  removeItem(key) { delete localStore[key] },
}
const sessionStore = {}
globalThis.sessionStorage = {
  getItem(key) { return Object.prototype.hasOwnProperty.call(sessionStore, key) ? sessionStore[key] : null },
  setItem(key, value) { sessionStore[key] = String(value) },
  removeItem(key) { delete sessionStore[key] },
}

// 零依赖 React Mock
const ReactMock = {
  Fragment: Symbol.for('react.fragment'),
  memo: (comp) => comp,
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useEffect() {},
  useMemo: (fn) => fn(),
  useRef: (init) => ({ current: init ?? null }),
  useSyncExternalStore: (subscribe, getSnapshot) => {
    subscribe(() => {})
    return getSnapshot()
  },
  createElement: (type, props, ...children) => {
    const flattened = children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false && c !== true)
    const finalChildren = flattened.length > 0 ? (flattened.length === 1 ? flattened[0] : flattened) : props?.children
    return {
      type,
      props: { ...(props ?? {}), children: finalChildren },
    }
  },
}

// 零依赖 HTML 渲染器
function renderToStaticMarkup(vnode) {
  if (vnode === null || vnode === undefined || vnode === false || vnode === true) return ''
  if (typeof vnode === 'string' || typeof vnode === 'number') return String(vnode)
  if (Array.isArray(vnode)) return vnode.map(renderToStaticMarkup).join('')
  if (typeof vnode.type === 'function') {
    const rendered = vnode.type(vnode.props)
    return renderToStaticMarkup(rendered)
  }
  if (vnode.type === ReactMock.Fragment) {
    return renderToStaticMarkup(vnode.props?.children)
  }
  if (typeof vnode.type === 'string') {
    const tag = vnode.type
    const { children, className, ...rest } = vnode.props ?? {}
    let attrs = ''
    if (className) attrs += ` class="${className}"`
    for (const [k, v] of Object.entries(rest)) {
      if (typeof v === 'string' || typeof v === 'number') {
        attrs += ` ${k}="${v}"`
      }
    }
    const inner = renderToStaticMarkup(children)
    return `<${tag}${attrs}>${inner}</${tag}>`
  }
  return ''
}

// 桩 primitives: Tooltip 把 label 渲染到 data-label(便于断言), 图标桩渲染 "?"
function stubPrimitives(React) {
  return {
    Tooltip: ({ label, children }) => React.createElement('span', { 'data-label': typeof label === 'string' ? label : '' }, children ?? null),
    IconQuestionOutline14: () => React.createElement('span', null, '?'),
  }
}

const code = readFileSync(bundlePath, 'utf8')

// 以 CJS 方式执行 bundle
new Function('window', 'require', code)(globalThis.window, (id) => {
  if (id === 'react') return ReactMock
  if (id === '@deepseek-ai/dsh-client-ui-primitives') return stubPrimitives(ReactMock)
  throw new Error('unexpected require: ' + id)
})

if (captured === null) throw new Error('loader.load was not called')
if (captured.id !== 'dsh-credits') throw new Error('bad id: ' + captured.id)

const factoryResult = captured.factory((id) => {
  if (id === 'react') return ReactMock
  if (id === '@deepseek-ai/dsh-client-ui-primitives') return stubPrimitives(ReactMock)
  throw new Error('unexpected require: ' + id)
})
const api = factoryResult ?? {}
console.log('exports:', Object.keys(api))
function makeSlotCtx(regs, injectFn) {
  const ctx = {
    effect(fn) { fn() },
    inject: injectFn ?? (() => {}),
    locale: { register() {}, bind: () => (key) => key },
    slots: {
      inject(_name, factory) { factory() },
      register(opts, comp) {
        regs.push({ id: opts.id, order: opts.order, name: opts.name, locale: opts.locale, label: opts.label, comp })
        return () => {}
      },
    },
  }
  return ctx
}

function slotOf(regs, name) {
  return regs.find((r) => r.name === name)
}

if (typeof api.apply !== 'function') throw new Error('no apply')
if (JSON.stringify(api.inject) !== JSON.stringify(['slots', 'locale'])) throw new Error('bad inject')
if (/\bconfirm\s*\(\s*['"`]/.test(code)) throw new Error('native confirm() dialog should be removed')
if (!code.includes("data-dshqb-nav")) throw new Error('settings nav icon painter missing')
if (code.includes("ellipse cx='8' cy='5.1'")) throw new Error('stacked-coin icon should be replaced with currency coin')
if (!code.includes("[data-dshqb-nav='credits']")) throw new Error('credits nav icon missing')
if (!code.includes('data-dshqb-dock')) throw new Error('dock merge marker missing')
if (!code.includes("data-dshqb-layout")) throw new Error('dock layout marker missing')
if (!code.includes("[data-dshqb-layout='own']")) throw new Error('independent dock layout CSS missing')
if (!code.includes("[data-dshqb-layout='shared']")) throw new Error('shared dock layout CSS missing')
if (!code.includes('dsh-credits.settingsDraft.')) throw new Error('settings draft store missing')
if (!code.includes('settings.unsaved')) throw new Error('unsaved badge i18n missing')
if (!code.includes('settings.overridden')) throw new Error('overridden badge i18n missing')
if (!code.includes('settings.resetField')) throw new Error('per-field reset i18n missing')
if (!code.includes('settings.btnDiscard')) throw new Error('discard action missing')
if (!code.includes('dshqb_pcard')) throw new Error('plugin card shell missing')
if (!code.includes('settings.card.display')) throw new Error('display card i18n missing')
if (/\.dshqb_root\{[^}]*width:100%/.test(code)) throw new Error('shared dock root must not take full width by default')
if (!code.includes('copyTestDiagnostics')) throw new Error('quota test diagnostics copy action missing')
if (!code.includes('data.diagnostics ?? null')) throw new Error('quota test error diagnostics are not retained')
if (!code.includes('dshqb_diagnostic_preview')) throw new Error('quota test response preview missing')
if (!code.includes('settings.cookieCredentialHint')) throw new Error('cookie credential format hint missing')
if (!code.includes('dshqb_toast_error')) throw new Error('error toast styling missing')
if (!code.includes('preserveTestFields')) throw new Error('response field choices should survive mapping edits')
if (!code.includes('settings.metricMappingHint')) throw new Error('metric mapping guidance missing')
if (!code.includes('settings.metricScaleHint')) throw new Error('metric conversion formula hint missing')
if (!code.includes('Multiple-value handling (arrays only)')) throw new Error('array-only transform wording missing')

const capturedRegister = []
api.apply(makeSlotCtx(capturedRegister))
const dockReg = slotOf(capturedRegister, 'conversation.composer.dock')
const settingsReg = slotOf(capturedRegister, 'settings.section')
console.log('slots:', capturedRegister.map((r) => ({ id: r.id, order: r.order, name: r.name, locale: r.locale })))
if (!dockReg || dockReg.id !== 'dsh-credits' || dockReg.order !== 1000) throw new Error('bad dock slot registration')
if (!settingsReg || settingsReg.id !== 'dsh-credits' || settingsReg.order !== 1000) throw new Error('bad settings.section registration')
if (typeof settingsReg.label !== 'function') throw new Error('settings.section should expose a nav label')

// 模拟 API 数据与国际化
let mockBalanceTotal = 100.23
let mockIsAvailable = true
const mockSpend = {
  ok: true,
  range: 'today',
  from: Date.now() - 86400000,
  to: Date.now(),
  currency: 'CNY',
  cost: 12.5,
  costByModel: { 'deepseek-chat': 12.5 },
  tokens: { uncachedInput: 100, cacheRead: 0, cacheWrite: 0, output: 50 },
  calls: 3,
  sessions: 2,
}

function installFetch(balancePayload) {
  globalThis.fetch = async (url) => {
    const href = String(url)
    if (href.includes('/query-credits/spend')) {
      return { ok: true, json: async () => ({ ...mockSpend }) }
    }
    return { ok: true, json: async () => balancePayload() }
  }
}

installFetch(() => ({
  ok: true,
  fetchedAt: Date.now(),
  refreshIntervalMs: 300000,
  clientPollIntervalMs: 30000,
  currency: 'CNY',
  thresholds: { warning: 10, danger: 5 },
  isAvailable: mockIsAvailable,
  balances: [
    { currency: 'USD', total: 0, granted: 0, toppedUp: 0 },
    { currency: 'CNY', total: mockBalanceTotal, granted: 0, toppedUp: mockBalanceTotal },
  ],
  prices: {
    'deepseek-v4-flash': { cacheHit: 0.02, cacheMiss: 0.1, output: 0.2 },
    'deepseek-v4-pro': { cacheHit: 0.025, cacheMiss: 3, output: 6 },
    'deepseek-chat': { cacheHit: 0.2, cacheMiss: 2, output: 8 },
    'deepseek-reasoner': { cacheHit: 0.5, cacheMiss: 4, output: 16 },
  },
  defaultPrices: { cacheHit: 0.2, cacheMiss: 2, output: 8 },
}))

const Comp = dockReg.comp
const props = {
  t: (key, params) => {
    const dict = {
      'balance': '余额 {amount}',
      'status.sufficient': '充足',
      'status.warning': '偏低',
      'status.danger': '告急',
      'sessionCost': '本会话约 {amount}',
      'tps': 'TPS {rate} tok/s',
      'card.balanceTitle': '📊 账户余额',
      'card.sessionTitle': '⚡ 本会话消耗',
      'card.total': '总额: ',
      'card.wallet': '{currency} 钱包',
      'card.topup': '充值 {amount}',
      'card.granted': '赠送 {amount}',
      'card.updated': '更新于 {time} · 每 {interval} 刷新',
      'card.refreshHint': '💡 点击状态灯或卡片上的状态/百分比可立即刷新',
      'card.tokens': 'Token: 输入 {input} · 输出 {output}',
      'card.tokensHit': '命中: {hit} ({hitRate}%)',
      'card.noCost': '本会话暂未产生消耗',
      'card.pricingHint': '💡 计价规则与单价请见右侧 [?]',
      'tariff.peak': '梁文峰时刻',
      'tariff.offPeak': '梁文谷时刻',
      'tariff.peakTitle': '梁文峰时刻：北京时间周一至周五 09:00–12:00、14:00–18:00\n梁文谷时刻：其余时段（含周末）',
      'tariff.offPeakTitle': '梁文峰时刻：北京时间周一至周五 09:00–12:00、14:00–18:00\n梁文谷时刻：其余时段（含周末）',
      'pricing.title': '📋 DeepSeek V4 定价参考',
      'pricing.rateBadge': '每 1M tokens · {currency}',
      'pricing.hit': '命中 {price}',
      'pricing.miss': '未命中 {price}',
      'pricing.output': '输出 {price}',
      'pricing.link': '查看官方完整定价页 ›',
      'pricing.aria': '查看 DeepSeek 定价策略',
      'tip.statusAvailable': '可用',
      'tip.statusUnavailable': '不足',
      'tip.error': '获取失败: {error}',
      'model.unknown': '未知模型',
      'model.other': '其他模型',
      'unit.minutes': '{n} 分钟',
      'unit.seconds': '{n} 秒',
      'spend.pill': '{range} {amount}',
      'spend.title': '累计消耗',
      'spend.today': '今天',
      'spend.yesterday': '昨天',
      'spend.week': '本周',
      'spend.month': '本月',
      'spend.custom': '自定义',
      'spend.from': '开始时间',
      'spend.to': '结束时间',
      'spend.meta': '{calls} 次调用 · {sessions} 个会话',
      'spend.empty': '该区间暂无消耗',
      'spend.open': '打开累计消耗',
      'spend.close': '收起',
    }
    let out = dict[key] ?? key
    for (const [k, v] of Object.entries(params ?? {})) out = out.replaceAll('{' + k + '}', String(v))
    return out
  },
  useProjection: (key) => key === 'liveTokenUsage' ? ({ tokensPerSecond: 31.4 }) : ({
    models: ['deepseek-chat'],
    cost: 0.000712,
    costByModel: { 'deepseek-chat': 0.000712 },
    tokens: { uncachedInput: 100, cacheRead: 60, cacheWrite: 10, output: 60 },
    tokensByModel: { 'deepseek-chat': { uncachedInput: 100, cacheRead: 60, cacheWrite: 10, output: 60 } },
    legs: [{ t: Date.now(), model: 'deepseek-chat', uncachedInput: 100, cacheRead: 60, cacheWrite: 10, output: 60 }],
    currency: 'CNY',
  }),
}

// 1. 验证绿色 (充足: 100.23 >= 10)
renderToStaticMarkup(ReactMock.createElement(Comp, props))
await new Promise((r) => setTimeout(r, 400))
const htmlGreen = renderToStaticMarkup(ReactMock.createElement(Comp, props))
console.log('rendered (green):', htmlGreen)
if (!htmlGreen.includes('100.23')) throw new Error('balance not rendered')
if (!htmlGreen.includes('TPS 31.4 tok/s')) throw new Error('TPS should render in the bottom dock')
if (!htmlGreen.includes('dshqb_dot_success')) throw new Error('green status dot missing')
if (!htmlGreen.includes('dshqb_dot_btn')) throw new Error('status button class missing')
if (!htmlGreen.includes('<button')) throw new Error('status button element missing')
if (!htmlGreen.includes('dshqb_trigger')) throw new Error('trigger container missing')
if (!htmlGreen.includes('dshqb_popover')) throw new Error('popover container missing')
if (!htmlGreen.includes('dshqb_card_title')) throw new Error('popover titles should use ellipsis title class')
if (!code.includes('container-type:inline-size')) throw new Error('popover should use container queries')
if (!code.includes('clamp(11px')) throw new Error('popover should use fluid type')
if (code.includes('min-width:440px')) throw new Error('popover min-width should not stay hardcoded at 440px')
if (!htmlGreen.includes('dshqb_col')) throw new Error('dual column missing')
if (!htmlGreen.includes('dshqb_vsep')) throw new Error('vertical separator missing')
if (!htmlGreen.includes('📊 账户余额')) throw new Error('balance title missing')
if (!htmlGreen.includes('⚡ 本会话消耗')) throw new Error('session title missing')
if (htmlGreen.includes('dshqb_card_settings_link')) throw new Error('settings link should not appear in hover card')
if (htmlGreen.includes('打开偏好设置')) throw new Error('settings entry should not appear in hover card')
if (htmlGreen.includes('title="插件设置"')) throw new Error('in-session settings gear should be removed')
if (htmlGreen.includes('<svg')) throw new Error('gear svg should be removed from session bar')
if (!htmlGreen.includes('dshqb_card_tokens')) throw new Error('tokens container class missing')
if (!htmlGreen.includes('dshqb_card_hit')) throw new Error('hit container class missing')
if (!htmlGreen.includes('命中: 60')) throw new Error('hit token count missing')
if (!htmlGreen.includes('dshqb_pricing_wrap')) throw new Error('pricing wrap missing')
if (!htmlGreen.includes('dshqb_pricing_popover')) throw new Error('pricing popover missing')
if (!htmlGreen.includes('📋 DeepSeek V4 定价参考')) throw new Error('v4 pricing title missing')
if (!htmlGreen.includes('deepseek-v4-flash')) throw new Error('v4 flash model missing')
if (!htmlGreen.includes('deepseek-v4-pro')) throw new Error('v4 pro model missing')
if (!htmlGreen.includes('命中 ¥0.1')) throw new Error('v4 peak hit rate missing')
if (!htmlGreen.includes('未命中 ¥3')) throw new Error('v4 peak miss rate missing')
if (!htmlGreen.includes('输出 ¥9')) throw new Error('v4 peak output rate missing')
if (!htmlGreen.includes('命中 ¥0.05')) throw new Error('v4 off-peak hit rate missing')
if (!htmlGreen.includes('未命中 ¥1.5')) throw new Error('v4 off-peak miss rate missing')
if (!htmlGreen.includes('输出 ¥4.5')) throw new Error('v4 off-peak output rate missing')
// 验证非 V4 模型被成功过滤不展示在定价气泡中
if (htmlGreen.includes('• deepseek-chat</span><div class="dshqb_pricing_rates"')) throw new Error('non-v4 model should be filtered out')
if (!htmlGreen.includes('CNY 钱包')) throw new Error('CNY wallet row missing')
if (!htmlGreen.includes('USD 钱包')) throw new Error('USD wallet row missing')
if (!htmlGreen.includes('$0.00')) throw new Error('zero USD wallet should still appear on card')
if (!htmlGreen.includes('dshqb_card_badge_btn')) throw new Error('balance status badge should be a refresh button')
if (!htmlGreen.includes('梁文峰时刻') && !htmlGreen.includes('梁文谷时刻')) throw new Error('tariff badge should show current peak/valley period')
if (htmlGreen.includes('dshqb_tariff_tooltip')) throw new Error('old tariff tooltip should be removed')
if (!htmlGreen.includes('dshqb_hover_tip') || !htmlGreen.includes('梁文峰时刻：北京时间周一至周五 09:00–12:00、14:00–18:00') || !htmlGreen.includes('梁文谷时刻：其余时段（含周末）')) throw new Error('tariff badge should show the exact two-line Beijing-time tooltip')
if (htmlGreen.includes('title="梁文峰时刻') || htmlGreen.includes('title="梁文谷时刻')) throw new Error('tariff tooltip should not duplicate as a native title')
if (!htmlGreen.includes('dshqb_tariff_badge dshqb_card_badge dshqb_card_badge_btn') && !htmlGreen.includes('dshqb_card_badge dshqb_card_badge_btn dshqb_tariff_badge')) throw new Error('tariff badge should use the same button format as status badges')
if (htmlGreen.indexOf('梁文') > htmlGreen.indexOf('● 充足')) throw new Error('tariff badge should be left of balance status badge')
if (!htmlGreen.includes('余额 ¥100.23')) throw new Error('CNY preferred readout should hide empty extra currencies')
if (!htmlGreen.includes('dshqb_cap')) throw new Error('spend capsule missing')
if (!htmlGreen.includes('dshqb_cap_pill')) throw new Error('spend pill missing')
if (!htmlGreen.includes('今天 ¥12.50')) throw new Error('today spend pill amount missing')
if (!htmlGreen.includes('data-dshqb-layout="own"')) throw new Error('default dock layout should be own line')

const settingsT = (key, params) => {
  const dict = {
    'settings.title': '额度与消耗',
    'settings.desc': '底部额度、累计消耗与模型单价。',
    'settings.unsaved': '未保存',
    'settings.overridden': '已覆盖',
    'settings.resetField': '恢复默认',
    'settings.expand': '展开设置',
    'settings.collapse': '收起设置',
    'settings.card.display': '展示',
    'settings.card.displayDesc': '底部条、累计胶囊与悬停卡片。',
    'settings.card.quota': '额度查询',
    'settings.card.quotaDesc': '数据源、货币与凭证。',
    'settings.card.thresholds': '阈值与刷新',
    'settings.card.thresholdsDesc': '状态灯阈值与后台查询频率。',
    'settings.card.pricing': '模型单价',
    'settings.card.pricingDesc': '各模型每 1M Token 的命中 / 未命中 / 输出价。',
    'settings.card.export': 'YAML 导出',
    'settings.card.exportDesc': '复制到 cordis.patch.yml 做持久覆盖。',
    'settings.enabled': '启用额度功能',
    'settings.enabledHint': 'global quota hint',
    'settings.showDock': '底部统计条',
    'settings.showDockHint': 'dock hint',
    'settings.dockLayout': '底部条布局',
    'settings.dockLayout.own': '独立换行',
    'settings.dockLayout.shared': '共用一行',
    'settings.dockLayoutHint': 'layout hint',
    'settings.showCapsule': '累计消耗胶囊',
    'settings.showCapsuleHint': 'capsule hint',
    'settings.showPopover': '悬停详情气泡',
    'settings.showPopoverHint': 'popover hint',
    'settings.showTps': '实时 TPS',
    'settings.showTpsHint': 'tps hint',
    'settings.quotaMode': '额度查询模式',
    'settings.quotaMode.follow': '跟随当前模型供应商',
    'settings.quotaMode.custom': '自定义固定展示',
    'settings.quotaModeHint': 'quota mode hint',
    'settings.provider': '额度数据源',
    'settings.provider.deepseek': 'DeepSeek 官方余额',
    'settings.provider.opencode': 'OpenCode Go 订阅用量',
    'settings.currency': '计价货币',
    'settings.btnDiscard': '放弃修改',
    'settings.btnSave': '保存',
  }
  let out = dict[key] ?? key
  for (const [k, v] of Object.entries(params ?? {})) out = out.replaceAll('{' + k + '}', String(v))
  return out
}
const htmlSettings = renderToStaticMarkup(ReactMock.createElement(settingsReg.comp, { t: settingsT }))
if (!htmlSettings.includes('dshqb_settings_page')) throw new Error('settings page wrapper missing')
if (!htmlSettings.includes('额度与消耗')) throw new Error('settings page title missing')
if (!htmlSettings.includes('底部额度、累计消耗与模型单价。')) throw new Error('settings page description missing')
if (!htmlSettings.includes('dshqb_pcard')) throw new Error('settings cards missing')
if (!htmlSettings.includes('展示')) throw new Error('display card title missing')
if (!htmlSettings.includes('启用额度功能')) throw new Error('global quota enable switch missing from settings')
if (!htmlSettings.includes('dshqb_settings_title_control')) throw new Error('global quota enable switch should live in the title bar')
if (htmlSettings.includes('dshqb_settings_global')) throw new Error('global quota enable switch should not render as a separate card')
if (!code.includes('displayCheck("showTps", "settings.showTps", "settings.showTpsHint")')) throw new Error('TPS display toggle wiring missing')
if (!code.includes('dshqb_switch')) throw new Error('settings switches should use slider controls')
if (!code.includes('dshqb_toggle_list')) throw new Error('display switches should be grouped together')
if (!code.includes('dshqb_layout_choices') || !code.includes('dshqb_layout_choice_selected')) throw new Error('dock layout should use two selectable cards')
if (!code.includes('dshqb_code_copy') || !code.includes('dshqb_copy_icon')) throw new Error('YAML copy should be a compact icon inside the code block')
if (!code.includes('isSchemaOverridden("enabled"')) throw new Error('global quota switch should expose override/reset state')
if (!code.includes('settings.enabled')) throw new Error('global quota enable switch missing')
if (!htmlSettings.includes('额度查询')) throw new Error('quota card title missing')
if (!htmlSettings.includes('阈值与刷新')) throw new Error('thresholds card title missing')
if (!htmlSettings.includes('模型单价')) throw new Error('pricing card title missing')
if (!code.includes('settings.pricingPeak')) throw new Error('peak pricing i18n missing')
if (!code.includes('settings.pricingOffPeak')) throw new Error('off-peak pricing i18n missing')
if (!code.includes('settings.pricingPeriod')) throw new Error('period column i18n missing')
if (!code.includes('settings.pricingFlat')) throw new Error('flat pricing i18n missing')
if (!code.includes('settings.addFillingPeak')) throw new Error('add-form peak label missing')
if (!code.includes('settings.peakMultiplier')) throw new Error('peak multiplier i18n missing')
if (!code.includes('buildAddedModelPrice')) throw new Error('manual add-model price builder missing')
if (!code.includes('isFlatMultiplier')) throw new Error('multiplier 1 must mean no peak/off-peak split')
if (code.includes('settings.addFillKind')) throw new Error('add form must not use four fill kinds')
if (code.includes('[name]: table')) throw new Error('adding a model must not auto-seed official peak/off-peak')
if (!code.includes('dshqb_btn_del')) throw new Error('model delete button missing')
if (!code.includes('PINNED_V4_MODELS')) throw new Error('pinned v4 models allowlist missing')
if (code.includes('!model.toLowerCase().includes("v4")')) throw new Error('delete button must not key off the v4 substring')
if (!htmlSettings.includes('YAML 导出')) throw new Error('export card title missing')
if (htmlSettings.includes('未保存')) throw new Error('unsaved badge should stay hidden until dirty')
if (htmlSettings.includes('放弃修改')) throw new Error('discard should stay hidden until a dirty card is open')
if (htmlSettings.includes('🎯 常规与阈值')) throw new Error('tabbed settings should be replaced by cards')
if (htmlSettings.includes('settings.btnCancel')) throw new Error('settings cancel button should be removed')
if (!code.includes('dshqb_field_grid')) throw new Error('settings two-column field grid missing')
if (!code.includes('white-space:pre-line')) throw new Error('settings hints should keep explicit line breaks')
if (code.includes('关掉后只保留 Web UI') || code.includes('keep only the Web UI stats')) throw new Error('showDockHint should not mention Web UI')
if (code.includes('TPS 排在同一行') || code.includes('official stats and TPS')) throw new Error('dockLayoutHint should not mention TPS')
if (code.includes('官方接口见 https://opencode.ai') || code.includes('Official endpoint: https://opencode.ai')) throw new Error('opencode URL hint should be removed')
if (code.includes('"settings.exportDesc"')) throw new Error('duplicate YAML exportDesc should be removed')
if (code.includes('"settings.opencodeBaseUrlHint"')) throw new Error('opencodeBaseUrlHint should be removed')
if (code.includes('"settings.pricingDesc"')) throw new Error('pricing body hint should be removed')
if (!code.includes('dshqb_field_full')) throw new Error('full-width field span missing for long inputs')
if (!code.includes('display_bar')) throw new Error('display fields should use a two-column grid')
if (!code.includes('dshqb_provider_quota_list') || !code.includes('providerQuotas')) throw new Error('provider-centric quota configuration missing')
if (!code.includes('settings.providerQuota.reuse') || !code.includes('settings.providerQuota.custom')) throw new Error('provider quota reuse/custom modes missing')
if (!code.includes('直接填写 Token / Cookie（推荐）') || !code.includes('settings.directCredentialConfigured')) throw new Error('write-only direct credential UI missing')
if (!code.includes('authValue: ""') || !code.includes('autoComplete: "new-password"')) throw new Error('direct credential draft must be cleared and use a password input')
if (!code.includes('dshqb_provider_editor_footer') || !code.includes('settings.providerQuota.saveHint')) throw new Error('provider editor must expose local save actions')
if (code.includes('key: "close_actions"')) throw new Error('provider editor should not duplicate the collapse action at the bottom')
if (code.includes('key: "quotaMode"') || code.includes('key: "provider",\n\t\t\t\t\t\tlabel: t("settings.provider")')) throw new Error('legacy global quota mode/fallback controls should not render')
console.log('SETTINGS SECTION SMOKE TEST PASSED')

function loadClientFactory() {
  let next = null
  globalThis.window.__ModuleLoader__.load = (entry) => { next = entry }
  new Function('window', 'require', code)(globalThis.window, (id) => {
    if (id === 'react') return ReactMock
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return stubPrimitives(ReactMock)
    throw new Error('unexpected require: ' + id)
  })
  if (next === null) throw new Error('loader.load was not called')
  return next.factory((id) => {
    if (id === 'react') return ReactMock
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return stubPrimitives(ReactMock)
    throw new Error('unexpected require: ' + id)
  })
}

{
  const prevSession = globalThis.sessionStorage
  const draftStore = {}
  globalThis.sessionStorage = {
    getItem(key) { return Object.prototype.hasOwnProperty.call(draftStore, key) ? draftStore[key] : null },
    setItem(key, value) { draftStore[key] = String(value) },
    removeItem(key) { delete draftStore[key] },
  }
  const saved = {
    enabled: true,
    quotaMode: 'follow',
    showDock: true,
    dockLayout: 'own',
    showCapsule: true,
    showPopover: true,
    showTps: false,
    provider: 'opencode-go',
    currency: 'CNY',
    warningThreshold: 10,
    dangerThreshold: 5,
    refreshIntervalMs: 300000,
    clientPollIntervalMs: 30000,
    timeoutMs: 8000,
    baseUrl: 'https://api.deepseek.com',
    apiKey: '',
    opencodeApiKeyRef: 'OPENCODE_GO_API_KEY',
    opencodeApiKey: '',
    opencodeBaseUrl: 'https://opencode.ai/zen/go/v1/usage',
    providerQuotas: [{ providerId: 'go-work', enabled: true, sourceType: 'auto', templateId: 'opencode-go', sourceProviderId: '' }],
    quotaTemplates: [{ id: 'opencode-go', category: 'subscription', name: 'OpenCode Go 订阅用量', description: 'test' }],
    dshProviders: [{ id: 'go-work', name: 'Go 工作套餐', configured: true, quotaSupported: true, templateId: 'opencode-go' }],
    prices: { 'deepseek-v4-flash': { cacheHit: 0.02, cacheMiss: 1, output: 2 } },
    defaultPrices: { cacheHit: 0.1, cacheMiss: 1, output: 2 },
  }
  draftStore['dsh-credits.settingsDraft.state'] = JSON.stringify({
    baseline: saved,
    drafts: { display: { dockLayout: 'shared' } },
    open: { display: true, quota: true, thresholds: true, export: true },
  })
  const draftApi = loadClientFactory()
  const draftRegs = []
  draftApi.apply(makeSlotCtx(draftRegs))
  const draftSettings = slotOf(draftRegs, 'settings.section')
  const htmlDraft = renderToStaticMarkup(ReactMock.createElement(draftSettings.comp, { t: settingsT }))
  if (!htmlDraft.includes('未保存')) throw new Error('dirty draft should show unsaved badge')
if (!htmlDraft.includes('放弃修改')) throw new Error('dirty draft should show discard')
  if (!htmlDraft.includes('实时 TPS')) throw new Error('TPS display toggle missing from open display settings card')
  if (!htmlDraft.includes('已覆盖')) throw new Error('overridden field should show badge')
  if (!htmlDraft.includes('恢复默认')) throw new Error('overridden field should show restore default')
  if (!htmlDraft.includes('dshqb_layout_choice dshqb_layout_choice_selected')) throw new Error('dirty draft should restore the selected dock layout card')
  if (!htmlDraft.includes('dshqb_switch')) throw new Error('display settings should render slider switches')
  if (!htmlDraft.includes('dshqb_field_grid')) throw new Error('threshold fields should use two-column grid')
  if (!htmlDraft.includes('dshqb_provider_quota_item') || !htmlDraft.includes('Go 工作套餐')) throw new Error('quota card should be centered on DSH provider rows')
  if (htmlDraft.includes('settings.exportDesc') || htmlDraft.includes('复制下方片段')) throw new Error('YAML body should not repeat the card description')
  if (!htmlDraft.includes('dshqb_code_copy') || !htmlDraft.includes('dshqb_copy_icon')) throw new Error('YAML code block should contain an icon-only copy button')
  globalThis.sessionStorage = prevSession
  globalThis.window.__ModuleLoader__.load = (entry) => { captured = entry }
  console.log('SETTINGS DRAFT RESTORE SMOKE TEST PASSED')
}

// ---------- OpenCode Go 场景 ----------
// 重新执行 bundle, 获得一个全新的模块实例与单例 store。
installFetch(() => ({
  ok: true,
  provider: 'opencode-go',
  fetchedAt: Date.now(),
  refreshIntervalMs: 300000,
  clientPollIntervalMs: 30000,
  currency: 'USD',
  thresholds: { warning: 10, danger: 5 },
  usage: {
    rolling: { status: 'ok', percent: 9, resetsAt: '2026-08-14T07:20:04.810Z' },
    weekly: { status: 'ok', percent: 12, resetsAt: '2026-08-17T00:00:00.810Z' },
    monthly: { status: 'ok', percent: 6, resetsAt: '2026-09-09T00:41:03.810Z' },
  },
  prices: {},
  defaultPrices: {},
}))
new Function('window', 'require', code)(globalThis.window, (id) => {
  if (id === 'react') return ReactMock
  if (id === '@deepseek-ai/dsh-client-ui-primitives') return stubPrimitives(ReactMock)
  throw new Error('unexpected require: ' + id)
})
if (captured === null) throw new Error('opencode bundle was not captured')
const opencodeApi = captured.factory((id) => {
  if (id === 'react') return ReactMock
  if (id === '@deepseek-ai/dsh-client-ui-primitives') return stubPrimitives(ReactMock)
  throw new Error('unexpected require: ' + id)
})
const opencodeRegs = []
opencodeApi.apply(makeSlotCtx(opencodeRegs))
const quotaDict = {
  'quota.readout': 'Go 额度 月 {monthly} · 周 {weekly} · 5h {rolling}',
  'quota.cardTitle': '🧾 OpenCode Go 额度',
  'quota.remaining': '剩余 {percent}',
  'quota.rolling': '5 小时滚动',
  'quota.weekly': '每周',
  'quota.monthly': '每月',
  'quota.resets': '{time} 重置',
  'quota.unavailable': 'OpenCode Go 额度不可用',
  'tariff.peak': '梁文峰时刻',
  'tariff.offPeak': '梁文谷时刻',
  'tariff.peakTitle': '梁文峰时刻：北京时间周一至周五 09:00–12:00、14:00–18:00\n梁文谷时刻：其余时段（含周末）',
  'tariff.offPeakTitle': '梁文峰时刻：北京时间周一至周五 09:00–12:00、14:00–18:00\n梁文谷时刻：其余时段（含周末）',
  'btn.refreshQuota': '点击立即刷新 OpenCode Go 额度',
  'btn.refreshingQuota': '正在刷新 OpenCode Go 额度...',
  'status.sufficient': '充足',
  'status.warning': '偏低',
  'status.danger': '告急',
  'card.updated': '更新于 {time} · 每 {interval} 刷新',
  'card.refreshHint': '💡 点击状态灯或卡片上的状态/百分比可立即刷新',
  'sessionCost': '本会话约 {amount}',
  'card.sessionTitle': '⚡ 本会话消耗',
  'card.noCost': '本会话暂未产生消耗',
  'card.sessionHintQuota': '💡 本会话按设置单价估算，实际扣减以 Go 套餐窗口为准。',
  'unit.minutes': '{n} 分钟',
  'unit.seconds': '{n} 秒',
  'model.unknown': '未知模型',
  'spend.pill': '{range} {amount}',
  'spend.today': '今天',
  'spend.open': '打开累计消耗',
}
const quotaT = (key, params) => {
  let out = quotaDict[key] ?? key
  for (const [k, v] of Object.entries(params ?? {})) out = out.replaceAll('{' + k + '}', String(v))
  return out
}
const QuotaComp = slotOf(opencodeRegs, 'conversation.composer.dock').comp
const quotaProps = {
  t: quotaT,
  useProjection: () => ({
    models: [],
    cost: 0,
    costByModel: {},
    tokens: { uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
    tokensByModel: {},
    legs: [],
    currency: 'USD',
  }),
}
renderToStaticMarkup(ReactMock.createElement(QuotaComp, quotaProps))
await new Promise((r) => setTimeout(r, 400))
const htmlQuota = renderToStaticMarkup(ReactMock.createElement(QuotaComp, quotaProps))
console.log('rendered (opencode-go):', htmlQuota)
if (!htmlQuota.includes('data-dshqb-dock')) throw new Error('dock merge marker missing on readout')
if (!htmlQuota.includes('data-dshqb-layout="own"')) throw new Error('default dock layout should be own line')
if (!htmlQuota.includes('Go 额度 月 6% · 周 12% · 5h 9%')) throw new Error('opencode quota readout missing')
if (!htmlQuota.includes('🧾 OpenCode Go 额度')) throw new Error('opencode quota card missing')
if (!htmlQuota.includes('剩余 88%')) throw new Error('opencode remaining badge missing')
if (!htmlQuota.includes('dshqb_quota_rows')) throw new Error('opencode quota rows missing')
if (htmlQuota.includes('dshqb_pricing_wrap')) throw new Error('DeepSeek pricing must be hidden in opencode-go mode')
if (!htmlQuota.includes('dshqb_quota_fill')) throw new Error('opencode quota progress fill missing')
if (!htmlQuota.includes('dshqb_cap')) throw new Error('spend capsule missing in opencode-go mode')
if (!htmlQuota.includes('dshqb_card_badge_btn')) throw new Error('quota remaining badge should be a refresh button')
  if (!htmlQuota.includes('梁文峰时刻') && !htmlQuota.includes('梁文谷时刻')) throw new Error('quota tariff badge should show current peak/valley period')
  if (htmlQuota.indexOf('梁文') > htmlQuota.indexOf('剩余 88%')) throw new Error('quota tariff badge should be left of remaining badge')
if (!htmlQuota.includes('dshqb_quota_pct_btn')) throw new Error('quota percent should be a refresh button')
console.log('OPENCODE CLIENT SMOKE TEST PASSED')

// ---------- 跟随对话模型供应商 ----------
installFetch(() => ({
  ok: true,
  provider: 'deepseek',
  defaultProvider: 'deepseek',
  fetchedAt: Date.now(),
  refreshIntervalMs: 300000,
  clientPollIntervalMs: 30000,
  currency: 'CNY',
  thresholds: { warning: 10, danger: 5 },
  isAvailable: true,
  balances: [
    { currency: 'CNY', total: 100.23, granted: 0, toppedUp: 100.23 },
  ],
  views: {
    deepseek: {
      ok: true,
      provider: 'deepseek',
      isAvailable: true,
      fetchedAt: Date.now(),
      balances: [
        { currency: 'CNY', total: 100.23, granted: 0, toppedUp: 100.23 },
      ],
    },
    'opencode-go': {
      ok: true,
      provider: 'opencode-go',
      fetchedAt: Date.now(),
      usage: {
        rolling: { status: 'ok', percent: 9, resetsAt: '2026-08-14T07:20:04.810Z' },
        weekly: { status: 'ok', percent: 12, resetsAt: '2026-08-17T00:00:00.810Z' },
        monthly: { status: 'ok', percent: 6, resetsAt: '2026-09-09T00:41:03.810Z' },
      },
    },
  },
  prices: {},
  defaultPrices: {},
}))

const dirSnap = {
  current: { provider: 'opencode-go', model: 'deepseek-v4-pro' },
  routable: true,
  groups: [],
  failures: [],
  status: 'ready',
  error: null,
}
const mockDirectory = {
  store: {
    subscribe(fn) { return () => {} },
    getSnapshot() { return dirSnap },
  },
  load: async () => dirSnap,
}
new Function('window', 'require', code)(globalThis.window, (id) => {
  if (id === 'react') return ReactMock
  if (id === '@deepseek-ai/dsh-client-ui-primitives') return stubPrimitives(ReactMock)
  throw new Error('unexpected require: ' + id)
})
const followApi = captured.factory((id) => {
  if (id === 'react') return ReactMock
  if (id === '@deepseek-ai/dsh-client-ui-primitives') return stubPrimitives(ReactMock)
  throw new Error('unexpected require: ' + id)
})
const followRegs = []
followApi.apply(makeSlotCtx(followRegs, (keys, fn) => {
  if (keys.includes('modelDirectories')) {
    fn({
      modelDirectories: {
        directoryFor() { return mockDirectory },
      },
    })
  }
}))
const followT = (key, params) => {
  const dict = { ...quotaDict, 'balance': '余额 {amount}', 'card.balanceTitle': '📊 账户余额' }
  let out = dict[key] ?? key
  for (const [k, v] of Object.entries(params ?? {})) out = out.replaceAll('{' + k + '}', String(v))
  return out
}
const FollowComp = slotOf(followRegs, 'conversation.composer.dock').comp
const followProps = {
  t: followT,
  sessionId: 'sess-follow',
  session: { sessionId: 'sess-follow', nodes: [] },
  useProjection: (key) => key === 'liveTokenUsage'
    ? ({ tokensPerSecond: 31.4 })
    : ({
        models: [],
        cost: 0,
        costByModel: {},
        tokens: { uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
        tokensByModel: {},
        legs: [],
        currency: 'CNY',
      }),
}
renderToStaticMarkup(ReactMock.createElement(FollowComp, followProps))
await new Promise((r) => setTimeout(r, 400))
const htmlFollowGo = renderToStaticMarkup(ReactMock.createElement(FollowComp, followProps))
if (!htmlFollowGo.includes('Go 额度 月 6% · 周 12% · 5h 9%')) throw new Error('switching to opencode-go model should show quota readout')
if (htmlFollowGo.includes('余额 ¥100.23')) throw new Error('opencode-go model should not show DeepSeek balance')

dirSnap.current = { provider: 'anthropic', model: 'claude-sonnet-4' }
const htmlFollowOther = renderToStaticMarkup(ReactMock.createElement(FollowComp, followProps))
if (!htmlFollowOther.includes('余额 ¥100.23')) throw new Error('other providers should fall back to DeepSeek balance')
if (htmlFollowOther.includes('Go 额度')) throw new Error('other providers should not show Go quota')
console.log('MODEL FOLLOW CLIENT SMOKE TEST PASSED')

// ---------- 自定义额度模式：忽略当前模型 ----------
dirSnap.current = { provider: 'anthropic', model: 'claude-sonnet-4' }
installFetch(() => ({
  ok: true,
  quotaMode: 'custom',
  provider: 'opencode-go',
  defaultProvider: 'opencode-go',
  fetchedAt: Date.now(),
  refreshIntervalMs: 300000,
  clientPollIntervalMs: 30000,
  currency: 'CNY',
  thresholds: { warning: 10, danger: 5 },
  isAvailable: true,
  balances: [
    { currency: 'CNY', total: 100.23, granted: 0, toppedUp: 100.23 },
  ],
  views: {
    deepseek: {
      ok: true,
      provider: 'deepseek',
      isAvailable: true,
      fetchedAt: Date.now(),
      balances: [
        { currency: 'CNY', total: 100.23, granted: 0, toppedUp: 100.23 },
      ],
    },
    'opencode-go': {
      ok: true,
      provider: 'opencode-go',
      fetchedAt: Date.now(),
      usage: {
        rolling: { status: 'ok', percent: 9, resetsAt: '2026-08-14T07:20:04.810Z' },
        weekly: { status: 'ok', percent: 12, resetsAt: '2026-08-17T00:00:00.810Z' },
        monthly: { status: 'ok', percent: 6, resetsAt: '2026-09-09T00:41:03.810Z' },
      },
    },
  },
  prices: {},
  defaultPrices: {},
}))
new Function('window', 'require', code)(globalThis.window, (id) => {
  if (id === 'react') return ReactMock
  if (id === '@deepseek-ai/dsh-client-ui-primitives') return stubPrimitives(ReactMock)
  throw new Error('unexpected require: ' + id)
})
const customApi = captured.factory((id) => {
  if (id === 'react') return ReactMock
  if (id === '@deepseek-ai/dsh-client-ui-primitives') return stubPrimitives(ReactMock)
  throw new Error('unexpected require: ' + id)
})
const customRegs = []
customApi.apply(makeSlotCtx(customRegs, (keys, fn) => {
  if (keys.includes('modelDirectories')) {
    fn({
      modelDirectories: {
        directoryFor() { return mockDirectory },
      },
    })
  }
}))
const CustomComp = slotOf(customRegs, 'conversation.composer.dock').comp
renderToStaticMarkup(ReactMock.createElement(CustomComp, followProps))
await new Promise((r) => setTimeout(r, 400))
const htmlCustom = renderToStaticMarkup(ReactMock.createElement(CustomComp, followProps))
if (!htmlCustom.includes('Go 额度 月 6% · 周 12% · 5h 9%')) throw new Error('custom mode should keep Go quota even on anthropic model')
if (htmlCustom.includes('余额 ¥100.23')) throw new Error('custom Go source should not show DeepSeek balance')
console.log('CUSTOM QUOTA MODE CLIENT SMOKE TEST PASSED')

// ---------- 自定义 metric 额度源 ----------
dirSnap.current = { provider: 'my-provider', model: 'my-model' }
installFetch(() => ({
  ok: true,
  quotaMode: 'custom',
  provider: 'custom-metric',
  defaultProvider: 'custom-metric',
  fetchedAt: Date.now(),
  refreshIntervalMs: 300000,
  clientPollIntervalMs: 30000,
  currency: 'USD',
  thresholds: { warning: 10, danger: 5 },
  quotaSources: [
    { id: 'deepseek', kind: 'balance', name: 'DeepSeek 官方余额', providerIds: ['deepseek'], default: true },
    { id: 'custom-metric', kind: 'metric', name: 'Custom Metric', providerIds: ['my-provider'], default: false },
  ],
  providerQuotaMap: { 'my-provider': 'provider:my-provider', deepseek: null },
  views: {
    deepseek: {
      ok: true,
      provider: 'deepseek',
      kind: 'balance',
      isAvailable: true,
      fetchedAt: Date.now(),
      balances: [{ currency: 'CNY', total: 100.23, granted: 0, toppedUp: 100.23 }],
    },
    'provider:my-provider': {
      ok: true,
      provider: 'provider:my-provider',
      providerId: 'my-provider',
      kind: 'metric',
      name: 'Custom Metric',
      fetchedAt: Date.now(),
      metrics: [
        { key: 'remaining', label: '剩余额度', value: 25, total: 100, unit: '%', resetsAt: '2026-08-17T00:00:00.000Z' },
        { key: 'balance', label: '账户余额', value: 0, total: 0, unit: 'CNY', resetsAt: null },
        { key: 'overdrawn', label: '透支额度', value: -20, total: 100, unit: 'CNY', resetsAt: null },
      ],
    },
  },
  prices: {},
  defaultPrices: {},
}))
new Function('window', 'require', code)(globalThis.window, (id) => {
  if (id === 'react') return ReactMock
  if (id === '@deepseek-ai/dsh-client-ui-primitives') return stubPrimitives(ReactMock)
  throw new Error('unexpected require: ' + id)
})
const customMetricApi = captured.factory((id) => {
  if (id === 'react') return ReactMock
  if (id === '@deepseek-ai/dsh-client-ui-primitives') return stubPrimitives(ReactMock)
  throw new Error('unexpected require: ' + id)
})
const customMetricRegs = []
customMetricApi.apply(makeSlotCtx(customMetricRegs, (keys, fn) => {
  if (keys.includes('modelDirectories')) {
    fn({
      modelDirectories: {
        directoryFor() { return mockDirectory },
      },
    })
  }
}))
const CustomMetricComp = slotOf(customMetricRegs, 'conversation.composer.dock').comp
const customMetricT = (key, params) => {
  const dict = {
    'quota.cardTitleCustom': '🎯 额度用量',
    'quota.remaining': '剩余 {percent}',
    'quota.resets': '{time} 重置',
    'quota.valueTotal': '剩余 {value} / {total} {unit}',
    'quota.unavailableCustom': '额度用量不可用',
    'quota.errorCustom': '【额度用量】异常: {error}',
    'btn.refreshCustom': '点击立即刷新额度',
    'btn.refreshingCustom': '正在刷新额度...',
    'card.sessionHintCustom': '💡 本会话按设置单价估算，实际扣减以所选套餐/额度为准。',
  }
  if (dict[key] !== undefined) {
    let out = dict[key]
    for (const [k, v] of Object.entries(params ?? {})) out = out.replaceAll('{' + k + '}', String(v))
    return out
  }
  return followT(key, params)
}
const customMetricProps = { ...followProps, t: customMetricT }
renderToStaticMarkup(ReactMock.createElement(CustomMetricComp, customMetricProps))
await new Promise((r) => setTimeout(r, 400))
const htmlCustomMetric = renderToStaticMarkup(ReactMock.createElement(CustomMetricComp, customMetricProps))
if (!htmlCustomMetric.includes('剩余额度 25%')) throw new Error('custom metric readout missing')
if (!htmlCustomMetric.includes('Custom Metric · 剩余额度 25%')) throw new Error('custom metric source name missing from readout')
if (!htmlCustomMetric.includes('🎯 Custom Metric')) throw new Error('custom metric source name missing from card title')
if (!htmlCustomMetric.includes('账户余额 0 CNY')) throw new Error('zero scalar metric must remain visible')
if (!htmlCustomMetric.includes('透支额度 -20%')) throw new Error('negative metric percentage must not be clamped to zero')
if (htmlCustomMetric.includes('透支额度 0%')) throw new Error('negative metric percentage must not render as zero')
if (htmlCustomMetric.includes('额度用量不可用')) throw new Error('zero scalar metric must not be marked unavailable')
if (!htmlCustomMetric.includes('● 告急')) throw new Error('zero scalar metric should render a critical status badge')
if (!htmlCustomMetric.includes('dshqb_quota_rows')) throw new Error('custom metric quota rows missing')
if (!htmlCustomMetric.includes('2026/8/17 08:00:00 重置') && !htmlCustomMetric.includes('2026/8/17 00:00:00 重置')) throw new Error('custom metric reset time missing')
if (htmlCustomMetric.includes('dshqb_pricing_wrap')) throw new Error('DeepSeek pricing must be hidden for custom metric')
dirSnap.current = { provider: 'unconfigured-provider', model: 'other-model' }
const htmlUnconfiguredProvider = renderToStaticMarkup(ReactMock.createElement(CustomMetricComp, customMetricProps))
if (htmlUnconfiguredProvider.includes('Custom Metric') || htmlUnconfiguredProvider.includes('账户余额 0 CNY')) throw new Error('unconfigured provider must not fall back to another provider quota')
console.log('CUSTOM METRIC CLIENT SMOKE TEST PASSED')

// ---------- 展示开关 ----------
installFetch(() => ({
  ok: true,
  showDock: false,
  showCapsule: true,
  showPopover: false,
  showTps: false,
  fetchedAt: Date.now(),
  refreshIntervalMs: 300000,
  clientPollIntervalMs: 30000,
  currency: 'CNY',
  thresholds: { warning: 10, danger: 5 },
  isAvailable: true,
  balances: [
    { currency: 'CNY', total: 100.23, granted: 0, toppedUp: 100.23 },
  ],
  prices: {},
  defaultPrices: {},
}))
new Function('window', 'require', code)(globalThis.window, (id) => {
  if (id === 'react') return ReactMock
  if (id === '@deepseek-ai/dsh-client-ui-primitives') return stubPrimitives(ReactMock)
  throw new Error('unexpected require: ' + id)
})
const flagsApi = captured.factory((id) => {
  if (id === 'react') return ReactMock
  if (id === '@deepseek-ai/dsh-client-ui-primitives') return stubPrimitives(ReactMock)
  throw new Error('unexpected require: ' + id)
})
const flagsRegs = []
flagsApi.apply(makeSlotCtx(flagsRegs))
const FlagsComp = slotOf(flagsRegs, 'conversation.composer.dock').comp
renderToStaticMarkup(ReactMock.createElement(FlagsComp, followProps))
await new Promise((r) => setTimeout(r, 400))
const htmlFlags = renderToStaticMarkup(ReactMock.createElement(FlagsComp, followProps))
if (htmlFlags.includes('dshqb_root')) throw new Error('showDock=false should hide the bottom bar')
if (htmlFlags.includes('dshqb_popover')) throw new Error('hidden dock should not render hover card')
if (htmlFlags.includes('TPS 31.4 tok/s')) throw new Error('showTps=false should hide TPS')
if (!htmlFlags.includes('dshqb_cap')) throw new Error('showCapsule=true should keep spend capsule')
if (!htmlFlags.includes('dshqb_host')) throw new Error('capsule should use zero-size host when dock is hidden')
console.log('DISPLAY FLAGS CLIENT SMOKE TEST PASSED')

// ---------- 全局功能开关 ----------
installFetch(() => ({
  ok: true,
  enabled: false,
  showDock: true,
  showCapsule: true,
  showPopover: true,
  showTps: true,
  fetchedAt: Date.now(),
  refreshIntervalMs: 300000,
  clientPollIntervalMs: 30000,
  currency: 'CNY',
  thresholds: { warning: 10, danger: 5 },
  isAvailable: true,
  balances: [{ currency: 'CNY', total: 100.23, granted: 0, toppedUp: 100.23 }],
  prices: {},
  defaultPrices: {},
}))
new Function('window', 'require', code)(globalThis.window, (id) => {
  if (id === 'react') return ReactMock
  if (id === '@deepseek-ai/dsh-client-ui-primitives') return stubPrimitives(ReactMock)
  throw new Error('unexpected require: ' + id)
})
const disabledApi = captured.factory((id) => {
  if (id === 'react') return ReactMock
  if (id === '@deepseek-ai/dsh-client-ui-primitives') return stubPrimitives(ReactMock)
  throw new Error('unexpected require: ' + id)
})
const disabledRegs = []
disabledApi.apply(makeSlotCtx(disabledRegs))
const DisabledComp = slotOf(disabledRegs, 'conversation.composer.dock').comp
renderToStaticMarkup(ReactMock.createElement(DisabledComp, followProps))
await new Promise((r) => setTimeout(r, 400))
const htmlDisabled = renderToStaticMarkup(ReactMock.createElement(DisabledComp, followProps))
if (htmlDisabled !== '') throw new Error('enabled=false should hide all quota UI')
console.log('GLOBAL ENABLE FLAG CLIENT SMOKE TEST PASSED')

console.log('CLIENT SMOKE TEST PASSED (ZERO-DEPENDENCY)')
process.exit(0)
