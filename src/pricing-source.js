/**
 * 官方定价页解析。
 *
 * 抓取官方「模型与价格」页并抽出「模型 × 时段 × 三项单价」矩阵，用于和内置表比对、
 * 给用户提供候选。不参与计价：解析失败时调用方直接忽略即可。
 */

export const OFFICIAL_PRICING_SOURCES = [
  { currency: 'CNY', url: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing' },
  { currency: 'USD', url: 'https://api-docs.deepseek.com/quick_start/pricing' },
]

const DEFAULT_TIMEOUT_MS = 15000
const MAX_HTML_BYTES = 2 * 1024 * 1024

const RATE_KEYS = ['cacheHit', 'cacheMiss', 'output']

const stripTags = (html) => String(html)
  .replace(/<br\s*\/?>/gi, ' ')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ')
  .trim()

const tableRows = (tableHtml) =>
  [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
    [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => stripTags(cell[1])))

const looksLikeModelId = (text) => /^[a-z0-9][a-z0-9._-]*-[a-z0-9._-]+$/i.test(text)

/** 表头行里的模型 id 列表（中英表头分别是「模型」/「MODEL」，脚注 (1) 需先去掉）。 */
const modelIdsOf = (rows) => {
  for (const cells of rows) {
    if (!/(^|\s)(模型|models?)(\s|$)/i.test(cells.join(' | '))) continue
    const ids = cells.map((text) => text.replace(/\(\d+\)$/, '').trim()).filter(looksLikeModelId)
    if (ids.length > 0) return ids
  }
  return []
}

const GROUP_RE = /(缓存命中|缓存未命中|输出|CACHE HIT|CACHE MISS|OUTPUT)/i
const BAND_RE = /(空闲时段|高峰时段|OFF-PEAK|PEAK)/i

const groupKeyOf = (text) => {
  const value = text.toLowerCase()
  if (value.includes('缓存未命中') || value.includes('cache miss')) return 'cacheMiss'
  if (value.includes('缓存命中') || value.includes('cache hit')) return 'cacheHit'
  if (value.includes('输出') || value.includes('output')) return 'output'
  return null
}

const bandKeyOf = (text) => {
  const value = text.toLowerCase()
  if (value.includes('空闲') || value.includes('off-peak') || value.includes('off peak')) return 'offPeak'
  if (value.includes('高峰') || value.includes('peak')) return 'peak'
  return null
}

const PRICE_CELL_RE = /^[$¥]?\s*\d+(?:\.\d+)?\s*元?$/
const numberOf = (text) => {
  const matched = String(text).match(/\d+(?:\.\d+)?/)
  return matched ? Number(matched[0]) : null
}

/**
 * 从定价页 HTML 抽出价格矩阵。
 *
 * @returns `{ models, rates }`；页面结构不符合预期时返回 `null`。
 */
export const parseOfficialPricing = (html) => {
  const tables = [...String(html ?? '').matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)].map((match) => match[1])
  for (const table of tables) {
    const rows = tableRows(table)
    const models = modelIdsOf(rows)
    if (models.length === 0) continue

    // 价格行的「缓存命中 / 缓存未命中 / 输出」标签因 rowspan 只出现在每组首行，
    // 因此按出现顺序记住当前分组，再靠「空闲时段 / 高峰时段」定位数值。
    const slots = {}
    let group = null
    for (const cells of rows) {
      const groupCell = cells.find((text) => GROUP_RE.test(text) && !BAND_RE.test(text))
      if (groupCell) {
        const key = groupKeyOf(groupCell)
        if (key) group = key
      }
      const bandCell = cells.find((text) => BAND_RE.test(text))
      if (!bandCell || group === null) continue
      const band = bandKeyOf(bandCell)
      if (!band) continue
      const values = cells.filter((text) => PRICE_CELL_RE.test(text)).map(numberOf)
      if (values.length < models.length || values.some((value) => value === null)) continue
      slots[group] = { ...(slots[group] ?? {}), [band]: values.slice(-models.length) }
    }

    if (!RATE_KEYS.every((key) => slots[key]?.peak && slots[key]?.offPeak)) continue

    const rates = {}
    for (let index = 0; index < models.length; index += 1) {
      rates[models[index]] = {
        peak: Object.fromEntries(RATE_KEYS.map((key) => [key, slots[key].peak[index]])),
        offPeak: Object.fromEntries(RATE_KEYS.map((key) => [key, slots[key].offPeak[index]])),
      }
    }
    return { models, rates }
  }
  return null
}

/**
 * 抓取并解析全部官方定价页。
 *
 * @returns `{ ok: true, fetchedAt, prices: { CNY?, USD? }, errors }`
 *   或 `{ ok: false, error }`（全部来源都失败时）。
 */
export const fetchOfficialPricing = async ({ fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS, now = Date.now } = {}) => {
  const doFetch = fetchImpl ?? globalThis.fetch
  if (typeof doFetch !== 'function') return { ok: false, error: 'fetch unavailable' }

  const prices = {}
  const errors = []
  for (const source of OFFICIAL_PRICING_SOURCES) {
    try {
      const response = await doFetch(source.url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' })
      if (!response?.ok) throw new Error(`HTTP ${response?.status ?? '?'}`)
      const html = await response.text()
      if (html.length > MAX_HTML_BYTES) throw new Error('page too large')
      const parsed = parseOfficialPricing(html)
      if (!parsed) throw new Error('unrecognized page structure')
      prices[source.currency] = parsed.rates
    } catch (error) {
      errors.push(`${source.currency}: ${error?.message ?? error}`)
    }
  }

  if (Object.keys(prices).length === 0) return { ok: false, error: errors.join('; ') || 'fetch failed' }
  return { ok: true, fetchedAt: now(), prices, errors }
}

const sameRate = (a, b) =>
  Number(a?.cacheHit) === Number(b?.cacheHit) &&
  Number(a?.cacheMiss) === Number(b?.cacheMiss) &&
  Number(a?.output) === Number(b?.output)

const sameTiers = (a, b) => sameRate(a?.peak, b?.peak) && sameRate(a?.offPeak, b?.offPeak)

/**
 * 把官方页结果与内置表比对成候选列表。
 *
 * @param prices `{ CNY?: { [model]: { peak, offPeak } }, USD?: ... }`
 * @param builtinOf `(currency) => ({ [model]: { peak, offPeak, ... } })`
 */
export const buildPricingCandidates = (prices, builtinOf) => {
  const candidates = []
  for (const [currency, rates] of Object.entries(prices ?? {})) {
    const builtin = builtinOf(currency) ?? {}
    for (const [model, price] of Object.entries(rates ?? {})) {
      const current = builtin[model]
      candidates.push({
        model,
        currency,
        peak: { ...price.peak },
        offPeak: { ...price.offPeak },
        current: current ? { peak: { ...current.peak }, offPeak: { ...current.offPeak } } : null,
        known: Boolean(current),
        changed: !current || !sameTiers(current, price),
      })
    }
  }
  return candidates
}
