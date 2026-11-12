# 活动可见与作品预览

基线：8c2fde8（GitHub main）。生产目录仍为 aa1f35f，服务启动于 2026-11-13 02:10 +08；没有可信运行构建 SHA，未重启或升级生产。本轮在 feedback-preview 隔离 worktree 中实施。

P0 已打通已登录工作台 → 预览 → 生成静态产物 → 播放/暂停/继续/重播 → 下载。使用原 78b0950e 动画源码作为隔离回归输入，保留作品原配色。工作台维持原主题和草稿/手机抽屉。

`/api/runtime` 在启动时固定 buildCommit、dirty、contentVersion、startedAt 和支持流程；新建默认 legacy。历史缺版本显示 legacy，创建响应返回实际 workflowVersion。磁盘更新不改变旧进程已记录的启动信息。

产物独立保存在应用 data/artifacts，通过 artifactId 与 conversationId 访问；工作区清理后仍可读取。先复用 dist/index.html，没有静态构建时用有限 esbuild 适配器编译本地 HTML/TS/JS/CSS，不执行目标配置、不安装依赖或浏览器、不调用模型。HTML 解析使用 parse5，模块与 CSS 交给编译器，避免替换任意 JS URL。复杂框架/后端/API/WebSocket 暂不支持，失败保留上次成功版本并说明原因。

产物登记与验收分开。正式检查在固定提交生成的产物可以关联提交与证据；手动导入已有输出但缺少生成记录时标记来源未知，不能伪称同提交验收通过。源码下载为指定提交的最小 ZIP，排除隐藏凭据、环境文件和依赖。预览响应与 iframe 双重 sandbox，只允许脚本，不允许同源、联网、表单、弹窗和顶层导航；新标签继续受响应 CSP 约束。桥消息只更新显示状态，校验 iframe 窗口、opaque origin、artifactId、version 与结构，不执行业务命令。

P0 验证：preview.test 4 项、preview-http.test 1 项通过；test:preview 在隔离 HTTPS 服务中操作原动画，验证 iframe 和新标签隔离、跨会话拒绝、作品/源码下载和四尺寸布局。截图与实际断言在 evidence/feedback-preview。没有真实模型消耗。

官方依据：[CSP sandbox](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/sandbox)、[iframe sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe)、[Vite 静态构建/base](https://vite.dev/guide/build.html)、[esbuild](https://esbuild.github.io/api/)、[parse5](https://parse5.js.org/)。
