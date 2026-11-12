let modelCatalog = null,
  showHiddenModels = false;
import { marked, DOMPurify, hljs, speaker } from "./vendor.mjs";
let studioView = "home",
  studioGraphCache = null;
const studioSeenEdges = new Map();
const markdown = (text) =>
  DOMPurify.sanitize(marked.parse(String(text || "")), {
    FORBID_TAGS: ["img", "style", "form", "input", "button"],
    FORBID_ATTR: ["style"],
  });
const $ = (s) => document.querySelector(s),
  escape = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
let attachments = [];
let conversations = [],
  current,
  tab = "team",
  config,
  models = [];
async function api(path, data) {
  let r = await fetch(
    "/api/" + path,
    data === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
  );
  if (r.status === 401) {
    location.href = "/login";
    throw Error("请登录");
  }
  let d = await r.json();
  if (!r.ok) throw Error(d.error);
  return d;
}
const labels = {
  idle: "待命",
  working: "团队工作中",
  paused: "已暂停",
  done: "已完成",
  error: "回合出错",
  interrupted: "已中断",
  queued: "待办",
  running: "进行中",
  review: "待审查",
  reviewing: "审查中",
  repair: "返修中",
  consultation: "等待会诊",
  stopped: "已停止",
  passed: "已通过",
  deferred: "遗留",
  cancelled: "已取消",
  resolved: "遗留已解决",
  rate_wait: "等待额度恢复",
  rate_limited: "额度受限",
  waiting_setup: "等你决定",
};
function name(s, id) {
  return id === "user"
    ? "尼克杨先生"
    : s.members.find((m) => m.id === id)?.name || id;
}
async function refresh() {
  conversations = await api("state");
  render();
}
function render() {
  let s = conversations.find((s) => s.id === current);
  $("#conversations").innerHTML = conversations
    .map(
      (s) =>
        `<button data-id="${s.id}" class="${current === s.id ? "active" : ""}">◦ ${escape(s.title)}<span class="badge"> · ${labels[s.status] || s.status}</span></button>`,
    )
    .join("");
  $("#path").hidden = !!s;
  $("#pause").hidden = !s || s.status === "done";
  if (!s) {
    $("#overall").textContent = "";
    drawStudio(null);
    return;
  }
  $("#overall").textContent = s.questions.some((q) => !q.answered)
    ? "等你决定"
    : labels[s.status];
  $("#overall").dataset.status = s.status;
  $("#heading").innerHTML =
    `${escape(s.title)}<span>${escape(s.path)} · ${escape(s.branch)} · ${labels[s.status]}</span>`;
  $("#pause").textContent = ["paused", "error", "interrupted"].includes(
    s.status,
  )
    ? "继续"
    : "暂停";
  document.title =
    (s.questions.some((q) => !q.answered)
      ? "等你决定 · "
      : s.status === "done"
        ? "已完成 · "
        : "") + "NickYoung";
  let html = "";
  const seenRuns = new Set();
  for (const e of s.events) {
    const d = e.data;
    if (e.type === "message") {
      if (d.member === "user")
        html += `<div class="message user" id="e${e.id}">${escape(d.text)}${d.attachments?.length ? "\n附件：" + d.attachments.map((f) => escape(f.name)).join("、") : ""}</div>`;
      else {
        let m = speaker(s, e);
        html += `<article class="message" id="e${e.id}"><div class="who"><span class="avatar tone${s.members.findIndex((x) => x.id === m?.id)}">${escape(m?.name?.[0])}</span><div>${escape(m?.name)}<small>${escape(m?.role)} · ${escape(m?.model)}</small></div></div><div class="prose">${markdown(d.text)}</div></article>`;
      }
    } else if (e.type === "process") {
      const run = s.events
        .filter(
          (x) =>
            x.id < e.id && x.type === "run_start" && x.data.member === d.member,
        )
        .at(-1);
      const key = run?.id || d.member;
      if (seenRuns.has(key)) continue;
      seenRuns.add(key);
      const next = s.events.find(
        (x) =>
          x.id > (run?.id || 0) &&
          x.type === "run_start" &&
          x.data.member === d.member,
      );
      const logs = s.events
        .filter(
          (x) =>
            x.type === "process" &&
            x.data.member === d.member &&
            x.id >= (run?.id || 0) &&
            (!next || x.id < next.id),
        )
        .map((x) => {
          const p = x.data.event;
          if (p.item?.type === "command_execution")
            return p.item.command + "\n" + (p.item.aggregated_output || "");
          if (p.item?.type === "file_change")
            return JSON.stringify(p.item.changes);
          if (p.type === "output" || p.type === "stderr") return p.text;
          if (p.message?.content)
            return p.message.content
              .filter((b) => b.type === "tool_use" || b.type === "text")
              .map((b) =>
                b.type === "tool_use"
                  ? b.name + " " + JSON.stringify(b.input)
                  : b.text,
              )
              .join("\n");
          return "";
        })
        .filter(Boolean);
      html += `<details class="worklog" id="e${e.id}"><summary>${escape(name(s, d.member))} · 工作过程 · ${logs.length} 条记录</summary><pre>${escape(logs.join("\n\n"))}</pre></details>`;
    } else if (
      e.type === "report" ||
      e.type === "review" ||
      e.type === "check" ||
      e.type === "error"
    ) {
      if (e.type === "check")
        html += `<details class="checkline" id="e${e.id}"><summary>「${escape(s.tasks.find((t) => t.id === d.task)?.title || "任务")}」验收${d.passed ? "通过" : "未通过，已退回"}</summary><pre>${escape(d.command)}${d.output ? "\n" + escape(d.output) : ""}</pre></details>`;
      else if (e.type === "report")
        html += `<article class="card" id="e${e.id}"><h3>交付报告</h3><div class="prose">${markdown(d.text)}</div></article>`;
      else if (e.type === "review")
        html += `<article class="card" id="e${e.id}"><h3>审查${d.verdict === "pass" ? "通过" : "退回"}</h3><div class="prose">${markdown(d.message)}</div>${(d.issues || []).map((i) => `<p><strong>${escape(i.title)}</strong> · ${escape({ minor: "小问题", major: "一般问题", design: "方案问题" }[i.severity] || i.severity)}<br>${escape(i.evidence)}<br>${escape(i.suggestion)}</p>`).join("")}<details><summary>验证证据 · ${escape(d.commit?.slice(0, 8))}</summary><pre>${escape(d.verification)}</pre></details></article>`;
      else
        html += `<details class="card" id="e${e.id}"><summary>运行问题</summary><pre>${escape(d.text)}</pre></details>`;
    } else if (
      [
        "recruit",
        "task",
        "task_update",
        "decision",
        "model_change",
        "interrupted",
        "question",
        "answer",
        "question_closed",
        "notice",
      ].includes(e.type)
    ) {
      let text =
        e.type === "recruit"
          ? `知行邀请 ${d.name} · ${d.role}`
          : e.type === "task"
            ? `知行请 ${name(s, d.member)} 完成「${d.title}」，交给 ${name(s, d.reviewer)} 审查`
            : e.type === "task_update"
              ? `「${s.tasks.find((t) => t.id === d.id)?.title}」${labels[d.status] || ""}${d.commit ? " · " + d.commit.slice(0, 8) : ""}`
              : e.type === "decision"
                ? "决定 · " + d.text
                : e.type === "question"
                  ? "请你决定 · " + d.question
                  : e.type === "answer"
                    ? "你的回答 · " + (d.answer ? "是" : "否")
                    : e.type === "question_closed"
                      ? "请示已结束 · " + d.reason
                      : e.type === "notice"
                        ? "项目须知已更新"
                        : d.text || "模型已更换";
      html += `<div class="event" id="e${e.id}">${escape(text)}</div>`;
    }
  }
  const box = $("#messages"),
    bottom = box.scrollHeight - box.scrollTop - box.clientHeight < 150;
  box.innerHTML = html;
  for (const code of box.querySelectorAll(".prose pre code"))
    hljs.highlightElement(code);
  if (bottom) box.scrollTop = box.scrollHeight;
  $("#questions").innerHTML = s.questions
    .filter((q) => !q.answered)
    .map(
      (q) =>
        `<div class="card question"><h3>${escape(q.question)}</h3><p>是：${escape(q.yes)}<br>否：${escape(q.no)}</p><button data-answer="true" data-id="${q.id}">是</button><button data-answer="false" data-id="${q.id}">否</button><button data-other>我想说点别的</button></div>`,
    )
    .join("");
  panel(s);
  drawStudio(s);
}
function panel(s) {
  if (true)
    $("#panel").innerHTML =
      s.members
        .map(
          (m) =>
            `<div class="member ${m.status}"><div class="who"><span class="avatar tone${s.members.findIndex((x) => x.id === m.id)}">${escape(m.name[0])}</span><div>${escape(m.name)}<small>${escape(m.role)} · ${labels[m.status] || "待命"}</small></div></div><small>${escape(m.model)} · ${escape(m.effort)}</small><button data-model="${m.id}">更换模型</button></div>`,
        )
        .join("") +
      "<h3>任务</h3>" +
      s.tasks
        .map(
          (t) =>
            `<div class="task">${escape(t.title)}<small class="badge"><br>${escape(name(s, t.member))} · ${labels[t.status]} · 返修 ${t.failures} 次</small></div>`,
        )
        .join("");
}
function graph(s, expanded = false) {
  const events = s.events.filter((e) =>
    [
      "task",
      "task_update",
      "run_start",
      "model_result",
      "run_failed",
      "run_interrupted",
      "review",
      "check",
      "member_question",
      "member_answer",
      "question",
      "answer",
    ].includes(e.type),
  );
  const width = expanded
      ? Math.max(440, window.innerWidth - 160)
      : Math.max(440, s.members.length * 132 + 70),
    height = 100 + events.length * 42;
  const gap =
    expanded && s.members.length > 1
      ? (width - 140) / (s.members.length - 1)
      : 132;
  const x = (id) => 70 + s.members.findIndex((m) => m.id === id) * gap;
  let out = `<div class="graphviewport"><svg class="collaboration" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg"><defs><marker id="arrowhead" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto-start-reverse"><path d="M0,0 L0,6 L8,3 z" fill="#007aff"/></marker></defs>`;
  for (const m of s.members)
    out += `<line class="lane" x1="${x(m.id)}" y1="55" x2="${x(m.id)}" y2="${height}"/><circle class="graphavatar" cx="${x(m.id)}" cy="22" r="17"/><text x="${x(m.id)}" y="27" text-anchor="middle">${escape(m.name[0])}</text><text x="${x(m.id)}" y="52" text-anchor="middle">${escape(m.name)}</text>`;
  const starts = new Map();
  events.forEach((e, i) => {
    const d = e.data,
      y = 84 + i * 42;
    let from = d.member || d.from || "leader",
      to = d.to || from,
      label = "";
    const t = s.tasks.find((t) => t.id === (d.task || d.id));
    if (e.type === "run_start") {
      starts.set(d.member, y);
      label = "开始工作";
    }
    if (["model_result", "run_failed", "run_interrupted"].includes(e.type)) {
      if (starts.has(d.member))
        out += `<line class="bar" x1="${x(d.member)}" y1="${starts.get(d.member)}" x2="${x(d.member)}" y2="${y}"/>`;
      starts.delete(d.member);
      label =
        e.type === "model_result"
          ? "交付结果"
          : e.type === "run_failed"
            ? "回合失败"
            : "回合中断";
    }
    if (e.type === "task") {
      from = "leader";
      to = d.member;
      label = "派活";
    }
    if (e.type === "task_update") {
      from = t?.member || "leader";
      to =
        d.status === "review" || d.status === "reviewing"
          ? t?.reviewer || from
          : d.status === "repair"
            ? t?.member || from
            : "leader";
      label = labels[d.status] || "提交版本";
    }
    if (e.type === "review") {
      from = t?.reviewer || "leader";
      to = t?.member || "leader";
      label = d.verdict === "pass" ? "审查通过" : "退回";
    }
    if (e.type === "check") {
      from = t?.member || "leader";
      to = from;
      label = d.passed ? "验收通过" : "验收未过";
    }
    if (e.type === "member_question") label = "提问";
    if (e.type === "member_answer") label = "答复";
    if (e.type === "question") label = "请你决定";
    if (e.type === "answer") label = "收到回答";
    if (x(from) < 0) from = "leader";
    if (x(to) < 0) to = "leader";
    out += `<g class="arrow" data-jump="e${e.id}"><title>${escape(e.time + " " + label)}</title><line x1="${x(from)}" y1="${y}" x2="${x(to) + (from === to ? 48 : 0)}" y2="${y}" marker-end="url(#arrowhead)"/><text x="${(x(from) + x(to)) / 2 + 8}" y="${y - 6}">${escape(label)}</text></g>`;
  });
  for (const [member, y] of starts)
    out += `<line class="bar" x1="${x(member)}" y1="${y}" x2="${x(member)}" y2="${height}"/>`;
  return out + "</svg></div>";
}

$("#conversations").onclick = (e) => {
  let b = e.target.closest("[data-id]");
  if (b) {
    current = b.dataset.id;
    studioView = "task";
    render();
    $("#messages").scrollTop = $("#messages").scrollHeight;
  }
};
$("#new").onclick = () => {
  current = undefined;
  $("#heading").innerHTML =
    "新的想法，从这里开始<span>尼克杨先生的工作助手</span>";
  $("#messages").innerHTML =
    '<div class="welcome"><div class="monogram">N</div><h1>把想法，交给团队。</h1><p>描述你想完成的事，知行会组织成员一起推进。</p></div>';
  $("#panel").innerHTML = "还没有成员";
  $("#questions").innerHTML = "";
  $("#path").hidden = false;
  $("#pause").hidden = true;
  $("#overall").textContent = "";
  $("#input").focus();
};
$("#composer").onsubmit = async (e) => {
  e.preventDefault();
  let text = $("#input").value.trim();
  if (!text) return;
  try {
    if (current)
      await api(`conversations/${current}/message`, {
        text,
        files: attachments,
      });
    else {
      let r = await api("conversations", {
        text,
        path: $("#path").value,
        files: attachments,
      });
      current = r.id;
    }
    $("#input").value = "";
    attachments = [];
    $("#attachments").textContent = "";
    await refresh();
    $("#messages").scrollTop = $("#messages").scrollHeight;
  } catch (e) {
    $("#notice").textContent = e.message;
  }
};
$("#input").onkeydown = (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $("#composer").requestSubmit();
  }
};
$("#pause").onclick = async () => {
  const s = conversations.find((s) => s.id === current);
  if (!s) return;
  const action = ["paused", "error", "interrupted"].includes(s.status)
    ? "resume"
    : "pause";
  $("#pause").disabled = true;
  $("#pause").textContent =
    action === "pause" ? "正在请求暂停…" : "正在请求继续…";
  try {
    await api(`conversations/${current}/${action}`, {});
    await refresh();
  } catch (e) {
    $("#notice").textContent = e.message;
  } finally {
    $("#pause").disabled = false;
  }
};
$("#questions").onclick = async (e) => {
  let b = e.target.closest("[data-answer]");
  if (b) {
    await api(`conversations/${current}/answer`, {
      id: b.dataset.id,
      answer: b.dataset.answer === "true",
    });
    refresh();
  }
  if (e.target.matches("[data-other]")) $("#input").focus();
};
$(".tabs").onclick = async (e) => {
  if (!e.target.dataset.tab) return;
  tab = e.target.dataset.tab;
  updateTaskTab();
  if (tab === "changes") await loadStudioFiles();
};
$("#panel").onclick = async (e) => {
  const file = e.target.closest("[data-file]");
  if (file) {
    try {
      const r = await api(
        `conversations/${current}/files?path=${encodeURIComponent(file.dataset.file)}`,
      );
      $("#filePreview").innerHTML =
        `<details open><summary>${r.deleted ? "已删除 · " : ""}差异</summary><pre>${escape(r.diff)}</pre></details>` +
        (r.image
          ? `<img class="preview-image" alt="${escape(r.file)}" src="data:image/${r.file.split(".").at(-1).replace("jpg", "jpeg")};base64,${r.content}">`
          : `<details><summary>文件预览</summary><pre>${escape(r.content)}</pre></details>`);
    } catch (e) {
      $("#notice").textContent = e.message;
    }
  }
  const jump = e.target.closest("[data-jump]");
  if (jump) document.getElementById(jump.dataset.jump)?.scrollIntoView();
  if (e.target.id === "expandGraph") {
    let dialog = $("#graphDialog");
    if (!dialog) {
      dialog = document.createElement("dialog");
      dialog.id = "graphDialog";
      dialog.className = "graph-full";
      document.body.append(dialog);
    }
    dialog.innerHTML =
      '<button class="close">关闭</button><h2>团队协作</h2>' +
      graph(
        conversations.find((s) => s.id === current),
        true,
      );
    dialog.onclick = (e) => {
      if (e.target.className === "close") dialog.close();
      const jump = e.target.closest("[data-jump]");
      if (jump) {
        dialog.close();
        document.getElementById(jump.dataset.jump)?.scrollIntoView();
      }
    };
    dialog.showModal();
  }
  if (e.target.dataset.model) {
    const m = conversations
      .find((s) => s.id === current)
      .members.find((m) => m.id === e.target.dataset.model);
    const value = prompt(
      "输入通道/模型/推理强度，例如 codex/gpt-6.1-sol/high",
      `${m.channel}/${m.model}/${m.effort}`,
    );
    if (!value) return;
    const [channel, model, effort] = value.split("/"),
      selection = { channel, model, effort };
    try {
      await api("test", selection);
      await api(`conversations/${current}/member`, { id: m.id, selection });
      refresh();
    } catch (e) {
      $("#notice").textContent = e.message;
    }
  }
};
$("#toggleLeft").onclick = () => $(".shell").classList.toggle("hide-left");
$("#toggleRight").onclick = () => $(".shell").classList.toggle("show-live");
const effortLabels = {
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "更高",
  max: "最大",
  ultra: "超高",
};
function channelModels(channel, selected) {
  return models.filter(
    (m) =>
      m.channel === channel &&
      (!m.hidden || showHiddenModels || m.model === selected),
  );
}
function modelOptions(channel, selected) {
  return (
    '<option value="">选择模型</option>' +
    channelModels(channel, selected)
      .map(
        (m) =>
          `<option value="${escape(m.model)}" ${m.model === selected ? "selected" : ""}>${escape((m.hidden ? "隐藏 · " : "") + m.name)}</option>`,
      )
      .join("") +
    `<option value="__custom" ${selected && !models.some((m) => m.channel === channel && m.model === selected) ? "selected" : ""}>手动输入模型…</option>`
  );
}
function modelrow(s, i) {
  const custom = !models.some(
    (m) => m.channel === s.channel && m.model === s.model,
  );
  return `<div class="modelrow" data-index="${i}"><input class="tierName" aria-label="档位名称" value="${escape(s.name || "负责人")}" ${i < 0 ? "disabled" : ""}><select class="channel" aria-label="接入类型"><option value="codex" ${s.channel === "codex" ? "selected" : ""}>Codex / GPT</option><option value="claude" ${s.channel === "claude" ? "selected" : ""}>Claude Code</option></select><select class="modelChoice" aria-label="可用模型">${modelOptions(s.channel, s.model)}</select><input class="model" aria-label="自定义模型名称" placeholder="输入完整模型名称" value="${escape(s.model)}" ${custom ? "" : "hidden"}><select class="effort" aria-label="推理强度"><option value="${escape(s.effort || "")}" selected>${escape(s.effort || "模型默认")}</option></select>${i >= 0 ? `<input class="description" aria-label="适用任务" placeholder="适合做什么" value="${escape(s.description)}"><button data-up="${i}">上移</button><button data-remove="${i}">删除</button>` : ""}<button class="testModel">测试连接</button><small class="capabilityText"></small><small class="testResult" role="status"></small></div>`;
}
function drawCatalog() {
  if (!modelCatalog) return;
  $("#catalogMeta").textContent =
    `识别 ${modelCatalog.channels.filter((c) => c.status !== "unavailable").length} 条通道 · ${modelCatalog.models.length} 个模型 · ${new Date(modelCatalog.scannedAt).toLocaleString()}。${modelCatalog.note}`;
  $("#catalogChannels").innerHTML = modelCatalog.channels
    .map(
      (c) =>
        `<div class="catalog-channel"><strong>${escape(c.name)}</strong><span>${escape(c.status === "discovered" ? "目录已读取" : c.status === "cached" ? "使用本机缓存" : "未能读取")} · ${c.count} 个模型</span>${c.error ? `<details><summary>读取详情</summary><pre>${escape(c.error)}</pre></details>` : ""}</div>`,
    )
    .join("");
  $("#catalogTable").innerHTML =
    "<table><thead><tr><th>接入类型</th><th>模型</th><th>支持强度</th><th>来源</th></tr></thead><tbody>" +
    models
      .filter((m) => showHiddenModels || !m.hidden)
      .map(
        (m) =>
          `<tr><td>${escape(m.channel)}</td><td>${escape(m.name)}${m.hidden ? " · 隐藏" : ""}<small>${escape(m.model)}</small></td><td>${m.efforts.length ? m.efforts.map((e) => escape(e)).join(" / ") : "未声明，使用模型默认"}</td><td>${escape(m.source)}</td></tr>`,
      )
      .join("") +
    "</tbody></table>";
}
function drawSettings() {
  $("#modelSettings").innerHTML =
    modelrow(config.leader, -1) + config.tiers.map(modelrow).join("");
  for (const row of document.querySelectorAll(".modelrow")) updateEfforts(row);
  drawCatalog();
}
function readSettings() {
  for (const row of document.querySelectorAll(".modelrow")) {
    let i = Number(row.dataset.index),
      s = i < 0 ? config.leader : config.tiers[i];
    Object.assign(s, {
      channel: row.querySelector(".channel").value,
      model: row.querySelector(".model").value,
      effort: row.querySelector(".effort").value,
    });
    if (i >= 0)
      Object.assign(s, {
        name: row.querySelector(".tierName").value,
        description: row.querySelector(".description").value,
      });
  }
}
$("#settings").onclick = async () => {
  try {
    showStudioView("settings");
    $("#catalogMeta").textContent = "正在读取本机模型目录…";
    [config, modelCatalog] = await Promise.all([
      api("config"),
      api("model-catalog"),
    ]);
    models = modelCatalog.models;
    drawSettings();
    $("#concurrency").value = config.concurrency;
    $("#timeout").value = config.timeout / 60000;
    $("#names").value = config.names.join("、");
    $("#experience").value = config.experience;
    showStudioView("settings");
    const stats = await api("stats");
    $("#stats").innerHTML =
      "<table><tr><th>模型 / 档位</th><th>回合 / 失败</th><th>输入 / 输出</th><th>一次通过</th><th>平均返修</th><th>平均耗时</th></tr>" +
      stats
        .map(
          (s) =>
            `<tr><td>${escape(s.model)}<br>${escape(s.tier)}</td><td>${s.turns} / ${s.failed}</td><td>${s.input} / ${s.output}</td><td>${s.tasks ? Math.round((s.firstPassed / s.tasks) * 100) + "%" : "—"}</td><td>${s.tasks ? (s.repairs / s.tasks).toFixed(1) : "—"}</td><td>${Math.round(s.duration / s.turns / 1000)} 秒</td></tr>`,
        )
        .join("") +
      "</table>";
  } catch (e) {
    $("#notice").textContent = e.message;
  }
};
$("#modelSettings").onclick = async (e) => {
  if (e.target.matches(".testModel")) {
    readSettings();
    let row = e.target.closest(".modelrow"),
      i = Number(row.dataset.index),
      s = i < 0 ? config.leader : config.tiers[i];
    e.target.disabled = true;
    row.querySelector(".testResult").textContent = "测试中…";
    try {
      let r = await api("test", s);
      row.querySelector(".testResult").textContent =
        `通过 · ${r.model} · ${(r.duration / 1000).toFixed(1)} 秒`;
    } catch (e) {
      row.querySelector(".testResult").textContent = e.message;
    } finally {
      e.target.disabled = false;
    }
  }
  if (e.target.dataset.remove !== undefined) {
    readSettings();
    config.tiers.splice(Number(e.target.dataset.remove), 1);
    drawSettings();
  }
  if (e.target.dataset.up !== undefined) {
    readSettings();
    let i = Number(e.target.dataset.up);
    if (i > 0)
      [config.tiers[i - 1], config.tiers[i]] = [
        config.tiers[i],
        config.tiers[i - 1],
      ];
    drawSettings();
  }
};
$("#addTier").onclick = () => {
  readSettings();
  config.tiers.push({
    id: crypto.randomUUID(),
    name: "新档位",
    channel: "codex",
    model: "gpt-6-luna",
    effort: "high",
    description: "",
  });
  drawSettings();
};
$("#saveSettings").onclick = async () => {
  readSettings();
  Object.assign(config, {
    concurrency: Number($("#concurrency").value),
    timeout: Number($("#timeout").value) * 60000,
    names: $("#names").value.split("、").filter(Boolean),
    experience: $("#experience").value,
  });
  try {
    await api("config", config);
    $("#settingsResult").textContent = "已保存";
  } catch (e) {
    $("#settingsResult").textContent = e.message;
  }
};
$("#changePassword").onclick = async () => {
  try {
    await api("password", { password: $("#newPassword").value });
    location.href = "/login";
  } catch (e) {
    $("#settingsResult").textContent = e.message;
  }
};
$("#logout").onclick = async () => {
  await api("logout", {});
  location.href = "/login";
};
let timer;
const events = new EventSource("/api/events");
events.onmessage = (event) => {
  const e = JSON.parse(event.data);
  if (
    e.conversation === current &&
    ["question", "report"].includes(e.type) &&
    "Notification" in window &&
    Notification.permission === "granted"
  ) {
    const notification = new Notification(
      e.type === "question" ? "NickYoung · 等你决定" : "NickYoung · 已交付",
      { body: e.data.question || e.data.text?.slice(0, 120) },
    );
    notification.onclick = () => window.focus();
  }
  clearTimeout(timer);
  timer = setTimeout(
    () => refresh().catch((e) => ($("#notice").textContent = e.message)),
    200,
  );
};
events.onopen = () => {
  fetch("/api/ui-version", { cache: "no-store" })
    .then((response) => response.ok ? response.json() : null)
    .then((version) => {
      if (version && document.documentElement.dataset.uiVersion !== version.version)
        location.reload();
    })
    .catch(() => {});
  $("#connectionState").textContent = "已连接";
  $("#notice").textContent = "";
  refresh();
};
events.onerror = () => {
  $("#notice").textContent = "连接中断，正在重连…";
  $("#connectionState").textContent = "连接中断";
};
await refresh();
if (conversations.length) {
  current = conversations.at(-1).id;
  render();
  requestAnimationFrame(() => {
    $("#messages").scrollTo({
      top: $("#messages").scrollHeight,
      behavior: "instant",
    });
  });
} else $("#panel").textContent = "还没有成员";

async function addFiles(files) {
  for (const file of files) {
    if (file.size > 8000000) {
      $("#notice").textContent = "单个附件最多 8 MB";
      continue;
    }
    const data = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(",")[1]);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    attachments.push({ name: file.name, data });
  }
  $("#attachments").textContent = attachments.map((f) => f.name).join(" · ");
  $("#homeAttachments").textContent = $("#attachments").textContent;
}
$("#fileInput").onchange = (e) => addFiles(e.target.files);
$("#composer").ondragover = (e) => e.preventDefault();
$("#composer").ondrop = (e) => {
  e.preventDefault();
  addFiles(e.dataTransfer.files);
};
$("#input").onpaste = (e) => {
  const files = [...e.clipboardData.files];
  if (files.length) {
    e.preventDefault();
    addFiles(files);
  }
};

function updateEfforts(row, changed = false) {
  const m = models.find(
      (m) =>
        m.channel === row.querySelector(".channel").value &&
        m.model === row.querySelector(".model").value,
    ),
    select = row.querySelector(".effort"),
    current = select.value,
    efforts = m?.efforts || [];
  let target =
    !changed && current
      ? current
      : efforts.includes(m?.defaultEffort)
        ? m.defaultEffort
        : efforts[0] || "";
  let options = efforts
    .map(
      (e) =>
        `<option value="${escape(e)}">${escape(e)} · ${escape(effortLabels[e] || e)}</option>`,
    )
    .join("");
  if (!efforts.length)
    options = '<option value="">模型默认（目录未声明强度）</option>';
  if (target && !efforts.includes(target))
    options += `<option value="${escape(target)}">当前配置：${escape(target)}（目录未声明）</option>`;
  select.innerHTML = options;
  select.value = target;
  select.disabled = select.options.length === 1 && !efforts.length;
  row.querySelector(".capabilityText").textContent = m
    ? `${m.source}${m.resolvedModel && m.resolvedModel !== m.model ? " · " + m.resolvedModel : ""}${m.hidden ? " · 隐藏模型" : ""}`
    : "目录未列出此模型，需手动输入并进行真实测试。";
}
$("#modelSettings").onchange = (e) => {
  const row = e.target.closest(".modelrow");
  if (!row) return;
  const channel = row.querySelector(".channel"),
    choice = row.querySelector(".modelChoice"),
    input = row.querySelector(".model");
  if (e.target === channel) {
    const available = channelModels(channel.value);
    input.value = available[0]?.model || "";
    choice.innerHTML = modelOptions(channel.value, input.value);
    input.hidden = !!available.length;
    updateEfforts(row, true);
  } else if (e.target === choice) {
    if (choice.value === "__custom") {
      input.hidden = false;
      input.value = "";
      input.focus();
    } else {
      input.value = choice.value;
      input.hidden = true;
    }
    updateEfforts(row, true);
  } else if (e.target === input) updateEfforts(row, true);
};
$("#refreshModels").onclick = async () => {
  if (config) readSettings();
  const button = $("#refreshModels");
  button.disabled = true;
  button.textContent = "正在扫描…";
  try {
    modelCatalog = await api("model-catalog/scan", {});
    models = modelCatalog.models;
    drawSettings();
  } catch (e) {
    $("#settingsResult").textContent = e.message;
  } finally {
    button.disabled = false;
    button.textContent = "扫描本机模型与强度";
  }
};
$("#showHiddenModels").onchange = (e) => {
  readSettings();
  showHiddenModels = e.target.checked;
  drawSettings();
};
$("#notifications").onclick = async () => {
  $("#settingsResult").textContent =
    "Notification" in window
      ? (await Notification.requestPermission()) === "granted"
        ? "桌面通知已启用"
        : "桌面通知未启用"
      : "浏览器不支持桌面通知";
};

function showStudioView(view) {
  studioView = view;
  const active = conversations.find((s) => s.id === current);
  $("#heading").innerHTML =
    view === "task" && active
      ? `${escape(active.title)}<span>${escape(active.path)}</span>`
      : {
          home: "工作台",
          task: "当前任务",
          decision: "待你决定",
          result: "交付成果",
          settings: "模型设置",
        }[view];
  for (const [id, v] of [
    ["homeView", "home"],
    ["taskView", "task"],
    ["decisionView", "decision"],
    ["resultView", "result"],
    ["settingsDialog", "settings"],
  ])
    $("#" + id).hidden = v !== view;
  for (const b of document.querySelectorAll("[data-view-nav]"))
    b.classList.toggle("ny-active", b.dataset.viewNav === view);
  $("#settings").classList.toggle("ny-active", view === "settings");
  if (view === "home") $("#path").hidden = false;
  if (view === "task" && !current) {
    $("#taskTitle").textContent = "还没有任务";
    $("#projectPath").textContent = "从工作台描述你的目标。";
  }
  window.lucide?.createIcons();
}
function updateTaskTab() {
  $("#messages").hidden = tab !== "team";
  $("#taskList").hidden = tab !== "graph";
  $("#changesPanel").hidden = tab !== "changes";
  for (const b of document.querySelectorAll(".tabs [data-tab]"))
    b.classList.toggle("ny-active", b.dataset.tab === tab);
}
async function loadStudioFiles() {
  if (!current) {
    $("#changesPanel").textContent = "还没有改动";
    return;
  }
  try {
    const d = await api(`conversations/${current}/files`);
    $("#changesPanel").innerHTML = d.files.length
      ? d.files
          .map(
            (f) =>
              `<button class="file" data-file="${escape(f)}">${escape(f)}</button>`,
          )
          .join("") + '<div id="filePreview"></div>'
      : "还没有改动";
  } catch (e) {
    $("#notice").textContent = e.message;
  }
}
function studioEdges(s) {
  if (!s) return [];
  const find = (id) => s.members.find((m) => m.id === id || m.name === id)?.id;
  const edges = [];
  for (const e of s.events) {
    const d = e.data;
    const t = s.tasks.find((t) => t.id === (d.task || d.id));
    let from, to, label;
    if (e.type === "task") {
      from = "leader";
      to = d.member;
      label = "派发任务";
    }
    if (e.type === "task_update" && d.status === "review") {
      from = t?.member;
      to = t?.reviewer;
      label = "送审";
    }
    if (e.type === "review") {
      from = t?.reviewer;
      to = d.verdict === "pass" ? "leader" : t?.member;
      label = d.verdict === "pass" ? "审查通过" : "退回修改";
    }
    if (e.type === "member_question") {
      from = d.from;
      to = find(d.to);
      label = "提问";
    }
    if (e.type === "member_answer") {
      from = d.from;
      to = d.to;
      label = "答复";
    }
    if (find(from) && find(to) && find(from) !== find(to))
      edges.push({
        id: e.id,
        from: find(from),
        to: find(to),
        label,
        time: e.time,
        task: t?.title,
        event: e,
      });
  }
  return edges;
}
function drawStudio(s) {
  $("#homeRecent").innerHTML = conversations.length
    ? conversations
        .slice()
        .reverse()
        .map(
          (c) =>
            `<button data-id="${c.id}"><strong>${escape(c.title)}</strong><small>${escape(labels[c.status] || c.status)} · ${c.tasks.filter((t) => t.status === "passed").length} 项已通过审查</small></button>`,
        )
        .join("")
    : '<p class="ny-small">还没有任务，描述目标即可开始。</p>';
  const pending = conversations.flatMap((c) =>
    c.questions.filter((q) => !q.answered).map((q) => ({ q, c })),
  );
  $("#decisionCount").textContent = pending.length || "";
  $("#decisionContent").innerHTML = pending.length
    ? pending
        .map(
          ({ q, c }) =>
            `<article class="card question"><div class="ny-small">${escape(c.title)}</div><h3>${escape(q.question)}</h3><p>是：${escape(q.yes)}<br>否：${escape(q.no)}</p><button data-decision="true" data-conversation="${c.id}" data-question="${q.id}">是</button><button data-decision="false" data-conversation="${c.id}" data-question="${q.id}">否</button><button data-open="${c.id}">我想说点别的</button></article>`,
        )
        .join("")
    : '<div class="card"><h3>暂时没有待决定事项</h3><p class="ny-small">需要你拍板时，会在这里显示。</p></div>';
  const reports = conversations
    .flatMap((c) =>
      c.events.filter((e) => e.type === "report").map((e) => ({ c, e })),
    )
    .reverse();
  $("#resultContent").innerHTML = reports.length
    ? reports
        .map(
          ({ c, e }) =>
            `<article class="card"><div class="ny-small">${escape(c.title)} · ${escape(new Date(e.time).toLocaleString())}</div><div class="prose">${markdown(e.data.text)}</div><button class="ny-button" data-open="${c.id}">查看任务和证据</button></article>`,
        )
        .join("")
    : '<div class="card ny-small">还没有交付成果。</div>';
  if (s) {
    $("#taskTitle").textContent = s.title;
    $("#projectPath").textContent = s.path + (s.branch ? " · " + s.branch : "");
    $("#taskStatus").textContent = s.questions.some((q) => !q.answered)
      ? "等你决定"
      : labels[s.status];
    const running = s.tasks.filter((t) =>
      ["running", "reviewing", "repair", "consultation"].includes(t.status),
    );
    $("#focusTitle").textContent =
      s.status === "paused"
        ? s.members.some((m) => m.status === "running")
          ? "工作流已暂停，正在等待进程结束。"
          : "工作流已暂停。"
        : running.length
          ? running.map((t) => `${t.title} · ${labels[t.status]}`).join("；")
          : s.status === "done"
            ? "成果已交付，验收记录可查看。"
            : s.questions.some((q) => !q.answered)
              ? "重要决定等待你的答复，其余任务继续推进。"
              : s.status === "paused"
                ? "工作流已暂停。"
                : "知行正在处理你的目标。";
    $("#taskCounts").textContent = s.tasks.length
      ? `${s.tasks.length} 项任务 · ${s.tasks.filter((t) => t.status === "passed").length} 项已通过审查`
      : "还没有派发任务";
    $("#taskList").innerHTML = s.tasks.length
      ? s.tasks
          .map(
            (
              t,
            ) => `<div class="task"><strong>${escape(t.title)}</strong><div class="ny-small">${escape(name(s, t.member))} → ${escape(name(s, t.reviewer))} · ${escape(labels[t.status])} · 返修 ${t.failures} 次</div><details><summary>验收标准</summary><pre>${escape(t.description)}
${escape(t.commands?.join("\n"))}</pre></details></div>`,
          )
          .join("")
      : '<p class="ny-small">还没有任务。</p>';
  }
  $("#liveStatus").textContent = s
    ? s.questions.some((q) => !q.answered)
      ? "等你决定"
      : labels[s.status]
    : "待命";
  $("#memberCount").textContent = s
    ? `${s.members.length} 位成员 · ${s.members.filter((m) => m.status === "running").length} 人在忙`
    : "还没有成员";
  $("#expandGraph").disabled = !s;
  drawStudioGraph(s);
  updateTaskTab();
  showStudioView(studioView);
}
function drawStudioGraph(s) {
  const box = $("#liveGraph"),
    members = s?.members || [],
    edges = studioEdges(s),
    edge = edges.at(-1),
    width = Math.max(250, box.clientWidth),
    height = Math.max(280, box.clientHeight);
  const cache = studioGraphCache;
  if (
    cache &&
    cache.id === s?.id &&
    cache.width === width &&
    cache.height === height &&
    cache.edge === edge?.id &&
    cache.members.length === members.length &&
    cache.members.every(
      (m, i) => m.id === members[i].id && m.status === members[i].status,
    )
  )
    return;
  studioGraphCache = {
    id: s?.id,
    width,
    height,
    edge: edge?.id,
    members: members.map((m) => ({ id: m.id, status: m.status })),
  };
  if (!members.length) {
    box.innerHTML =
      '<div class="ny-graph-center"><div class="ny-phase-name">团队待命</div><div class="ny-phase-description">任务开始后显示真实协作</div></div>';
    $("#liveEvents").textContent = "还没有交接记录";
    $("#liveDetailTitle").textContent = "团队待命";
    $("#liveDetailText").textContent = "创建任务后，成员和交接将显示在这里。";
    return;
  }
  const positions = new Map();
  const leader = members.find((m) => m.id === "leader") || members[0],
    others = members.filter((m) => m !== leader);
  positions.set(leader.id, {
    x: width / 2,
    y: members.length === 1 ? 180 : 62,
  });
  if (others.length === 1)
    positions.set(others[0].id, { x: width / 2, y: 280 });
  else if (others.length === 2) {
    positions.set(others[0].id, { x: 60, y: 285 });
    positions.set(others[1].id, { x: width - 60, y: 285 });
  } else if (others.length === 3) {
    positions.set(others[0].id, { x: 60, y: 192 });
    positions.set(others[1].id, { x: width - 60, y: 192 });
    positions.set(others[2].id, { x: width / 2, y: 326 });
  } else
    others.forEach((m, i) =>
      positions.set(m.id, { x: i % 2 ? width - 60 : 60, y: i < 2 ? 180 : 315 }),
    );
  for (const point of positions.values()) point.y *= height / 382;
  const pathFor = (e) => {
    const a = positions.get(e.from),
      b = positions.get(e.to);
    if (!a || !b) return "";
    const dx = b.x - a.x,
      dy = b.y - a.y,
      l = Math.hypot(dx, dy) || 1,
      sx = a.x + (dx / l) * 48,
      sy = a.y + (dy / l) * 42,
      ex = b.x - (dx / l) * 48,
      ey = b.y - (dy / l) * 42;
    return `M ${sx} ${sy} Q ${(sx + ex) / 2} ${(sy + ey) / 2 - 18} ${ex} ${ey}`;
  };
  const unique = [];
  for (const e of edges)
    if (
      !unique.some(
        (x) =>
          (x.from === e.from && x.to === e.to) ||
          (x.from === e.to && x.to === e.from),
      )
    )
      unique.push(e);
  const seen = studioSeenEdges.get(s.id),
    animate =
      edge &&
      seen !== undefined &&
      edge.id > seen &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches;
  studioSeenEdges.set(s.id, edge?.id || 0);
  let svg = `<svg class="ny-graph-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="真实任务交接">`;
  for (const e of unique) svg += `<path class="ny-wire" d="${pathFor(e)}"/>`;
  if (edge) {
    const path = pathFor(edge);
    svg += `<path class="ny-wire-active" d="${path}"/><path class="ny-wire-hit" data-studio-edge="${edge.id}" d="${path}"/>`;
    if (animate)
      svg += `<circle class="ny-particle" r="3"><animateMotion dur="1.1s" repeatCount="1" fill="remove" path="${path}"/></circle>`;
  }
  svg += "</svg>";
  box.innerHTML =
    svg +
    members
      .map(
        (m) =>
          `<button class="ny-node" data-studio-member="${m.id}" data-busy="${m.status === "running"}"><span class="ny-node-top"><span class="ny-node-avatar">${escape(m.name[0])}</span>${escape(m.name)}</span><span class="ny-node-role">${escape(m.role)}</span><span class="ny-node-status">${escape(labels[m.status] || "待命")}</span></button>`,
      )
      .join("");
  for (const node of box.querySelectorAll("[data-studio-member]")) {
    const p = positions.get(node.dataset.studioMember);
    node.style.left = p.x - 50 + "px";
    node.style.top = p.y - 41 + "px";
  }
  if (edge) {
    const a = positions.get(edge.from),
      b = positions.get(edge.to),
      label = document.createElement("button");
    label.className = "ny-edge-label";
    label.dataset.studioEdge = edge.id;
    label.textContent = edge.label;
    label.style.left = (a.x + b.x) / 2 + "px";
    label.style.top = (a.y + b.y) / 2 - 12 + "px";
    box.append(label);
    $("#liveDetailTitle").textContent =
      `${name(s, edge.from)} → ${name(s, edge.to)} · ${edge.label}`;
    $("#liveDetailText").textContent = edge.task || "点击成员或交接查看记录。";
  } else {
    $("#liveDetailTitle").textContent = "团队已就位";
    $("#liveDetailText").textContent =
      "成员来自当前项目，交接发生后会在此显示。";
  }
  $("#liveEvents").innerHTML =
    edges
      .slice(-5)
      .reverse()
      .map(
        (e) =>
          `<button data-studio-edge="${e.id}">${escape(name(s, e.from))} → ${escape(name(s, e.to))} · ${escape(e.label)}<time>${escape(new Date(e.time).toLocaleTimeString())}</time></button>`,
      )
      .join("") || '<p class="ny-small">还没有交接记录。</p>';
}
const previousNew = $("#new").onclick;
$("#new").onclick = (e) => {
  previousNew(e);
  attachments = [];
  $("#attachments").textContent = "";
  $("#homeAttachments").textContent = "";
  $("#path").value = "";
  studioView = "home";
  studioGraphCache = null;
  drawStudio(null);
  $("#homeInput").focus();
};
for (const b of document.querySelectorAll("[data-view-nav]"))
  b.onclick = () => showStudioView(b.dataset.viewNav);
$("#homeStart").onclick = () => {
  if (!$("#homeInput").value.trim()) {
    $("#homeInput").focus();
    return;
  }
  current = undefined;
  studioView = "task";
  drawStudio(null);
  $("#panel").textContent = "正在创建任务…";
  $("#input").value = $("#homeInput").value;
  showStudioView("task");
  $("#composer").requestSubmit();
};
$("#homeInput").onkeydown = (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $("#homeStart").click();
  }
};
$("#homeAttach").onclick = () => $("#fileInput").click();
$("#homeRecent").onclick = (e) => {
  const b = e.target.closest("[data-id]");
  if (b) {
    current = b.dataset.id;
    studioView = "task";
    render();
  }
};
$("#decisionContent").onclick = async (e) => {
  const b = e.target.closest("[data-decision]");
  if (b) {
    try {
      await api(`conversations/${b.dataset.conversation}/answer`, {
        id: b.dataset.question,
        answer: b.dataset.decision === "true",
      });
      await refresh();
    } catch (e) {
      $("#notice").textContent = e.message;
    }
  }
  const open = e.target.closest("[data-open]");
  if (open) {
    current = open.dataset.open;
    studioView = "task";
    render();
    $("#input").focus();
  }
};
$("#resultContent").onclick = (e) => {
  const b = e.target.closest("[data-open]");
  if (b) {
    current = b.dataset.open;
    studioView = "task";
    render();
  }
};
$("#settingsDialog .close").onclick = () =>
  showStudioView(current ? "task" : "home");
$("#changesPanel").onclick = (e) => $("#panel").onclick(e);
$("#expandGraph").onclick = (e) => {
  if (current) $("#panel").onclick(e);
};
function studioGraphClick(e) {
  const s = conversations.find((s) => s.id === current);
  if (!s) return;
  const member = e.target.closest("[data-studio-member]");
  if (member) {
    const m = s.members.find((m) => m.id === member.dataset.studioMember);
    $("#liveDetailTitle").textContent = m.name + " · " + m.role;
    $("#liveDetailText").textContent =
      `${m.model} / ${m.effort} · ${labels[m.status] || "待命"}`;
  }
  const edge = e.target.closest("[data-studio-edge]");
  if (edge) {
    const item = studioEdges(s).find(
      (x) => x.id === Number(edge.dataset.studioEdge),
    );
    if (item) {
      $("#liveDetailTitle").textContent =
        `${name(s, item.from)} → ${name(s, item.to)} · ${item.label}`;
      $("#liveDetailText").textContent =
        (item.task || "") + " · " + new Date(item.time).toLocaleString();
      studioView = "task";
      tab = "team";
      showStudioView("task");
      updateTaskTab();
      document
        .getElementById("e" + item.id)
        ?.scrollIntoView({ block: "center" });
    }
  }
}
$("#liveGraph").onclick = studioGraphClick;
$("#liveEvents").onclick = studioGraphClick;
new ResizeObserver(() => {
  studioGraphCache = null;
  drawStudioGraph(conversations.find((s) => s.id === current));
}).observe($("#liveGraph"));
showStudioView("home");
drawStudio(conversations.find((s) => s.id === current));

$("#homeInput").onpaste = (e) => {
  if (e.clipboardData.files.length) {
    e.preventDefault();
    addFiles(e.clipboardData.files);
  }
};
$("#homeView").ondragover = (e) => e.preventDefault();
$("#homeView").ondrop = (e) => {
  e.preventDefault();
  addFiles(e.dataTransfer.files);
};
