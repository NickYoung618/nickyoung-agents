# NickYoung 交付与验收

服务运行于 https://43.156.51.71:8787 ，用户级 `nickyoung.service` 已启用。当前负责人为 GPT-6.1-Sol / high，执行成员为 GPT-6.1-Sol / medium；当前不调用 Claude。

初始口令在 `data/initial-password`，文件权限 600。源码、说明、截图及验收事件保存于本目录，口令、私钥、数据库和日志不入库。

## 交付结果

- 真实模型完成零依赖 Node 待办 CLI 和 JSON 名字列表 CLI，均通过程序验收与独立成员实测审查。名字列表工具另经独立进程验证中文名字的添加、持久化及列出。
- 受控缺陷完整经历机器退回、原成员返修、审查退回、第二次失败会诊、修复、机器复验和独立复审，最终通过。负责人亲读实际代码并给出具体改法。
- 真实讨论收齐两位成员意见，负责人记录结论；是/否请示等待期间，无关 README 任务通过审查；回答后继续实现并交付。
- 团队工作中重启服务，中断被记录，负责人恢复任务并完成交付。工作中插入新要求后，负责人安排补充任务，经实测和审查通过。
- 已有仓库创建了新任务分支，原主分支提交未变化；新增档位实际招募了成员，测试后恢复原档位清单。
- 新对话读取经验，实际回复建议使用 Sol / medium、不调用 Claude。配置、用量、失败与返修均有事件记录。
- 项目沙箱允许目录内写入、拒绝目录外写入，保留实际退出码。讨论和执行共用成员并发上限，同一成员不会重复启动；取消与改派仅影响目标任务。
- 历史发言显示该回合实际模型，换模不会重写旧消息标签。浅深色界面和协作图已截图，浏览器未发现脚本错误。

## PLAN.md 验收对照

| 场景 | 验证结果与证据 |
|---|---|
| 1 完整流程 | 待办工具、名字列表工具均完成真实开发、提交、机器验收、独立实测审查与报告。`core-events.json`、`live-events.json` |
| 2 返修闭环 | 两个受控缺陷分别被机器和模型发现，返修会诊后对新提交复验、复审通过，累计失败次数为 2。`repair-events.json`、`repair-run.txt` |
| 3 升级与方案问题 | 真实二次失败会诊给出具体代码改法并完成修复；首次返修、第二次会诊、第三次停止及方案问题分流有自动化覆盖。`repair-events.json`、`unit-tests.txt` |
| 4 请我决定 | 等待 JSON/CSV 选择期间，独立 README 任务先通过；测试驱动回答“是”后继续完成 JSON 实现。`independent-before-answer.json`、`live-events.json` |
| 5 讨论 | 两位真实成员分别给出 JSON/CSV 意见，负责人记录结论，一轮结束；两轮上限自动化通过。`live-events.json` |
| 6 插话、暂停、继续 | 暂停继续真实记录见核心事件；青禾正在审查时插入补充要求，新增任务执行、实测和审查通过。`interjection-at-running.json`、`existing-events.json` |
| 7 恢复 | 青禾运行中重启服务，进程中断后负责人接手恢复，最终交付。刷新、重连和中断恢复状态机通过。`restart-before.json`、`restart-after.json`、`live-events.json` |
| 8 已有项目 | 已有仓库新建任务分支，原 master 提交不变，插话后两句说明均已写入；CLI 独立运行通过。`existing-before.json`、`existing-after.json`、`existing-events.json` |
| 9 换模型 | Sol / high、Sol / medium 等配置经真实测试保存；新增档位被实际招募，随后恢复档位清单；不存在的模型被拒绝且未改配置；同通道续用会话和对话专用设置有适配器测试。`leader-sol-high.json`、`current-models.json`、`invalid-model.json`、`existing-events.json` |
| 10 访问与登录 | 公网和 localhost HTTPS 200；认证隔离、5 次失败限速、Cookie 属性、来源检查及改密注销通过自动化；systemd active、enabled。未重启整台共享服务器。 |
| 11 界面 | 浅深色新对话、设置、工作中、等待决定、已完成和展开协作图已截图；浏览器脚本错误为 0。`browser.json`、`live-browser.json` 及 PNG |
| 12 经验、统计及跨通道 | 经验在新对话中被实际采用；统计按交付模型归属，含缓存、失败及返修，对账测试通过；此前成员 GPT→Claude 实际工作通过，通道往返、会话接续及上下文交接有适配器测试。`experience-events.json`、`statistics.json`、`core-events.json`、`unit-tests.txt` |

本地 26 项自动化测试全部通过，覆盖状态重放、任务与收工门槛、角色与审查、返修升级、并发、排队取消与改派、提问接续、请示关闭、恢复、认证、进程终止、限流恢复、模型通道、历史模型标签和统计。

## 证据位置

本表中的 JSON、TXT 和 PNG 均在 `evidence/`。

截图包括 `new-light.png`、`new-dark.png`、`settings-light.png`、`settings-dark.png`、`working-light.png`、`working-dark.png`、`waiting-light.png`、`waiting-dark.png`、`completed-light.png`、`completed-dark.png`、`graph-light.png` 和登录页。`final-summary.json` 汇总模型、任务状态、团队工具实际调用及验收配置恢复结果。

## 费用及边界

真实调用使用服务器现有订阅登录，无 API key；模型回合用量和耗时记录在事件中。CLI 的费用字段不等同于用户实际账单，不折算美元费用。自动化测试和沙箱边界测试不调用真实模型；适配器及限流测试使用明确的测试进程，不作为真实模型场景证据。

Claude 当前返回 API 403（`oauth_not_allowed_for_organization`），原始响应保存在 `provider-block.json`。按用户当前“不用 Claude”的设置，不再进行 Claude 回切实测；此前成功的成员跨通道记录保留。当前 GPT 配置的功能验收不依赖 Claude。

任意模型及推理强度组合没有逐一消耗额度测试。整台共享服务器的重启和笔记本证书信任安装未执行；用户服务启用状态、服务重启恢复和 HTTPS 访问已验证。单个附件最多 8 MB，单次请求最多 16 MB，不提供项目运行预览代理。


## 新版界面更新（2026-11-12）

接入用户提供的 UI 包，改为视口固定的单屏工作台，任务输入框固定可见，桌面协作区保持右侧分栏，手机使用抽屉。资源增加版本号。模型设置按 CLI 原生目录扫描模型和各自强度，保持负责人 Sol / high、执行 Sol / medium。29 项自动化测试通过。公网单屏尺寸检查及截图见 `evidence/ui-package/`，真实与隔离测试的边界见 `docs/UI-INTEGRATION.md`。

## vNext 体验优化（2026-11-13）

项目选择、任务摘要、分级日志、草稿恢复、自适应真实协作图、决策卡、交付证据与模型设置反馈已接入。35 项测试及浏览器回归通过：六个视口、深浅色、五个视图，页面脚本错误 0。500/2000/5000 条事件的响应后 DOM 观测上界分别为 59/60/130ms。

隔离真实任务 `dd95fb52-6407-4d38-89f7-03b5b58d5bc7` 已交付，提交 `b3e41c02ec1d777160a43a6c9509be9b3389c789` 经机器验收与独立 Sol 成员审查通过。服务已应用 `20261113-ux-1`，版本、状态和模块接口 HTTP 200。实施说明和人工验证边界见 `docs/UX-VNEXT.md`，截图及原始事件见 `evidence/ux-vnext/`。

## 自适应流程开发副本

本轮基线 aa1f35f，隔离分支 adaptive-v1。E0 调用追踪、E1 角色/策略、E2 连续调度、E3 检查证据与有限返修、E4 原 UI 对接、E5 无模型评估入口与发布文档均已落地。逐项命令、调用轨迹和截图见 [本轮验证结果](evidence/adaptive/RESULT.md)；正式规格见 [ADAPTIVE-WORKFLOW.md](docs/ADAPTIVE-WORKFLOW.md)。

本轮没有重启、push、merge 或部署，没有改生产数据和模型配置；真实模型评估未获预算授权，未执行，不报告效率提升比例。此前各节的真实服务和模型记录属于历史验收。
