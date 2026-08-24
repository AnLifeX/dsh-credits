# dsh-credits

DeepSeek Harness（`dsh web`）额度插件：在输入框下方显示账户额度与本会话估算消耗；右下角另有可拖动的累计消耗胶囊。设置在侧栏「额度」（最后一项，货币硬币图标），分成多张可折叠卡片。

> 兼容性：`dsh-credits 0.2.4` 已适配 `dsh 0.1.1-rc.1`（即 0.1.1-rc1）的新版会话投影接口；TPS 与本会话金额可正常传递到 Web 前端，同时保留对旧版投影接口的兼容。

- **账户额度 + 状态灯**  
  DeepSeek 模式如 `🟢 余额 ¥97.69`；OpenCode Go 模式如 `🟢 Go 额度 月 6% · 周 12% · 5h 9%`。点击圆点可立即强刷。
- **跟随当前对话模型**  
  底部读数跟输入框选中的模型供应商走。优先识别 DSH 已配置供应商并复用其地址和凭据；也可改成「固定展示一个额度源」。
- **底部条布局**  
  默认独立换行，额度单独占底下一行；也可改成跟底部已有统计共用一行、排在最后。底部条、累计胶囊、悬停卡片都可以关掉。
- **本会话估算消耗**  
  按模型单价估算（单价可在设置里改）。DeepSeek V4 自 2026-08-17 起按北京时间自动套用峰谷价。
- **实时生成吞吐 TPS**
  直接消费 DSH 会话事件，在流式输出时估算并显示 `TPS n tok/s`；收到 provider 精确 usage 后自动替换估算值。可在「设置 → 展示 → 实时 TPS」关闭，不需要额外安装 `@linxin666/dsh-live-stats`。
- **累计消耗胶囊**  
  右下角可拖动气泡，查看今天 / 昨天 / 本周 / 本月 / 自定义时间范围内的跨会话估算总额（按当前计价货币与单价现算）。
- **设置卡片**  
  展示、额度查询、阈值与刷新、模型单价、YAML 导出各一张卡。每张独立「放弃修改 / 保存」，改过的字段可「恢复默认」。关掉再打开，未保存的草稿还在。
  顶部「启用额度功能」总开关关闭后会隐藏额度、TPS、峰谷徽章、悬停详情与累计消耗，停止额度轮询，并锁定展示、额度查询、阈值与刷新；模型单价和 YAML 导出仍可用。

## 界面预览

悬停底部读数会展开详情：DeepSeek 列出全部币种钱包，Go 列出三个用量窗口，下面是本会话估算。

![DeepSeek 官方余额悬停卡片](./assets/preview.png)

底部额度默认独立占一行：

![DeepSeek 余额条](./assets/bar-deepseek.png)

![OpenCode Go 额度条](./assets/bar-go.png)

OpenCode Go 模式下，卡片改成三个窗口的用量百分比与重置时间：

![OpenCode Go 额度卡片](./assets/card-go.png)

右下角可拖动的累计消耗胶囊，按今天 / 昨天 / 本周 / 本月 / 自定义区间汇总跨会话估算：

![累计消耗胶囊](./assets/capsule.png)

设置 → 额度：多张可折叠卡片，同一功能区两列排布，每张卡单独保存。

![设置卡片列表](./assets/settings-cards.png)

![展示卡片](./assets/settings-display.png)

![额度查询卡片](./assets/settings-quota.png)

![阈值与刷新卡片](./assets/settings-thresholds.png)

## 额度源怎么用

在「设置 → 额度 → 额度查询」中：

1. 页面以 DSH 已启用的供应商为列表，每个供应商独立开启或关闭额度展示。
2. 能识别的供应商默认用「自动识别」：复用这个供应商在 DSH 保存的 Base URL 和 Key，并选择匹配的解析模板。
3. 也可以明确选择一个「内置模板」，或让两个模型供应商「复用另一供应商的额度」。
4. 最后才用「自定义 HTTP 接口」：填 URL，选择 DSH Key、直接 Token/Cookie 或凭证引用；需要时添加请求头、JSON/Form 请求体。点「测试并读取字段」后可直接选择字段，也可以填写 JSONPath 并设置求和、计数、乘数或偏移。

切换模型时只查看当前 DSH 供应商自己的绑定；没有配置或已关闭的供应商不显示额度，也不会回退到无关账户。每个绑定有独立缓存，因此可以在 DSH 里用多个自定义供应商添加多个 OpenCode Go 账号，它们会分别查询和展示。设置修改会立即作用于当前 `dsh web` 进程；需要跨重启保留时，请再从 YAML 导出卡片复制到 profile 配置。

### 内置与官方模板

内置额度源：

| provider | 说明 | 上游接口 | 密钥 |
| :--- | :--- | :--- | :--- |
| `deepseek` | DeepSeek 官方余额 | `GET /user/balance` | `DEEPSEEK_API_KEY` |
| `opencode-go` | OpenCode Go 订阅用量 | `GET https://opencode.ai/zen/go/v1/usage` | `OPENCODE_GO_API_KEY` 或 OpenCode `auth.json` |

除 DeepSeek 和 OpenCode Go 外，设置页内置了以下模板：

- 订阅套餐：Kimi For Coding、智谱 GLM Coding / Z.AI、MiniMax Coding Plan（国内 / 国际）
- 账户余额：StepFun、OpenRouter、Novita AI

硅基流动不再提供内置余额模板。旧 `/user/info` 无法可靠反映网页现金余额和代金券；需要时请给对应 DSH 供应商选择「自定义 HTTP 接口」，自行配置网页接口与会话凭证。网页内部接口可能随时调整，Cookie 失效时需要重新填写。

高级 YAML 的每个 `providerQuotas` 绑定可以使用三种数据形态：

- `balance`：DeepSeek 风格多币种余额
- `usage`：OpenCode Go 风格多窗口用量
- `metric`：任意单指标/多指标剩余额度（HTTP + JSONPath）

服务端会按 DSH 供应商分别缓存所有已启用额度源；切模型时底部直接换展示，不必再等一轮查询。

| 当前对话模型的供应商 | 底部展示 |
| :--- | :--- |
| 绑定为 OpenCode Go 模板的供应商 | 该账号的订阅用量（5 小时 / 周 / 月） |
| 绑定为 DeepSeek 模板的供应商 | 该账号的官方余额 |
| 绑定为余额/套餐模板或自定义 HTTP 的供应商 | 该供应商自己的解析结果 |
| 未配置或单独关闭的供应商 | 不显示额度；本会话消耗与 TPS 仍可正常显示 |

OpenCode Go 密钥解析顺序：`opencodeApiKey` → `OPENCODE_GO_API_KEY`（credentials / 环境变量）→ `~/.local/share/opencode/auth.json`。

## 安装

```sh
dsh plugin --profile web add dsh-credits
```

装完后**重启 `dsh web`**。本地开发可改为：

```sh
dsh plugin --profile web add <本目录绝对路径>
```

升级：

```sh
dsh plugin --profile web remove dsh-credits
pnpm store prune
dsh plugin --profile web add dsh-credits@latest
```

卸载：

```sh
dsh plugin --profile web remove dsh-credits
```

## 从 dsh-balance 迁移

`dsh-credits` 已覆盖旧插件的全部能力（官方余额、本会话估算、设置面板），并加上 Go 订阅用量、累计胶囊、跟随当前模型。装上本包并确认底部只有一条额度读数后：

```sh
dsh plugin --profile web remove dsh-balance
```

然后删掉 profile 里的本地目录（常见是 `$DSH_HOME/profiles/web/dsh-balance-local`）以及 `cordis.patch.yml` 里给 `dsh-balance` 写的 `disabled: true`。源码仓库（例如 `dsh-balance`）也可以删，不再被引用。

## 配置

覆盖文件：`$DSH_HOME/profiles/web/cordis.patch.yml`。也可在设置 → 额度 改完后按卡片点「保存」。

常用展示项：

| 配置 | 默认 | 说明 |
| :--- | :--- | :--- |
| `providerQuotas` | `[]` | 每个 DSH 供应商独立的额度来源绑定；设置页会为能识别的已启用供应商自动生成推荐项 |
| `showDock` | `true` | 是否显示底部额度读数 |
| `dockLayout` | `own` | `own` 独立换行；`shared` 与底部已有统计共用一行 |
| `showCapsule` | `true` | 右下角累计消耗胶囊 |
| `showPopover` | `true` | 悬停底部读数时的双栏详情 |
| `showTps` | `true` | 是否显示实时 TPS |
| `enabled` | `true` | 额度功能总开关；关闭后隐藏相关 UI、停止轮询，并锁定展示、额度查询、阈值与刷新；不影响模型单价和 YAML 导出 |

### 多个 OpenCode Go 账号

```yaml
- id: dsh-credits
  config:
    showDock: true
    dockLayout: own
    showCapsule: true
    showPopover: true
    providerQuotas:
      - providerId: opencode-go
        enabled: true
        sourceType: auto
      - providerId: go-personal  # DSH 中另一个自定义供应商，使用另一份 Key
        enabled: true
        sourceType: auto
    warningThreshold: 10          # Go 套餐剩余额度 < 10% 黄灯
    dangerThreshold: 5            # 剩余额度 < 5% 红灯
    refreshIntervalMs: 300000
    clientPollIntervalMs: 30000
    timeoutMs: 15000
    currency: USD
```

两个 DSH 供应商需要分别保存自己的 Key；插件会产生 `provider:opencode-go` 和 `provider:go-personal` 两个适配器及缓存。切到哪个供应商，就显示哪个账号的三个用量窗口。状态灯按「剩余最少」的窗口判定；套餐没有固定美元上限可展示。

### DeepSeek 人民币账户

```yaml
- id: dsh-credits
  config:
    providerQuotas:
      - providerId: deepseek-official
        enabled: true
        sourceType: auto
    warningThreshold: 10
    dangerThreshold: 5
    refreshIntervalMs: 300000
    clientPollIntervalMs: 30000
    timeoutMs: 8000
    currency: CNY
    prices:
      deepseek-v4-flash:
        cacheHit: 0.1
        cacheMiss: 3
        output: 9
        peak: { cacheHit: 0.1, cacheMiss: 3, output: 9 }
        offPeak: { cacheHit: 0.05, cacheMiss: 1.5, output: 4.5 }
      deepseek-v4-pro:
        cacheHit: 0.3
        cacheMiss: 9
        output: 27
        peak: { cacheHit: 0.3, cacheMiss: 9, output: 27 }
        offPeak: { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 }
      deepseek-chat: { cacheHit: 0.1, cacheMiss: 1, output: 2 }
      deepseek-reasoner: { cacheHit: 1, cacheMiss: 4, output: 16 }
```

### DeepSeek 美元账户

```yaml
- id: dsh-credits
  config:
    provider: deepseek
    apiKeyRef: DEEPSEEK_API_KEY
    baseUrl: https://api.deepseek.com
    warningThreshold: 2.0
    dangerThreshold: 0.5
    currency: USD
    prices:
      deepseek-v4-flash:
        cacheHit: 0.014
        cacheMiss: 0.42
        output: 1.26
        peak: { cacheHit: 0.014, cacheMiss: 0.42, output: 1.26 }
        offPeak: { cacheHit: 0.007, cacheMiss: 0.21, output: 0.63 }
      deepseek-v4-pro:
        cacheHit: 0.042
        cacheMiss: 1.26
        output: 3.78
        peak: { cacheHit: 0.042, cacheMiss: 1.26, output: 3.78 }
        offPeak: { cacheHit: 0.021, cacheMiss: 0.63, output: 1.89 }
```

`prices` 是「当前 `currency` 下每 1M token」的单价。V4 可写 `peak` / `offPeak`（高峰 / 低谷）。内置 `deepseek-v4-flash` / `deepseek-v4-pro` 如果只有三个刊例字段，插件仍按官方峰谷表计价（兼容涨价前旧配置）。自行添加的模型只写三字段则全天按该价计，等效峰谷倍率 1。高峰为北京时间周一至周五 09:00–12:00、14:00–18:00，其余时段（含周末）为低谷。DeepSeek 账户的 CNY / USD 是两套独立钱包：底部会列出选定货币，以及其它仍有余额的钱包；悬停卡片列出全部钱包。计价货币只影响本会话/累计估算和状态灯，不会把其它钱包藏掉。切换货币时会套用该币种官方刊例单价，**不会做汇率换算**。V4 在 2026-08-17 之后按北京时间走峰谷价，人民币和美元同步切换（美元 = 人民币官方价 × 0.14）。

### 自定义额度源（高级 YAML）

设置页已可视化添加官方模板和自定义 HTTP。仅需要批量维护或特殊解析时才建议手写 YAML：

```yaml
- id: dsh-credits
  config:
    providerQuotas:
      - providerId: my-provider
        enabled: true
        sourceType: custom
        source:
          id: quota-my-provider
          name: My Plan
          kind: metric
          request:
            method: GET
            url: https://example.com/quota
            dshProvider: my-provider  # 复用这个 DSH 供应商的 Key
            authStyle: bearer
          response:
            metrics:
              - key: remaining
                label: 剩余额度
                valuePath: $.data.remaining
                totalPath: $.data.total
                unit: USD
                resetsAtPath: $.data.resetsAt
```

自定义 HTTP 支持直接取「剩余」，也支持用「总额 - 已用」计算剩余。OpenRouter 已是内置模板，不需要再写代理脚本。

请求鉴权支持：

- `Bearer`、`Authorization: Token`、Basic Auth、任意请求头、Cookie、URL 查询参数
- 将凭证注入 JSON 或 `application/x-www-form-urlencoded` 请求体
- 直接填写一份敏感凭证、复用 DSH 供应商 Key，或使用 credentials / 环境变量引用
- 附加多个普通请求头，例如硅基流动网页接口需要的 `x-subject-id`

响应映射支持普通点路径、数组下标和 `[*]` 通配符；数组可取第一项、求和、计数、最小值或最大值，最后再应用乘数与加减偏移。例如 `$.data.wallets[*].remaining` 配合「求和」可汇总代金券列表。当前每个供应商绑定只请求一个 URL；现金与代金券若来自两个接口，需要分别选择其中一个查询，后续再考虑组合请求。

## 架构

浏览器只读本地缓存，不直连上游：

| 路径 | 作用 |
| :--- | :--- |
| `GET /query-credits` | 账户额度缓存。响应里同时带所有已启用额度源的 `views`；`?source=` 只决定顶层摊平哪一套，`?force=1` 强刷 |
| `GET /query-credits/spend?range=today` | 跨会话累计消耗。`range` 可为 `today` / `yesterday` / `week` / `month` / `custom`；自定义时再带 `from`、`to`（`YYYY-MM-DD` 或 ISO） |
| `GET /query-credits/config` | 读当前配置 |
| `POST /query-credits/config` | 保存配置并立即生效 |
| `POST /query-credits/test-connection` | 连通性测试 |

本会话花费由 `queryCreditsCost` 投影折叠 token（每笔带事件时间），按该笔发生时的北京时间峰谷价计价；前端切货币时仍按各自行情重算，不会用“此刻”的单价覆盖早上的高峰用量。实时 TPS 由同一组会话事件生成 `liveTokenUsage` 投影：流式 chunk 阶段按字符估算，provider usage 到达后替换为精确输出 token，步骤结束后保留最近一次速率。累计消耗同样按事件时间计价，并落盘到 `$DSH_HOME/storages/dsh-credits-spend.json`。胶囊位置和所选时间范围记在浏览器 `localStorage`。

密钥走 Harness `credentials`，默认不写进配置文件。

## 更新记录

### 未发布（额度源适配器）

- 将内置 `deepseek` / `opencode-go` 抽象为额度源适配器注册表
- 支持自定义 HTTP / JSONPath 额度源：`balance` / `usage` / `metric`
- 自定义 HTTP 支持 Cookie / Token / Basic / Header / Query / JSON / Form 鉴权、请求体与数值转换
- 移除不可靠的硅基流动旧余额模板
- 额度源可通过 `providerIds` / `providerPatterns` 自动匹配当前模型供应商
- 保持 `follow`（自动匹配）/ `custom`（固定展示）/ 默认源配置
- 设置页「额度查询」新增可视化添加/编辑/删除自定义额度源
- 服务端与客户端统一按 `kind` 渲染，不再写死 `opencode-go`

### 0.2.4

适配 `dsh 0.1.1-rc.1` 的新版会话投影接口。

- 为本会话金额与实时 TPS 投影增加持久化状态 schema 和前端 `wire` 视图
- 修复升级 dsh 后设置已开启但 TPS、本会话金额不显示的问题
- 保留旧版投影字段，兼容较早版本的 dsh

### 0.2.2

设置页改成多张可折叠卡片，截图同步换成当前界面。

- 展示 / 额度查询 / 阈值与刷新 / 模型单价 / YAML 导出各一张卡，每张独立草稿和保存
- 同一功能区两列排布，勾选框与标题同行
- 提示文案缩短；底部条「共用一行」不再绑定第三方统计插件

### 0.2.1

悬停双栏卡片改成响应式：字号随卡片宽度缩放，窄窗口时两列改上下叠，主标题不再被挤换行。

### 0.2.0

适配官方设置页，不再用输入框旁边的齿轮。

- 设置收进一级「额度」入口，排在侧栏最后；图标改为带 `¥` 的硬币
- 可开关底部条、累计胶囊、悬停卡片
- 底部条默认独立换行，可选与底部已有统计共用一行
- 额度查询支持「跟随当前模型」或「自定义固定展示」

## 发布到 npm

**普通 `git push` 不会发包。** 只有推送符合 `v*` 的 tag（例如 `v0.2.2`）才会触发 `.github/workflows/publish.yml`。

第一次发布前：

1. 在 [npmjs.com](https://www.npmjs.com/signup) 注册账号（包名 `dsh-credits` 目前可用）。
2. 生成 **Automation** 或 Granular Access Token，权限包含 publish。
3. GitHub 仓库 → Settings → Secrets and variables → Actions → New repository secret，名称必须是 **`NPM_TOKEN`**，值贴刚才的 token。不要写进代码或 README。
4. 仓库 Settings → Actions 允许 workflow 运行。
5. `package.json` 的 `version` 与即将打的 tag 一致后：

```sh
git tag v0.2.2
git push origin v0.2.2
```

之后 Actions 会执行 `npm publish --provenance --access public`。发布成功即可：

```sh
dsh plugin --profile web add dsh-credits
```

## 验证

```sh
npm test
curl http://127.0.0.1:3080/query-credits
curl http://127.0.0.1:3080/query-credits/spend?range=today
curl http://127.0.0.1:3080/plugins/dsh-credits/client.js
```

## 开发

- 服务端：`src/index.js`（ESM，零构建）
- 浏览器：`client/client.js`（手写 `__ModuleLoader__` 工厂）。改完需重启 `dsh web`
- 测试：`npm test`（零依赖冒烟）

## FAQ

**Q: 插件怎么知道查的是谁的额度？**  
A: 优先复用 DSH 供应商已保存的 credential ref / API-key record，不会把 Key 发给浏览器。没有可复用凭据时才使用额度源中的凭据引用。

**Q: 状态灯规则？**  
A: DeepSeek 按余额金额对比 `warningThreshold` / `dangerThreshold`。OpenCode Go 按剩余额度百分比对比同一组阈值。🟢 ≥ 预警线；🟡 告急线～预警线；🔴 < 告急线或接口不可用。

**Q: 切模型后底部读数会跟着变吗？**  
A: 会。插件按当前模型的 DSH 供应商 ID 读取它自己的 `providerQuotas` 绑定；没配置或单独关闭时不显示额度，不会回退到其它账号。

**Q: 8 月 17 日峰谷价会自动切吗？**  
A: 会。北京时间 2026-08-17 00:00 之后，V4 Flash / Pro 按 09:00–12:00、14:00–18:00 高峰价；谷时段是 00:00–09:00、12:00–14:00、18:00–24:00，其余时段半价。
