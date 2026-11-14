# 成果持续交付验证

最终生产：`20261114-workbench-4.2`；运行代码 `1254172dfe38ac57ae90d09c0f6f1f6358bf88d4`。证据中的历史代码重建、受控运行器与本轮真实模型调用分别记录，不把自动化标为用户验收。

| 验证 | 入口 |
|---|---|
| 总览 | verification-summary.json |
| 最终单元、状态机、隔离接口与进程测试 | tests-4.2-final.log（71 项） |
| 多视口与键盘、草稿、设置回归 | ui-4.2/browser.json |
| 稳定反馈、截图、iframe、响应丢失、连续编辑 | repair-regression/browser.json |
| 过期/停止/启动失败/重启 | repair-regression/expiry-browser.json |
| 浏览器暂停与真实 HTTPS 进程重启恢复 | repair-regression/recovery-browser.json |
| 慢增量下首次导航与用户选择 | bootstrap-browser.json |
| 六个历史会话逐项处理 | history-final.json |
| 历史网页操作、完整包独立启动和 CLI 输出 | browser.json |
| 实际历史登记流程、原仓库不可用时完整包及重复导入 | import-check.json |
| 现有订阅真实模型：已有项目、CLI、网页、反馈后新版及数据保留 | live.json（8 次模型启动，含独立审查） |
| 跨会话升级来源与数据保留 | cross-session-fixed.log |
| 长历史索引、缓存和分页 | performance.json |
| 原目录不可用时 SQLite/成果/使用数据实际恢复 | restore.json |
| 发布损坏检测、真实进程切换与回滚 | rollover.json |
| 活跃浏览器/空闲 TLS 下回滚排空及限时退出 | rollback-drain-test.log |
| 发布目录、备份和服务版本 | deployment.json、service-final.txt |
| 公网登录、历史、静态资源一致、成果操作和三次刷新 | production.json |
| 工作区运行源文件与实际运行提交一致、原主分支及暂存区保留 | source-consistency.json |

首次失败及原始原因单独保留：history-first、live-first-failure、restore-first、tool-first、unchanged-first、cross-session-first、bootstrap-first，以及各轮原始测试日志。production-final.log 是 4.1 公网首次点击暴露的初始化竞态，随后通过受控慢增量复现并修复；最终线上结果以 production-4.2.log/production.json 为准。临时预览能力链接已脱敏。

生产没有注入测试事项、执行自动验收、发送反馈或确认用户验收。真实手机软键盘和读屏器未人工验证；OpenCode 外部认证模式、Python/Docker/原生扩展及外部服务数据恢复不在支持范围。
