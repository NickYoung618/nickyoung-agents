# NickYoung

尼克杨助手，通过真实 Claude / Codex CLI 组织开发、验收和审查。服务端使用 Node 24 内置 HTTPS 和 SQLite，前端资源随源码提供。

当前模型：负责人 GPT-6.1-Sol / high，执行成员 GPT-6.1-Sol / medium，辅助档位默认 GPT-6-Astra / high。目前不调用 Claude。可以在设置中调整模型和成员档位。

新版工作台采用提供的 UI 包，页面固定为单屏，长内容在面板内滚动。模型设置支持扫描本机 Codex / Claude 的模型目录及各模型声明的推理强度，支持显示隐藏模型。详情见 [界面接入与验证](docs/UI-INTEGRATION.md)。

## 访问

打开 https://43.156.51.71:8787 ，也可在服务器上访问 https://localhost:8787 。服务为 `nickyoung.service`，已启用用户级开机自启。

初始口令在 `data/initial-password`，文件权限为 600。登录后可在设置中更改。口令、证书私钥、数据库和日志不入库。

首次启动生成 `data/cert.pem` 和 `data/key.pem`。macOS：将证书导入“钥匙串访问”的“系统”钥匙串，双击证书，在“信任”中将 SSL 设为“始终信任”。Windows：双击证书，选择“安装证书”，导入“受信任的根证书颁发机构”。只导入从服务器项目目录取出的 `cert.pem`。

备用 SSH 隧道：

```bash
ssh -N -L 8787:127.0.0.1:8787 ubuntu@43.156.51.71
```

然后访问 https://localhost:8787 。

## 启动和维护

```bash
cd /home/ubuntu/disk/dzk/nickyoung
npm start
```

安装用户级服务：`bash deploy/install.sh`。服务单元使用本项目固定目录及服务器 Node 路径。

```bash
systemctl --user start nickyoung
systemctl --user stop nickyoung
systemctl --user restart nickyoung
systemctl --user status nickyoung --no-pager
tail -f logs/service.log
```

修改前端依赖后重新打包：

```bash
npm ci
npm run build
```

服务端不要求 npm 运行依赖；`public/vendor.mjs` 包含 Markdown、清理 HTML 和代码高亮模块。运行还需要已登录的 `claude`、`codex` 以及 `git`、`openssl`。

## 使用

新对话输入需求，可指定已有项目目录。默认新项目位于 `/home/ubuntu/disk/dzk/nickyoung-workspace/`。已有项目在 `nickyoung/` 分支工作；非 Git 目录先出现初始化仓库的确认卡片；有未提交改动的 Git 项目需先提交。

legacy 流程中，负责人使用 MCP 团队工具招募、派活、讨论、写须知、记录决定和请示。程序先运行验收命令，再将交付提交交给独立 worktree 中的另一位成员审查。第一次失败直接返修，第二次会诊，第三次停止。未审查通过的任务必须明确列为遗留才能交付。

成员命令在项目沙箱中运行。Codex 使用 workspace-write；Claude 使用受限文件工具及 MCP `project_command`，命令通过同一 Codex 沙箱执行。负责人只有只读文件工具和团队工具。程序保留每轮提交、命令输出、退出状态和模型用量。

可暂停、继续和插话，也可在成员卡片上单独换模型。输入框支持文件选择、拖入附件及粘贴截图，单个文件最多 8 MB。对话支持 Markdown 和代码高亮，协作图可展开并跳转到事件，改动页可查看文件。

## 配置与数据

`data/config.json` 为服务端配置；网页设置写入同一文件，手工修改后重启服务。

- `leader`：`channel` 为 `claude` / `codex`，以及 `model`、`effort`。
- `tiers`：有序成员档位，含 `id`、名称、说明及模型设置。
- `names`、`concurrency`、`timeout`：名字、并发成员数、单回合时限（毫秒）。
- `workspace`：默认项目根目录；`cert`、`key`：HTTPS 证书和私钥。
- `experience`：经验内容，另保存于 `data/experience.md`，新对话交给负责人。
- 环境变量 `NY_DATA`、`NY_PORT`、`NY_HOST` 指定数据目录、端口、监听地址；`NY_CLAUDE`、`NY_CODEX` 指定 CLI 路径。

提示词在 `prompts/`。模型改变需真实测试成功后保存；负责人与在岗成员从下一回合生效，新档位对以后招募的成员生效。同一通道续用会话，跨通道通过事件与项目须知接手。设置页修改全局负责人默认值；成员卡上的负责人换模仅影响本对话，对话专用设置优先。

`data/events.sqlite` 保存事件与登录会话。备份时停止服务并复制整个 `data/`。统计按实际交付回合归属模型，Claude 输入包含缓存创建、缓存读取和普通输入；失败与返修按事件计数。

## 验证

`npm test` 执行本地自动化验证。`node scripts/verify-sandbox.mjs` 验证项目命令的写入边界及退出码，不调用模型。

`node scripts/acceptance-repair.mjs` 会消耗模型额度，运行受控缺陷的真实返修场景。日常开发使用本地测试即可。实际场景结果及尚未覆盖的验收见 [RESULT.md](RESULT.md)。

Codex 的本应用团队工具使用按工具配置的 `approval_mode = "approve"`，命令执行仍受项目沙箱约束；配置字段见 [官方 MCP 文档](https://learn.chatgpt.com/docs/extend/mcp)。

## vNext 使用体验优化

新增项目选择、任务首屏摘要、会话草稿恢复、稳定的实时更新、自适应真实协作图、决策选项与交付证据台。桌面支持专注阅读，手机团队抽屉支持键盘关闭和焦点返回。实施与验证边界见 [UX-VNEXT.md](docs/UX-VNEXT.md)，截图和事件证据在 `evidence/ux-vnext/`。浏览器回归：`npm run test:ui`。

## 自适应流程（显式试用）

新会话在工作台「执行策略」选择 adaptive_v1，未选择仍运行 legacy。支持 checks_only、final_review、checkpoint_plus_final：首次规划同时分流，任务连续实现，程序记录正式检查和固定提交审查；普通成功不调用负责人，建议不触发返修。完整 direct 预设才可零规划。旧会话不切换引擎。

`npm run test:workflow` 运行无模型调度测试；`npm run trace:workflow` 保存受控调用轨迹。`npm run evaluate:workflow` 默认标注真实评估未运行，真实模型必须显式 --live 和预算。规范、启用参数、证据与回滚见 [ADAPTIVE-WORKFLOW.md](docs/ADAPTIVE-WORKFLOW.md)。本轮代码尚未部署，生产默认配置保持原样。

## 活动与作品预览

任务页的“预览”可生成、操作和下载受隔离的静态作品；“运行记录”显示真实工具、命令及产物事件，文件与日志可点击。新版本默认提示，勾选“跟随最新”后才切换；构建失败保留上次成功画面。运行版本、实际会话流程、草稿与验收状态分开显示。

支持现有 legacy 和显式启用的 adaptive_v1。视觉任务可规划为 inline_preview，其他任务继续 downloadable_source。静态适配目前面向 HTML/TS/JS/CSS 本地资源，不提供后台服务或 HMR 代理。实现、限制、验证和回滚见 [活动可见与作品预览](docs/FEEDBACK-PREVIEW.md)。隔离交互回归：`npm run test:preview`。
