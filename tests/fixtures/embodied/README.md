# 具身智能 · 抓取闭环动画

Vite + TypeScript 中文科普单页，使用本地 SVG 演示机器人感知—规划—行动—反馈的完整抓取闭环。动画采用预设时间轴，用于说明概念，不连接真实机器人，也不执行真实模型推理。

默认自动播放，每轮 30 秒：0–6 秒扫描并框选物体，6–10 秒显示规划路径，10–25 秒接近、夹紧、抬起、搬运、放下与松爪，25–30 秒检测目标区并反馈成功，随后重置。夹爪释放后物体留在目标区至下一轮。

可点击“暂停 / 继续”和“从头重播”，也可用 Tab 聚焦按钮、空格或 Enter 操作。重播从第 0 秒开始并播放，清除上一轮结果。暂停冻结全部场景运动，继续从当前姿态恢复。系统设置减少动态效果时默认暂停；可主动点击“播放”或“从头重播”观看。

## 启动

需要 Node.js 22.18+（推荐 Node.js 24）与 npm。

```sh
npm ci
npm run dev
```

打开终端提示的本地地址（默认 http://localhost:5173）。不需要 API 密钥、远程字体或外部图片，运行时无外部素材请求。

## 验收

在项目根目录依次执行：

```sh
npm ci
npm run build
npm test
npx playwright install chromium
npm run test:e2e
```

- `build`：先执行 TypeScript 检查，再构建到 `dist/`。
- `test`：Node.js 原生测试，执行 `tests/*.test.ts`，验证中文内容、阶段边界、夹取 / 运输 / 释放关系、固定臂长与连续姿态、30 秒循环重置。
- `test:e2e`：启动本地 Vite 服务，真实打开 Chromium，在 1440×900 和 320×740 下检查标题、SVG、内容和无横向溢出；使用 Playwright clock 逐帧推进至少两个完整循环，读取实际 SVG 变换矩阵验证抓持、运输与目标落点，检查键盘控件、暂停冻结、无跳跃续播、重播和减少动态效果。捕获页面异常与控制台错误，断言为空。

截图保存在 `test-results/animation-1440×900-两轮闭环与键盘控件/` 和 `test-results/animation-320×740-两轮闭环与键盘控件/`，每轮包含 `cycle-N-perception.png`、`cycle-N-planning.png`、`cycle-N-grasp.png`、`cycle-N-transport.png`、`cycle-N-feedback.png`；同目录有 `browser-errors.json` 和记录实际 SVG 坐标的 `motion-evidence.json`。基础布局截图为 `test-results/page-视口-页面与场景正常/page.png`。失败时另保留追踪信息。生成文件不提交到仓库，每次测试重新生成。

首次在精简 Linux 环境运行时，如浏览器提示缺少系统库，需要由运行环境安装 Chromium 的系统依赖（具备权限时可用 `npx playwright install-deps chromium`）。测试所用端口 4173 需空闲；配置会自行启动与停止服务，不复用其他进程。

浏览器缓存通过 `package.json` 的 `config.playwright_browsers_path` 固定到项目的 `.cache/ms-playwright`，npm 缓存通过 `.npmrc` 固定到 `.cache/npm`。上述命令可直接用于主目录只读的沙箱，无需额外设置环境变量。npm / npx 会将配置传递给 Playwright，安装和测试使用同一路径；显式设置 `PLAYWRIGHT_BROWSERS_PATH` 时，以该环境变量为准。

## 实现结构

- `src/content.ts`：标题和四阶段科普数据。
- `src/timeline.ts`：纯函数时间轴与两段机械臂逆运动学；以毫秒采样所有位置、夹爪开合、扫描、轨迹和反馈。可在此调整时序与关键坐标，机械臂连杆长度保持固定。
- `src/animation.ts`：唯一的 `requestAnimationFrame` 循环，驱动 SVG、阶段高亮、中文说明、进度与控件；全部运动共用同一时间源，不使用独立计时器或 CSS 动画。
- `src/main.ts`：SVG 场景及中文页面结构，`#scene-controls` 提供原生键盘可操作按钮与可读进度。
- `src/style.css`：深色视觉与桌面、手机自适应布局。
- `tests/` 与 `playwright.config.ts`：基础断言及浏览器验收入口。
