import {deliveryGate} from "./delivery.mjs";
import {inspectProject} from "./project-support.mjs";
import { dirtyWork, readWorkFile, sameWork, preserveWork, workChanges } from "./work-checkpoints.mjs";
import { productFiles } from "./artifacts.mjs";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { execFileSync } from "node:child_process";
import { runModel, runProcess } from "./runner.mjs";
import { project, failureState } from "./store.mjs";
const id = () => randomUUID();
export class Engine {
  constructor(store, config, saveConfig, emit) {
    Object.assign(this, { store, config, saveConfig, emit });
    this.running = new Map();
    this.waking = new Set();
    this.pending = new Set();
    this.busyProjects = new Set();
    this.teamTokens = new Map();
    this.retryTimers = new Map();
    this.memberTurns = new Set();
    this.memberQueue = [];this.toolStarts=new Map();this.turnSource=new Map();
    for (const s of store.summaries()) {
      if (s.status === "working") {
        this.event(s.id, "status", { status: "interrupted" });
        this.event(s.id, "interrupted", {
          text: "服务重启，回合已中断，负责人将安排恢复。",
        });
      }
    }
  }
  state(c) {
    return this.store.state(c);
  }
  event(c, t, d) {
    let e = this.store.append(c, t, d);
    this.emit(e);
    return e;
  }
  git(path, args) {
    return execFileSync("git", ["-C", path, ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "NickYoung",
        GIT_AUTHOR_EMAIL: "nickyoung@localhost",
        GIT_COMMITTER_NAME: "NickYoung",
        GIT_COMMITTER_EMAIL: "nickyoung@localhost",
      },
    }).trim();
  }
  async create(title, path,kind="auto") {
    if(this.draining)throw Error("服务维护中，暂不接收新任务");
    const c = id();
    path = path ? resolve(path) : join(this.config.workspace, c);
    if(existsSync(path)){path=realpathSync(path);try{path=this.git(path,["rev-parse","--show-toplevel"]);}catch{}}
    if (
      this.store
        .conversations()
        .some(
          (s) => (s.path === path||s.projectId===this.store.projectId(path)) && !["done", "cancelled"].includes(s.status),
        )
    )
      throw new Error("这个目录已有对话，请在原对话继续。");
    const existed = existsSync(path);
    if(existed)path=realpathSync(path);
    mkdirSync(path, { recursive: true });
    if (existed && !existsSync(join(path, ".git"))) {
      this.event(c, "created", {
        title: title.slice(0, 40),
        path,
        status: "waiting_setup",
      });
      this.event(c, "recruit", {
        id: "leader",
        name: "知行",
        role: "负责人",
        ...this.config.leader,
      });
      this.event(c, "question", {
        id: id(),
        purpose: "init_repo",
        question: "这个目录还没有 Git 仓库，是否初始化本地仓库记录改动？",
        yes: "保留现有文件，初始化本地仓库并开始开发。",
        no: "保留目录原状，停止这次开发。",
      });
      return c;
    }
    if (!existsSync(join(path, ".git"))) {
      this.git(path, ["init"]);
      this.git(path, ["commit", "--allow-empty", "-m", "初始化项目"]);
    }
    if (this.git(path, ["status", "--porcelain"]))
      throw new Error("项目有未提交改动，请先提交后再开始。");
    this.event(c, "created", {
      title: title.slice(0, 40),
      projectId:this.store.projectId(path),
      kind,
      path,
      status: "idle",
    });
    this.event(c, "recruit", {
      id: "leader",
      name: "知行",
      role: "负责人",
      ...this.config.leader,
    });
    this.initialize(c);
    this.event(c,"project_detected",inspectProject(path));
    return c;
  }
  initialize(c) {
    const s = this.state(c),
      path = s.path;
    if (!existsSync(join(path, ".git"))) {
      this.git(path, ["init"]);
      this.git(path, ["add", "--all"]);
      this.git(path, ["commit", "--allow-empty", "-m", "记录项目初始内容"]);
    }
    const branch = "nickyoung/" + c.slice(0, 8);
    this.git(path, ["switch", "-c", branch]);
    mkdirSync(join(path, ".nickyoung"), { recursive: true });
    const notes = join(path, ".nickyoung", "项目须知.md");
    if (!existsSync(notes)) writeFileSync(notes, "# 项目须知\n");
    this.event(c, "project_update", {
      branch,
      base: this.git(path, ["rev-parse", "HEAD"]),
    });
  }
  async message(c, text, files = [], feedback) {
    if(this.draining)throw Error("服务维护中，暂不接收新要求");
    const s = this.state(c);
    if(feedback){const prior=s.events.find(e=>e.type==='artifact_feedback'&&e.data.id===feedback.id&&e.data.requestId===feedback.requestId);
      if(prior){if(prior.data.text!==feedback.text)throw Error('请求标识已用于另一条修改要求');return;}}
    const attachments = [];
    for (const f of files) {
      const dir = join(s.path, ".nickyoung", "附件");
      mkdirSync(dir, { recursive: true });
      const path = join(dir, id() + "-" + basename(f.name));
      writeFileSync(path, Buffer.from(f.data, "base64"));
      attachments.push({ name: f.name, path });
    }
    this.store.db.exec('BEGIN');
    try{
      const userEvent=this.event(c,"message",{member:'user',text,attachments,...(feedback?{artifactFeedback:feedback}:{})});
      this.event(c,'intent',{goal:text,expected:s.intent?.expected||'按需求交付可使用成果',criteria:s.intent?.criteria||'对应版本验证及独立审查',kind:s.kind||s.intent?.kind||'auto',source:'user',sourceMessage:userEvent.id,previous:s.intent?.goal,artifact:feedback});
      this.event(c,'requirement_status',{sourceMessage:userEvent.id,text,status:this.running.size||this.waking.has(c)?'等待当前回合结束后处理':'已收到',affected:s.tasks.filter(t=>!["passed","cancelled"].includes(t.status)).map(t=>t.id)});
      if(feedback)this.event(c,'artifact_feedback',feedback);
      if(s.branch)this.event(c,'status',{status:'working'});
      this.store.db.exec('COMMIT');
    }catch(e){this.store.db.exec('ROLLBACK');throw e;}
    if (!s.branch) return;
    this.wake(c);
  }
  context(c) {
    const s = this.state(c);
    return JSON.stringify({
      project: s.path,
      members: s.members,
      tasks: [...s.tasks.filter(t=>!["passed","resolved","cancelled","deferred"].includes(t.status)),...s.tasks.filter(t=>["passed","resolved"].includes(t.status)).slice(-8)],
      outcomes:s.events.filter(e=>e.type==='artifact').slice(-8).map(e=>({eventId:e.id,id:e.data.id,name:e.data.name,version:e.data.version,commit:e.data.commit,status:e.data.verification?.status,limits:e.data.limits})),
      intent:s.intent,
      goals: s.events.filter(e => e.type === "message" && e.data.member === "user").slice(-6),
      decisions: s.events.filter(e => ["decision", "answer", "notice", "artifact_feedback"].includes(e.type)).slice(-16),
      existingNotes: s.path && existsSync(join(s.path, ".nickyoung", "项目须知.md")) ? readFileSync(join(s.path, ".nickyoung", "项目须知.md"), "utf8") : "",
      events: s.events
        .filter((e) => !["process", "model_result", "work_checkpoint", "artifact"].includes(e.type))
        .slice(-32).map(e=>({...e,data:JSON.stringify(e.data).slice(0,2400)})),
      tiers: this.config.tiers,
      names: this.config.names,
      experience: existsSync(join(this.config.data || ".", "experience.md"))
        ? readFileSync(join(this.config.data, "experience.md"), "utf8")
        : this.config.experience || "",
    });
  }
  memberSlot(c, member, taskId, taskRole) {
    return new Promise((resolve, reject) => {
      this.memberQueue.push({
        c,
        member,
        key: c + ":" + member,
        taskId,
        taskRole,
        resolve,
        reject,
      });
      this.drainMembers();
    });
  }
  drainMembers() {
    for (const request of [...this.memberQueue]) {
      const state = this.state(request.c),
        task = state.tasks.find((t) => t.id === request.taskId);
      if (
        ["paused", "interrupted"].includes(state.status) ||
        (task &&
          (["cancelled", "deferred"].includes(task.status) ||
            (request.taskRole && task[request.taskRole] !== request.member)))
      ) {
        this.memberQueue.splice(this.memberQueue.indexOf(request), 1);
        request.reject(new Error("排队回合已取消"));
      }
    }
    while (this.memberTurns.size < (this.config.concurrency || 2)) {
      const index = this.memberQueue.findIndex(
        (r) => !this.memberTurns.has(r.key),
      );
      if (index < 0) break;
      const request = this.memberQueue.splice(index, 1)[0];
      this.memberTurns.add(request.key);
      request.resolve(() => {
        this.memberTurns.delete(request.key);
        this.drainMembers();
      });
    }
  }
  async model(
    c,
    member,
    prompt,
    { leader = false, cwd, readOnly = false, taskId, taskRole } = {},
  ) {
    if (!leader && !this.memberTurns.has(c + ":" + member.id))
      this.event(c, "member", { id: member.id, status: "queued" });
    const releaseMember = leader
      ? () => {}
      : await this.memberSlot(c, member.id, taskId, taskRole);
    const s = this.state(c);
    member = s.members.find((m) => m.id === member.id) || member;
    const selection = leader ? s.leaderSelection || this.config.leader : member;
    const key = c + ":" + member.id;
    const queuedAt=Date.now();
    let releaseResource=()=>{};
    try{releaseResource=await this.resources?.acquire('model:'+c+':'+member.id,2,()=>this.event(c,'resource_wait',{member:member.id,reason:'等待模型资源预算'}))||releaseResource;}catch(e){releaseMember();throw e;}
    const started = Date.now();
    this.event(c,'resource_ready',{member:member.id});
    this.event(c,'timing',{kind:'model_queue',member:member.id,duration:started-queuedAt});
    this.event(c, "member", { ...selection, id: member.id, status: "running" });
    this.event(c, "run_start", { member: member.id, ...selection });
    const token = id();
    if (leader || selection.channel === "claude")
      this.teamTokens.set(token, {
        conversation: c,
        member: member.id,
        cwd: cwd || s.path,
        readOnly: leader || readOnly,
        taskId,
        leader,
      });
    const proc = runModel({
      selection,
      cwd: cwd || s.path,
      prompt,
      leader,
      readOnly,
      team:
        leader || selection.channel === "claude"
          ? {
              role: leader ? "leader" : "member",
              token,
              url: `https://127.0.0.1:${this.config.port}/internal/team`,
            }
          : undefined,
      session:
        member.sessionChannel === selection.channel
          ? member.session
          : undefined,
      timeout: this.config.timeout,
      onEvent: (e) => {
        this.event(c,"process",{member:member.id,event:e});
        if(e.item?.type==='command_execution'){const key=c+':'+member.id+':'+e.item.id;if(e.type==='item.started')this.toolStarts.set(key,Date.now());if(e.type==='item.completed'){const began=this.toolStarts.get(key);this.event(c,'timing',{kind:'tool',member:member.id,duration:began?Date.now()-began:e.item.duration_ms??null,sourceItem:e.item.id});this.toolStarts.delete(key);}}
        if(taskId&&taskRole==='member'){
          const last=this.store.latest(c,'work_checkpoint',taskId);
          if(last)this.checkpoint(c,taskId,cwd||s.path,last.protected);
        }
      },
    });
    proc.taskId = taskId;
    this.running.set(key, proc);
    try {
      let r = await proc.promise;
      this.event(c, "member", {
        id: member.id,
        status: "idle",
        session: r.session,
        sessionChannel: selection.channel,
      });
      this.event(c, "model_result", {
        member: member.id,
        tier: member.tierId || member.role || "负责人",
        model: r.model,
        channel: selection.channel,
        usage: r.usage,
        duration: Date.now() - started,
        result: r.result,
      });
      if (r.result.message)
        this.event(c, "message", {
          member: member.id,
          text: r.result.message,
          model: r.model,
          effort: selection.effort,
          channel: selection.channel,
        });
      return r.result;
    } catch (e) {
      if (e.signal && !e.timedOut) {
        this.event(c, "run_interrupted", {
          member: member.id,
          model: selection.model,
          duration: Date.now() - started,
          signal: e.signal,
        });
        this.event(c, "member", { id: member.id, status: "interrupted" });
        throw e;
      }
      this.event(c, "run_failed", {
        member: member.id,
        model: selection.model,
        tier: member.tierId || member.role || "负责人",
        duration: Date.now() - started,
        error: e.message,
      });
      if (
        /rate.?limit|quota|limit reached|usage limit|429|额度/i.test(e.message)
      ) {
        e.retryAt = Date.now() + 60000;
        for (const event of e.events || []) {
          const reset = event.rate_limit_info?.resetsAt;
          if (reset) e.retryAt = Math.max(Date.now() + 1000, reset * 1000);
        }
        this.event(c, "rate_limit", {
          member: member.id,
          retryAt: e.retryAt,
          text: e.message,
        });
      }
      this.event(c, "member", {
        id: member.id,
        status: e.retryAt ? "rate_limited" : "error",
      });
      this.event(c, "error", { member: member.id, text: e.message });
      throw e;
    } finally {
      releaseResource();
      this.event(c,'timing',{kind:'model',member:member.id,duration:Date.now()-started});
      this.running.delete(key);
      this.teamTokens.delete(token);
      releaseMember();
    }
  }
  settleIdle(c) {
    const s = this.state(c),
      result = s.events.findLast(
        (e) => e.type === "model_result" && e.data.member === "leader",
      ),
      user = s.events.findLast(
        (e) => e.type === "message" && e.data.member === "user",
      );
    if (
      ["working", "interrupted"].includes(s.status) &&
      !s.tasks.length &&
      !s.questions.some((q) => !q.answered) &&
      !s.members.some((m) => m.status === "running") &&
      result &&
      (!user || result.id > user.id) &&
      !this.pending.has(c)
    ) {
      this.event(c, "status", { status: "idle" });
      return true;
    }
    return false;
  }
  async wake(c) {
    if (this.draining || this.state(c).status === "paused") return;
    if (this.waking.has(c)) {
      this.pending.add(c);
      return;
    }
    this.waking.add(c);
    try {
      let s = this.state(c);
      const source=s.events.findLast(e=>e.type==='message'&&e.data.member==='user')||(s.requirement?.sourceMessage?{id:s.requirement.sourceMessage,data:{text:s.requirement.text}}:null);this.turnSource.set(c,source?.id||0);
      const turnStart=s.historyCursor||s.events.at(-1)?.id||0;
      let r = await this.model(c, s.members[0], this.context(c), {
        leader: true,
      });
      if (this.draining || this.state(c).status === "paused") return;
      for (const a of r.actions || []) {
        try {
          await this.action(c, a);
        } catch (e) {
          this.event(c, "error", { text: e.message, action: a.type });
          const repeated=this.state(c).events.filter(x=>x.type==='error'&&x.data.action===a.type&&x.data.text===e.message).length;
          if(repeated>=3)this.event(c,'status',{status:'error'});else this.pending.add(c);
        }
      }
      if(source){const tasks=this.state(c).events.filter(e=>e.type==='task'&&e.id>turnStart).map(e=>e.data.id);this.event(c,'requirement_status',{sourceMessage:source.id,text:source.data.text,status:tasks.length?'已纳入本轮派发':'本轮已读取并答复，落实情况见结果',affected:tasks});}
    } catch (e) {
      if (!["paused", "interrupted"].includes(this.state(c).status)) {
        if (e.retryAt) this.retry(c, "leader", e.retryAt, () => this.wake(c));
        else this.event(c, "status", { status: "error" });
      }
    } finally {
      this.waking.delete(c);
      this.settleIdle(c);
      this.pump();
      if (
        this.pending.delete(c) &&
        !["paused", "interrupted", "error", "done"].includes(
          this.state(c).status,
        )
      )
        setTimeout(() => this.wake(c), 100);
    }
  }
  async teamAction(token, action) {
    const scope = this.teamTokens.get(token);
    if (!scope) throw new Error("团队回合已结束");
    if (action.type !== "project_command") {
      if (!scope.leader) throw new Error("成员不能调度团队");
      return this.action(scope.conversation, action);
    }
    if (scope.leader) throw new Error("负责人仅使用只读文件工具");
    if (typeof action.command !== "string") throw new Error("缺少命令");
    const key = scope.conversation + ":" + scope.member + ":command";
    const output = [];
    const proc = runProcess(
      "codex",
      [
        "sandbox",
        "-c",
        `sandbox_mode="${scope.readOnly ? "read-only" : "workspace-write"}"`,
        "-c",
        "sandbox_workspace_write.network_access=true",
        "--",
        "bash",
        "-lc",
        action.command,
      ],
      {
        cwd: scope.cwd,
        timeout: this.config.timeout,
        onEvent: (event) => {
          output.push(event);
          this.event(scope.conversation, "process", {
            member: scope.member,
            event,
          });
        },
      },
    );
    proc.taskId = scope.taskId;
    this.running.set(key, proc);
    try {
      await proc.promise;
      return { exitCode: 0, events: output };
    } catch (e) {
      return { exitCode: e.exitCode ?? 1, events: output, error: e.message };
    } finally {
      releaseResource();
      this.event(c,'timing',{kind:'model',member:member.id,duration:Date.now()-started});
      this.running.delete(key);
    }
  }
  async action(c, a) {
    const s = this.state(c);
    switch (a.type) {
      case "recruit": {
        if (s.members.length >= 5) throw new Error("团队最多五人");
        if (s.members.some((m) => m.name === a.name))
          throw new Error("成员名字重复");
        const tier = this.config.tiers.find(
          (t) => t.id === a.tier || t.name === a.tier,
        );
        if (!tier) throw new Error("未知档位");
        this.event(c, "recruit", {
          ...tier,
          tierId: tier.id,
          id: id(),
          name: a.name,
          role: a.role,
          status: "idle",
        });
        break;
      }
      case "assign": {
        if(s.kind==="answer")throw Error("本轮仅问答，不启动开发任务；如需开发请修订任务类型");
        const m = s.members.find(
          (m) => m.name === a.member || m.id === a.member,
        );
        const r =
          s.members.find((m) => m.name === a.reviewer || m.id === a.reviewer) ||
          s.members.find((x) => x.id !== "leader" && x.id !== m?.id);
        if (!m || m.id === "leader" || !r || r.id === m.id || r.id === "leader")
          throw new Error("需要不同的实现者和审查者");
        if (!a.commands?.length) throw new Error("任务必须有验收命令");
        this.event(c, "task", {
          id: id(),
          deliveryType:a.deliveryType||s.kind||"auto",
          title: a.title,
          description: a.description,
          commands: a.commands,
          member: m.id,
          reviewer: r.id,
          status: "queued",
          failures: 0,
        });
        break;
      }
      case "discuss": {
        const rounds = s.events.filter(
          (e) => e.type === "discussion" && e.data.title === a.title,
        ).length;
        if (rounds >= 2)
          throw new Error("同一议题最多两轮，请负责人收尾并记录决定");
        const members = a.participants.map((n) =>
          s.members.find((m) => m.id === n || m.name === n),
        );
        if (!members.length || members.some((m) => !m || m.id === "leader"))
          throw new Error("请指定讨论成员");
        this.event(c, "discussion", { title: a.title, round: rounds + 1 });
        for (const m of members) {
          await this.model(
            c,
            m,
            JSON.stringify({
              discussion: a.title,
              background: a.text,
              context: this.context(c),
              instruction: "只从你的职责给出意见，不修改文件。",
            }),
            { readOnly: true },
          );
          if (this.state(c).status === "paused") break;
        }
        this.pending.add(c);
        break;
      }
      case "notice":
        // Persistent notice events carry platform context without modifying product files.
        this.event(c, "notice", { text: a.text });
        break;
      case "decision":
        this.event(c, "decision", { text: a.text });
        break;
      case "ask":
        this.event(c, "question", {
          id: id(),
          question: a.question,
          yes: a.yes,
          no: a.no,
        });
        break;
      case "withdraw_question": {
        const question = s.questions.find(
          (q) => q.id === a.question && !q.answered,
        );
        if (!question) throw new Error("没有待结束的请示");
        if (!a.reason?.trim()) throw new Error("需要说明请示结束原因");
        this.event(c, "question_closed", { id: question.id, reason: a.reason });
        break;
      }
      case "experience":
        this.config.experience = (this.config.experience || "") + "\n" + a.text;
        this.saveConfig();
        this.event(c, "experience", { text: a.text });
        break;
      case "retry": {
        let t = s.tasks.find((t) => t.id === a.task);
        if (!t || t.status !== "consultation")
          throw new Error("只有会诊任务可以直接重试");
        this.event(c, "task_update", {
          id: t.id,
          status: "repair",
          advice: a.advice,
        });
        break;
      }
      case "defer":
      case "cancel":
      case "reassign": {
        const task = s.tasks.find((t) => t.id === a.task);
        if (!task) throw new Error("未知任务");

        if (a.type === "reassign") {
          const member = s.members.find(
            (m) =>
              (m.id === a.member || m.name === a.member) && m.id !== "leader",
          );
          const reviewer =
            s.members.find(
              (m) =>
                (m.id === a.reviewer || m.name === a.reviewer) &&
                m.id !== "leader",
            ) || s.members.find((m) => m.id === task.reviewer);
          if (!member || !reviewer || member.id === reviewer.id)
            throw new Error("改派需要不同的实现者和审查者");
          this.event(c, "task_update", {
            id: task.id,
            status: "queued",
            member: member.id,
            reviewer: reviewer.id,
            description: a.description || task.description,
            advice: a.advice || a.reason,
          });
        } else
          this.event(c, "task_update", {
            id: task.id,
            status: a.type === "defer" ? "deferred" : "cancelled",
            reason: a.reason,
          });
        for (const [key, process] of this.running)
          if (key.startsWith(c + ":") && process.taskId === task.id)
            process.stop();
        this.drainMembers();
        break;
      }
      case "resolve": {
        const task = s.tasks.find((t) => t.id === a.task),
          replacement = s.tasks.find((t) => t.id === a.replacement);
        if (task?.status !== "deferred" || replacement?.status !== "passed")
          throw new Error("关闭遗留需要关联一项已通过审查的替代任务");
        this.event(c, "task_update", {
          id: task.id,
          status: "resolved",
          replacement: replacement.id,
          reason: a.reason,
        });
        break;
      }
      case "finish":
        if(this.waking.has(c)&&(s.requirement?.sourceMessage||s.events.findLast(e=>e.type==='message'&&e.data.member==='user')?.id||0)>(this.turnSource.get(c)||0))throw Error('仍有本轮开始后到达的要求，待下一轮处理后才能收工');
        if (s.questions.some((q) => !q.answered))
          throw new Error("仍有请示等待用户回答");
        if (
          s.tasks.some(
            (t) =>
              !["passed", "deferred", "cancelled", "resolved"].includes(
                t.status,
              ),
          )
        )
          throw new Error("仍有未通过审查的任务");
        if(this.artifacts){const gate=deliveryGate(s,this.artifacts.list(c));this.event(c,'delivery_gate',gate);if(!gate.ready)throw Error('成果尚未准备完成：'+gate.issues.map(i=>i.reason+'；'+i.retry).join('；'));}
        this.event(c, "report", { text: a.text,stage:s.tasks.some(t=>t.status==='passed')?'prepared':'answer' });
        this.event(c, "status", { status: "done" });
        break;
      case "read_context":
        {const ids=(a.commands||[]).map(Number).filter(Number.isFinite).slice(0,8);if(!ids.length)return[];return this.store.db.prepare('SELECT * FROM events WHERE conversation=? AND id IN ('+ids.map(()=>'?').join(',')+') ORDER BY id').all(c,...ids).map(row=>{const e=this.store.decode(row,true);return{...e,data:JSON.stringify(e.data).slice(0,16000)};});}
      case "verify_artifact": {
        const attempts=s.events.filter(e=>e.type==='artifact_validation'&&e.data.id===a.task&&e.data.status==='running').length;
        if(attempts>=3)throw Error('同一成果自动重试已达三次，请修复原因并交付新版');
        await this.artifacts.verify(c,a.task);break;
      }
      default:
        throw new Error("未知团队指令：" + a.type);
    }
  }
  pump() {
    if(this.draining)return;
    let active = this.busyProjects.size;
    for (const s of this.store.summaries()) {
      if (
        s.status !== "working" ||
        this.busyProjects.has(s.id) ||
        (s.projectId&&[...this.busyProjects].some(id=>this.state(id).projectId===s.projectId)) ||
        this.waking.has(s.id) ||
        [...this.running.keys()].some(
          (k) => k.startsWith(s.id + ":") && !k.endsWith(":leader"),
        )
      )
        continue;
      if (active >= this.config.concurrency) break;
      let t = s.tasks.find((t) =>
        ["queued", "repair", "review"].includes(t.status),
      );
      if (t) {
        active++;
        this.busyProjects.add(s.id);
        this.task(s.id, t)
          .catch((e) => {
            const current = this.state(s.id).tasks.find(
              (task) => task.id === t.id,
            );
            if (["cancelled", "deferred", "queued"].includes(current?.status))
              return;
            if (!["paused", "interrupted"].includes(this.state(s.id).status))
              this.event(s.id, "error", { text: e.message });
            if (e.retryAt) {
              this.event(s.id, "task_update", {
                id: t.id,
                status: "rate_wait",
                resumeStatus: t.status,
                retryAt: e.retryAt,
              });
              this.retry(s.id, t.id, e.retryAt, () => {
                this.event(s.id, "task_update", { id: t.id, status: t.status });
                this.pump();
              });
            } else if (
              ["paused", "interrupted"].includes(this.state(s.id).status)
            ) {
              this.event(s.id, "task_update", {
                id: t.id,
                status: t.status === "review" ? "review" : "repair",
              });
            } else {
              this.event(s.id, "task_update", { id: t.id, status: "stopped" });
              this.wake(s.id);
            }
          })
          .finally(() => {
            this.busyProjects.delete(s.id);
            this.pump();
          });
      }
    }
  }
  checkpoint(c,task,path,protectedFiles={}) {
    const all=dirtyWork(path),own=Object.fromEntries(Object.entries(all).filter(([file])=>!(file in protectedFiles)));
    const value={task,head:this.git(path,['rev-parse','HEAD']),own,protected:protectedFiles};
    const previous=this.store.latest(c,'work_checkpoint',task);
    if(JSON.stringify(previous)!==JSON.stringify(value))this.event(c,'work_checkpoint',value);
    return value;
  }
  workConflict(c,t,conflicts) {
    this.event(c,'work_conflict',{task:t.id,conflicts});
    this.event(c,'task_update',{id:t.id,status:'waiting_user',advice:conflicts.map(x=>x.file+': '+x.reason).join('；')});
    if(!this.state(c).questions.some(q=>q.purpose==='work_conflict'&&q.task===t.id&&!q.answered))this.event(c,'question',{id:id(),purpose:'work_conflict',task:t.id,question:'检测到用户改动：'+conflicts.map(x=>x.file).join('、')+'。保留当前内容并以它为基础继续？',yes:'保留当前文件作为新的实现基础，仅接管这些冲突文件。',no:'保留所有文件并暂停，暂不继续修改。',conflicts});
  }
  resolveWorkConflict(c,question,answer) {
    if(!answer){this.event(c,'status',{status:'paused'});return;}
    const s=this.state(c),previous=this.store.latest(c,'work_checkpoint',question.task);
    const protectedFiles={...previous?.protected};
    const conflicts=new Set(question.conflicts.map(x=>x.file));
    for(const [file,value] of Object.entries(dirtyWork(s.path)))if(!(file in (previous?.own||{}))&&!conflicts.has(file))protectedFiles[file]=value;
    for(const conflict of question.conflicts)delete protectedFiles[conflict.file];
    this.checkpoint(c,question.task,s.path,protectedFiles);
    this.event(c,'task_update',{id:question.task,status:'repair'});this.event(c,'status',{status:'working'});this.pump();
  }
  async task(c, t) {
    let s = this.state(c);
    const review = t.status === "review";
    this.event(c, "task_update", {
      id: t.id,
      status: review ? "reviewing" : "running",
    });
    let cwd = s.path, worktree, protectedFiles={}, checkpointActive=false;
    if (review) {
      worktree = join(this.config.data, "reviews", t.id + "-" + t.failures);
      mkdirSync(resolve(worktree, ".."), { recursive: true });
      this.git(s.path, ["worktree", "add", "--detach", worktree, t.commit]);
      cwd = worktree;
    }
    try {
      if(!review&&cwd){
        const previous=this.store.latest(c,'work_checkpoint',t.id);
        const changes=workChanges(cwd,previous,this.git(cwd,['rev-parse','HEAD']));
        if(!previous&&Object.keys(changes.dirty).length){this.workConflict(c,t,Object.keys(changes.dirty).map(file=>({file,reason:'任务开始前已有未提交改动'})));return;}
        if(changes.conflicts.length){this.workConflict(c,t,changes.conflicts);return;}
        protectedFiles=changes.protected;checkpointActive=true;this.checkpoint(c,t.id,cwd,protectedFiles);
      }
      const m = s.members.find(
        (m) => m.id === (review ? t.reviewer : t.member),
      );
      const result = await this.model(
        c,
        m,
        JSON.stringify({
          task: t,
          review,
          commit: t.commit,
          advice: t.advice,
          protectedUserFiles:Object.keys(protectedFiles),
          userFileRule:"保留 protectedUserFiles，不修改或提交这些用户文件。任务自身未完成改动已保留，可在其上继续。",
          context: this.context(c),
        }),
        { cwd, taskId: t.id, taskRole: review ? "reviewer" : "member" },
      );
      if (
        ["cancelled", "deferred", "queued"].includes(
          this.state(c).tasks.find((task) => task.id === t.id)?.status,
        )
      )
        return;
      if (this.state(c).status === "paused") {
        this.event(c, "task_update", {
          id: t.id,
          status: review ? "review" : "repair",
        });
        return;
      }
      if (
        !review &&
        result.completion === "blocked" &&
        !result.questions?.length
      ) {
        this.event(c, "task_update", {
          id: t.id,
          status: "consultation",
          advice: result.blockers,
        });
        this.wake(c);
        return;
      }
      if (result.questions?.length) {
        let unanswered = false;
        for (const q of result.questions) {
          this.event(c, "member_question", {
            from: m.id,
            to: q.to,
            text: q.text,
            task: t.id,
          });
          const peer = this.state(c).members.find(
            (x) =>
              (x.name === q.to || x.id === q.to) &&
              x.id !== "leader" &&
              x.id !== m.id,
          );
          if (peer) {
            const answer = await this.model(
              c,
              peer,
              JSON.stringify({
                question: q.text,
                from: m.name,
                context: this.context(c),
                instruction: "只回答问题，不修改文件。",
              }),
              { readOnly: true },
            );
            if (answer.completion === "blocked") unanswered = true;
            this.event(c, "member_answer", {
              from: peer.id,
              to: m.id,
              task: t.id,
              text: answer.message,
            });
          } else {
            unanswered = true;
            this.pending.add(c);
          }
        }
        this.event(c, "task_update", {
          id: t.id,
          status: unanswered ? "consultation" : review ? "review" : "repair",
          advice: "请查看 member_question 与 member_answer，按实际答复继续。",
        });
        if (unanswered) this.wake(c);
        return;
      }
      const overwritten=Object.keys(protectedFiles).filter(file=>!sameWork(protectedFiles[file],readWorkFile(cwd,file)));
      if(overwritten.length){preserveWork(cwd,protectedFiles);this.workConflict(c,t,overwritten.map(file=>({file,reason:'模型触及用户保留文件，用户原内容已保留'})));return;}
      if (review) {
        if (this.git(cwd, ["status", "--porcelain"]))
          throw new Error("审查者修改了成果，审查无效");
        this.event(c, "review", { task: t.id, commit: t.commit, ...result });
        if (result.verdict !== "pass" || result.issues?.length) {
          this.fail(
            c,
            t,
            result.issues?.some((i) => i.severity === "design"),
            JSON.stringify(result),
          );
        } else {
          this.event(c, "task_update", { id: t.id, status: "passed" });
          if (this.artifacts) {
            try { await this.artifacts.collect(c, t, s.path); }
            catch (e) { this.event(c, "artifact_error", {task:t.id, message:e.message}); }
          }
          this.wake(c);
        }
      } else {
        const files = productFiles(cwd).filter(file=>!(file in protectedFiles));
        if (files.length) this.git(cwd, ["add", "--force", "--", ...files]);
        if (files.length && this.git(cwd, ["diff", "--cached", "--name-only", "--", ...files])) this.git(cwd, ["commit", "--only", "-m", t.title, "--", ...files]);
        let commit = this.git(cwd, ["rev-parse", "HEAD"]);
        this.event(c, "task_update", { id: t.id, commit });
        let ok = true;
        for (const cmd of t.commands) {
          const checkAt=Date.now(),releaseCheck=await this.resources?.acquire('check:'+t.id,1,()=>this.event(c,'resource_wait',{task:t.id,reason:'验收命令等待资源'}))||(()=>{});
          const output = [];
          const proc = runProcess(
            "codex",
            [
              "sandbox",
              "--config",
              'sandbox_mode="workspace-write"',
              "--config",
              "sandbox_workspace_write.network_access=true",
              "--",
              "bash",
              "-lc",
              cmd,
            ],
            {
              cwd,
              timeout: this.config.timeout,
              onEvent: (e) => {
                output.push(e.text || JSON.stringify(e));
                this.event(c, "process", {
                  member: "machine",
                  task: t.id,
                  event: e,
                });
              },
            },
          );
          proc.taskId = t.id;
          this.running.set(c + ":machine", proc);
          try {
            await proc.promise;
            this.event(c, "check", {
              task: t.id,
              command: cmd,
              passed: true,
              output: output.join("\n"),
              commit,
            });
          } catch (e) {
            if (e.signal && !e.timedOut) {
              this.event(c, "check_interrupted", {
                task: t.id,
                command: cmd,
                commit,
                signal: e.signal,
              });
              return;
            }
            ok = false;
            this.event(c, "check", {
              task: t.id,
              command: cmd,
              passed: false,
              output: output.join("\n") + "\n" + e.message,
              commit,
            });
          } finally {
            releaseCheck();this.event(c,'timing',{kind:'check',task:t.id,duration:Date.now()-checkAt});
            this.running.delete(c + ":machine");
          }
          if (!ok) break;
        }
        if (ok && productFiles(cwd).some(file=>!(file in protectedFiles))) {
          ok = false;
          this.event(c, "check", {
            task: t.id,
            passed: false,
            command: "git diff HEAD",
            output: "验收命令修改了已提交文件，请将所需改动纳入交付后重试。",
            commit,
          });
        }
        if (ok) this.event(c, "task_update", { id: t.id, status: "review" });
        else
          this.fail(
            c,
            t,
            false,
            "验收命令失败，请查看 check 和 process 事件。",
          );
      }
    } finally {
      if(checkpointActive){
        const changed=Object.keys(protectedFiles).filter(file=>!sameWork(protectedFiles[file],readWorkFile(cwd,file)));
        if(changed.length){preserveWork(cwd,protectedFiles);this.workConflict(c,t,changed.map(file=>({file,reason:'模型触及用户文件，已保留用户原内容'})));}
        this.checkpoint(c,t.id,cwd,protectedFiles);
      }
      if (worktree) {
        this.git(s.path, ["worktree", "remove", "--force", worktree]);
      }
      this.pump();
    }
  }
  retry(c, key, at, fn) {
    const k = c + ":" + key;
    clearTimeout(this.retryTimers.get(k));
    this.retryTimers.set(
      k,
      setTimeout(
        () => {
          this.retryTimers.delete(k);
          if (this.state(c).status !== "paused") fn();
        },
        Math.min(2147483647, Math.max(1000, at - Date.now())),
      ),
    );
  }
  fail(c, t, design, advice) {
    let failures = t.failures + 1,
      status = failureState(failures, design);
    this.event(c, "task_update", { id: t.id, failures, status, advice });
    if (status === "consultation" || status === "stopped") this.wake(c);
  }
  recover() {
    for (const s of this.store.summaries())
      if (s.status === "interrupted" && !this.settleIdle(s.id))
        this.resume(s.id);
  }
  shutdown() {
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    for (const s of this.store.summaries())
      if (s.status === "working") {
        this.event(s.id, "status", { status: "interrupted" });
        this.event(s.id, "interrupted", {
          text: "服务停止，本回合中断，重启后由负责人安排恢复。",
        });
      }
    for(const proc of this.running.values()){
      if(proc.taskId)for(const s of this.store.summaries()){const task=s.tasks.find(t=>t.id===proc.taskId);if(task?.status==='running'&&s.path){const previous=this.store.latest(s.id,'work_checkpoint',task.id);try{this.checkpoint(s.id,task.id,s.path,previous?.protected||{});}catch(e){this.event(s.id,'error',{text:'停止检查点：'+e.message});}}}
      proc.stop();
    }
    this.drainMembers();
  }
  pause(c) {
    for (const [key, timer] of this.retryTimers)
      if (key.startsWith(c + ":")) {
        clearTimeout(timer);
        this.retryTimers.delete(key);
      }
    this.event(c, "status", { status: "paused" });
    this.drainMembers();
    for (const [k,p] of this.running)if(k.startsWith(c+':')){
      const s=this.state(c),task=s.tasks.find(t=>t.id===p.taskId),last=this.store.latest(c,'work_checkpoint',p.taskId);
      if(task&&last&&task.status!=='reviewing')this.checkpoint(c,p.taskId,s.path,last.protected);
      p.stop();
    }
  }
  resume(c) {
    if(this.state(c).status==='paused'&&[...this.running.keys()].some(key=>key.startsWith(c+':')))throw Error('当前进程正在停止，请在已停止后继续。');
    if (!this.state(c).branch) return;
    for (const t of this.state(c).tasks)
      if (
        ["running", "reviewing", "rate_wait", "interrupted"].includes(
          t.status,
        ) ||
        (t.status === "stopped" && t.failures < 3)
      )
        this.event(c, "task_update", {
          id: t.id,
          status:
            t.status === "rate_wait"
              ? t.resumeStatus
              : t.status === "reviewing"
                ? "review"
                : "repair",
        });
    this.event(c, "status", { status: "working" });
    this.wake(c);
    this.pump();
  }
}
