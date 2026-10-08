/**
 * DeepSeek V4 / V4.1 系列官方定价表。
 *
 * 时间线（北京时间）：
 * - 2026-08-17 00:00 之前：旧刊例价（listed）。
 * - 2026-08-17 00:00 起：V4 峰谷价，低谷 = 高峰 × 0.5。
 * - 2026-09-10 12:00 起：V4.1 Flash 新价；deepseek-flash、deepseek-v4-flash、
 *   deepseek-v4-flash-vision-exp 全部按新表计费。
 *
 * CNY / USD 是两套独立官方价目，各自照官方页数值列出，不做汇率换算。
 * 高峰：北京时间周一至周五（排除中国法定节假日）09:00–12:00、14:00–18:00。
 * 设置里的 prices[model].peak / .offPeak 可覆盖官方峰谷；如果配置值与任一历史官方
 * 快照一致，仍按内置时间表计费，只有用户手改过的值才当作自定义覆盖。
 * 没有精确价表的 DeepSeek 新模型按名字回退到默认 Flash / Pro（familyModelFor）。
 */

import calendar2026 from './data/holidays-2026.json' with { type: 'json' }

// 手动更新年度文件；前端通过额度响应复用这份日历，不另存一份日期表。
const calendars = [calendar2026]
export const HOLIDAY_CALENDAR = {
  years: calendars.map((calendar) => calendar.year),
  offDays: calendars.flatMap((calendar) => calendar.days.filter((day) => day.isOffDay).map((day) => day.date)),
}
const holidayOffDays = new Set(HOLIDAY_CALENDAR.offDays)

/** 2026-08-17T00:00:00+08:00：V4 峰谷价生效。 */
export const V4_CUTOFF_MS = 1786896000000
/** 2026-09-10T12:00:00+08:00：V4.1 Flash 新价生效。 */
export const V41_FLASH_CUTOFF_MS = 1789012800000

/** 旧 V4 价目（2026-08-17 起），用于历史样本。 */
const V4_CNY = {
  'deepseek-v4-flash': {
    listed: { cacheHit: 0.02, cacheMiss: 1, output: 2 },
    peak: { cacheHit: 0.10, cacheMiss: 3.0, output: 9.0 },
    offPeak: { cacheHit: 0.05, cacheMiss: 1.5, output: 4.5 },
  },
  'deepseek-v4-pro': {
    listed: { cacheHit: 0.025, cacheMiss: 3, output: 6 },
    peak: { cacheHit: 0.30, cacheMiss: 9.0, output: 27.0 },
    offPeak: { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 },
  },
  'deepseek-v4-flash-vision-exp': {
    listed: { cacheHit: 0.02, cacheMiss: 1, output: 2 },
    peak: { cacheHit: 0.10, cacheMiss: 3.0, output: 9.0 },
    offPeak: { cacheHit: 0.05, cacheMiss: 1.5, output: 4.5 },
  },
}

/** 旧 V4 美元价目：官方美元表原值，与 CNY 表独立。 */
const V4_USD = {
  'deepseek-v4-flash': {
    listed: { cacheHit: 0.0028, cacheMiss: 0.14, output: 0.28 },
    peak: { cacheHit: 0.014, cacheMiss: 0.44, output: 1.32 },
    offPeak: { cacheHit: 0.007, cacheMiss: 0.22, output: 0.66 },
  },
  'deepseek-v4-pro': {
    listed: { cacheHit: 0.003625, cacheMiss: 0.435, output: 0.87 },
    peak: { cacheHit: 0.044, cacheMiss: 1.32, output: 3.96 },
    offPeak: { cacheHit: 0.022, cacheMiss: 0.66, output: 1.98 },
  },
  'deepseek-v4-flash-vision-exp': {
    listed: { cacheHit: 0.0028, cacheMiss: 0.14, output: 0.28 },
    peak: { cacheHit: 0.014, cacheMiss: 0.44, output: 1.32 },
    offPeak: { cacheHit: 0.007, cacheMiss: 0.22, output: 0.66 },
  },
}

/** V4.1 Flash 官方价（2026-09-10 12:00 起）。 */
const V41_FLASH_TIERS = {
  CNY: {
    peak: { cacheHit: 0.04, cacheMiss: 2, output: 8 },
    offPeak: { cacheHit: 0.02, cacheMiss: 1, output: 4 },
  },
  USD: {
    peak: { cacheHit: 0.006, cacheMiss: 0.30, output: 1.20 },
    offPeak: { cacheHit: 0.003, cacheMiss: 0.15, output: 0.60 },
  },
}

/** 走 V4.1 Flash 新价（2026-09-10 12:00 起）的模型。 */
const V41_TIER_MODELS = [
  'deepseek-flash',
  'deepseek-v4-flash',
  'deepseek-v4-flash-vision-exp',
]

const V41_CNY = Object.fromEntries(
  V41_TIER_MODELS.map((model) => [model, {
    peak: { ...V41_FLASH_TIERS.CNY.peak },
    offPeak: { ...V41_FLASH_TIERS.CNY.offPeak },
  }]),
)
const V41_USD = Object.fromEntries(
  V41_TIER_MODELS.map((model) => [model, {
    peak: { ...V41_FLASH_TIERS.USD.peak },
    offPeak: { ...V41_FLASH_TIERS.USD.offPeak },
  }]),
)

/** 旧 V4 表的别名：deepseek-flash 这个名字在 V4.1 上线前沿用的是旧 Flash 计费。 */
const OLD_V4_ALIASES = {
  'deepseek-flash': 'deepseek-v4-flash',
}

const isFiniteRate = (p) => p && [p.cacheHit, p.cacheMiss, p.output].every((n) => Number.isFinite(Number(n)))

export const PINNED_V4_MODELS = [
  'deepseek-flash',
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  'deepseek-v4-flash-vision-exp',
]
export const PRICING_CURRENCIES = ['CNY', 'USD']

/** 官方仅提供人民币与美元价；历史 EUR 实际复用了美元数值，因此迁移为 USD。 */
export const normalizePricingCurrency = (currency) => ['USD', 'EUR'].includes(String(currency ?? '').trim().toUpperCase()) ? 'USD' : 'CNY'

export const hasTariffTiers = (p) => isFiniteRate(p?.peak) && isFiniteRate(p?.offPeak)

/** 周末（含补班）及中国节假日全天低谷。 */
export const isPeakBeijing = (timestamp) => {
  const beijing = new Date(Number(timestamp) + 8 * 3600 * 1000)
  if (!Number.isFinite(beijing.getTime())) return false
  const hour = beijing.getUTCHours()
  const dow = beijing.getUTCDay()
  if (dow === 0 || dow === 6) return false
  // ponytail: 未收录年份仍按星期判断；跨年使用前应手动补齐年度日历。
  if (holidayOffDays.has(beijing.toISOString().slice(0, 10))) return false
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18)
}

const v4TableFor = (currency) => {
  if (currency === 'USD') return V4_USD
  if (currency === 'CNY') return V4_CNY
  return null
}

const v41TableFor = (currency) => {
  if (currency === 'USD') return V41_USD
  if (currency === 'CNY') return V41_CNY
  return null
}

const oldV4TableFor = (model, currency) => v4TableFor(currency)?.[OLD_V4_ALIASES[model] ?? model]
const v41TiersFor = (model, currency) => v41TableFor(currency)?.[model]

const rateCopy = (p) => ({ cacheHit: Number(p.cacheHit), cacheMiss: Number(p.cacheMiss), output: Number(p.output) })

/**
 * 指定时间点下该模型处在哪一档官方价表：
 * 旧刊例 → 旧峰谷 → V4.1 Flash 新价。
 */
export const officialTiersFor = (model, currency, timestamp = Date.now()) => {
  const v41 = v41TiersFor(model, currency)
  const v4 = oldV4TableFor(model, currency)
  if (v41 && timestamp >= V41_FLASH_CUTOFF_MS) return { peak: rateCopy(v41.peak), offPeak: rateCopy(v41.offPeak) }
  if (v4) return { peak: rateCopy(v4.peak), offPeak: rateCopy(v4.offPeak), listed: rateCopy(v4.listed) }
  if (v41) return { peak: rateCopy(v41.peak), offPeak: rateCopy(v41.offPeak) }
  return null
}

/** 指定时间点、指定模型的官方单价（旧刊例 / 峰 / 谷）。 */
export const officialRateFor = (model, currency, timestamp = Date.now()) => {
  const v4 = oldV4TableFor(model, currency)
  const tiers = officialTiersFor(model, currency, timestamp)
  if (!tiers) return undefined
  if (v4 && timestamp < V4_CUTOFF_MS) return rateCopy(v4.listed)
  return isPeakBeijing(timestamp) ? rateCopy(tiers.peak) : rateCopy(tiers.offPeak)
}

const toConfigPrice = (tiers) => ({
  cacheHit: tiers.peak.cacheHit,
  cacheMiss: tiers.peak.cacheMiss,
  output: tiers.peak.output,
  peak: { ...tiers.peak },
  offPeak: { ...tiers.offPeak },
})

/** 设置页 / Schema 默认用的当前生效官方峰谷价。 */
export const officialV4ConfigPrices = (currency, timestamp = Date.now()) => {
  return Object.fromEntries(
    PINNED_V4_MODELS
      .map((model) => {
        const tiers = officialTiersFor(model, currency, timestamp)
        return tiers ? [model, toConfigPrice(tiers)] : null
      })
      .filter(Boolean),
  )
}

const asRate = (p) => ({
  cacheHit: Number(p.cacheHit),
  cacheMiss: Number(p.cacheMiss),
  output: Number(p.output),
})

const ratesEqual = (a, b) => isFiniteRate(a) && isFiniteRate(b) &&
  Number(a.cacheHit) === Number(b.cacheHit) &&
  Number(a.cacheMiss) === Number(b.cacheMiss) &&
  Number(a.output) === Number(b.output)

const officialSnapshots = (model, currency) => {
  const out = []
  const v4 = oldV4TableFor(model, currency)
  if (v4) out.push(v4)
  const v41 = v41TiersFor(model, currency)
  if (v41) out.push(v41)
  return out
}

const matchesOfficialTiers = (model, currency, configured) => {
  if (!hasTariffTiers(configured)) return false
  return officialSnapshots(model, currency).some((snapshot) =>
    ratesEqual(configured.peak, snapshot.peak) && ratesEqual(configured.offPeak, snapshot.offPeak))
}

/**
 * 没有精确价表时按模型名回退到默认 Flash / Pro 定价：
 * - 含 `flash` 的新模型 → 默认 Flash
 * - 含 `pro` 的新模型 → 默认 Pro
 * - 其它 DeepSeek 模型 → 默认 Flash
 * - 非 DeepSeek 模型（如 glm）→ 不回退
 */
export const familyModelFor = (model) => {
  const id = String(model ?? '').trim().toLowerCase()
  if (!id) return null
  if (id.includes('flash')) return 'deepseek-flash'
  if (id.includes('pro')) return 'deepseek-v4-pro'
  if (id.includes('deepseek')) return 'deepseek-flash'
  return null
}

/**
 * 解析单价并附带来源，供 UI 标注“回退”或“无价”：
 * source = official | configured | family | none
 */
export const resolveModelPriceInfo = (configOrGetter, model, timestamp = Date.now()) => {
  const config = typeof configOrGetter === 'function' ? configOrGetter() : configOrGetter
  const currency = normalizePricingCurrency(config.currency)
  const configured = config.prices?.[model]
  const official = officialRateFor(model, currency, timestamp)
  const pinned = PINNED_V4_MODELS.includes(model)

  // 内置官方模型：未配置、只有旧刊例三字段、或配置值等于任一历史官方快照时，
  // 一律按内置时间表计价，保证历史样本和未来调价都能正确重算。
  if (official !== undefined && (
    configured === undefined ||
    (pinned && isFiniteRate(configured) && !hasTariffTiers(configured)) ||
    matchesOfficialTiers(model, currency, configured)
  )) {
    return { rate: official, source: 'official' }
  }

  if (hasTariffTiers(configured)) {
    const v4 = oldV4TableFor(model, currency)
    if (v4 && timestamp < V4_CUTOFF_MS) return { rate: asRate(v4.listed), source: 'configured' }
    return { rate: asRate(isPeakBeijing(timestamp) ? configured.peak : configured.offPeak), source: 'configured' }
  }

  if (isFiniteRate(configured)) return { rate: asRate(configured), source: 'configured' }

  const fallbackModel = familyModelFor(model)
  if (fallbackModel) {
    const rate = officialRateFor(fallbackModel, currency, timestamp)
    if (rate !== undefined) return { rate, source: 'family', fallbackModel }
  }

  return { rate: undefined, source: 'none' }
}

/** 实时计算指定模型在指定时间戳下的单价；无价时回退配置的 defaultPrices。 */
export const resolveModelPrice = (configOrGetter, model, timestamp = Date.now()) => {
  const config = typeof configOrGetter === 'function' ? configOrGetter() : configOrGetter
  const info = resolveModelPriceInfo(config, model, timestamp)
  return info.rate ?? config.defaultPrices ?? { cacheHit: 0, cacheMiss: 0, output: 0 }
}

export const priceBuckets = (cfg, model, buckets, timestamp = Date.now()) => {
  const price = resolveModelPrice(cfg, model, timestamp)
  return ((buckets.uncachedInputTokens + buckets.cacheWriteTokens) * price.cacheMiss +
    buckets.cacheReadTokens * price.cacheHit +
    buckets.outputTokens * price.output) / 1e6
}
