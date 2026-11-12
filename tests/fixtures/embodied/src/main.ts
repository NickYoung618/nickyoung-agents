import { pageTitle, phases } from './content';
import './style.css';
import { startAnimation } from './animation';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div class="shell">
    <header class="masthead">
      <a class="brand" href="#main" aria-label="具身智能，跳至正文"><span class="brand-mark" aria-hidden="true">◈</span> EMBODIED LAB</a>
      <span class="edition">交互科普 · 01</span>
    </header>
    <main id="main">
      <section class="intro" aria-labelledby="page-title">
        <div><p class="eyebrow">INTELLIGENCE IN THE PHYSICAL WORLD</p><h1 id="page-title">${pageTitle}</h1>
        <p class="subtitle">让智能拥有身体，<span>在与世界的交互中理解世界。</span></p></div>
        <p class="intro-note">从观察到决策，从动作到学习。<br />一个连接身体、智能与环境的闭环。</p>
      </section>
      <section class="workspace" aria-labelledby="scene-heading">
        <div class="scene-panel">
          <div class="panel-top"><h2 id="scene-heading">机器人实验场</h2><span class="status"><i></i><span id="play-status">循环演示中</span></span></div>
          <svg data-testid="robot-scene" viewBox="0 0 800 470" role="img" aria-labelledby="scene-title scene-desc">
            <title id="scene-title">具身智能机器人场景</title>
            <desc id="scene-desc">机器人扫描并识别橙色方块，规划路径，抓取搬运到目标区，最后检查放置结果。下方可暂停、继续或从头重播。</desc>
            <defs>
              <pattern id="grid" width="40" height="30" patternUnits="userSpaceOnUse" patternTransform="skewX(-30)"><path d="M40 0H0V30" fill="none" stroke="#1b3341" stroke-width="1"/></pattern>
              <linearGradient id="body" x2="1" y2="1"><stop stop-color="#d5e6ee"/><stop offset="1" stop-color="#7898ac"/></linearGradient>
              <linearGradient id="platform" x2="0" y2="1"><stop stop-color="#203747"/><stop offset="1" stop-color="#111f2c"/></linearGradient>
            </defs>
            <ellipse cx="400" cy="376" rx="328" ry="70" fill="#0c1c27"/>
            <path d="M70 292H730L780 438H20Z" fill="url(#grid)" opacity=".75"/>
            <g id="environment">
              <path d="M110 296L546 259L708 314L273 365Z" fill="url(#platform)" stroke="#365363"/>
              <path d="M110 296V317L273 386V365M273 386L708 334V314" fill="#0b1823" stroke="#365363"/>
              <path d="M151 331V389M652 342V399" stroke="#304959" stroke-width="12"/>
              <path id="target-zone" d="M495 285L542 272L586 292L539 316Z" fill="#72ebd5" fill-opacity=".06" stroke="#72ebd5" stroke-dasharray="5 5"/>
              <text x="553" y="344" fill="#829caa" font-size="13" font-family="sans-serif">目标区</text>
            </g>
            <path id="planned-path" d="M441 278L441 208L540 214L540 284" pathLength="1" fill="none" stroke="#72ebd5" stroke-width="2" stroke-dasharray="1" opacity="0"/>
            <g id="robot" stroke-linejoin="round">
              <ellipse cx="285" cy="311" rx="75" ry="17" fill="#050b12" opacity=".6"/>
              <path d="M245 256L239 300L269 305L282 265M295 264L306 302L339 298L327 251" fill="#6a879a" stroke="#b3cbd7" stroke-width="2"/>
              <path d="M228 197Q278 176 331 196L324 257Q280 275 239 255Z" fill="url(#body)" stroke="#d5e6ee" stroke-width="2"/>
              <path d="M265 214H300V241H265Z" fill="#173746"/><path d="M272 228H293" stroke="#72ebd5" stroke-width="3"/>
              <path d="M229 204L201 234L219 266" fill="none" stroke="#90aebf" stroke-width="18" stroke-linecap="round"/>
              <path id="arm-links" d="" fill="none" stroke="#90aebf" stroke-width="15" stroke-linecap="round"/>
              <circle cx="331" cy="205" r="11" fill="#203b4d" stroke="#b0c8d5" stroke-width="3"/>
              <circle id="elbow-joint" r="9" fill="#203b4d" stroke="#b0c8d5" stroke-width="3"/>
              <path d="M278 174V187" stroke="#89a9bb" stroke-width="14"/>
              <rect x="230" y="111" width="103" height="67" rx="22" fill="url(#body)" stroke="#d5e6ee" stroke-width="2"/>
              <rect x="243" y="129" width="77" height="31" rx="12" fill="#102735"/>
              <path d="M257 143H266M295 143H304" stroke="#72ebd5" stroke-width="5" stroke-linecap="round"/>
              <path d="M281 111V98" stroke="#94b0c0" stroke-width="3"/><circle cx="281" cy="94" r="5" fill="#72ebd5"/>
            </g>
            <g id="object"><path d="M-25 -16L1 -26L26 -14L0 -3Z" fill="#ffbf82"/><path d="M-25 -16V11L0 25V-3Z" fill="#e48c54"/><path d="M0 -3L26 -14V12L0 25Z" fill="#bb613a"/></g>
            <g id="gripper" fill="none" stroke="#c9e0e8" stroke-width="5" stroke-linecap="round">
              <path d="M-37 0H37" stroke="#8aaaba" stroke-width="7"/>
              <path id="finger-left" d="M0 0V36L5 39"/>
              <path id="finger-right" d="M0 0V36L-5 39"/>
              <circle r="6" fill="#203b4d" stroke="#72ebd5" stroke-width="2"/>
            </g>
            <g id="perception-overlay" fill="none" stroke="#72ebd5" opacity="0"><path d="M404 254V244H419M465 244H480V258M480 292V307H465M419 307H404V293"/><path d="M336 145L430 237" stroke-dasharray="4 7" opacity=".5"/></g>
            <path id="scan-line" d="M0 237V315" stroke="#72ebd5" stroke-width="3"/>
            <g id="feedback-overlay" opacity="0" fill="none" stroke="#72ebd5"><ellipse cx="540" cy="291" rx="54" ry="34" stroke-dasharray="5 5"/><g id="result-check"><path d="M578 239L585 246L600 229" stroke-width="4"/><text x="569" y="220" fill="#72ebd5" stroke="none" font-size="12">放置成功</text></g></g>
            <g font-family="sans-serif" font-size="12" fill="#829caa"><text x="72" y="71">ENVIRONMENT / 01</text><text x="72" y="91" fill="#b5d0dd">桌面物体交互</text><text x="613" y="410">抓取闭环演示</text></g>
          </svg>
          <div class="narration"><span id="phase-label" aria-live="polite"></span><p id="dynamic-description"></p></div>
          <div id="scene-controls" class="scene-footer" role="group" aria-label="动画播放控制">
            <button id="play-toggle" type="button">暂停</button><button id="replay" type="button">从头重播</button>
            <div class="time-group"><label for="time-progress" id="time-display">00:00 / 00:30</label><progress id="time-progress" max="30000" value="0" aria-label="当前循环进度"></progress></div>
            <p id="motion-note" hidden>已遵循减少动态效果偏好，点击播放可观看。</p>
            <p class="demo-note">预设动画演示 · 非真实模型推理</p>
          </div>
        </div>
        <aside class="concept" aria-labelledby="concept-heading"><p class="eyebrow">THE EMBODIED LOOP</p><h2 id="concept-heading">智能，来自交互</h2><p class="concept-summary">身体是智能与物理世界的接口。每一次行动的结果，都会成为下一次感知的起点。</p>
          <ol class="phases">${phases.map((phase, i) => `<li data-phase="${phase.id}"><span class="phase-number">0${i + 1}</span><div><h3>${phase.name}<span>${phase.english}</span></h3><p>${phase.description}</p></div></li>`).join('')}</ol>
          <div class="loop-note"><span aria-hidden="true">↻</span> 持续交互，形成闭环</div>
        </aside>
      </section>
      <footer class="page-footer"><span>具身智能 · 可视化实验室</span><span>观察世界 → 理解世界 → 改变世界</span></footer>
    </main>
  </div>
`;

startAnimation();
