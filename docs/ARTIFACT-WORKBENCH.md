# 成果工作台实施与验收

## 阶段计划

1. 提交内成果清单、程序核实、类型化成果卡、报告兼容、失败分类与提交范围。
2. 固定提交快照、预览进程、健康检查、并发与超时、真实浏览器场景验收。
3. 稳定成果 key 的版本、文字及截图反馈、差异、保留上版、保护未提交改动的代码恢复。
4. 持久目标与决定、按变化会话更新、SSE 重连补齐、关键写入幂等、移动回归与部署。

## 成果协议

模型将 `.nickyoung/artifacts.json` 纳入产品提交；顶层为 artifacts 数组。字段：key、type（web/cli/document/library/change）、name、description、entry、cwd、start、example、scenarios、limits。程序补充 ID、项目、任务、版本、提交、验证时间、证据、预览状态和用户验收事件。

CLI/library 示例仅用 Node 参数数组执行，禁止测试参数替代使用示例，真实输出严格比对 expected。文档读取提交快照正文。修改类关联同一提交的机器验收。网页健康检查通过后仍需 Playwright 用户步骤验证；用户验收只能点击实际使用确认按钮。

每个版本来自 git archive 的固定提交快照，旧版保留独立证据。预览数据写在独立快照内，代码恢复不恢复数据库、部署或外部服务。

## 部署条件与取舍

沿用 HTTPS 8787，无新增域名、Docker、付费服务或公开端口。预览通过随机能力路径代理 loopback Node 服务，响应 CSP sandbox 与 iframe 双重隔离，opaque origin 禁止预览脚本读取登录 Cookie、DOM 和管理 API。代理不传递 Cookie、Authorization、Set-Cookie 和 Location。最多两个预览、20 分钟租期、Node 堆 128MB、Node permission 限制文件读写在成果快照并禁止子进程；停止及服务退出清理进程组。

网页资源及 API 必须用相对 URL；不支持浏览器 localStorage、Cookie 登录、WebSocket，持久数据应使用预览后端。Node 预览仅支持读取 PORT/HOST 的零安装入口，依赖不在快照中的应用会明确启动失败。下载目前提供入口文件，完整代码仍可通过项目目录获取。

平台生成的须知、schema、附件不自动加入产品提交，已有其他 `.nickyoung` 产品文件（特别是成果清单）继续纳入；即使项目忽略 .nickyoung 目录，产品成果清单仍按明确路径纳入，不会强制加入附件。已有须知会保留并进入上下文。

## 数据兼容与回滚

只新增事件类型，不删除或改写历史事件，不改数据库表。旧服务忽略新增事件仍可读取会话。部署备份包含一致 SQLite 备份、配置及代码归档；回滚代码后重启 nickyoung 用户服务，保留数据库和所有用户数据。需要恢复数据库时须另行确认期间新增数据的处理，不直接覆盖。

## 验证结果

执行结果与限制在 RESULT.md 和 evidence/artifacts/ 中记录。测试夹具与真实模型事件分别标识，不将浏览器自动通过当作用户验收。

## 操作与回滚命令

新版代码核验完成后运行 `node scripts/deploy-artifacts.mjs`。脚本拒绝在生产工作流运行时重启，使用 SQLite 在线备份写入 `data/backups/artifacts-<时间>/`，保留配置、证书、口令文件及旧代码归档，再重启唯一的 nickyoung 用户服务。健康结果写入 `evidence/artifacts/deployment.json`。

代码回滚（将 BACKUP 替换为部署记录的 backup 路径）：

```bash
systemctl --user stop nickyoung
# 先保留当前代码及未提交改动，归档不包含生产数据。
tar --exclude=.git --exclude=data --exclude=node_modules --exclude=logs -cf /tmp/nickyoung-before-rollback.tar .
tar -xf "$BACKUP/code.tar" -C /home/ubuntu/disk/dzk/nickyoung
systemctl --user start nickyoung
```

旧代码不引用新增模块，新增文件可保留，不需删除。代码回滚使用现有数据库；不复制备份库覆盖当前库，不丢弃部署后的新对话。若必须恢复数据库，应先停止服务并保留当前数据库及 WAL，再根据新增数据范围另行安排。

## 当前边界

- 增量更新按全局事件 ID 读取并在浏览器去重，重连通过游标补齐；首次加载使用摘要接口，当前会话详情按需加载，旧 state 接口保留供脚本和历史客户端兼容。
- 成果模块、草稿模块、协作图、事件投影已拆出，项目与设置仍在 app.js；旧样式未进行全量重排。
- 问答与小改动的流程规则已收紧；真实验收仍出现重复协调及一次脚本等待超时，不能据此宣称端到端延迟改善。原始事件完整保留。
- 新版未通过时旧版快照和证据不变；代码恢复不自动创建提交。恢复后项目有待提交改动，需要用户先检查和提交才能启动新的开发任务。
- 自动浏览器场景使用模型声明的场景和任务条件，不能替代用户认可或保证任意应用的全部行为。实际手机软键盘和读屏器未人工验证。
