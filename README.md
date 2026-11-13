# NickYoung

尼克杨助手，通过真实 Claude / Codex CLI 组织开发、验收和审查。服务端使用 Node 24 内置 HTTPS 和 SQLite，前端资源随源码提供。

当前模型：负责人 GPT-6.1-Sol / high，执行成员 GPT-6.1-Sol / medium，辅助档位默认 GPT-6-Astra / high。目前不调用 Claude。可以在设置中调整模型和成员档位。

新版工作台采用提供的 UI 包，页面固定为单屏，长内容在面板内滚动。模型设置支持扫描本机 Codex / Claude 的模型目录及各模型声明的推理强度，支持显示隐藏模型。详情见 [界面接入与验证](docs/UI-INTEGRATION.md)。

## 当前成果工作台

`20261114-workbench-4.2` 提供首页最近成果、项目导航、成果搜索/类型/归档筛选与历史版本。登录后打开“交付成果”，网页点击“启动 / 重新启动预览”；普通打开不会执行验收。“继续修改此版本”支持文字和截图，文字草稿可恢复，刷新后截图需重新选择。下载完整源码包或静态构建包后按包内 `NICKYOUNG-USAGE.txt` 使用。

新版使用独立数据验收；声明数据协议的网页在明确“升级并沿用数据”后迁移候选副本，失败保留旧版与原数据。问答可以直接回答，开发交付需要对应成果类型的程序验证和独立审查。“用户已验收”只由用户明确点击产生。

运行服务使用 `data/releases/` 中的固定发布目录，原工作区编辑不会自动上线。发布前使用维护 API 排空，检查无任务后备份实际代码、SQLite 和成果数据，再切换 systemd drop-in。维护、历史整理、协议及回滚见 [持续交付维护说明](docs/ROUND-4.md)。

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

负责人使用 MCP 团队工具招募、派活、讨论、写须知、记录决定和请示。程序先运行验收命令，再将交付提交交给独立 worktree 中的另一位成员审查。第一次失败直接返修，第二次会诊，第三次停止。未审查通过的任务必须明确列为遗留才能交付。

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

## 成果工作台

在左侧「交付成果」打开固定提交的成果卡。网页点击「启动 / 重新启动预览」，在页面内实际操作；CLI 显示服务器上的固定版本目录、使用命令及真实输入输出；文档显示正文，库与已有修改显示验证证据。只有程序验证通过才显示可使用，测试命令保留在折叠详情。

在成果卡展开「继续修改此版本」，填写要求并附截图。修改会关联该版本和提交，新版单独验收，上版仍保留。可查看版本差异与恢复范围；有未提交改动时恢复被阻止。代码恢复不恢复数据库、部署或外部服务。

历史报告不推断使用入口，明确标记尚未验证。新任务通过提交内 `.nickyoung/artifacts.json` 声明成果，协议、支持范围、隔离方式、验收和可执行回滚步骤见 [成果工作台说明](docs/ARTIFACT-WORKBENCH.md)。

成果工作台 `artifacts-3`：点击「打开应用」复用原使用实例；「独立数据重新验收」在独立目录运行场景，不改变使用数据。文字草稿支持刷新恢复，截图刷新后需重新选择。任务暂停后可直接继续自身改动；用户修改同一文件时会显示具体冲突并等待明确处理。维护与回滚见 [稳定性修复](docs/ARTIFACT-REPAIR.md)。
