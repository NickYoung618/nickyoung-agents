import { Workflow } from "./workflow.mjs";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { execFileSync } from "node:child_process";
import { runModel, runProcess } from "./runner.mjs";
import { project, failureState } from "./store.mjs";
const id = () => randomUUID();
export class Engine {
  constructor(store, config, saveConfig, emit) {
    Object.assign(this, { store, config, saveConfig, emit });
    this.workflow = new Workflow(this);
    this.workflowPaths = new Set();
    this.running = new Map();
    this.waking = new Set();
    this.pending = new Set();
    this.busyProjects = new Set();
    this.teamTokens = new Map();
    this.retryTimers = new Map();
    this.memberTurns = new Set();
    this.memberQueue = [];
    for (const s of store.conversations()) {
      if (s.status === "working") {
        this.event(s.id, "status", { status: "interrupted" });
        this.event(s.id, "interrupted", {
          text: "服务重启，回合已中断，负责人将安排恢复。",
        });
      }
    }
  }
  state(c) {
    return project(this.store.events(c));
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
  async create(title, path, options = {}) {
    const workflowVersion = options.workflowVersion || "legacy";
    if (!["legacy", "adaptive_v1"].includes(workflowVersion)) throw Error("未知工作流版本");
    if (options.directPlan && workflowVersion !== "adaptive_v1") throw Error("direct 需要 adaptive_v1");
    const c = id();
    path = path ? resolve(path) : join(this.config.workspace, c);
    if (
      this.store
        .conversations()
        .some(
          (s) => s.path === path && !["done", "cancelled"].includes(s.status),
        )
    )
      throw new Error("这个目录已有对话，请在原对话继续。");
    const existed = existsSync(path);
    mkdirSync(path, { recursive: true });
    if (existed && !existsSync(join(path, ".git"))) {
      this.event(c, "created", {
        workflowVersion, directPlan: options.directPlan,
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
      workflowVersion, directPlan: options.directPlan,
      title: title.slice(0, 40),
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
  async message(c, text, files = [], { intent = "goal" } = {}) {
    const s = this.state(c);
    const attachments = [];
    for (const f of files) {
      const dir = join(s.path, ".nickyoung", "附件");
      mkdirSync(dir, { recursive: true });
      const path = join(dir, id() + "-" + basename(f.name));
      writeFileSync(path, Buffer.from(f.data, "base64"));
      attachments.push({ name: f.name, path });
    }
    this.event(c, "message", { member: "user", text, attachments });
    if (!s.branch) return;
    if (s.workflowVersion === "adaptive_v1") {
      if (intent === "status") return;
      if (!s.cycle || s.cycle.phase === "delivered") this.workflow.start(c, text);
      else {
        this.workflow.update(c, { goal: text, phase: "planning", generation: s.cycle.generation + 1 });
        for (const [key, proc] of this.running) if (key.startsWith(c + ":")) proc.stop();
      }
      this.event(c, "status", { status: "working" });
      if (s.directPlan && !s.cycle) {
        for (const member of s.directPlan.members || []) await this.action(c, { type: "recruit", ...member });
        this.workflow.submit(c, s.directPlan.plan, { direct: true }); this.pump();
      } else this.wake(c, { reason: s.cycle ? "goal_changed" : "new_goal" });
      return;
    }
    this.event(c, "status", { status: "working" });
    this.wake(c);
  }
  context(c) {
    const s = this.state(c);
    return JSON.stringify({
      project: s.path,
      members: s.members,
      tasks: s.tasks,
      events: s.events
        .filter((e) => !["process", "model_result"].includes(e.type))
        .slice(-80),
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
    { leader = false, cwd, readOnly = false, taskId, taskRole, cycleId = null, role, purpose, trigger, gateId, fresh = false } = {},
  ) {
    const queuedAt = Date.now();
    if (!leader && !this.memberTurns.has(c + ":" + member.id))
      this.event(c, "member", { id: member.id, status: "queued" });
    const releaseMember = leader
      ? () => {}
      : await this.memberSlot(c, member.id, taskId, taskRole);
    const s = this.state(c);
    member = s.members.find((m) => m.id === member.id) || member;
    const selection = leader ? s.leaderSelection || this.config.leader : member;
    const key = c + ":" + member.id;
    const started = Date.now();
    this.event(c, "member", { ...selection, id: member.id, status: "running" });
    const trace = { runId: id(), cycleId, taskId, gateId,
      role: role || (leader ? "planner" : taskRole === "reviewer" ? "reviewer" : "executor"),
      purpose: purpose || (leader ? "coordinate" : taskRole === "reviewer" ? "review" : "execute"),
      trigger: trigger || (leader ? "legacy_wake" : "legacy_task"),
      waitDuration: started - queuedAt };
    this.event(c, "run_start", { member: member.id, ...selection, ...trace });
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
      role,
      team:
        leader || selection.channel === "claude"
          ? {
              role: leader ? "leader" : "member",
              token,
              url: `https://127.0.0.1:${this.config.port}/internal/team`,
            }
          : undefined,
      session:
        !fresh && member.sessionChannel === selection.channel
          ? member.session
          : undefined,
      timeout: this.config.timeout,
      onEvent: (e) => this.event(c, "process", { member: member.id, runId: trace.runId, event: e }),
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
        ...trace,
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
          ...trace,
          member: member.id,
          model: selection.model,
          duration: Date.now() - started,
          signal: e.signal,
        });
        this.event(c, "member", { id: member.id, status: "interrupted" });
        throw e;
      }
      this.event(c, "run_failed", {
        ...trace,
        usage: e.events?.findLast(x => x.usage)?.usage,
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
  async wake(c, { reason = "new_goal", evidenceIds = [] } = {}) {
    if (this.state(c).status === "paused") return;
    if (this.waking.has(c)) {
      this.pending.add(c);
      return;
    }
    this.waking.add(c);
    try {
      let s = this.state(c);
      const adaptive = s.workflowVersion === "adaptive_v1";
      const generation = s.cycle?.generation;
      let r = await this.model(c, s.members[0], adaptive ? JSON.stringify({ project: s.path, goal: s.cycle?.goal, cycle: s.cycle, members: s.members.map(({session,...m})=>m), tiers: this.config.tiers, reason, evidenceIds }) : this.context(c), {
        leader: true, ...(adaptive ? { role: "planner", purpose: s.cycle?.planRevision ? "coordinate" : "plan", trigger: reason, cycleId: s.cycleId, fresh: true } : {}),
      });
      if (adaptive && generation !== this.state(c).cycle?.generation && this.state(c).cycle?.planRevision === s.cycle?.planRevision) return;
      if (adaptive) {
        for (const member of r.recruits || []) await this.action(c, { type: "recruit", ...member });
        if (r.plan) this.workflow.submit(c, r.plan);
      }
      if (this.state(c).status === "paused") return;
      for (const a of r.actions || []) {
        try {
          await this.action(c, a);
        } catch (e) {
          this.event(c, "error", { text: e.message, action: a.type });
          if (this.state(c).workflowVersion !== "adaptive_v1") this.pending.add(c);
        }
      }
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
      this.running.delete(key);
    }
  }
  async action(c, a) {
    const s = this.state(c);
    if (s.workflowVersion === "adaptive_v1") {
      if (a.type === "submit_plan") return this.workflow.submit(c, a.plan);
      if (a.type === "finish") return this.workflow.deliver(c);
      if (a.type === "assign") throw Error("adaptive 任务随 submit_plan 原子提交，只需 executorId");
      if (["retry","defer","resolve","discuss","experience","notice"].includes(a.type)) throw Error("adaptive 请通过计划修订处理此操作");
      if (["cancel","reassign"].includes(a.type)) {
        const task = s.tasks.find(t => t.id === a.task && t.cycleId === s.cycleId);
        if (!task) throw Error("未知批次任务");
        const member = a.type === "reassign" && s.members.find(m => m.id === a.member || m.name === a.member);
        if (a.type === "reassign" && (!member || member.id === "leader")) throw Error("改派需要执行者");
        this.workflow.update(c, { generation: s.cycle.generation + 1, phase: a.type === "cancel" ? "blocked" : "executing" });
        this.event(c, "task_update", { id: task.id, status: a.type === "cancel" ? "cancelled" : "queued", ...(member ? { member: member.id, executorId: member.id } : {}) });
        for (const [key, proc] of this.running) if (key.startsWith(c + ":") && proc.taskId === task.id) proc.stop();
        this.drainMembers(); return;
      }
      if (a.type === "ask") {
        this.event(c, "question", { id: id(), cycleId: s.cycleId, question: a.question, yes: a.yes, no: a.no, taskIds: a.taskIds || [], gateIds: a.gateIds || [] });
        for (const t of s.cycle.tasks.filter(t => a.taskIds?.includes(t.id) || a.taskIds?.includes(t.localId))) this.event(c, "task_update", { id: t.id, waitsForQuestions: [...t.waitsForQuestions, this.state(c).questions.at(-1).id] });
        return;
      }
    }
    switch (a.type) {
      case "recruit": {
        if (s.workflowVersion === "adaptive_v1" && s.members.some(m => m.name === a.name)) return;
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
        writeFileSync(join(s.path, ".nickyoung", "项目须知.md"), a.text);
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
        this.event(c, "report", { text: a.text });
        this.event(c, "status", { status: "done" });
        break;
      default:
        throw new Error("未知团队指令：" + a.type);
    }
  }
  pump() {
    let active = this.busyProjects.size;
    for (const s of this.store.conversations()) {
      if (
        s.status !== "working" ||
        this.busyProjects.has(s.id) ||
        this.waking.has(s.id) ||
        [...this.running.keys()].some(
          (k) => k.startsWith(s.id + ":") && !k.endsWith(":leader"),
        )
      )
        continue;
      if (active >= (this.config.concurrency || 2)) break;
      if (s.workflowVersion === "adaptive_v1") {
        if (this.workflowPaths.has(s.path) || !this.workflow.next(s)) continue;
        active++; this.busyProjects.add(s.id); this.workflowPaths.add(s.path);
        this.workflow.step(s.id).catch(e => { this.event(s.id, "error", { text: e.message }); this.workflow.block(s.id, e.message); }).finally(() => {
          this.busyProjects.delete(s.id); this.workflowPaths.delete(s.path); this.pump();
        });
        continue;
      }
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
  async task(c, t) {
    let s = this.state(c);
    const review = t.status === "review";
    this.event(c, "task_update", {
      id: t.id,
      status: review ? "reviewing" : "running",
    });
    let cwd = s.path,
      worktree;
    if (review) {
      worktree = join(this.config.data, "reviews", t.id + "-" + t.failures);
      mkdirSync(resolve(worktree, ".."), { recursive: true });
      this.git(s.path, ["worktree", "add", "--detach", worktree, t.commit]);
      cwd = worktree;
    }
    try {
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
          this.wake(c);
        }
      } else {
        this.git(cwd, ["add", "--all"]);
        this.git(cwd, ["commit", "--allow-empty", "-m", t.title]);
        let commit = this.git(cwd, ["rev-parse", "HEAD"]);
        this.event(c, "task_update", { id: t.id, commit });
        let ok = true;
        for (const cmd of t.commands) {
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
            this.running.delete(c + ":machine");
          }
          if (!ok) break;
        }
        if (ok && this.git(cwd, ["diff", "HEAD"])) {
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
    for (const s of this.store.conversations())
      if (s.status === "interrupted" && !this.settleIdle(s.id))
        this.resume(s.id);
  }
  shutdown() {
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    for (const s of this.store.conversations())
      if (s.status === "working") {
        this.event(s.id, "status", { status: "interrupted" });
        this.event(s.id, "interrupted", {
          text: "服务停止，本回合中断，重启后由负责人安排恢复。",
        });
      }
    for (const p of this.running.values()) p.stop();
    this.drainMembers();
  }
  pause(c) {
    if (this.state(c).workflowVersion === "adaptive_v1") this.workflow.pause(c);
    for (const [key, timer] of this.retryTimers)
      if (key.startsWith(c + ":")) {
        clearTimeout(timer);
        this.retryTimers.delete(key);
      }
    this.event(c, "status", { status: "paused" });
    this.drainMembers();
    for (const [k, p] of this.running) if (k.startsWith(c + ":")) p.stop();
  }
  resume(c) {
    if (!this.state(c).branch) return;
    if (this.state(c).workflowVersion === "adaptive_v1") return this.workflow.resume(c);
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
