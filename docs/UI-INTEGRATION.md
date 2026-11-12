# 新版工作台与单屏布局

界面取自用户提供的 NickYoung-UI-Package.zip，保留配色、导航、卡片和右侧协作图；未接入原型的演示脚本和虚构成员。第三方许可见 UI-THIRD-PARTY-NOTICES.md。

页面外框使用视口高度并禁止页面整体滚动。导航、顶部栏、任务输入框固定在屏内；对话、任务、文件和设置的长内容在所属面板内滚动。桌面保持左右分栏，中等宽度收起文字导航，手机通过侧边抽屉查看团队，不把团队区排到页面底部。资源附带版本号，SSE 重连时检查版本变化。

协作节点来自真实成员，连线来自真实派发、提交、审查和问答事件。首次打开不重播历史动画。暂停、继续、文件、任务和待决定操作使用现有服务端接口。

## 模型目录

Codex 使用 app-server 的 model/list（包括隐藏模型），Claude 使用流式协议的 initialize 控制请求，只读取模型元数据，不发送用户提示。各模型强度来自 supportedReasoningEfforts / supportedEffortLevels；未声明时显示模型默认。扫描缓存五分钟，失败时标明缓存来源。手填模型仍可用，实际连接测试与元数据发现分开。

协议参考：
- https://learn.chatgpt.com/docs/app-server
- https://code.claude.com/docs/en/agent-sdk/typescript

当前仅支持运行时已有的 Codex / Claude 两种通道。扫描不代表每个模型都能实际推理；没有逐一调用模型。负责人保留 Sol / high，执行档位保留 Sol / medium，不进行 Claude 推理。

## 验证边界

- 29 项自动化通过，包括目录能力的去重、隐藏模型和未知强度。
- evidence/ui-package/browser.json：界面、设置和一项真实 Sol / medium 连接测试；最后的 HTTP 400 来自显式隔离的创建请求测试，避免启动新模型。
- evidence/ui-package/single-screen.json：公网多个尺寸、五个主视图的外框尺寸及任务输入框位置检查。
- 四成员布局、暂停继续按钮映射和网络断开恢复通过浏览器隔离数据验证；不作为真实四成员执行证据，不修改生产数据库。
- 公网截图见 evidence/ui-package/public-home.png、public-task.png。
