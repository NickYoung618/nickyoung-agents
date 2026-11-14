# 活动可见与作品预览

基线：GitHub main 为 `8c2fde8f17691741b450c8b8e7190966e6ab9fec`，本轮在隔离 worktree `nickyoung-preview` 的 `feedback-preview` 分支实施。生产目录仍为 `aa1f35f`；`nickyoung.service` PID 1884776，启动于 2026-11-13 02:10 +08，运行原目录。没有重启、push、merge、升级在途会话或修改模型与账户配置。

整合后的接口兼容和交付入口见 [GitHub 整合说明](GITHUB-INTEGRATION.md)；本页保留该轮独立实施的历史记录。

## 使用

已登录工作台打开任务 → “运行记录”查看活动 → “预览” → “生成 / 检查预览”。原 `78b0950e` 具身智能动画源码作为回归夹具，可以播放、暂停、继续、重播及下载。工作台保持原黑白灰冷蓝主题，作品保留自身配色。预览时压缩进展摘要，手机给画面留出空间；文件、任务清单和完整运行记录仍可切换。

每条活动来自实际 process/run/check 事件，包含来源 eventId、成员和运行信息。点击活动展开原日志，点击文件打开源码与差异，点击产物或检查附件打开受鉴权的入口。只有明确的工具起止事件才显示起止时间；没有开始记录就显示未记录，不推测进度或剩余时间。SSE 按事件 ID 去重、增量投影，连续输出的刷新等待上限为 200ms；重连拉取快照并补齐刷新期间的新事件，保留草稿与阅读位置。

执行者成功构建与正式构建检查自动登记草稿，程序不增加模型汇报或审批调用。新版本默认只提示；勾选“跟随最新”后才自动切换。构建失败、中断或等待新版时保留上次成功画面，错误与构建证据可查。切换会话不携带另一会话的画面或错误。

运行版本在新建页及任务页可核对。`GET /api/runtime` 在启动时固定 buildCommit、dirty、contentVersion、startedAt 和支持流程；脏目录同时采集变更文件内容版本。磁盘上的后续改动不会把旧进程伪装成新构建。新会话默认 legacy；显式选择 adaptive_v1 才走新流程；缺少版本的历史会话按 legacy 展示。创建响应返回服务端实际 workflowVersion。

规划增加 `deliveryTarget`：视觉任务可为 inline_preview，其他任务为 downloadable_source。inline_preview 交付要求当前批次最终提交对应的可打开静态作品；程序补齐预览，失败以具体原因阻塞交付。首个视觉里程碑是可播放版本，后续补足故事、手机适配和必要检查；普通静态脚手架不默认再安排一次模型审查。三种既有审查策略继续有效。

## 产物与隔离

产物保存在应用 `data/artifacts/<artifactId>/`，版本不可变并与会话、批次、提交、构建事件关联。临时 verification/review 工作区删除后仍能读取。单项目只处理一个预览构建，连续请求合并为最新候选；重复成功不重复登记相同版本；取消、暂停或切换批次后的迟到结果不登记。

优先复用 `dist/index.html`。没有构建产物时，有限静态适配器编译本地 HTML/TS/JS/CSS；使用 parse5 解析 HTML、esbuild 处理模块与资源，不执行目标构建配置，不修改目标源码，不安装依赖或浏览器。输入整理前后比对文件内容，变化中的输出不登记。受支持的本地模块、样式和图片内联成可下载 HTML，单文件上限 8 MiB，输入总量上限 32 MiB。

预览就绪和任务验收分别记录。正式检查在固定提交生成的产物可关联源码提交及证据；只有对应提交的任务/批次通过后才显示已验收。手动整理已有输出但缺少生成记录时，来源提交保持未确认，仍为草稿。此时“下载已提交源码”下载登记时所引用提交的最小 ZIP，不能据此认定它与草稿画面完全一致。源码包排除隐藏凭据、环境文件、密钥和依赖。

预览响应与 iframe 双重 sandbox，只允许脚本，不允许同源、联网、表单、弹窗或顶层导航；新标签继续受响应 CSP 约束。桥消息必须匹配对应 iframe 窗口、opaque origin、artifactId、版本和有限结构，只更新显示状态，不调用业务写接口。读取与下载都校验登录和会话所属关系；入口不接受任意服务器路径或代理地址。路径越界、符号链接和未允许文件类型被拒绝。

主要接口：

| 接口 | 用途 |
| --- | --- |
| GET /api/runtime | 已加载服务版本与支持流程 |
| GET /api/conversations/:c/activity | 实际活动投影与来源事件 |
| GET /api/conversations/:c/artifacts?view=preview | 历史产物与当前预览状态 |
| POST /api/conversations/:c/preview，空对象 | 生成/检查受限静态预览 |
| GET /api/conversations/:c/artifacts/:id/content | 隔离预览或检查附件 |
| GET /api/conversations/:c/artifacts/:id/download | 附件下载 |
| GET /api/conversations/:c/artifacts/:id/source | 登记时引用提交的最小源码 ZIP |
| GET /api/conversations/:c/source-file?path=相对路径 | 工具关联文件的实际源码、图片或差异 |

## 验证

P0 提交 `7b9afd1`：运行版本和原动画的隔离预览、操作、下载。P1 提交 `cc4e6b4`：工具活动、自动草稿登记、历史版本与连续更新。P2 完成隔离、生命周期、多尺寸及完整回归。

| 检查 | 实际结果与证据 |
| --- | --- |
| npm run build | 通过；build.log |
| npm test | 92 项通过，0 失败；npm-test.log |
| npm run test:ui | 通过；原有草稿、阅读位置、事件动画、重连、模型设置、6 视口 × 深浅色 × 5 主视图及手机抽屉；test-ui.log、regression/ui-browser.json |
| npm run test:preview | 隔离 HTTPS 服务与 Chromium 操作原动画；browser.json、截图和 operation.webm |
| 实际模型评估 | 未执行；真实模型调用 0，无效率或节省比例结论 |

新增单元与 HTTPS 测试覆盖自动构建登记、命令日志关联、取消/暂停/批次切换的迟到结果、恢复、同提交跨批次关联、版本去重、工作区清理后读取、源码凭据排除、路径与链接拒绝、消息伪造拒绝、旧会话、真实创建 adaptive direct 会话及实际创建事件。直接预设在完整约束下通过程序检查后交付，不调用规划模型。活动测试核对浏览器增量状态与服务端重放一致、源事件不被修改、重复事件不制造重复活动、EROFS 原因和未知开始时间。

浏览器操作记录按“查看任务 → 连续工具活动在回合结束前出现 → 点击文件 → 打开动画 → 播放控件 → 修改源码生成新版 → 手动/跟随切换 → 构建失败保留 → 四尺寸交互”执行。PNG 证明显示状态；播放冻结/继续、焦点、版本和隔离由实际断言验证。CLI 回合由隔离夹具提供，正式程序检查真实执行，不冒充模型效果。

所有本轮证据位于 `evidence/feedback-preview/`。`browser.json` 记录实测请求至新版本可见耗时，以及产物登记至 DOM 可见观测上界；后者目标为 2 秒。它包含本机负载与采样开销，仅是夹具观测，真实环境延迟未测。

## 发布与回滚

本轮是隔离副本交付，生产没有加载上述能力。应用发布需要在获准的维护操作中切换代码并重启服务，之后核对鉴权 runtime 接口与 UI。仅更新磁盘或 UI 版本号不代表后台已切换。部署前检查在途任务，不自动升级原会话。

发布差异是 Node 运行依赖增加 parse5、将现有 esbuild 移为运行依赖，以及新事件和产物目录；不迁移 SQLite 表结构，不改账户、模型配置、默认 legacy 或既有工作区。安装沿用 `npm ci`，检查沿用上表命令。`npm run test:preview` 使用临时目录、随机回环端口及夹具 CLI，结束后关闭进程并清理临时数据。

开关沿用新建页的 workflowVersion；既有会话按原值运行。预览可由用户点击生成，成功构建自动整理。没有额外模型审批开关，也没有全局开放代理。若撤回本轮能力，在发布副本将本轮三个提交按逆序 revert，回到 `8c2fde8` 所含功能，再按维护流程重启。保留事件数据库和产物目录作为备份；旧代码忽略新增事件，不需要回滚数据库或删除用户文件。

## 已知限制

静态适配目前面向本次 Vite/TypeScript/SVG 动画及有限本地前端资源。复杂框架、需后端/API/WebSocket/登录态的应用、外部依赖资源及 srcset 暂不支持；显示具体失败并保留文件、已有画面和下载。没有通用 dev-server/HMR，upgrade 仍拒绝，不能把静态版本更新称为热更新。

历史产物随会话保留，尚无自动回收策略；需要运维按保留需求备份和管理 `data/artifacts`。真实环境的长会话磁盘规模、延迟和实际模型效率未作预算评估。

官方依据：[CSP sandbox](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/sandbox)、[iframe sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe)、[Vite 静态构建/base](https://vite.dev/guide/build.html)、[esbuild](https://esbuild.github.io/api/)、[parse5](https://parse5.js.org/)。
