# 活动可见与作品预览

基线：8c2fde8（GitHub main）。生产目录仍为 aa1f35f，服务启动于 2026-11-13 02:10 +08；没有可信运行构建 SHA，未重启或升级生产。本轮在 feedback-preview 隔离 worktree 中实施。

P0 已打通已登录工作台 → 预览 → 生成静态产物 → 播放/暂停/继续/重播 → 下载。使用原 78b0950e 动画源码作为隔离回归输入，保留作品原配色。工作台维持原主题和草稿/手机抽屉。

`/api/runtime` 在启动时固定 buildCommit、dirty、contentVersion、startedAt 和支持流程；新建默认 legacy。历史缺版本显示 legacy，创建响应返回实际 workflowVersion。磁盘更新不改变旧进程已记录的启动信息。

产物独立保存在应用 data/artifacts，通过 artifactId 与 conversationId 访问；工作区清理后仍可读取。先复用 dist/index.html，没有静态构建时用有限 esbuild 适配器编译本地 HTML/TS/JS/CSS，不执行目标配置、不安装依赖或浏览器、不调用模型。HTML 解析使用 parse5，模块与 CSS 交给编译器，避免替换任意 JS URL。复杂框架/后端/API/WebSocket 暂不支持，失败保留上次成功版本并说明原因。

产物登记与验收分开。正式检查在固定提交生成的产物可以关联提交与证据；手动导入已有输出但缺少生成记录时标记来源未知，不能伪称同提交验收通过。源码下载为指定提交的最小 ZIP，排除隐藏凭据、环境文件和依赖。预览响应与 iframe 双重 sandbox，只允许脚本，不允许同源、联网、表单、弹窗和顶层导航；新标签继续受响应 CSP 约束。桥消息只更新显示状态，校验 iframe 窗口、opaque origin、artifactId、version 与结构，不执行业务命令。

P0 验证：preview.test 4 项、preview-http.test 1 项通过；test:preview 在隔离 HTTPS 服务中操作原动画，验证 iframe 和新标签隔离、跨会话拒绝、作品/源码下载和四尺寸布局。截图与实际断言在 evidence/feedback-preview。没有真实模型消耗。

官方依据：[CSP sandbox](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/sandbox)、[iframe sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe)、[Vite 静态构建/base](https://vite.dev/guide/build.html)、[esbuild](https://esbuild.github.io/api/)、[parse5](https://parse5.js.org/)。

P1 已接入实际 process/run/check 事件。活动以原 eventId 追溯，工具起止时间只取真实记录，未报告开始时明确显示未记录。SSE 对当前会话增量投影、去重，连续输出的刷新等待上限为 200ms；重连拉取完整快照并补齐刷新期间的事件。文件可打开实际源码与差异，检查可展开原日志。

执行者的成功构建事件和正式构建检查自动登记草稿，不增加模型调用。版本与批次、提交、构建证据关联；取消、暂停或批次变更后的迟到结果不登记。单项目合并待处理请求，重复成功不新增相同版本。用户默认停留原版本；勾选“跟随最新”后才自动切换；构建失败保留原画面和输入。inline_preview 交付必须有当前批次、最终提交对应的静态作品；程序负责补齐预览，downloadable_source 不强制网页化。

P1 验证：preview/activity/HTTPS 共 12 项通过。隔离浏览器完成版本切换、跟随、失败保留、回合结束前活动可见、点击未改动文件、跨会话预览隔离；页面脚本异常 0。本机一次请求至新版本可见为 262ms，包含打包与往返，仅为夹具观测，不代表生产或真实模型效率。
