# dsh-credits

[![npm version](https://img.shields.io/npm/v/dsh-credits.svg)](https://www.npmjs.com/package/dsh-credits)

DeepSeek Harness（`dsh web`）额度插件：在输入框下方显示账户额度与本会话估算消耗；右下角另有可拖动的累计消耗胶囊。设置在侧栏「额度」（最后一项，货币硬币图标），分成多张可折叠卡片。

> 兼容性：`dsh-credits 0.3.1` 已适配 `dsh 0.1.1-rc.1`（即 0.1.1-rc1）的新版会话投影接口；TPS 与本会话金额可正常传递到 Web 前端，同时保留对旧版投影接口的兼容。

- **账户额度 + 状态灯**  
  DeepSeek 模式如 `🟢 余额 ¥97.69`；OpenCode Go 模式如 `🟢 Go 额度 月 6% · 周 12% · 5h 9%`。点击圆点可立即强刷。
- **跟随当前对话模型**  
  底部读数跟输入框选中的模型供应商走。每个 DSH 供应商独立选择内置模板、复用另一供应商的额度，或配置自定义 HTTP 接口；未配置或已关闭时不显示额度。
- **底部条布局**  
  默认独立换行，额度单独占底下一行；也可改成跟底部已有统计共用一行、排在最后。底部条、累计胶囊、悬停卡片都可以关掉。
- **本会话估算消耗**  
  按模型单价估算（单价可在设置里改）。DeepSeek V4 自 2026-08-17 起按北京时间自动套用峰谷价。
- **实时生成吞吐 TPS**
  直接消费 DSH 会话事件，在流式输出时估算并显示 `TPS n tok/s`；收到 provider 精确 usage 后自动替换估算值。可在「设置 → 展示 → 实时 TPS」关闭。
- **累计消耗胶囊**  
  右下角可拖动气泡，查看今天 / 昨天 / 本周 / 本月 / 自定义时间范围内的跨会话估算总额（按当前计价货币与单价现算）。
- **设置卡片**  
  展示、额度查询、模型单价、YAML 导出各一张卡；阈值与查询频率已收进每个供应商的额度配置。每张卡独立「放弃修改 / 保存」，改过的字段可「恢复默认」。关掉再打开，未保存的草稿还在。
  顶部「启用额度功能」总开关关闭后会隐藏额度、TPS、峰谷徽章、悬停详情与累计消耗，停止额度轮询，并锁定展示和额度查询；模型单价和 YAML 导出仍可用。

## 快速使用

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

额度查询现在以 DSH 供应商列表为主体：每个供应商都有独立的额度开关、信息来源和保存按钮。

![供应商级额度查询](./assets/settings-quota.png)

识别出适合的模板后会直接显示为「内置模板」，展开后仍可切换其他套餐或余额模板：

![内置额度模板设置](./assets/settings-quota-template.png)

没有适合的模板时，可使用自定义 HTTP 接口配置请求、鉴权、返回字段与数值换算：

![自定义 HTTP 额度设置](./assets/settings-quota-custom.png)

![供应商额度配置里的阈值与刷新](./assets/settings-thresholds.png)

## 供应商额度怎么用

在「设置 → 额度 → 额度查询」中：

1. 页面以 DSH 已启用的供应商为列表，每个供应商独立开启或关闭额度展示。
2. 插件会在后台按供应商 ID 和 Base URL 匹配模板。匹配成功时，页面直接显示对应的「内置模板」，不会再出现单独的「自动识别」选项。
3. 如需调整，可点「编辑」，在「额度信息来源」中选择：
   - **内置模板**：使用模板的查询地址和解析规则，并复用当前 DSH 供应商保存的 Key；模板仍可手动切换。
   - **复用另一供应商的额度**：两个模型供应商实际共用同一账号时，直接展示另一项已经查询到的额度。
   - **自定义 HTTP 接口**：自行填写 URL、鉴权和返回字段映射。
4. 未识别出模板的供应商默认进入「自定义 HTTP 接口」；接口尚未填写时保持关闭，不会随意套用其他供应商的模板。
5. 修改后点击当前供应商编辑区底部的「保存」。测试按钮使用当前草稿，不要求先开启该供应商的额度展示。

切换模型时只查看当前 DSH 供应商自己的绑定；没有配置或已关闭的供应商不显示额度，也不会回退到无关账户。本会话消耗和 TPS 不受影响。每个供应商拥有独立的查询与缓存，因此可以在 DSH 中添加多个指向 OpenCode Go 的自定义供应商，并为每个账号分别配置同一个模板。

### 自定义 HTTP 操作流程

自定义接口不要求编写整段 JSON 配置，常用设置都可以在页面完成：

1. 填写额度接口 URL 和请求方法。
2. 选择请求凭证：直接填写凭证、复用当前/其他 DSH 供应商的 Key、使用凭证引用，或无需鉴权。
3. 选择鉴权方式：Bearer、Token、Basic、任意请求头、Cookie、URL 参数、JSON 参数或 Form 参数。需要时再添加普通请求头和请求体。
4. 点击「测试并读取字段」。成功提示会列出实际解析出的指标；失败时可以复制请求方法、脱敏后的请求头与请求体、响应状态码和响应体。
5. 为每个展示指标选择计算方式并映射字段：
   - **直接读取指标值**：读取余额、剩余次数或任意数值；可选总量字段用于显示百分比。
   - **总量减已用量**：分别选择总量和已用量字段，插件计算剩余量。
6. 字段返回数组时可取第一项、求和、计数、最小值或最大值；换算乘数支持科学计数法，例如 `1e-12`。重置时间字段只用于显示。
7. 测试结果正确后保存，再开启「展示该供应商额度」。

直接填写的 Token 或 Cookie 保存到 DSH credentials，不写入导出的普通配置；页面只显示「已设置」，可输入新值覆盖。附加请求头中的 Cookie、Authorization、Token、API Key 等敏感字段也会脱敏。

设置页保存后会立即更新当前 `dsh web` 进程。若要让额度绑定在服务重启后仍然保留，请从「YAML 导出」卡片复制配置到当前 profile 的 `cordis.patch.yml`；直接填写的敏感凭证无需写入 YAML。

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

## 配置

覆盖文件：`$DSH_HOME/profiles/web/cordis.patch.yml`。也可在设置 → 额度 改完后按卡片点「保存」。

新配置以 `providerQuotas` 为准，不再需要全局的额度查询模式、默认展示源或未匹配回退项。`providerId` 必须与 DSH 供应商列表中的实际 ID 一致。旧版 `quotaMode`、`provider`、`quotaSources` 等字段仍会兼容读取，但新配置不建议继续使用。

常用展示项：

| 配置 | 默认 | 说明 |
| :--- | :--- | :--- |
| `providerQuotas` | `[]` | 每个 DSH 供应商独立的额度来源绑定；未显式配置时会在后台匹配内置模板，失败则准备一份关闭的自定义 HTTP 配置 |
| `showDock` | `true` | 是否显示底部额度读数 |
| `dockLayout` | `own` | `own` 独立换行；`shared` 与底部已有统计共用一行 |
| `showCapsule` | `true` | 右下角累计消耗胶囊 |
| `showPopover` | `true` | 悬停底部读数时的双栏详情 |
| `showTps` | `true` | 是否显示实时 TPS |
| `enabled` | `true` | 额度功能总开关；关闭后隐藏相关 UI、停止轮询，并锁定展示和额度查询；不影响模型单价和 YAML 导出 |

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
        sourceType: template
        templateId: opencode-go
        thresholdMode: percent
        warningThreshold: 30       # 剩余额度 < 30% 黄灯
        dangerThreshold: 10        # 剩余额度 < 10% 红灯
        refreshIntervalMs: 300000
      - providerId: go-personal  # DSH 中另一个自定义供应商，使用另一份 Key
        enabled: true
        sourceType: template
        templateId: opencode-go
        thresholdMode: percent
        warningThreshold: 30
        dangerThreshold: 10
        refreshIntervalMs: 300000
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
        sourceType: template
        templateId: deepseek
        thresholdMode: value
        warningThreshold: 10
        dangerThreshold: 5
        refreshIntervalMs: 300000
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
    providerQuotas:
      - providerId: deepseek-official
        enabled: true
        sourceType: template
        templateId: deepseek
        thresholdMode: value
        warningThreshold: 2.0
        dangerThreshold: 0.5
        refreshIntervalMs: 300000
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

`prices` 是「当前 `currency` 下每 1M token」的单价。V4 可写 `peak` / `offPeak`（高峰 / 低谷）。内置 `deepseek-v4-flash` / `deepseek-v4-pro` / `deepseek-v4-flash-vision-exp` 如果只有三个刊例字段，插件仍按官方峰谷表计价（兼容旧配置）。自行添加的模型只写三字段则全天按该价计，等效峰谷倍率 1。高峰为北京时间周一至周五 09:00–12:00、14:00–18:00，其余时段（含周末全天）为低谷。DeepSeek 账户的 CNY / USD 是两套独立钱包：底部会列出选定货币，以及其它仍有余额的钱包；悬停卡片列出全部钱包。计价货币只影响本会话/累计估算和状态灯，不会把其它钱包藏掉。计价仅支持官方提供的 CNY / USD 两套价格，不做汇率换算；旧版 EUR 实际复用了 USD 数值，升级后会按 USD 显示。V4 在 2026-08-17 之后按北京时间走峰谷价，人民币和美元同步切换。

### 自定义 HTTP（高级 YAML）

设置页已经覆盖常用配置。只有批量维护、版本控制或特殊解析时才建议手写 `providerQuotas`：

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
                calculation: direct
                valuePath: $.data.remaining
                totalPath: $.data.total
                unit: USD
                aggregate: value
                scale: 1
                offset: 0
                resetsAtPath: $.data.resetsAt
```

自定义 HTTP 支持直接取「剩余」，也支持用「总额 - 已用」计算剩余。OpenRouter 已是内置模板，不需要再写代理脚本。

请求鉴权支持：

- `Bearer`、`Authorization: Token`、Basic Auth、任意请求头、Cookie、URL 查询参数
- 将凭证注入 JSON 或 `application/x-www-form-urlencoded` 请求体
- 直接填写敏感凭证、复用 DSH 供应商 Key，或在高级选项中使用 credentials / 环境变量引用
- 直接填写的值通过 DSH `credentials.set` 只写保存；设置页和配置 API 只显示「已设置」，不会回显原值，再次填写即覆盖
- 附加多个普通请求头，例如硅基流动网页接口需要的 `x-subject-id`

响应映射支持普通点路径、数组下标和 `[*]` 通配符；数组可取第一项、求和、计数、最小值或最大值，最后再应用乘数与加减偏移。例如 `$.data.wallets[*].remaining` 配合「求和」可汇总代金券列表。当前每个供应商绑定只请求一个 URL；现金与代金券若来自两个接口，暂时不能在同一绑定中组合请求。

#### 硅基流动网页余额示例

硅基流动未提供内置模板，可使用登录后的网页接口配置自定义 HTTP。以下示例只说明字段结构，不应把真实 Cookie 提交到仓库：

```yaml
- id: dsh-credits
  config:
    providerQuotas:
      - providerId: siliconflow-cn
        enabled: true
        sourceType: custom
        source:
          id: quota-siliconflow-cn
          name: 硅基流动-国内额度
          kind: metric
          request:
            method: GET
            url: https://cloud.siliconflow.cn/walletd-server/api/v1/subject/profile/peek
            credentialMode: direct
            authStyle: cookie
            headers:
              x-subject-id: <当前账号的 subject id>
          response:
            metrics:
              - key: remaining
                label: 剩余额度
                calculation: direct
                valuePath: $.data.financialInfo.balance
                totalPath: $.data.financialInfo.recharged
                unit: CNY
                aggregate: value
                scale: 1e-12
                offset: 0
```

页面配置时，将完整 Cookie 填入凭证输入框，`x-subject-id` 放在附加请求头。先测试并确认实际返回字段；如果接口返回的金额使用 `10^-12` 为单位，就把换算乘数设为 `1e-12`。网页接口及字段可能调整，Cookie 过期后需要重新填写。代金券接口与现金余额是两个请求，当前版本不能自动合并。

## 架构

浏览器只读本地缓存，不直连上游：

| 路径 | 作用 |
| :--- | :--- |
| `GET /query-credits` | 账户额度缓存。响应里同时带所有已启用额度源的 `views`；`?source=` 只决定顶层摊平哪一套，`?force=1` 强刷 |
| `GET /query-credits/spend?range=today` | 跨会话累计消耗。`range` 可为 `today` / `yesterday` / `week` / `month` / `custom`；自定义时再带 `from`、`to`（`YYYY-MM-DD` 或 ISO） |
| `GET /query-credits/config` | 读当前配置 |
| `POST /query-credits/config` | 保存配置并立即生效 |
| `POST /query-credits/test-connection` | 使用当前供应商草稿测试模板或自定义 HTTP，并返回可选字段或脱敏后的错误诊断 |

本会话花费由 `queryCreditsCost` 投影折叠 token（每笔带事件时间），按该笔发生时的北京时间峰谷价计价；前端切货币时仍按各自行情重算，不会用“此刻”的单价覆盖早上的高峰用量。实时 TPS 由同一组会话事件生成 `liveTokenUsage` 投影：流式 chunk 阶段按字符估算，provider usage 到达后替换为精确输出 token，步骤结束后保留最近一次速率。累计消耗同样按事件时间计价，并落盘到 `$DSH_HOME/storages/dsh-credits-spend.json`。胶囊位置和所选时间范围记在浏览器 `localStorage`。

密钥走 Harness `credentials`，默认不写进配置文件。

## 更新记录

### 0.3.1

阈值与查询频率全面改为供应商级独立配置，移除全局「阈值与刷新」设置卡。

- 删除全局「阈值与刷新」卡片；阈值、刷新频率均在每个供应商的额度配置中设置
- 每个供应商默认独立阈值，不再有「独立 / 继承全局」开关
- 百分比模式默认预警 / 告急改为 30% / 10%
- 金额模式默认 CNY 10 / 5，USD 2 / 0.5
- 旧配置遗留的 0 阈值视为未设置，自动回退默认值
- 查询频率改为数字输入框，单位分钟，支持 0.5～60 分钟，默认 5 分钟
- YAML 导出不再输出全局阈值 / 刷新字段，改为随 `providerQuotas` 保存
- 会话消耗按「提供方 / 模型」区分，例如 `opencode-go/deepseek-v4-flash`
- 旧会话投影缓存升级后自动失效重建，旧会话也能补上提供方前缀
- 右下角累计消耗胶囊支持视口边界避障 / 贴边，关闭后不会跑出画面

### 0.3.0

额度查询重构为供应商级配置，并扩展自定义 HTTP、诊断和模型计价能力。

- 将内置 `deepseek` / `opencode-go` 抽象为额度源适配器注册表
- 支持自定义 HTTP / JSONPath 额度源：`balance` / `usage` / `metric`
- 自定义 HTTP 支持 Cookie / Token / Basic / Header / Query / JSON / Form 鉴权、请求体与数值转换
- 自定义指标支持直接读取、总量减已用量、百分比基准、重置时间、数组汇总、乘数和偏移
- 测试连接可读取响应字段；请求失败时可查看并复制脱敏后的请求与响应诊断
- 移除不可靠的硅基流动旧余额模板
- 设置页改为以 DSH 供应商列表为主体，每个供应商可独立使用内置模板、复用另一供应商或自定义 HTTP
- 模板匹配改为后台默认逻辑：匹配成功直接展示可编辑的内置模板，匹配失败进入自定义 HTTP；不再暴露全局查询模式或「自动识别」选项
- 同一模板的多个供应商分别使用各自凭证和缓存，可配置多个 OpenCode Go 账号
- 直接输入的敏感凭证写入 DSH credentials，页面和配置 API 不回显原值
- 服务端与客户端统一按 `kind` 渲染，不再写死 `opencode-go`
- 供应商子卡片独立标记未保存状态；改回原值后自动清除提示
- 内置 `deepseek-v4-flash-vision-exp` 定价，恢复官方默认价不会删除自定义模型
- 计价货币仅保留官方 CNY / USD 两套价格；修复旧 EUR 复用 USD 数值但标签错误的问题
- V4 按工作日峰谷和周末全天低谷计价，本会话与累计消耗均按每笔请求发生时间计算
- 更新供应商级额度配置、自定义 HTTP 和内置模板的高清截图

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

**普通 `git push` 不会发包。** 只有推送符合 `v*` 的 tag（例如 `v0.3.1`）才会触发 `.github/workflows/publish.yml`。

第一次发布前：

1. 在 [npmjs.com](https://www.npmjs.com/signup) 注册账号（包名 `dsh-credits` 目前可用）。
2. 生成 **Automation** 或 Granular Access Token，权限包含 publish。
3. GitHub 仓库 → Settings → Secrets and variables → Actions → New repository secret，名称必须是 **`NPM_TOKEN`**，值贴刚才的 token。不要写进代码或 README。
4. 仓库 Settings → Actions 允许 workflow 运行。
5. `package.json` 的 `version` 与即将打的 tag 一致后：

```sh
git tag v0.3.1
git push origin v0.3.1
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
A: 插件先根据当前模型的 DSH 供应商 ID 找到它自己的 `providerQuotas` 绑定。内置模板默认复用该供应商保存的 Base URL 与 Key；自定义 HTTP 则按页面选择使用直接凭证、DSH 供应商 Key、凭证引用或无鉴权。Key 不会发给浏览器。

**Q: 状态灯规则？**  
A: 每个供应商使用自己的 `warningThreshold` / `dangerThreshold`。DeepSeek 按余额金额对比，OpenCode Go 按剩余额度百分比对比；未填写时使用该模式的默认值。🟢 ≥ 预警线；🟡 告急线～预警线；🔴 < 告急线或接口不可用。

**Q: 切模型后底部读数会跟着变吗？**  
A: 会。插件按当前模型的 DSH 供应商 ID 读取它自己的 `providerQuotas` 绑定；没配置或单独关闭时不显示额度，不会回退到其它账号。

**Q: “自动识别”去哪了？**

A: 它现在只是后台默认逻辑，不再是页面选项。识别成功时会直接显示匹配到的内置模板，你仍可修改模板；识别失败时使用自定义 HTTP 配置。

**Q: 一个自定义供应商能同时查询现金余额和代金券两个接口吗？**

A: 当前不能。一个供应商绑定只发送一个 HTTP 请求，可以在同一个响应内配置多个指标或汇总数组；来自两个不同 URL 的数据暂时不能合并。

**Q: 8 月 17 日峰谷价会自动切吗？**  
A: 会。北京时间 2026-08-17 00:00 之后，V4 Flash / Pro / Flash Vision Exp 在周一至周五 09:00–12:00、14:00–18:00 按高峰价；工作日其余时段及周末全天按低谷价。
