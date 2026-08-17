# dsh-credits

DeepSeek Harness（`dsh web`）额度插件：在输入框下方统计条同一行，实时显示账户额度与本会话估算消耗；右下角另有可拖动的累计消耗胶囊。

- **账户额度 + 状态灯**  
  DeepSeek 模式如 `🟢 余额 ¥97.69`；OpenCode Go 模式如 `🟢 Go 额度 月 6% · 周 12% · 5h 9%`。点击圆点可立即强刷。
- **本会话估算消耗**  
  按模型单价估算（单价可在设置面板修改）。DeepSeek V4 自 2026-08-17 起按北京时间自动套用峰谷价。
- **累计消耗胶囊**  
  右下角可拖动气泡，查看今天 / 昨天 / 本周 / 本月 / 自定义时间范围内的跨会话估算总额（按当前计价货币与单价现算）。
- **可视化设置**  
  齿轮图标打开：数据源、阈值滑块、API 凭证、连通性测试、模型单价、YAML 导出。保存后立即生效。

## 界面预览

悬停底部读数，会展开双栏卡片：左侧是账户额度（DeepSeek 列出全部币种钱包，Go 列出三个用量窗口），右侧是本会话估算。

![DeepSeek 官方余额悬停卡片](./assets/preview.png)

底部统计条会跟输入框那一行并排：

![DeepSeek 余额条](./assets/bar-deepseek.png)

![OpenCode Go 额度条](./assets/bar-go.png)

OpenCode Go 模式下，卡片改成三个窗口的用量百分比与重置时间：

![OpenCode Go 额度卡片](./assets/card-go.png)

右下角可拖动的累计消耗胶囊，按今天 / 昨天 / 本周 / 本月 / 自定义区间汇总跨会话估算：

![累计消耗胶囊](./assets/capsule.png)

## 数据源

| provider | 说明 | 上游接口 | 密钥 |
| :--- | :--- | :--- | :--- |
| `deepseek` | DeepSeek 官方余额 | `GET /user/balance` | `DEEPSEEK_API_KEY` |
| `opencode-go` | OpenCode Go 订阅用量 | `GET https://opencode.ai/zen/go/v1/usage` | `OPENCODE_GO_API_KEY` 或 OpenCode `auth.json` |

本仓库默认 `provider: opencode-go`。切回官方余额时把 `provider` 改成 `deepseek` 即可。

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

## 配置

覆盖文件：`$DSH_HOME/profiles/web/cordis.patch.yml`。也可在 Web 设置面板改完点「保存并生效」。

### OpenCode Go（默认）

```yaml
- id: dsh-credits
  config:
    provider: opencode-go
    opencodeApiKeyRef: OPENCODE_GO_API_KEY
    opencodeBaseUrl: https://opencode.ai/zen/go/v1/usage
    warningThreshold: 10          # 剩余额度 < 10% 黄灯
    dangerThreshold: 5            # 剩余额度 < 5% 红灯
    refreshIntervalMs: 300000
    clientPollIntervalMs: 30000
    timeoutMs: 15000
    currency: USD
```

Go 模式展示 5 小时 / 每周 / 每月三个窗口的用量百分比与重置时间；状态灯按「剩余最少」的窗口判定。套餐没有固定美元上限可展示。

### DeepSeek 人民币账户

```yaml
- id: dsh-credits
  config:
    provider: deepseek
    apiKeyRef: DEEPSEEK_API_KEY
    baseUrl: https://api.deepseek.com
    warningThreshold: 10
    dangerThreshold: 5
    refreshIntervalMs: 300000
    clientPollIntervalMs: 30000
    timeoutMs: 8000
    currency: CNY
    prices:
      deepseek-v4-flash: { cacheHit: 0.02, cacheMiss: 1, output: 2 }
      deepseek-v4-pro: { cacheHit: 0.025, cacheMiss: 3, output: 6 }
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
      deepseek-v4-flash: { cacheHit: 0.0028, cacheMiss: 0.14, output: 0.28 }
      deepseek-v4-pro: { cacheHit: 0.0035, cacheMiss: 0.42, output: 0.84 }
```

`prices` 是「当前 `currency` 下每 1M token」的刊例单价。DeepSeek 账户的 CNY / USD 是两套独立钱包：底部会列出选定货币，以及其它仍有余额的钱包；悬停卡片列出全部钱包。计价货币只影响本会话/累计估算和状态灯，不会把其它钱包藏掉。切换货币时会套用该币种官方刊例单价，**不会做汇率换算**。V4 在 2026-08-17 之后按北京时间走峰谷价，人民币和美元同步切换（美元 = 人民币官方价 × 0.14）。

## 架构

浏览器只读本地缓存，不直连上游：

| 路径 | 作用 |
| :--- | :--- |
| `GET /query-credits` | 账户额度缓存（`?force=1` 强刷） |
| `GET /query-credits/spend?range=today` | 跨会话累计消耗。`range` 可为 `today` / `yesterday` / `week` / `month` / `custom`；自定义时再带 `from`、`to`（`YYYY-MM-DD` 或 ISO） |
| `GET /query-credits/config` | 读当前配置 |
| `POST /query-credits/config` | 保存配置并立即生效 |
| `POST /query-credits/test-connection` | 连通性测试 |

本会话花费由 `queryCreditsCost` 投影折叠 token（每笔带事件时间），按该笔发生时的北京时间峰谷价计价；前端切货币时仍按各自行情重算，不会用“此刻”的单价覆盖早上的高峰用量。累计消耗同样按事件时间计价，并落盘到 `$DSH_HOME/storages/dsh-credits-spend.json`。胶囊位置和所选时间范围记在浏览器 `localStorage`。

密钥走 Harness `credentials`，默认不写进配置文件。

## 发布到 npm

**普通 `git push` 不会发包。** 只有推送符合 `v*` 的 tag（例如 `v0.1.0`）才会触发 `.github/workflows/publish.yml`。

第一次发布前：

1. 在 [npmjs.com](https://www.npmjs.com/signup) 注册账号（包名 `dsh-credits` 目前可用）。
2. 生成 **Automation** 或 Granular Access Token，权限包含 publish。
3. GitHub 仓库 → Settings → Secrets and variables → Actions → New repository secret，名称必须是 **`NPM_TOKEN`**，值贴刚才的 token。不要写进代码或 README。
4. 仓库 Settings → Actions 允许 workflow 运行。
5. `package.json` 的 `version` 与即将打的 tag 一致后：

```sh
git tag v0.1.0
git push origin v0.1.0
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
A: 请求头带你的 API Key。DeepSeek 默认复用聊天用的 `DEEPSEEK_API_KEY`；OpenCode Go 按上文顺序解析。

**Q: 状态灯规则？**  
A: DeepSeek 按余额金额对比 `warningThreshold` / `dangerThreshold`。OpenCode Go 按剩余额度百分比对比同一组阈值。🟢 ≥ 预警线；🟡 告急线～预警线；🔴 < 告急线或接口不可用。

**Q: 8 月 17 日峰谷价会自动切吗？**  
A: 会。北京时间 2026-08-17 00:00 之后，V4 Flash / Pro 按 09:00–12:00、14:00–18:00 高峰价，其余时段半价。
