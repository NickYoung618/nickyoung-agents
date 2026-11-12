# NickYoung

尼克杨助手：通过真实 Claude / Codex CLI 组织开发和审查。Node 24 内置 HTTPS、SQLite 和静态界面，无 npm 运行依赖。

## 启动与访问

```bash
cd /home/ubuntu/disk/dzk/nickyoung
npm start
```

打开 https://43.156.51.71:8787 或 https://localhost:8787 。首次启动口令位于 `data/initial-password`（文件权限 600），登录后在设置中更改。不要把该文件或 `data/` 分享出去。

首次启动生成的证书是 `data/cert.pem`。macOS：打开“钥匙串访问”，将证书导入“系统”钥匙串，双击证书，在“信任”里将 SSL 设置为“始终信任”。Windows：双击证书，选择“安装证书”，导入“受信任的根证书颁发机构”。仅导入你从本机项目目录取出的证书，不要导入私钥 `data/key.pem`。

备用隧道：

```bash
ssh -N -L 8787:127.0.0.1:8787 ubuntu@43.156.51.71
```

然后访问 https://localhost:8787 。

## 服务管理

在服务器上运行 `bash deploy/install.sh` 安装用户级服务。服务文件使用 PLAN.md 中的固定项目目录与 Node 路径。

```bash
systemctl --user start nickyoung
systemctl --user stop nickyoung
systemctl --user restart nickyoung
tail -f logs/service.log
```

## 配置

`data/config.json` 是服务端配置，页面设置写入同一文件。直接修改文件后重启服务。负责人和成员档位的模型在保存前须完成真实连通测试；在岗成员卡片支持单独切换。新成员使用当前档位，旧成员保留招募时的配置。跨通道时以事件上下文接手。

- `leader`：通道 `claude` / `codex`、`model`、`effort`。
- `tiers`：有序档位清单；`id`、名称、说明及模型设置。
- `names`、`concurrency`、`timeout`：成员名字、全局成员并发数、回合时限（毫秒）。
- `workspace`：默认项目根目录；当前配置使用项目内的 `nickyoung-workspace/`，可改为方案指定的同级目录。
- `cert`、`key`：HTTPS 证书和私钥路径。
- `experience`：跨对话经验文字。
- 环境变量 `NY_DATA`、`NY_PORT`、`NY_HOST` 可指定数据目录、监听端口、监听地址；`NY_CLAUDE`、`NY_CODEX` 可指定 CLI 路径。

提示词在 `prompts/leader.md`、`prompts/member.md`。负责人通过结构化团队指令招募、派活、讨论、请示、记录决定、会诊、交付。机器验收通过后自动审查；审查使用交付提交的独立 worktree。单项目成员工作串行，全局并发可配置。

SQLite 的 `data/events.sqlite` 保存全部事件和登录会话。备份时停止服务后复制整个 `data/`。事件包含模型过程和项目内容，应按项目资料保管。

## 验证

`npm test` 验证事件重放、收工门槛、独立审查人、验收命令要求、暂停与逐级升级。真实场景验收和当前限制见 [RESULT.md](RESULT.md)。
