# 中国节假日数据

`holidays-2026.json` 原样取自 [NateScarlet/holiday-cn](https://github.com/NateScarlet/holiday-cn)，固定版本 `dcecbce230a57639cc8967ec9e2465e744880fd8`，2026-10-08 核对。

数据内 `papers` 保留国务院通知原文链接；`days` 列出放假及补班日期，普通日期由北京时间星期推导。上游 MIT 许可证保留在 `holiday-cn-LICENSE`。

插件不自动下载日历，也不解析政府公告。手动维护步骤：

1. 从上游固定 commit 下载所需年度 JSON，核对 `papers`、年份和日期，保存为 `holidays-YYYY.json`。同一年文件如有修订，直接替换。
2. 在 `src/pricing.js` 导入新增年度文件，并加入 `calendars` 数组。保留历史年度，避免历史用量重算失去节假日信息；跨年安排需核对相邻年度文件。
3. 更新此文件的来源版本及 README 的覆盖年份，运行 `npm test`。前端通过 `/query-credits` 获取同一份日历，不需另改日期表。

当前策略：周末（即使补班）及 `isOffDay: true` 的日期全天谷价；普通周一至周五北京时间 09:00–12:00、14:00–18:00 为峰价。未收录年份退回星期规则，不保证节假日计价准确；使用新年度前需手动补齐。DeepSeek 调整计费策略时，另行核对并修改前后端规则及测试，日历不会代替计费政策。
