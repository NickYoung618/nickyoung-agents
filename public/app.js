import { marked, DOMPurify, hljs } from "./vendor.mjs";
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
        let m = s.members.find((m) => m.id === d.member);
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
}
function panel(s) {
  if (tab === "team")
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
  if (tab === "graph")
    $("#panel").innerHTML =
      '<button id="expandGraph">展开协作图</button>' + graph(s);
}
function graph(s) {
  const events = s.events.filter((e) =>
    [
      "task",
      "task_update",
      "run_start",
      "model_result",
      "review",
      "check",
      "member_question",
      "member_answer",
      "question",
      "answer",
    ].includes(e.type),
  );
  const width = Math.max(440, s.members.length * 132 + 70),
    height = 100 + events.length * 42;
  const x = (id) => 70 + s.members.findIndex((m) => m.id === id) * 132;
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
    if (e.type === "model_result") {
      if (starts.has(d.member))
        out += `<line class="bar" x1="${x(d.member)}" y1="${starts.get(d.member)}" x2="${x(d.member)}" y2="${y}"/>`;
      starts.delete(d.member);
      label = "交付结果";
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
  let s = conversations.find((s) => s.id === current);
  await api(
    `conversations/${current}/${["paused", "error", "interrupted"].includes(s.status) ? "resume" : "pause"}`,
    {},
  );
  refresh();
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
  render();
  if (tab === "changes") {
    try {
      const d = await api(`conversations/${current}/files`);
      $("#panel").innerHTML = d.files.length
        ? d.files
            .map(
              (f) =>
                `<button class="file" data-file="${escape(f)}">${escape(f)}</button>`,
            )
            .join("") + '<div id="filePreview"></div>'
        : "还没有改动";
    } catch (e) {
      $("#panel").textContent = e.message;
    }
  }
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
      graph(conversations.find((s) => s.id === current));
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
$("#toggleRight").onclick = () => $(".shell").classList.toggle("hide-right");
function modelrow(s, i) {
  return `<div class="modelrow" data-index="${i}"><input class="tierName" aria-label="档位名称" value="${escape(s.name || "负责人")}" ${i < 0 ? "disabled" : ""}><select class="channel" aria-label="通道"><option ${s.channel === "claude" ? "selected" : ""}>claude</option><option ${s.channel === "codex" ? "selected" : ""}>codex</option></select><input class="model" list="models" aria-label="模型" value="${escape(s.model)}"><select class="effort" aria-label="推理强度">${["low", "medium", "high", "xhigh", "max"].map((x) => `<option ${s.effort === x ? "selected" : ""}>${x}</option>`).join("")}</select>${i >= 0 ? `<input class="description" aria-label="适用任务" placeholder="适合做什么" value="${escape(s.description)}"><button data-up="${i}">上移</button><button data-remove="${i}">删除</button>` : ""}<button class="testModel">测试</button><small class="testResult"></small></div>`;
}
function drawSettings() {
  $("#modelSettings").innerHTML =
    '<datalist id="models">' +
    models
      .map(
        (m) =>
          `<option value="${escape(m.model)}">${escape(m.channel + " / " + m.name)}</option>`,
      )
      .join("") +
    "</datalist>" +
    modelrow(config.leader, -1) +
    config.tiers.map(modelrow).join("");
  for (const row of document.querySelectorAll(".modelrow")) updateEfforts(row);
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
    [config, models] = await Promise.all([api("config"), api("models")]);
    drawSettings();
    $("#concurrency").value = config.concurrency;
    $("#timeout").value = config.timeout / 60000;
    $("#names").value = config.names.join("、");
    $("#experience").value = config.experience;
    $("#settingsDialog").showModal();
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
  $("#notice").textContent = "";
  refresh();
};
events.onerror = () => ($("#notice").textContent = "连接中断，正在重连…");
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

function updateEfforts(row) {
  const model = models.find(
    (m) =>
      m.channel === row.querySelector(".channel").value &&
      m.model === row.querySelector(".model").value,
  );
  const select = row.querySelector(".effort"),
    current = select.value;
  select.innerHTML = (
    model?.efforts || ["low", "medium", "high", "xhigh", "max"]
  )
    .map(
      (e) => `<option ${e === current ? "selected" : ""}>${escape(e)}</option>`,
    )
    .join("");
}
$("#modelSettings").onchange = (e) => {
  if (e.target.matches(".channel,.model"))
    updateEfforts(e.target.closest(".modelrow"));
};
$("#refreshModels").onclick = async () => {
  readSettings();
  models = await api("models");
  drawSettings();
  for (const row of document.querySelectorAll(".modelrow")) updateEfforts(row);
};

$("#notifications").onclick = async () => {
  $("#settingsResult").textContent =
    "Notification" in window
      ? (await Notification.requestPermission()) === "granted"
        ? "桌面通知已启用"
        : "桌面通知未启用"
      : "浏览器不支持桌面通知";
};
