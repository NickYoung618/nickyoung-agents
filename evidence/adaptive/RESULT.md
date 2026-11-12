# 自适应流程交付记录

隔离开发副本：`/home/ubuntu/disk/dzk/nickyoung-adaptive`，分支 `adaptive-v1`。基线、原 HEAD 和 fetch 后 origin/main 均为 `aa1f35fb5efa6b3f5343fa8484b6d717d0c31be1`；原工作区干净。Node 24.15.0。原仓库保持该 HEAD，工作区仍干净。

## 提交与代码

| 工作包 | 提交 | 主要文件 |
| --- | --- | --- |
| E0 | b91cec9 | engine、statistics、tracing 测试与基线证据 |
| E1 | dd080c0 | contracts、workflow-policy、store、runner、MCP、角色提示词 |
| E2 | 578db7e | workflow、依赖调度、版本和代际、正式检查、程序交付 |
| E3 | 2f2f8b7 | 固定快照证据、审查分类、局部修复和复查预算 |
| E4 | 90ab1ff | 原 studio 状态/图/交付卡、可选入口、浏览器证据 |
| E5 | 本提交 | 评估脚本、预算、轨迹、恢复与目标版本回归、文档与开关 |

三条路径由 `src/workflow-policy.mjs` 选择，共用 `src/workflow.mjs` 调度。`next/execute/verify/review/deliver` 完成连续实现、集成检查、整体审查与确定性交付。`contracts.mjs` 为 JSON 与 MCP 提供相同计划结构。`runner.mjs` 分离角色 schema 和权限；`store.mjs` 重放历史与批次事件。`verification.mjs` 记录正式检查和严格复用。`statistics.mjs` 与 `/api/stats/cycles` 记录各用途、已知 token 小计和未知覆盖率。

## 实际验证

| 命令 | 结果与证据 |
| --- | --- |
| npm ci | 成功，0 vulnerabilities；未更改依赖或 lockfile |
| 基线 npm test | 35/35，见 baseline.json |
| 基线 npm run test:ui | 通过，见 baseline-ui.txt |
| 最终 npm test | **76/76，失败 0、跳过 0**，见 unit-tests.txt |
| npm run test:workflow | 独立入口实际执行通过，见 workflow-tests.txt；最终全部新增用例同时由 npm test 覆盖 |
| 恢复/失败专项 | 16/16，见 resume-tests.txt；后续新增用例已进入最终 76 项 |
| npm run test:ui | 通过，页面脚本异常 0，见 ui-tests.txt、ui/browser.json |
| npm run trace:workflow | 六种受控场景完成，正式命令实际执行，见 traces/ |
| npm run evaluate:workflow | **not_run**，真实模型预算未授权，见 evaluation-default.json |
| git diff --check | 通过 |

最终回归包含：旧会话和报告、五任务调用次数、direct 与 auto 免审、检查点依赖、原子计划校验、重复提交与 pump、取消/改派/暂停后的迟到结果、检查/审查恢复、持久化规划结果重放、新目标版本、问题与授权拒绝、同版本检查复用与失效、网络/时间/随机检查不默认缓存、构建输出与源码污染、建议不返修、局部检查闭合、范围复查、公共约定升级、未知风险预算、限流与缺失依赖、硬失败上限、角色权限与会话隔离、MCP/JSON 等价、部分 usage 与未授权评估。

实际补丁回归对 clamp 下界缺陷新增一条测试，修复后的正式子检查确实执行并通过 2 条测试；审查提交与最终补丁提交不同，Git diff 中可见源码和测试变化。

## 调用轨迹

这些是受控模型夹具，不是真实模型质量、完成率或成本收益测量。模型输出明确标记 fixture；命令检查由程序在隔离 worktree 的沙箱中实际执行。每个轨迹有 runId、cycleId、用途、触发依据、scheduleId、提交与证据；未知 usage 保留为未知，不推断费用。

| 场景 | 规划 | 实现 | 修复 | 审查 | 额外协调 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| three_tasks | 1 | 3 | 0 | 1 | 0 | done |
| five_tasks | 1 | 5 | 0 | 1 | 0 | done |
| direct | 0 | 1 | 0 | 0 | 0 | done |
| auto_checks_only | 1 | 1 | 0 | 0 | 0 | done |
| checkpoint | 1 | 3 | 0 | 1 | 0 | done |
| local_repair | 1 | 1 | 1 | 1 | 0 | done |

[摘要](traces/summary.json)；[三任务完整事件](traces/three_tasks.json)；[五任务完整事件](traces/five_tasks.json)；[direct](traces/direct.json)；[检查点](traces/checkpoint.json)；[局部修复](traces/local_repair.json)。正常成功没有额外负责人确认或结尾调用。auto 免审仍记录首次规划。

## 界面证据

- [免审交付](ui/checks_only-result.png)：如实显示按策略无需模型审查。
- [整体审查](ui/final_review-result.png)：批次、最终提交和审查记录。
- [局部修复](ui/local_repair-result.png)：原提交已审查＋后续补丁经指定检查。
- [检查点等待](ui/checkpoint_wait-task.png)、[升级](ui/escalation-task.png)、[暂停](ui/paused-task.png)、[恢复](ui/resumed-task.png)。
- [浏览器断言](ui/browser.json)：草稿与策略选择恢复、附件、防重复、SSE、阅读位置、版本提示、真实交接单次动画、1～8 人与聚合、选中状态、减少动态效果、手机抽屉焦点、目录扫描和连接测试区分。
- 六视口 × 深浅色 × 五视图无横向溢出；[手机暗色](regression/task-390-dark.png)、[手机抽屉](regression/drawer-360-light.png)、[桌面浅色](regression/home-1536-light.png)。截图为隔离浏览器夹具，不是未经授权的真实模型或生产验收。

## 启用、兼容与回滚

工作台新建会话「执行策略」选择自适应；API 显式 `workflowVersion:"adaptive_v1"`。未提供仍为 legacy。完整 direct 配置才绕过规划；已有 legacy/adaptive 会话固定版本，不由开关转换。关闭新建选项不影响在途引擎。

回滚前先停止或完成在途 adaptive 会话，保留事件、日志和交付快照；旧二进制不能接管 adaptive 事件。整体回退应同步恢复 engine/store/runner/prompts/studio 与 UI 版本，不能只换旧调度器或删除历史。详细格式、预算参数和边界见 [ADAPTIVE-WORKFLOW.md](../../docs/ADAPTIVE-WORKFLOW.md)。

本轮没有修改生产数据或模型配置，没有重启、push、merge 或部署。真实提供商的 schema 成功率、真实任务效果、费用收益和人工手机/读屏体验未实测；没有节省比例结论。contractPaths、检查覆盖与 deterministic 声明仍依赖规划质量，程序不承诺任意语义证明、跨提交智能复用或外部副作用 exactly-once。
