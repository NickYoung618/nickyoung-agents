# GitHub 功能整合

整合基线：GitHub `main` 的 `262e726`（自适应执行与静态作品预览）和成果工作台分支 `6ab2e0e`。源代码版本为 `20261114-integrated-1`。

保留显式选择的 adaptive_v1、legacy、自适应三种审查策略、实际工具活动、静态作品历史版本及隔离预览；同时保留结构化成果清单、独立数据验收、稳定反馈、使用数据升级、项目导航、投影检查点与安全发布。

## 数据与接口

两种成果有不同语义，使用共同的会话、任务和提交关联：

- `artifact_ready` 是静态作品与附件，保留草稿／程序验证状态和构建出处，任务页「预览」可切换版本。
- `artifact` 是成果工作台固定版本，保留使用示例、独立场景验证、用户使用数据和显式用户验收。
- `GET /api/conversations/:c/artifacts` 保持成果工作台数组格式；`?view=preview` 返回静态作品的 `{artifacts,preview}`。静态作品的 content/download/source 与结构化成果的 start/verify/package/feedback 等动作按对应 ID 分派。
- 状态重放、前端增量和 SQLite 投影使用同一个 reducer，保留批次、成果、当前目标与要求来源。SSE 以固定 200ms 窗口获取有界增量，不因持续输出无限推迟显示。
- 交付页将可直接打开的静态作品与结构化成果放在前面，报告和原始证据折叠。静态草稿不会标为任务验收通过，也不会自动确认用户验收。

固定发布目录的 runtime 标识使用 release.json 的提交，避免读到外层工作区的 HEAD。发布脚本从 HTML 读取源版本，默认发布当前 HEAD；可通过 NY_DATA 复用现有数据，NY_RELEASE_REF 指定源码引用，NY_HISTORY_DATA 指定已经隔离验证的历史副本。没有历史副本时只跳过导入，不删除既有成果。新发布记录默认在 `evidence/releases/<版本>/`，可由 NY_RELEASE_EVIDENCE 指定位置。回滚根据备份目录寻找数据，保留当前数据库与用户使用数据。

## 验证

证据单独保存在 `evidence/github-merge-20261114/`：

- `tests-final.log`：131 项完整 Node、接口、进程和受控工作流回归全部通过，包含两侧原有测试与新增兼容测试。
- `compatibility-first.log`：自适应投影重启、同会话两类成果列出／下载／运行，以及不可变发布 runtime 标识。
- `ui-final.log`、`ui-final/`：自适应与原有工作台、草稿、键盘、多视口回归。
- `preview-second.log`、`preview/`：真实动画播放、暂停、重播，版本切换、失败保留和 sandbox 隔离。
- `workbench-first.log`、`workbench/`：文字／截图／iframe 稳定、独立验收、刷新重连、响应丢失与延迟响应。
- `build.log`：前端资源构建。

测试使用隔离数据与受控运行器，不调用真实模型，不向生产注入数据。原证据保持不变；首轮静态预览入口被折叠的失败与修复后结果分别保留。

## 运行状态

本次是 GitHub 合并，整合源代码没有替换现有生产服务。当前生产仍运行先前已验证的 `20261114-workbench-4.2`，代码提交 `1254172`，登录、模型配置与用户数据保持现状。整合版本需要按维护发布流程另行上线，不把 GitHub 合并当成进程已经更新。
