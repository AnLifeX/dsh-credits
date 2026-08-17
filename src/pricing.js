/** 实时计算指定模型在指定时间戳下的单价(内置 DeepSeek V4 8月17日谷峰费率自动切换规则) */
export const resolveModelPrice = (configOrGetter, model, timestamp = Date.now()) => {
  const config = typeof configOrGetter === 'function' ? configOrGetter() : configOrGetter
  const isV4Flash = model === 'deepseek-v4-flash'
  const isV4Pro = model === 'deepseek-v4-pro'

  // 峰谷引擎内置的是人民币官方价; 非 CNY 时使用配置表(切换货币后金额才会跟着变)。
  if ((config.currency || 'CNY') !== 'CNY') {
    return config.prices?.[model] ?? config.defaultPrices
  }

  if (!isV4Flash && !isV4Pro) {
    return config.prices?.[model] ?? config.defaultPrices
  }

  // 2026-08-17T00:00:00+08:00 (北京时间 8月17日 00:00)
  const isAfterCutoff = timestamp >= 1786896000000

  if (!isAfterCutoff) {
    if (isV4Flash) return { cacheHit: 0.02, cacheMiss: 1, output: 2 }
    if (isV4Pro) return { cacheHit: 0.025, cacheMiss: 3, output: 6 }
  }

  const d = new Date(timestamp)
  const hourBJT = (d.getUTCHours() + 8) % 24
  const isPeak = (hourBJT >= 9 && hourBJT < 12) || (hourBJT >= 14 && hourBJT < 18)

  if (isPeak) {
    if (isV4Flash) return { cacheHit: 0.10, cacheMiss: 3.0, output: 9.0 }
    if (isV4Pro) return { cacheHit: 0.30, cacheMiss: 9.0, output: 27.0 }
  } else {
    if (isV4Flash) return { cacheHit: 0.05, cacheMiss: 1.5, output: 4.5 }
    if (isV4Pro) return { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 }
  }
  return config.defaultPrices
}
