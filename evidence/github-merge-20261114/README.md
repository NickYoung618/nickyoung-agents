# GitHub 合并验证

基线：GitHub main `262e7268870e92d75de4e288a86c592a74660e71` 与成果工作台 `6ab2e0ea408a621c56c16fff9ea42d3ef66d4a74`。整合源码版本 `20261114-integrated-1`。

| 范围 | 结果及证据 |
|---|---|
| 全套单元、状态机、接口、受控工作流与进程 | 131/131 通过，tests-final.log；首轮 128 项在 tests-first.log |
| 两类成果与持久投影、不可变运行标识 | 3 项通过，compatibility-first.log，包含在全套内 |
| 主界面、显式自适应、多视口、键盘与草稿 | ui-final.log、ui-final/browser.json |
| 静态预览动画、版本、隔离、失败保留、交付入口 | preview-second.log、preview/browser.json、preview/operation.webm |
| 成果反馈、截图、iframe、验收数据、重连和响应丢失 | workbench-first.log、workbench/browser.json |
| 前端资源构建 | build.log |

preview-first.log 保留合并初期作品入口随报告折叠而不可见的失败，修复后入口在成果区直接显示。原历史证据未覆盖。

所有新增验证均使用隔离数据与受控运行器，真实模型调用 0。本次只整合并合入 GitHub，不替换线上代码；原服务 PID 4060103 保持 active，运行版本仍为 20261114-workbench-4.2。原主工作区仍为 main/aa1f35f，Git 状态与开始时完全一致。
