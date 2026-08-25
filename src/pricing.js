/**
 * DeepSeek V4 自 2026-08-17 起按北京时间走峰谷价。
 * CNY / USD 是两套官方价目，不是汇率换算；峰谷时段两边同步切换。
 * USD 官方价 = CNY 官方价 × 0.14（与刊例 1 / 0.14、2 / 0.28 一致）。
 * 高峰：北京时间周一至周五 09:00–12:00、14:00–18:00；其余（含周末）为低谷，低谷 = 高峰 × 0.5。
 * 设置里的 prices[model].peak / .offPeak 可覆盖官方峰谷。
 * 内置 flash / pro / vision-exp 若只有刊例三字段，仍走官方峰谷表（兼容涨价前旧配置）。
 * 其它模型只有三字段时按固定价计，等效峰谷倍率 1，不再套官方表。
 */

export const V4_CUTOFF_MS = 1786896000000 // 2026-08-17T00:00:00+08:00

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

const scaleUsd = (p) => ({
  cacheHit: Math.round(p.cacheHit * 0.14 * 1e6) / 1e6,
  cacheMiss: Math.round(p.cacheMiss * 0.14 * 1e6) / 1e6,
  output: Math.round(p.output * 0.14 * 1e6) / 1e6,
})

const V4_USD = Object.fromEntries(
  Object.entries(V4_CNY).map(([model, tiers]) => [model, {
    listed: scaleUsd(tiers.listed),
    peak: scaleUsd(tiers.peak),
    offPeak: scaleUsd(tiers.offPeak),
  }]),
)

const isFiniteRate = (p) => p && [p.cacheHit, p.cacheMiss, p.output].every((n) => Number.isFinite(Number(n)))

export const PINNED_V4_MODELS = ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-v4-flash-vision-exp']

export const hasTariffTiers = (p) => isFiniteRate(p?.peak) && isFiniteRate(p?.offPeak)

/** 北京时间周一至周五 09:00–12:00、14:00–18:00 为高峰。 */
export const isPeakBeijing = (timestamp) => {
  const beijing = new Date(Number(timestamp) + 8 * 3600 * 1000)
  const hour = beijing.getUTCHours()
  const dow = beijing.getUTCDay()
  if (dow === 0 || dow === 6) return false
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18)
}

const v4TableFor = (currency) => {
  if (currency === 'USD') return V4_USD
  if (currency === 'CNY') return V4_CNY
  return null
}

const toConfigPrice = (tiers) => ({
  cacheHit: tiers.peak.cacheHit,
  cacheMiss: tiers.peak.cacheMiss,
  output: tiers.peak.output,
  peak: { ...tiers.peak },
  offPeak: { ...tiers.offPeak },
})

/** 设置页 / Schema 默认用的 V4 官方峰谷价（不含涨价前刊例）。 */
export const officialV4ConfigPrices = (currency) => {
  const table = v4TableFor(currency)
  if (!table) return {}
  return Object.fromEntries(
    PINNED_V4_MODELS.map((model) => [model, toConfigPrice(table[model])]),
  )
}

const asRate = (p) => ({
  cacheHit: Number(p.cacheHit),
  cacheMiss: Number(p.cacheMiss),
  output: Number(p.output),
})

/** 实时计算指定模型在指定时间戳下的单价。 */
export const resolveModelPrice = (configOrGetter, model, timestamp = Date.now()) => {
  const config = typeof configOrGetter === 'function' ? configOrGetter() : configOrGetter
  const currency = config.currency || 'CNY'
  const table = v4TableFor(currency)?.[model]
  const configured = config.prices?.[model]
  const customTiers = hasTariffTiers(configured) ? configured : null

  if (customTiers) {
    if (table && timestamp < V4_CUTOFF_MS) return table.listed
    return asRate(isPeakBeijing(timestamp) ? customTiers.peak : customTiers.offPeak)
  }

  if (isFiniteRate(configured) && !(table && PINNED_V4_MODELS.includes(model))) {
    return asRate(configured)
  }

  if (table) {
    if (timestamp < V4_CUTOFF_MS) return table.listed
    return isPeakBeijing(timestamp) ? table.peak : table.offPeak
  }

  return configured ?? config.defaultPrices
}

export const priceBuckets = (cfg, model, buckets, timestamp = Date.now()) => {
  const price = resolveModelPrice(cfg, model, timestamp)
  return ((buckets.uncachedInputTokens + buckets.cacheWriteTokens) * price.cacheMiss +
    buckets.cacheReadTokens * price.cacheHit +
    buckets.outputTokens * price.output) / 1e6
}
