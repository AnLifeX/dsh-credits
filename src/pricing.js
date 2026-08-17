/**
 * DeepSeek V4 自 2026-08-17 起按北京时间走峰谷价。
 * CNY / USD 是两套官方价目，不是汇率换算；峰谷时段两边同步切换。
 * USD 官方价 = CNY 官方价 × 0.14（与刊例 1 / 0.14、2 / 0.28 一致）。
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

const isPeakBeijing = (timestamp) => {
  const hourBJT = (new Date(timestamp).getUTCHours() + 8) % 24
  return (hourBJT >= 9 && hourBJT < 12) || (hourBJT >= 14 && hourBJT < 18)
}

const v4TableFor = (currency) => {
  if (currency === 'USD') return V4_USD
  if (currency === 'CNY') return V4_CNY
  return null
}

/** 实时计算指定模型在指定时间戳下的单价。 */
export const resolveModelPrice = (configOrGetter, model, timestamp = Date.now()) => {
  const config = typeof configOrGetter === 'function' ? configOrGetter() : configOrGetter
  const currency = config.currency || 'CNY'
  const table = v4TableFor(currency)?.[model]

  if (table) {
    if (timestamp < V4_CUTOFF_MS) return table.listed
    return isPeakBeijing(timestamp) ? table.peak : table.offPeak
  }

  return config.prices?.[model] ?? config.defaultPrices
}

export const priceBuckets = (cfg, model, buckets, timestamp = Date.now()) => {
  const price = resolveModelPrice(cfg, model, timestamp)
  return ((buckets.uncachedInputTokens + buckets.cacheWriteTokens) * price.cacheMiss +
    buckets.cacheReadTokens * price.cacheHit +
    buckets.outputTokens * price.output) / 1e6
}
