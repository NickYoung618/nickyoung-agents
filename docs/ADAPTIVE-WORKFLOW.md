# 自适应执行与有效验证

基线 `aa1f35fb5efa6b3f5343fa8484b6d717d0c31be1`。默认仍为 `legacy`；新会话可显式选择 `adaptive_v1`。Node、SQLite append-only 事件、CLI、认证和沙箱继续沿用。生产数据、模型配置和服务未改动。

## 启用

工作台「执行策略」选择「自适应流程（试用）」，只影响此次创建。API 创建参数：

```json
{"text":"需求","path":"/隔离/项目","workflowVersion":"adaptive_v1"}
```

未传版本始终为 legacy，不读取全局开关改写已有会话。历史无版本事件按 legacy 重放。关闭入口只需不再创建 adaptive 会话；已有 adaptive 会话继续由新版程序处理。

auto 的首次负责人回合同时招募、提交简明计划和选择策略。任务用 executorId；审查者在批次 model gate 指定，必须独立于本批执行者。JSON 输出与 MCP submit_plan 使用同一个 plan schema 和 validatePlan。验收标准、引用、环、检查覆盖、独立身份在启动前校验。同一目标版本内，MCP 与最终 JSON 重复提交同一计划不会重复派活。免审缺少事实依据时退回 final_review，并要求整体审查安排，不能静默交付。

完整 direct 配置可通过 `directPlan: {members:[{name,role,tier}],plan:{...}}` 创建；plan 的格式见 `src/contracts.mjs` 与 `tests/workflow-fixtures.mjs`。执行者引用成员姓名，tier 引用现有档位。direct 只允许有明确范围、标准和客观检查的 checks_only；实际 diff 超出范围会升级。不能仅因为文件类型选择免审。界面不提供不完整的 direct 快捷入口。

「查看进度」以及消息 API 的 `intent:"status"` 只记录与投影当前状态，不调用模型或修改计划。「发送补充要求」是显式目标变更；已交付后产生新 cycleId，执行中变更增加 planRevision 并失效旧代结果。附件和最近用户要求进入规划上下文。

## 三条路径

| 策略 | 执行顺序 |
| --- | --- |
| checks_only | 实现 → 固定提交正式检查 → 程序交付；auto 仍计一次规划 |
| final_review | 一次规划 → 连续实现 → 集成检查 → 一次整体独立审查 → 程序交付 |
| checkpoint_plus_final | 按 afterTasks/gateIds 插入指定检查点，之后继续实现、最终检查与独立审查 |

关键代码：`workflow-policy.mjs` 的 selectPolicy / canRunTask / canDeliver / shouldWakePlanner；`workflow.mjs` 的 submit / next / step / execute / verify / review / deliver。旧调度保留在 engine 中，不用新提示词运行旧状态机。

检查点包含 assumption、scope、前置任务和受影响任务。未受问题影响的任务仍可排队；同一源码目录保持一个写入者。任务 implemented 只满足实现依赖，不代表检查或模型审查通过。正常实现和检查成功都不唤醒负责人，结尾不再调用模型。

## 证据与返修

每批记录 cycleId、planRevision、phase、任务、gates、evidence、预算和交付快照。每项工作启动前有 scheduleId；每次模型调用有独立 runId、role、purpose、trigger，成功、失败、中断均可关联。记录队列等待和模型耗时；批次墙钟从批次事件到最后记录计算，不把并行时长相加。

正式检查在固定提交的独立 worktree 中运行，通过现有 Codex 命令沙箱执行。检查子进程不继承父进程的 Node 测试运行上下文，确保子测试实际执行。检查绑定 commit/tree、检查规格、验收标准、planRevision 与 Node/环境指纹；只有系统实际成功执行的同快照、同规格、同环境检查可复用，引用原 evidenceId。deterministic=false 的网络、时间、随机依赖检查不复用。环境变化会先使证据失效，再安排审查。执行者自述不构成正式通过。

检查记录有退出码、开始结束时间、完整输出和 outputPath。声明 outputs 只允许隔离验证目录中的未跟踪构建产物；跟踪文件修改及未知新文件使检查失败。原源码目录不被验证命令修改或清理。公共约定检查点覆盖的文件再次修改后会重新验证。

Reviewer 使用独立只读会话、固定提交和已有正式证据，结果分 blockingIssues、advisories、needsVerification。阻塞项必须有位置、标准、证据、预期行为和验证定义。建议只记录。明确问题直接交给原执行者；局部补丁通过指定检查可关闭问题，保留 reviewedCommit 与 finalCommit，显示「原提交已审查＋后续补丁经指定检查」。语义问题最多做一次范围复查。contractPaths 是规划时声明的公共约定位置；补丁实际触及这些路径或超出任务 scope 时升级，不能依赖执行者自述“低风险”。

未证实疑点保持独立状态：已有完全对应正式证据可以回答具体检查问题；无法由检查回答的疑点进入有限范围复查，仍未知时阻止交付。协议缺失、环境错误、429、暂停和取消不增加代码质量失败。缺失依赖保留环境诊断，不让执行者反复修改业务代码。相同错误还要结合源码树、检查定义与进展判断重复。

默认每任务自动修复 2 次、批次修复 6 次、重规划 1 次、范围复查 1 次，可在隔离配置的 workflowBudgets 中覆盖 taskRepairs / cycleRepairs / replans / rechecks。任务重命名不会重置批次预算。到达预算保留成果和具体证据；不能靠继续按钮绕过。legacy 第三次失败优先停止，包括设计类失败。

问题绑定 taskIds/gateIds。必要授权用 authorization=true；明确拒绝不会被当成授权。没有答案只阻塞关联任务，未解除的相关问题也阻止 finish。两种交付入口共用 canDeliver，报告文本不能绕过。

## 恢复与兼容

重复 pump、重复计划和 SSE 重连不重新派活。取消、改派、暂停或计划换代后，迟到结果只记历史，不推进当前任务。已知检查/审查阶段恢复只重建该隔离 gate；规划结果已经持久化时直接校验并重放，避免重复调用负责人；实施进程中断且外部结果未知时，有证据升级负责人，不承诺任意外部副作用 exactly-once。

暂停保留当前阶段。环境问题可修复后继续；预算阻塞需明确调整目标或配置，不能盲目自动循环。新目标交付使用独立批次，旧批次证据不计入新目标。

回滚前先停止/完成在途 adaptive 会话，保留 SQLite 事件、检查日志及交付快照。旧二进制不能接管 adaptive 事件。仅关闭新建入口不等于转换在途引擎。可逐提交撤销 UI 和评估代码；若要回到基线，必须同时回滚 engine、store、runner、prompts、studio 模块与服务端 UI 版本，保留数据并用新版导出历史。不要删除生产历史或直接让旧服务恢复新会话。

## 验证与评估

```bash
npm test
npm run test:workflow
npm run test:ui
npm run trace:workflow
npm run evaluate:workflow
```

test:workflow 和 trace:workflow 使用受控模型夹具；正式命令实际在沙箱中执行。它们验证调用次数和状态机，不是质量/效率实测。trace:workflow 保存三任务、五任务、direct、auto 免审、检查点和局部修复轨迹。统计接口 `/api/stats/cycles` 提供各用途调用、已知 token 小计、缓存、用量覆盖率、失败/中断、等待、模型耗时、批次墙钟与人工决定；未知 usage 不作为已知零用量，费用不折算美元。

真实评估本轮**未运行，未授权预算**。默认 evaluate:workflow 只输出 not_run。显式运行命令示例（预算由操作者决定）：

```bash
npm run evaluate:workflow -- --live --budget-turns 30 --budget-ms 900000 \
  --config /隔离/config.json --output /隔离/evaluation --repeats 1
```

评估使用现有配置模型，不新增 API key，不测试或切换生产账户。对单强模型、legacy 和 adaptive 轮换运行顺序；六类任务使用同一初始提交、公共验收定义、模型池、全局调用/时间上限和固定外部验收器；追加目标为各组更新同一验收定义并记录输入提交。模型不能改外部验收器，验收器不修代码，验收耗时与流程成本分开记录。结果逐任务类型保存质量、调用与 usage 覆盖、耗时、返工、人工决定、失败、顺序和环境；legacy 指标为会话聚合。达到预算保留部分结果和源码。单次六类样本不足以证明普遍最优；未运行项不能算通过，不输出节省比例。

界面仍使用原 studio 模块、草稿与阅读位置逻辑。`evidence/adaptive/ui` 是新路径的隔离浏览器夹具截图；`regression` 保存原 UX 回归抽样和浏览器断言。原 `docs/UX-VNEXT.md` 的真实模型与生产服务记录是历史证据，不是本轮评估。

## 验收对应

| 范围 | 自动化证据 |
| --- | --- |
| A01–A02、A07–A08、A25、A33 | policy、workflow-lifecycle、workflow-failures、adaptive-runner |
| A03–A06、A09–A13、A29–A30 | workflow、workflow-lifecycle、workflow-failures |
| A14–A24、A26 | verification、workflow-failures、workflow-lifecycle |
| A27–A28、A34 | adaptive-runner、tracing、既有 channel/rate/process 回归 |
| A31–A32 | adaptive-ui、ux-projection、test:ui 浏览器断言与截图 |
| A35 | evaluation 默认不运行与预算校验 |

边界：contractPaths 和 deterministic 声明依赖规划质量；程序验证实际 diff 与精确快照，但不宣称自动证明任意语义风险或环境可重现性。真实提供商结构化输出成功率、真实任务完成率、成本收益和人工手机/读屏体验本轮未实测。受控 CLI 适配器验证 schema、权限参数、会话边界和事件关联，不冒充真实模型结果。
