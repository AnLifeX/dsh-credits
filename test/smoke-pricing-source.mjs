/**
 * 官方定价页解析冒烟测试。
 * 用内联 HTML 夹具（不联网）验证解析、候选比对与失败降级。
 * 运行: node test/smoke-pricing-source.mjs
 */
import assert from 'node:assert/strict'
import { parseOfficialPricing, fetchOfficialPricing, buildPricingCandidates } from '../src/pricing-source.js'

// 官方页真实结构的最小夹具：rowspan/colspan、<sup> 脚注、<br>、单位符号、表头大小写差异都要覆盖。
const zhFixture = `
<table style="text-align:center">
  <tr><td colspan="3" style="text-align:center">模型</td><td>deepseek-flash<sup>(1)</sup></td><td>deepseek-v4-pro<sup>(2)</sup></td></tr>
  <tr><td colspan="3">BASE URL (OpenAI 格式)</td><td colspan="2"><a href="https://api.deepseek.com">https://api.deepseek.com</a></td></tr>
  <tr><td rowspan="6">价格<sup>(3)</sup></td><td rowspan="2">百万tokens输入<br>（缓存命中）</td><td>空闲时段</td><td>0.02元</td><td>0.15元</td></tr>
  <tr><td>高峰时段</td><td>0.04元</td><td>0.30元</td></tr>
  <tr><td rowspan="2">百万tokens输入<br>（缓存未命中）</td><td>空闲时段</td><td>1元</td><td>4.5元</td></tr>
  <tr><td>高峰时段</td><td>2元</td><td>9.0元</td></tr>
  <tr><td rowspan="2">百万tokens输出</td><td>空闲时段</td><td>4元</td><td>13.5元</td></tr>
  <tr><td>高峰时段</td><td>8元</td><td>27.0元</td></tr>
</table>`

const enFixture = `
<table style="text-align:center">
  <tr><td colspan="3" style="text-align:center">MODEL</td><td>deepseek-flash<sup>(1)</sup></td><td>deepseek-v4-pro<sup>(2)</sup></td></tr>
  <tr><td rowspan="6">PRICING<sup>(3)</sup></td><td rowspan="2">1M INPUT TOKENS<br>(CACHE HIT)</td><td>OFF-PEAK</td><td>$0.003</td><td>$0.022</td></tr>
  <tr><td>PEAK</td><td>$0.006</td><td>$0.044</td></tr>
  <tr><td rowspan="2">1M INPUT TOKENS<br>(CACHE MISS)</td><td>OFF-PEAK</td><td>$0.15</td><td>$0.66</td></tr>
  <tr><td>PEAK</td><td>$0.3</td><td>$1.32</td></tr>
  <tr><td rowspan="2">1M OUTPUT TOKENS</td><td>OFF-PEAK</td><td>$0.6</td><td>$1.98</td></tr>
  <tr><td>PEAK</td><td>$1.2</td><td>$3.96</td></tr>
</table>`

const zh = parseOfficialPricing(zhFixture)
assert.ok(zh, 'the Chinese pricing table must parse')
assert.deepEqual(zh.models, ['deepseek-flash', 'deepseek-v4-pro'], 'footnote markers must be stripped from model ids')
assert.deepEqual(
  zh.rates['deepseek-flash'],
  {
    peak: { cacheHit: 0.04, cacheMiss: 2, output: 8 },
    offPeak: { cacheHit: 0.02, cacheMiss: 1, output: 4 },
  },
  'CNY Flash rates must come out of the rowspan layout correctly',
)
assert.deepEqual(
  zh.rates['deepseek-v4-pro'],
  {
    peak: { cacheHit: 0.30, cacheMiss: 9, output: 27 },
    offPeak: { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 },
  },
  'CNY Pro rates must come out of the rowspan layout correctly',
)

const en = parseOfficialPricing(enFixture)
assert.ok(en, 'the English pricing table must parse despite the uppercase MODEL header')
assert.deepEqual(
  en.rates['deepseek-v4-pro'],
  {
    peak: { cacheHit: 0.044, cacheMiss: 1.32, output: 3.96 },
    offPeak: { cacheHit: 0.022, cacheMiss: 0.66, output: 1.98 },
  },
  'USD Pro rates must match the official USD table',
)

// 结构不符合预期时必须返回 null，而不是抛错或给出半截数据。
assert.equal(parseOfficialPricing('<table><tr><td>nothing useful</td></tr></table>'), null, 'an unrelated table must not parse')
assert.equal(parseOfficialPricing(''), null, 'empty input must not parse')
assert.equal(parseOfficialPricing('<html>no table at all</html>'), null, 'a page without tables must not parse')

// 候选比对：与内置表一致则 changed=false，不同或未知则 changed=true。
const builtin = {
  CNY: {
    'deepseek-flash': { peak: { cacheHit: 0.04, cacheMiss: 2, output: 8 }, offPeak: { cacheHit: 0.02, cacheMiss: 1, output: 4 } },
  },
}
const candidates = buildPricingCandidates({ CNY: zh.rates }, (currency) => builtin[currency] ?? {})
const flash = candidates.find((item) => item.model === 'deepseek-flash')
const pro = candidates.find((item) => item.model === 'deepseek-v4-pro')
assert.equal(flash.changed, false, 'a model matching the built-in table must not be reported as changed')
assert.equal(flash.known, true)
assert.equal(pro.changed, true, 'a model missing from the built-in table must be reported as changed')
assert.equal(pro.known, false, 'a model missing from the built-in table must be flagged as unknown')
assert.deepEqual(pro.current, null)

// 单边价目不同也要判定为变化（逐项比较，不能只看某一项）。
const tweaked = buildPricingCandidates(
  { CNY: { 'deepseek-flash': { peak: { cacheHit: 0.04, cacheMiss: 2, output: 9 }, offPeak: { cacheHit: 0.02, cacheMiss: 1, output: 4 } } } },
  (currency) => builtin[currency] ?? {},
)
assert.equal(tweaked[0].changed, true, 'a single differing field must mark the tier as changed')

// 网络失败/结构变化：fetchOfficialPricing 必须优雅降级为 ok:false，绝不抛错。
const failing = await fetchOfficialPricing({ fetchImpl: async () => { throw new Error('offline') } })
assert.equal(failing.ok, false, 'a network failure must degrade to ok:false')
assert.ok(String(failing.error).includes('offline'), 'the failure reason must be reported')

const badStructure = await fetchOfficialPricing({
  fetchImpl: async () => ({ ok: true, status: 200, text: async () => '<html>redesigned page</html>' }),
})
assert.equal(badStructure.ok, false, 'an unrecognized page structure must degrade to ok:false')

const http500 = await fetchOfficialPricing({ fetchImpl: async () => ({ ok: false, status: 500, text: async () => '' }) })
assert.equal(http500.ok, false, 'an HTTP error must degrade to ok:false')

// 一个来源失败、另一个成功时仍应返回可用结果，并附带失败原因。
let call = 0
const partial = await fetchOfficialPricing({
  fetchImpl: async () => {
    call += 1
    if (call === 1) throw new Error('cn blocked')
    return { ok: true, status: 200, text: async () => enFixture }
  },
})
assert.equal(partial.ok, true, 'a single working source is enough')
assert.deepEqual(Object.keys(partial.prices), ['USD'], 'only the successful currency is reported')
assert.ok(partial.errors.some((message) => message.includes('cn blocked')), 'the failed source must be reported')

console.log('PRICING SOURCE TEST PASSED')
