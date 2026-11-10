# 额度与消耗

在输入框下方查看当前供应商的余额、套餐用量和本会话估算费用。

- **额度跟随模型**：支持 DeepSeek API Key / 登录账号余额、OpenCode Go 等内置模板，也可配置自定义 HTTP 接口。
- **会话费用与 TPS**：展示估算消耗和生成速度；支持供应商独立单价与 DeepSeek 峰谷价。
- **累计消耗**：右下角可拖动胶囊，按全部、今天、本周、本月或自定义区间查看。

## 开始使用

打开 **设置 → 额度与消耗 → 额度查询**，为需要展示的供应商选择额度来源，保存后开启。底部条、累计胶囊和 TPS 可在「展示」中分别开关。

设置保存到当前 Web / 桌面配置档，凭证保存在 DSH credentials。费用为按单价计算的估算值，以供应商账单为准。

升级后如提示重启，请完全退出并重新打开 DSH；Web 版需重启 `dsh web`。

[完整使用与配置文档](https://github.com/AnLifeX/dsh-credits#readme) · [反馈问题](https://github.com/AnLifeX/dsh-credits/issues)
