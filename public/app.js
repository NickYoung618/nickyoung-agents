import { applyEvent, project } from "./studio/conversation-state.mjs";
import { artifactCards, artifactAction, syncArtifacts, reconnectArtifacts, updateArtifactRegion, artifactDraftEvent, setArtifactFilters, artifactInventory } from "./studio/artifact-workbench.mjs";
const modelTests = new Map();
let modelCatalog = null,
  showHiddenModels = false;
import { marked, DOMPurify, hljs, speaker } from "./vendor.mjs";
import { labels, progress, timeline, eventText, deliveryEvidence } from "./studio/event-projection.mjs";
import { draftManager } from "./studio/draft-manager.mjs";
import { studioEdges, graphPositions } from "./studio/agent-graph.mjs";
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
let attachmentContext = "new";
const attachmentSelections = new Map([["new", attachments]]);
function syncAttachments() {
  const key = studioView === "home" ? "new" : current || "new";
  attachmentSelections.set(attachmentContext, attachments);
  attachmentContext = key;
  attachments = attachmentSelections.get(key) || [];
  attachmentSelections.set(key, attachments);
  for (const [id, context] of [["#homeAttachments", "new"], ["#attachments", current]]) {
    const selected = attachmentSelections.get(context) || [];
    const saved = drafts.read(context === "new" ? undefined : context).attachmentNames || [];
    $(id).textContent = selected.length ? selected.map(f => f.name).join(" · ") : saved.length ? `附件需重新选择：${saved.join("、")}` : "";
  }
}
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
          headers: { "Content-Type": "application/json", "Idempotency-Key": data.requestId || crypto.randomUUID() },
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
function memberStatus(s, m) {
  return s.status === "done" ? "本次已交付" : m.status === "idle" ? "空闲" : m.status === "running" ? "正在处理任务" : labels[m.status] || m.status || "空闲";
}
function name(s, id) {
  return id === "user"
    ? "尼克杨先生"
    : s.members.find((m) => m.id === id)?.name || id;
}
let refreshing, refreshAgain = false;
let updateCursor=0;
const detailLoads=new Map(),loadedDetails=new Set();
async function ensureDetail(id) {
  if(!id||loadedDetails.has(id)||detailLoads.has(id))return;
  const pending=(async()=>{
    try {
      const detail=await api(`conversations/${id}/detail`);
      if(detail?.id&&Array.isArray(detail.events)) {
        const newer=conversations.find(c=>c.id===id)?.events.filter(e=>e.id>(detail.events.at(-1)?.id||0))||[];
        for(const e of newer)applyEvent(detail,e);
        conversations=conversations.map(c=>c.id===id?detail:c);
      }
      loadedDetails.add(id);render();
    }catch(e){$('#notice').textContent=e.message;}finally{detailLoads.delete(id);}
  })();detailLoads.set(id,pending);return pending;
}
async function refresh() {
  if (refreshing) { refreshAgain = true; return refreshing; }
  refreshing = (async () => {
    do { refreshAgain = false; if(!updateCursor){const summaries=await api('summaries').catch(()=>null);conversations=Array.isArray(summaries)?summaries:await api('state');updateCursor=Math.max(0,...conversations.map(c=>c.historyCursor||c.events.at(-1)?.id||0));}
      else {const delta=await api('updates?after='+updateCursor);if(Array.isArray(delta.events)){const map=new Map(conversations.map(c=>[c.id,c]));for(const e of delta.events){if(!map.has(e.conversation))map.set(e.conversation,project([]));const c=map.get(e.conversation);c.id=e.conversation;applyEvent(c,e);}conversations=[...map.values()];updateCursor=delta.cursor;if(delta.hasMore)refreshAgain=true;}else conversations=await api('state');} await syncArtifacts(conversations,api);render(); } while (refreshAgain);
  })();
  try { await refreshing; } finally { refreshing = null; }
}
function updateRegion(selector, html) {
  const box = $(selector);
  if (box.dataset.html === html) return;
  const top = box.scrollTop;
  const open = [...box.querySelectorAll('details[open]')].map((n, i) => n.id || `index:${[...box.querySelectorAll('details')].indexOf(n)}`);
  box.innerHTML = html;
  for (const [i, node] of [...box.querySelectorAll('details')].entries()) if (open.includes(node.id || `index:${i}`)) node.open = true;
  box.scrollTop = top;
  box.dataset.html = html;
}
function render() {
  ensureDetail(current);
  let s = conversations.find((s) => s.id === current);
  $("#conversations").innerHTML = conversations
    .map(
      (s) =>
        `<button data-id="${s.id}" class="${current === s.id ? "active" : ""}">◦ ${escape(s.title)}<span class="badge"> · ${labels[s.status] || s.status}</span></button>`,
    )
    .join("");
  syncDraftContext();
  drawProjects();
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
    `<strong title="${escape(s.title)}">${escape(s.title)}</strong>`;
  $("#pause").textContent = ["paused", "error", "interrupted"].includes(
    s.status,
  )
    ? "继续"
    : "暂停";
  const stopping=s.status==='paused'&&s.members.some(m=>m.status==='running');
  if(stopping)$('#pause').textContent='正在停止…';
  $('#pause').disabled=stopping;
  document.title =
    (s.questions.some((q) => !q.answered)
      ? "等你决定 · "
      : s.status === "done"
        ? "已完成 · "
        : "") + "NickYoung";
  renderTimeline(s);
  updateRegion("#questions", s.questions.filter(q => !q.answered).map(q => decisionCard(s, q, true)).join(""));
  panel(s);
  drawStudio(s);
}
function panel(s) {
  if (true)
    $("#panel").innerHTML =
      s.members
        .map(
          (m) =>
            `<div class="member ${m.status}"><div class="who"><span class="avatar tone${s.members.findIndex((x) => x.id === m.id)}">${escape(m.name[0])}</span><div>${escape(m.name)}<small>${escape(m.role)} · ${escape(memberStatus(s, m))}</small></div></div><small>${escape(m.model)} · ${escape(m.effort)}</small><button data-model="${m.id}">更换模型</button></div>`,
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
  $("#heading").textContent = "工作台";
  $("#messages").innerHTML =
    '<div class="welcome"><div class="monogram">N</div><h1>把想法，交给团队。</h1><p>描述你想完成的事，知行会组织成员一起推进。</p></div>';
  $("#panel").innerHTML = "还没有成员";
  $("#questions").innerHTML = "";
  $("#path").hidden = false;
  $("#pause").hidden = true;
  $("#overall").textContent = "";
  $("#input").focus();
};
let sending = false;
async function sendRequest(home = false) {
  if (sending) return;
  const field = $(home ? '#homeInput' : '#input');
  const text = field.value.trim();
  if (!text) { field.focus(); return; }
  const target = home ? undefined : current;
  const files = [...attachments];
  sending = true;
  saveDrafts();
  $("#homeStart").disabled = true;
  $("#composer button").disabled = true;
  $("#homeStart").textContent = '正在创建任务…';
  $("#notice").textContent = target ? '正在发送补充要求…' : '正在创建任务，随后由负责人理解需求…';
  try {
    if (target) await api(`conversations/${target}/message`, { text, files });
    else {
      const r = await api('conversations', { text, path: selectedPath(), files,kind:$('#taskKind').value });
      current = r.id;
      studioView = 'task';
    }
    if (field.value.trim() === text) field.value = '';
    drafts.clear(target);
    attachmentSelections.set(home ? "new" : target, []);
    attachments = [];
    $("#attachments").textContent = '';
    $("#homeAttachments").textContent = '';
    if (field.value.trim()) saveDrafts();
    await refresh();
    $("#notice").textContent = '已发送，负责人将处理你的要求。';
    $("#messages").scrollTop = $("#messages").scrollHeight;
  } catch (error) {
    $("#notice").textContent = `发送未完成：${error.message}。输入和附件已保留，可重试。`;
  } finally {
    sending = false;
    $("#homeStart").disabled = false;
    $("#composer button").disabled = false;
    $("#homeStart").textContent = '开始';
  }
}
$("#composer").onsubmit = e => { e.preventDefault(); sendRequest(); };
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
    const latest=conversations.find(c=>c.id===current);
    $("#pause").disabled = latest?.status==='paused'&&latest.members.some(m=>m.status==='running');
  }
};
$("#questions").onclick = async (e) => {
  let b = e.target.closest("[data-answer]");
  if (b) {
    await answerQuestion(b, current, b.dataset.id, b.dataset.answer === 'true');
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
  if (jump) jumpToEvent(jump.dataset.jump.slice(1));
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
        jumpToEvent(jump.dataset.jump.slice(1));
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
$("#focusMode").onclick = () => { const hidden = $(".shell").classList.toggle("hide-right"); $("#focusMode").textContent = hidden ? "显示团队" : "专注阅读"; };
$("#toggleLeft").onclick = () => $(".shell").classList.toggle("hide-left");
function setDrawer(open) {
  $('.shell').classList.toggle('show-live', open);
  $('.ny-live').classList.toggle('drawer-open', open);
  $('#drawerBackdrop').hidden = !open;
  $('#toggleRight').setAttribute('aria-expanded', String(open));
  if (matchMedia('(max-width: 600px)').matches) {
    $('.ny-live').setAttribute('role', open ? 'dialog' : 'complementary');
    $('.ny-live').setAttribute('aria-modal', String(open));
    if (open) $('#closeTeam').focus({preventScroll:true}); else $('#toggleRight').focus({preventScroll:true});
  }
}
$('#toggleRight').onclick = () => setDrawer(!$('.shell').classList.contains('show-live'));
$('#closeTeam').onclick = () => setDrawer(false);
$('#drawerBackdrop').onclick = () => setDrawer(false);
document.addEventListener('keydown', e => {
  if (!$('.shell').classList.contains('show-live') || !matchMedia('(max-width: 600px)').matches) return;
  if (e.key === 'Escape') { e.preventDefault(); setDrawer(false); }
  if (e.key === 'Tab') {
    const items = [...$('.ny-live').querySelectorAll('button:not(:disabled), summary, [tabindex="0"]')].filter(n => n.getClientRects().length);
    const first = items[0], last = items.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus({preventScroll:true}); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus({preventScroll:true}); }
  }
});
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
const modelKey = s => `${s.channel}/${s.model}/${s.effort}`;
function drawSettings() {
  $("#modelSettings").innerHTML =
    modelrow(config.leader, -1) + config.tiers.map(modelrow).join("");
  for (const row of document.querySelectorAll(".modelrow")) {
    updateEfforts(row);
    const i = Number(row.dataset.index), selection = i < 0 ? config.leader : config.tiers[i];
    row.querySelector('.testResult').textContent = modelTests.get(modelKey(selection)) || '目录可见不代表连接可用，尚无本次测试记录';
  }
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
        `连接测试通过 · ${r.model} · ${new Date().toLocaleTimeString()} · ${(r.duration / 1000).toFixed(1)} 秒`;
    } catch (e) {
      row.querySelector(".testResult").textContent = "连接测试失败：" + e.message;
    } finally {
      modelTests.set(modelKey(s), row.querySelector(".testResult").textContent);
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
    $("#settingsResult").textContent = "已保存全局默认配置；现有成员保持原配置。";
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
const drafts = draftManager(localStorage, () => { $("#notice").textContent = '本地草稿保存不可用，请保留输入内容后再刷新。'; });
let draftContext, connectionReady = false, selectedMember = null, selectedEdge = null;
let messageSession, messageSignature, timelineLimit = 8;
const readingPositions = new Map();
function selectedPath() { return $("#projectSelect").value === '__custom' ? $("#path").value.trim() : $("#projectSelect").value; }
function saveDrafts() {
  drafts.write(undefined, { text: $("#homeInput").value, project: $("#projectSelect").value, path: $("#path").value, attachmentNames: (attachmentSelections.get("new") || []).map(f => f.name) });
  if (draftContext) drafts.write(draftContext, { text: $("#input").value, attachmentNames: (attachmentSelections.get(draftContext) || []).map(f => f.name) });
}
function restoreHomeDraft() {
  const d = drafts.read();
  $("#homeInput").value = d.text || '';
  $("#path").value = d.path || '';
  drawProjects();
  $("#projectSelect").value = d.project || '';
  if ($("#projectSelect").selectedIndex < 0) $("#projectSelect").value = '__custom';
  $("#projectAdvanced").hidden = $("#projectSelect").value !== '__custom';
  $("#homeAttachments").textContent = d.attachmentNames?.length ? `附件需重新选择：${d.attachmentNames.join('、')}` : '';
}
function syncDraftContext() {
  if (draftContext === current) return;
  if (draftContext) drafts.write(draftContext, { text: $("#input").value, attachmentNames: (attachmentSelections.get(draftContext) || []).map(f => f.name) });
  draftContext = current;
  const d = drafts.read(current);
  $("#input").value = current ? d.text || '' : '';
  $("#attachments").textContent = current && d.attachmentNames?.length ? `附件需重新选择：${d.attachmentNames.join('、')}` : '';
}
function drawProjects() {
  const select = $("#projectSelect"), value = select.value;
  const paths = [...new Set(conversations.map(c => c.path).filter(Boolean))];
  const html = '<option value="">新建空项目</option>' + paths.map(path => `<option value="${escape(path)}">${escape(path.split('/').filter(Boolean).at(-1))} · ${escape(path)}</option>`).join('') + '<option value="__custom">高级：输入目录</option>';
  if (select.innerHTML !== html) { select.innerHTML = html; select.value = value; }
}
function showMemberDetail(s, id) {
  if (id === "__others") { $("#liveDetailTitle").textContent = "其他团队成员"; $("#liveDetailText").textContent = s.members.slice(7).map(m => `${m.name} · ${m.role} · ${memberStatus(s,m)}`).join("；"); return; }
  const m = s.members.find(m => m.id === id);
  if (!m) return;
  const task = s.tasks.find(t => (t.member === id || t.reviewer === id) && !['passed','cancelled','deferred'].includes(t.status));
  $("#liveDetailTitle").textContent = m.name + ' · ' + m.role;
  $("#liveDetailText").textContent = `${m.model} / ${m.effort} · ${s.status === 'done' ? '本次已交付' : m.status === 'idle' ? '空闲' : labels[m.status] || m.status}` + (task ? ` · ${task.title}` : '');
}
function renderTimeline(s) {
  const box = $("#messages");
  if (messageSession !== s.id) {
    if (messageSession) readingPositions.set(messageSession, { top: box.scrollTop, limit: timelineLimit });
    const saved = readingPositions.get(s.id);
    timelineLimit = saved?.limit || 8;
    box.replaceChildren();
    messageSession = s.id;
    messageSignature = undefined;
    $("#newProgress").hidden = true;
  }
  const selected = timeline(s.events, timelineLimit);
  const signature = `${s.id}:${s.events.length}:${s.events.at(-1)?.id}:${timelineLimit}`;
  if (signature === messageSignature) return;
  const changed = messageSignature !== undefined;
  const top = box.scrollTop, bottom = box.scrollHeight - top - box.clientHeight < 100;
  let html = selected.length >= timelineLimit ? '<button data-more>显示更早的关键进展</button>' : '';
  for (const e of selected) {
    const d = e.data;
    if (e.type === 'message') {
      const m = speaker(s, e);
      html += `<article class="message ${d.member === 'user' ? 'user' : ''}" id="e${e.id}"><div class="who">${escape(d.member === 'user' ? '你' : m?.name)} <small>${escape(d.member === 'user' ? '' : m?.model)}</small></div><div class="prose">${d.member === 'user' ? escape(d.text) : markdown(d.text)}</div></article>`;
    } else html += `<div class="event" id="e${e.id}">${escape(eventText(s, e))}<button data-evidence="${e.id}">查看证据</button></div>`;
  }
  html += `<details id="executionLog"><summary>完整执行日志 · ${s.events.length} 条事件（按需加载）</summary><div id="rawEvents"></div></details>`;
  const old = new Map([...box.children].filter(n => n.id).map(n => [n.id, n]));
  const fragment = document.createElement('template'); fragment.innerHTML = html;
  for (const node of [...fragment.content.children]) {
    const previous = old.get(node.id);
    if (previous && (node.id === 'executionLog' || previous.outerHTML === node.outerHTML)) node.replaceWith(previous);
  }
  box.replaceChildren(fragment.content);
  $('#executionLog > summary').textContent = `完整执行日志 · ${s.events.length} 条事件（按需加载）`;
  if ($('#executionLog').open) renderRaw(s);
  for (const code of box.querySelectorAll('.prose pre code:not([data-highlighted])')) hljs.highlightElement(code);
  box.scrollTop = changed ? (bottom ? box.scrollHeight : top) : readingPositions.get(s.id)?.top || 0;
  if (changed && !bottom) { $('#newProgress').hidden = false; $('#newProgress').textContent = '有新进展 · 跳到最新'; }
  messageSignature = signature;
}
const rawPages=new Map();
function renderRaw(s, target) {
  if(!s)return;
  if(!rawPages.has(s.id)){rawPages.set(s.id,[]);api(`conversations/${s.id}/events?limit=100`).then(page=>{if(Array.isArray(page.events)){rawPages.set(s.id,page.events);if(current===s.id)renderRaw(s,target);}}).catch(e=>$('#notice').textContent=e.message);}

  const raw = $('#rawEvents');
  if (target) raw.dataset.target = target;
  if (!target && raw.dataset.target) target = raw.dataset.target;
  const limit = Number(raw.dataset.limit) || 100;
  const opened = new Set([...raw.querySelectorAll('details[open]')].map(n => Number(n.id.slice(3))));
  const page=rawPages.get(s.id)||[];const merged=[...new Map([...page,...s.events.filter(e=>e.id>(page.at(-1)?.id||0))].map(e=>[e.id,e])).values()].sort((a,b)=>a.id-b.id);
  const recent = (page.length?merged:s.events).slice(-limit);
  const ids = new Set(recent.map(e => e.id));
  const events = target ? s.events.filter(e => e.id === Number(target)) : [...s.events.filter(e => opened.has(e.id) && !ids.has(e.id)), ...recent];
  const old = new Map([...raw.children].map(n => [n.id, n]));
  raw.replaceChildren(...events.map(e => {
    if (old.has(`raw${e.id}`)) return old.get(`raw${e.id}`);
    const detail = document.createElement('details'); detail.id = `raw${e.id}`;
    const summary = document.createElement('summary'); summary.textContent = `#${e.id} · ${e.type === 'model_change' ? '模型配置已更新' : e.type} · ${new Date(e.time).toLocaleTimeString()}`;
    detail.append(summary);
    detail.addEventListener('toggle', async () => {
      if (!detail.open || detail.querySelector('pre')) return;
      const pre = document.createElement('pre'); pre.textContent = JSON.stringify(e.data.payload?(await api(`events/${e.id}/payload`)).data:e.data, null, 2); detail.append(pre);
    });
    return detail;
  }));
  if (!target && s.events.length > 100) {
    const button = document.createElement('button'); button.textContent = '加载更早的原始记录';
    button.onclick = () => { const first = events[0]?.id; api(`conversations/${s.id}/events?before=${first}&limit=100`).then(page=>renderRawPage(s,page.events||[],raw));button.remove(); };
    raw.prepend(button);
  }
}
function renderRawPage(s, events, raw) {
  const fragment = document.createDocumentFragment();
  for (const e of events) { const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = `#${e.id} · ${e.type}`; const pre = document.createElement('pre'); pre.textContent = JSON.stringify(e.data, null, 2); details.append(summary, pre); fragment.append(details); }
  if (events.length && s.events.some(e => e.id < events[0].id)) { const b = document.createElement('button'); b.textContent = '加载更早的原始记录'; b.onclick = () => { api(`conversations/${s.id}/events?before=${events[0].id}&limit=100`).then(page=>renderRawPage(s,page.events||[],raw));b.remove(); }; fragment.prepend(b); }
  raw.dataset.limit = (Number(raw.dataset.limit) || 100) + events.length;
  raw.prepend(fragment);
}
function jumpToEvent(id) {
  studioView = 'task'; tab = 'team'; showStudioView('task'); updateTaskTab();
  $('#executionLog').open = true;
  const s = conversations.find(s => s.id === current); renderRaw(s, id);
  const detail = document.getElementById(`raw${id}`); if (detail) { detail.open = true; detail.scrollIntoView({ block: 'center' }); }
}
$('#messages').addEventListener('toggle', e => { if (e.target.id === 'executionLog' && e.target.open) renderRaw(conversations.find(s => s.id === current)); }, true);
$('#messages').onclick = e => {
  const evidence = e.target.closest('[data-evidence]');
  if (evidence) jumpToEvent(evidence.dataset.evidence);
  if (e.target.closest('[data-more]')) { timelineLimit += 30; render(); }
};
$('#newProgress').onclick = () => { $('#messages').scrollTop = $('#messages').scrollHeight; $('#newProgress').hidden = true; };
$('#homeInput').addEventListener('input', saveDrafts); $('#input').addEventListener('input', saveDrafts);
$('#path').addEventListener('input', saveDrafts);
$('#projectSelect').onchange = () => { $('#projectAdvanced').hidden = $('#projectSelect').value !== '__custom'; saveDrafts(); };
window.addEventListener('pagehide', saveDrafts);
$('#applyUpdate').onclick = () => { saveDrafts(); location.reload(); };
$('#copyPath').onclick = () => navigator.clipboard.writeText(conversations.find(s => s.id === current)?.path || '').catch(e => $('#notice').textContent = e.message);
restoreHomeDraft();
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
  reconnectArtifacts();
  fetch("/api/ui-version", { cache: "no-store" })
    .then((response) => response.ok ? response.json() : null)
    .then((version) => {
      if (version && document.documentElement.dataset.uiVersion !== version.version) {
        saveDrafts();
        $("#updateBanner").hidden = false;
      }
    })
    .catch(() => {});
  connectionReady = true;
  studioGraphCache = null;
  for (const c of conversations) studioSeenEdges.delete(c.id);
  $("#connectionState").textContent = "实时连接正常";
  $("#notice").textContent = "";
  refresh().catch(e => $("#notice").textContent = e.message);
};
events.onerror = () => {
  connectionReady = false;
  studioGraphCache = null;
  drawStudioGraph(conversations.find(s => s.id === current));
  $("#notice").textContent = "连接中断，正在重连…";
  $("#connectionState").textContent = "正在重连 · 任务状态保留";
};

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
  syncAttachments();
  const active = conversations.find((s) => s.id === current);
  $("#heading").innerHTML =
    view === "task" && active
      ? `<strong title="${escape(active.title)}">${escape(active.title)}</strong>`
      : {
          home: "工作台",
          task: "当前任务",
          decision: "待你决定",
          result: "交付成果",projects:"项目与版本",
          settings: "模型设置",
        }[view];
  for (const [id, v] of [
    ["homeView", "home"],
    ["taskView", "task"],
    ["decisionView", "decision"],
    ["resultView", "result"],["projectsView","projects"],
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
$("#taskFilter").onchange = () => render();
function updateTaskTab() {
  $("#taskFilter").hidden = tab !== "graph";
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
function taskGroup(t) {
  return ['running','reviewing','repair','consultation'].includes(t.status) ? '1进行中' : ['queued','review','rate_wait'].includes(t.status) ? '2等待' : t.status === 'passed' ? '3已通过' : '4遗留与已停止';
}
function taskNext(t) {
  const next = {queued:'等待成员执行',running:'等待实现结果与机器验收',review:'等待独立审查',reviewing:'审查者正在核验',repair:'等待实现者修复后重新验收',consultation:'等待负责人给出处理方案',passed:'验收与独立审查已通过',rate_wait:'等待额度恢复',deferred:'遗留项，可补充处理要求',stopped:'已停止，需负责人处理',cancelled:'任务已取消'};
  return (next[t.status] || '下一步尚未确定') + (t.reason ? ` · ${t.reason}` : '');
}
function decisionCard(c, q, local = false) {
  const button = (answer, text) => `<button ${local ? `data-answer="${answer}" data-id="${q.id}"` : `data-decision="${answer}" data-conversation="${c.id}" data-question="${q.id}"`}>${answer ? '是' : '否'}：${escape(text || '负责人尚未说明此选项后果')}</button>`;
  return `<article class="card question"><div class="ny-small">${escape(c.title)}</div><h3>${escape(q.question)}</h3><p>${escape(q.context || '背景与影响范围未单独记录，可请负责人补充解释。')}</p><div class="question-options">${button(true,q.yes)}${button(false,q.no)}</div><button ${local ? 'data-other' : `data-open="${c.id}"`}>补充说明或提出其他方案</button></article>`;
}
async function answerQuestion(button, conversation, question, answer) {
  button.disabled = true;
  try { await api(`conversations/${conversation}/answer`, { id: question, answer }); await refresh(); $('#notice').textContent = '决定已记录，团队将按你的答复继续处理。'; }
  catch(error) { $('#notice').textContent = error.message; }
  finally { button.disabled = false; }
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
  updateRegion('#decisionContent', pending.length ? pending.map(({q,c}) => decisionCard(c,q)).join('') : '<div class="card">暂时没有待决定事项。</div>');
  const reports = conversations
    .flatMap((c) =>
      c.events.filter((e) => e.type === "report").map((e) => ({ c, e })),
    )
    .reverse();
  updateArtifactRegion($('#resultContent'), artifactCards(conversations,escape) + (reports.length ? reports.map(({c,e}) => {
    const evidence = deliveryEvidence(c, e);
    return `<details class="card" id="delivery-${e.id}"><summary>报告、验收与审查详情 · ${escape(c.title)}</summary><div class="ny-small">${escape(c.title)} · ${escape(new Date(e.time).toLocaleString())}</div><h3>报告与辅助证据</h3><p>${c.events.some(item=>item.type==='artifact'&&item.id<=e.id)?'使用入口及验证状态见对应版本成果卡。':'历史报告，使用入口尚未验证。'}</p>${evidence.incomplete.length ? `<p>未通过或遗留：${evidence.incomplete.map(t => escape(t.title || t.id) + " · " + escape(labels[t.status] || t.status)).join("；")}</p>` : ""}<p class="delivery-summary">${escape(evidence.summary)}</p><div class="evidence-strip"><span>机器验收通过 ${evidence.passed} 次</span><span>机器检查失败 ${evidence.failed}</span><span>审查退回 ${evidence.reviewFailed}</span><span>运行异常 ${evidence.runtimeFailed}</span><span>当前未解决 ${evidence.incomplete.length}</span><span>独立审查 ${evidence.reviews.length} 次</span></div>${evidence.reviews.map(r => `<button data-open="${c.id}" data-event="${r.id}">审查${r.verdict === 'pass' ? '通过' : '退回'} · ${escape(r.commit?.slice(0,8) || '未记录提交')}</button>`).join('')}<p class="delivery-summary"><strong>运行与使用：</strong>${escape(evidence.usage || "报告未单独标注命令，请展开完整报告核对。")}</p><details id="report-${e.id}"><summary>完整报告与使用说明</summary><div class="prose">${markdown(e.data.text)}</div></details><div class="task-evidence"><button data-open="${c.id}" data-changes>查看文件与 diff</button><button data-open="${c.id}">提出修改 / 继续项目</button><button data-copy-report="${e.id}">复制摘要</button></div></details>`;
  }).join('') : '<div class="card ny-small">还没有交付成果。</div>'));
  renderProjectNavigation();
  if (s) {
    $("#taskTitle").textContent = s.title;
    $("#taskTitle").title = s.title;
    $("#fullGoal").textContent = (s.intent?.goal||s.title)+"\n预期："+(s.intent?.expected||s.kind||"自动识别")+"\n验收："+(s.intent?.criteria||"见各任务验收条件");
    $("#requirementStatus").textContent=s.requirement?(s.requirement.status+" · "+s.requirement.text):"";
    $("#projectPath").textContent = s.path + (s.branch ? " · " + s.branch : "");
    const summary = progress(s);
    $("#taskStatus").textContent = summary.waiting ? `等你决定 · ${summary.waiting} 项` : labels[s.status];
    $("#focusTitle").textContent = summary.action;
    $("#focusTitle").title = summary.action;
    $("#nextAction").textContent = summary.next;
    const handoff = studioEdges(s).at(-1);
    $("#taskCounts").textContent = `${summary.passed} / ${s.tasks.length} 项已通过 · 需要你 ${summary.waiting} 项` +
      (handoff ? ` · 最近交接：${name(s, handoff.from)} → ${name(s, handoff.to)}` : '') +
      (summary.last ? ` · 最后真实活动 ${new Date(summary.last.time).toLocaleTimeString()}` : '');
    updateRegion("#taskList", s.tasks.length
      ? [...s.tasks].filter(t => $("#taskFilter").value !== "blocked" || ["queued","review","consultation","rate_wait","stopped","deferred"].includes(t.status)).sort((a,b) => taskGroup(a).localeCompare(taskGroup(b)))
          .map(
            (
              t,
            ) => `<div class="task"><span class="ny-small">${escape(taskGroup(t).slice(1))}</span><br><strong>${escape(t.title)}</strong><div class="ny-small">${escape(name(s, t.member))} → ${escape(name(s, t.reviewer))} · ${escape(labels[t.status])} · 返修 ${t.failures} 次</div><p class="ny-small">${escape(taskNext(t))}</p><details><summary>验收标准</summary><pre>${escape(t.description)}
${escape(t.commands?.join("\n"))}</pre></details><div class="task-evidence">${s.events.filter(e => ["check","review"].includes(e.type) && e.data.task === t.id).slice(-2).map(e => `<button data-evidence="${e.id}">${e.type === "check" ? "机器验收" : "独立审查"} · 查看证据</button>`).join("")}</div></div>`,
          )
          .join("")
      : '<p class="ny-small">还没有任务。</p>');
  }
  $("#liveStatus").textContent = s
    ? s.questions.some((q) => !q.answered)
      ? "等你决定"
      : labels[s.status]
    : "待命";
  $("#memberCount").textContent = s
    ? `${s.members.length} 位成员 · ${s.status === "done" ? "本次已交付" : s.members.filter((m) => m.status === "running").length + " 人在忙"}${s.members.length > 8 ? " · 其余成员已聚合，点击聚合节点查看" : ""}`
    : "还没有成员";
  $("#expandGraph").disabled = !s;
  drawStudioGraph(s);
  updateTaskTab();
  showStudioView(studioView);
}
function drawStudioGraph(s) {
  const box = $("#liveGraph"),
    members = (s?.members?.length > 8 ? [...s.members.slice(0,7), {id:"__others",name:`其他 ${s.members.length-7} 人`,role:"点击查看全部",status:"idle"}] : s?.members || []),
    edges = studioEdges(s).filter(e => members.some(m => m.id === e.from) && members.some(m => m.id === e.to)),
    edge = edges.at(-1),
    width = Math.max(220, box.clientWidth),
    height = Math.max(members.length > 4 ? Math.ceil(members.length / 2) * 106 : 280, Math.round(Math.min(382, Math.max(282, window.innerHeight * 0.36))));
  box.style.minHeight = height + "px";
  const cache = studioGraphCache;
  if (
    cache &&
    cache.id === s?.id &&
    cache.width === width &&
    cache.height === height &&
    cache.edge === edge?.id && cache.status === s?.status && cache.connected === connectionReady &&
    cache.members.length === members.length &&
    cache.members.every(
      (m, i) => m.id === members[i].id && m.status === members[i].status && m.model === members[i].model,
    )
  )
    return;
  studioGraphCache = {
    id: s?.id,
    width,
    height,
    edge: edge?.id, status: s?.status, connected: connectionReady,
    members: members.map((m) => ({ id: m.id, status: m.status, model: m.model })),
  };
  if (!members.length) {
    box.innerHTML =
      '<div class="ny-graph-center"><div class="ny-phase-name">团队待命</div><div class="ny-phase-description">任务开始后显示真实协作</div></div>';
    $("#liveEvents").textContent = "还没有交接记录";
    $("#liveDetailTitle").textContent = "团队待命";
    $("#liveDetailText").textContent = "创建任务后，成员和交接将显示在这里。";
    return;
  }
  const positions = graphPositions(members, width, height);
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
      edge.id > seen && connectionReady && s.status === "working" &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches;
  studioSeenEdges.set(s.id, edge?.id || 0);
  let svg = `<svg class="ny-graph-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="真实任务交接">`;
  for (const e of unique) svg += `<path class="ny-wire" d="${pathFor(e)}"/><path class="ny-wire-hit" data-studio-edge="${e.id}" tabindex="0" role="button" aria-label="${escape(e.label)}" d="${pathFor(e)}"/>`;
  if (edge) {
    const path = pathFor(edge);
    svg += `<path class="ny-wire-active" d="${path}"/><path class="ny-wire-hit" data-studio-edge="${edge.id}" d="${path}"/>`;
    if (animate)
      svg += `<circle class="ny-particle" r="3"><animateMotion dur="1.1s" repeatCount="1" fill="remove" path="${path}"/></circle>`;
  }
  svg += "</svg>";
  const focusedMember = document.activeElement?.dataset.studioMember;
  const previousNodes = new Map([...box.querySelectorAll("[data-studio-member]")].map(n => [n.dataset.studioMember, n]));
  box.innerHTML =
    svg +
    members
      .map(
        (m) =>
          `<button class="ny-node" data-studio-member="${m.id}" data-busy="${m.status === "running" && s.status === "working" && connectionReady}"><span class="ny-node-top"><span class="ny-node-avatar">${escape(m.name[0])}</span>${escape(m.name)}</span><span class="ny-node-role">${escape(m.role)}</span><span class="ny-node-status">${escape(s.status === "done" ? "本次已交付" : m.status === "idle" ? "空闲" : labels[m.status] || m.status)}</span></button>`,
      )
      .join("");
  for (const node of box.querySelectorAll("[data-studio-member]")) {
    const p = positions.get(node.dataset.studioMember);
    const previous = previousNodes.get(node.dataset.studioMember);
    if (previous) {
      if (previous.innerHTML !== node.innerHTML) previous.innerHTML = node.innerHTML;
      previous.dataset.busy = node.dataset.busy;
      node.replaceWith(previous);
      previous.style.left = p.x - 50 + 'px'; previous.style.top = p.y - 41 + 'px';
      continue;
    }
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
  if (focusedMember) box.querySelector(`[data-studio-member="${focusedMember}"]`)?.focus({preventScroll:true});
  if (selectedMember?.conversation === s.id) showMemberDetail(s, selectedMember.id);
  if (selectedEdge?.conversation === s.id) {
    const selected = studioEdges(s).find(e => e.id === selectedEdge.id);
    if (selected) { $("#liveDetailTitle").textContent = `${name(s,selected.from)} → ${name(s,selected.to)} · ${selected.label}`; $("#liveDetailText").textContent = `${selected.task || ''} · ${new Date(selected.time).toLocaleString()}`; }
  }
  $("#liveEvents").innerHTML =
    edges
      .slice(-3)
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
  saveDrafts();
  syncDraftContext();
  restoreHomeDraft();
  studioView = "home";
  studioGraphCache = null;
  drawStudio(null);
  $("#homeInput").focus();
};
for (const b of document.querySelectorAll("[data-view-nav]"))
  b.onclick = () => showStudioView(b.dataset.viewNav);
$("#homeStart").onclick = () => sendRequest(true);
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
    await answerQuestion(b, b.dataset.conversation, b.dataset.question, b.dataset.decision === 'true');
  }
  const open = e.target.closest("[data-open]");
  if (open) {
    current = open.dataset.open;
    studioView = "task";
    render();
    $("#input").focus();
  }
};
$('#resultContent').addEventListener('toggle',artifactDraftEvent,true);
$('#resultContent').addEventListener('input',artifactDraftEvent);
$('#resultContent').addEventListener('change',artifactDraftEvent);
$('#resultContent').onclick = async e => {
  if(await artifactAction(e,api,refresh,text=>$('#notice').textContent=text))return;
  const copy = e.target.closest('[data-copy-report]');
  if (copy) {
    const report = conversations.flatMap(c => c.events).find(e => e.id === Number(copy.dataset.copyReport));
    try { await navigator.clipboard.writeText(report?.data.text || ''); $('#notice').textContent = '交付报告已复制。'; } catch (error) { $('#notice').textContent = error.message; }
  }
  const b = e.target.closest('[data-open]');
  if (!b) return;
  current = b.dataset.open; studioView = 'task'; render();
  if (b.hasAttribute('data-changes')) { tab = 'changes'; updateTaskTab(); await loadStudioFiles(); }
  else if (b.dataset.event) jumpToEvent(b.dataset.event);
  else $('#input').focus();
};
$('#taskList').onclick = e => { const b = e.target.closest('[data-evidence]'); if (b) jumpToEvent(b.dataset.evidence); };
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
    selectedEdge = null;
    selectedMember = { conversation: s.id, id: member.dataset.studioMember };
    showMemberDetail(s, selectedMember.id);
  }
  const edge = e.target.closest("[data-studio-edge]");
  if (edge) {
    const item = studioEdges(s).find(
      (x) => x.id === Number(edge.dataset.studioEdge),
    );
    if (item) {
      selectedMember = null;
      selectedEdge = {conversation:s.id,id:item.id};
      $("#liveDetailTitle").textContent =
        `${name(s, item.from)} → ${name(s, item.to)} · ${item.label}`;
      $("#liveDetailText").textContent =
        (item.task || "") + " · " + new Date(item.time).toLocaleString();
      jumpToEvent(item.id);
    }
  }
}
$("#liveGraph").onclick = studioGraphClick;
$("#liveGraph").onkeydown = e => { if (["Enter", " "].includes(e.key) && e.target.matches("[data-studio-edge]")) { e.preventDefault(); studioGraphClick(e); } };
$("#liveEvents").onclick = studioGraphClick;
new ResizeObserver(() => requestAnimationFrame(() => {
  studioGraphCache = null;
  drawStudioGraph(conversations.find((s) => s.id === current));
})).observe($("#liveGraph"));
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

function renderProjectNavigation(){
 const groups=new Map();for(const c of conversations){const id=c.projectId||c.path;if(!groups.has(id))groups.set(id,{id,path:c.path,conversations:[]});groups.get(id).conversations.push(c);}
 const selected=$('#artifactProject').value,options='<option value="all">全部项目</option>'+[...groups.values()].map(p=>`<option value="${escape(p.id)}">${escape(p.path.split('/').at(-1))}</option>`).join('');if($('#artifactProject').dataset.options!==options){$('#artifactProject').innerHTML=options;$('#artifactProject').value=selected;$('#artifactProject').dataset.options=options;}
 const recommended=p=>{const latest=new Map();for(const a of artifactInventory())if((a.projectId||a.project)===p.id&&!a.archived&&a.verification.status==='passed'&&a.dataState!=='requires-upgrade'&&(!latest.has(a.key)||latest.get(a.key).version<a.version))latest.set(a.key,a);return [...latest.values()].map(a=>`<p>${escape(a.name)} · 推荐 v${a.version} · ${a.type==='web'?'可启动预览':'已验证入口'} <button data-project-artifact="${a.id}" data-project-id="${p.id}">打开 / 继续修改</button></p>`).join('')||'<p>暂无已验证成果；可查看关联任务与历史报告。</p>';};
 updateRegion('#projectsContent',[...groups.values()].map(p=>`<article class="card"><h3>${escape(p.path.split('/').at(-1))}</h3><p>${escape(p.path)}</p>${recommended(p)}${p.conversations.map(c=>`<button data-open-project="${c.id}">${escape(c.title)} · ${escape(labels[c.status]||c.status)}</button>`).join('')}<button data-project-outcomes="${escape(p.id)}">打开推荐成果与历史版本</button></article>`).join(''));
 const latest=new Map();for(const a of artifactInventory())if(!a.archived&&(!latest.has((a.projectId||a.project)+':'+a.key)||latest.get((a.projectId||a.project)+':'+a.key).version<a.version))latest.set((a.projectId||a.project)+':'+a.key,a);const cards=[...latest.values()].reverse().slice(0,4);updateRegion('#homeOutcomes','<h3>最近成果</h3>'+cards.map(a=>`<button data-home-artifact="${a.id}">${escape(a.name)} · v${a.version} · ${a.verification.status==='passed'?'打开成果':'查看准备问题'}</button>`).join('')+`<p>${conversations.filter(c=>c.status==='working').length} 项进行中 · ${conversations.flatMap(c=>c.questions.filter(q=>!q.answered)).length} 项待你处理</p>`);
}
for(const id of ['artifactSearch','artifactType','artifactProject','artifactArchive','artifactHistory'])$('#'+id).addEventListener(id==='artifactSearch'?'input':'change',()=>{setArtifactFilters({query:$('#artifactSearch').value,type:$('#artifactType').value,project:$('#artifactProject').value,archive:$('#artifactArchive').value,history:$('#artifactHistory').checked});render();});
$('#projectsContent').onclick=e=>{const a=e.target.closest('[data-project-artifact]');if(a){$('#artifactProject').value=a.dataset.projectId;setArtifactFilters({project:a.dataset.projectId,query:'',type:'all',archive:'active'});$('#artifactSearch').value='';$('#artifactType').value='all';$('#artifactArchive').value='active';showStudioView('result');document.querySelector(`[data-artifact="${a.dataset.projectArtifact}"]`)?.scrollIntoView({block:'start'});return;}const b=e.target.closest('[data-open-project]');if(b){current=b.dataset.openProject;studioView='task';render();}const outcome=e.target.closest('[data-project-outcomes]');if(outcome){$('#artifactProject').value=outcome.dataset.projectOutcomes;setArtifactFilters({project:outcome.dataset.projectOutcomes});studioView='result';render();}};
$('#homeOutcomes').onclick=e=>{const b=e.target.closest('[data-home-artifact]');if(b){for(const [id,value] of [['artifactSearch',''],['artifactProject','all'],['artifactType','all'],['artifactArchive','active']])$('#'+id).value=value;setArtifactFilters({query:'',project:'all',type:'all',archive:'active'});showStudioView('result');document.querySelector(`[data-artifact="${b.dataset.homeArtifact}"]`)?.scrollIntoView({block:'start'});}};
$('#editIntent').onclick=async()=>{const s=conversations.find(c=>c.id===current);if(!s)return;const goal=prompt('修订当前目标',s.intent?.goal||s.title);if(!goal)return;const criteria=prompt('本轮验收条件（保留原条件，明确变化）',s.intent?.criteria||'各任务的原验收条件');if(criteria===null)return;try{await api(`conversations/${s.id}/intent`,{goal,criteria,expected:s.intent?.expected||s.kind||'auto'});await refresh();}catch(e){$('#notice').textContent=e.message;}};


await refresh();
if (conversations.length && !current) {
  current = conversations.at(-1).id;
  render();
  requestAnimationFrame(() => {
    $("#messages").scrollTo({
      top: $("#messages").scrollHeight,
      behavior: "instant",
    });
  });
} else if (!conversations.length) $("#panel").textContent = "还没有成员";


document.documentElement.dataset.appReady="true";
