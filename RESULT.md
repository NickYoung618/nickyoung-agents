# NickYoung 验收记录

服务已在 https://43.156.51.71:8787 运行，用户级 `nickyoung.service` 已启用。公网和 localhost 登录页均返回 HTTPS 200。

当前负责人为 Sonnet / low，执行模型为 GPT-6.1-Sol / medium，辅助模型为 GPT-6-Astra / high。初始口令文件为 `data/initial-password`，权限 600。

## 已验证结果

- 真实团队交付了零依赖 Node 待办 CLI，程序验收通过，另一位成员在独立 worktree 实际运行 11 个测试、跨进程持久化及错误退出码检查并通过，负责人读取核心代码后交付。
- 真实请示、用户回答、暂停与继续均写入事件。原交付的补审已通过，关联遗留已关闭。
- GPT 成员换到 Claude 后读取项目须知、实际执行测试、修改 README，并通过程序验收和独立成员审查。当前执行成员已按用户设置恢复为 GPT-6.1-Sol / medium。
- 受控缺陷场景实际触发一次机器退回、一次模型审查退回，累计两次失败进入会诊状态。
- 项目沙箱允许目录内写入、拒绝项目外写入，退出码 7 能原样返回。
- 本地 17 项自动化测试通过：任务门槛、独立审查人、返修升级、遗留关联、已有目录建仓确认、取消与暂停、服务恢复、讨论上限、HTTPS 认证隔离与限速、改密注销、真实子进程终止、输出与退出码、事件重放、统计归属及缓存用量。

## PLAN.md 场景对照

| 场景 | 结果与证据 |
|---|---|
| 1 完整流程 | 真实开发、提交、机器验收、独立实测审查及交付已通过。`evidence/core-events.json` |
| 2 返修闭环 | 机器退回和审查退回均已真实验证；两次受控缺陷的完整会诊后复验尚未完成。`evidence/repair-events.json`、`evidence/repair-run.txt` |
| 3 逐级升级及方案问题 | 首次返修、二次会诊、三次停止及方案问题分流有自动化覆盖；真实缺陷场景已进入二次会诊，负责人的真实会诊意见待补。 |
| 4 请我决定 | 真实是/否请示及用户选择“是”后继续交付已验证；等待期间的无关任务并行场景待补。`evidence/core-events.json` |
| 5 讨论 | 工具和两轮上限已实现，上限自动化通过；完整真实讨论待补。 |
| 6 插话、暂停、继续 | 项目中真实暂停和继续后完成交付；子进程终止与任务取消测试通过。工作中改变产品要求的完整场景待补。 |
| 7 恢复 | 服务多次重启后记录保留，浏览器刷新及重连无脚本错误；中断恢复状态机测试通过。所有中断阶段的真实进程验收待补。 |
| 8 已有项目 | 分支创建和非 Git 目录确认路径有测试，已有外部项目的完整模型验收待补。 |
| 9 换模型 | 负责人 Opus/medium、Sonnet/low 均真实测试成功，当前 Sonnet/low；执行 Sol/medium 测试成功。模型保存门槛、档位增删排序、在岗换模已实现，完整组合验收待补。`evidence/current-models.json`、`evidence/leader-sonnet-low.json` |
| 10 访问和登录 | 公网及 localhost 访问通过；认证隔离、5 次失败后限速、Cookie 属性、来源校验、改密后旧会话失效通过自动化。systemd 已运行并启用自启，未重启整台共享服务器。 |
| 11 界面 | 已截图自查浅深色新对话、设置、已完成和展开协作图，浏览器脚本错误为 0；工作中和等待决定画面的最终截图待补。`evidence/browser.json` 及同目录 PNG |
| 12 第二步 | 成员 GPT→Claude 接续及实际工作通过；经验写入和注入、按模型/档位用量及返修统计已实现，统计单元对账通过。负责人跨通道往返和经验影响的真实场景待补。 |

截图：`login-light.png`、`new-light.png`、`new-dark.png`、`settings-light.png`、`settings-dark.png`、`completed-light.png`、`completed-dark.png`、`graph-light.png`。

## 费用与验证范围

使用服务器现有订阅登录，无 API key。真实回合的 token 用量与耗时写在事件 `model_result` 中；订阅额度与美元费用无法等同，未估算费用。自动化测试与沙箱边界测试不调用模型。

继续验收时 Claude 返回 API 403，错误码 oauth_not_allowed_for_organization，当前订阅无法使用。已停止重试 Claude，受控缺陷场景停在会诊阶段。错误原文见 evidence/provider-block.json；未将失败计为通过。其余本地验证继续完成。

## 已知限制

- 未完成上表标明的组合场景和截图，当前不标记为 PLAN.md 全量验收通过。
- Claude 文件读写使用其受限权限，命令通过 MCP 和 Codex 沙箱执行；原生 Bash 沙箱在此环境无法启动，原始验证保留于 `evidence/claude-workspace-sandbox.json`。当前实际项目命令边界验证见 `evidence/workspace-sandbox.json`。
- 额度重试机制已实现，但未消耗额度人为触发服务商限流测试。
- 单个附件最多 8 MB，单次请求最多 16 MB；不提供项目运行预览代理。

源码使用本目录正常 `.git` 仓库。运行数据、初始口令、私钥和日志均不入库。
