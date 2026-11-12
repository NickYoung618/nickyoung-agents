import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  validatePlan,
  canRunTask,
  canDeliver,
  shouldWakePlanner,
} from "./workflow-policy.mjs";
import {
  fingerprint,
  inScope,
  checkFingerprint,
  reusableEvidence,
  unexpectedChanges,
  verificationEnvironment,
  executeCheck,
} from "./verification.mjs";
import { validateRoleResult } from "./contracts.mjs";
const id = () => randomUUID();
export class Workflow {
  constructor(engine) {
    this.e = engine;
  }
  state(c) {
    return this.e.state(c);
  }
  event(c, type, data) {
    return this.e.event(c, type, data);
  }
  update(c, patch) {
    const cycle = this.state(c).cycle;
    const event = this.event(c, "cycle_update", {
      cycleId: cycle.cycleId,
      ...patch,
    });
    if (patch.phase && patch.phase !== cycle.phase)
      this.event(c, "cycle_phase", {
        cycleId: cycle.cycleId,
        phase: patch.phase,
        reason: patch.blockedReason,
      });
    return event;
  }
  start(c, goal) {
    const cycleId = id();
    this.event(c, "cycle", {
      cycleId,
      goal,
      planRevision: 0,
      generation: 0,
      phase: "planning",
      tasks: [],
      gates: [],
      evidence: [],
      issues: [],
      repairs: {},
      replans: 0,
      rechecks: 0,
      policy: "final_review",
      budgets: {
        taskRepairs: 2,
        cycleRepairs: 6,
        replans: 1,
        rechecks: 1,
        ...this.e.config.workflowBudgets,
      },
    });
    return cycleId;
  }
  submit(c, input, { direct = false } = {}) {
    let s = this.state(c),
      cycle = s.cycle;
    const plan = validatePlan(input, s.members, { direct });
    const signature = fingerprint(plan);
    if (cycle?.planSignature === signature)
      return {
        cycleId: cycle.cycleId,
        planRevision: cycle.planRevision,
        reused: true,
      };
    if (!cycle || cycle.phase === "delivered") {
      this.start(c, plan.goal);
      s = this.state(c);
      cycle = s.cycle;
    }
    if (cycle.planRevision && cycle.replans >= cycle.budgets.replans)
      throw Error("批次重规划预算已达上限");
    const revision = cycle.planRevision + 1;
    const previous = cycle.tasks;
    // Stable IDs preserve repair budgets. Any changed plan invalidates formal evidence.
    for (const t of previous)
      if (!plan.tasks.some((x) => x.id === t.localId))
        this.event(c, "task_update", {
          id: t.id,
          status: "cancelled",
          generation: (t.generation || 0) + 1,
        });
    const ids = new Map(
      plan.tasks.map((t) => [
        t.id,
        previous.find((x) => x.localId === t.id)?.id ||
          `${cycle.cycleId}:${t.id}`,
      ]),
    );
    for (const t of plan.tasks) {
      const old = previous.find((x) => x.localId === t.id);
      const same = old && fingerprint(old.definition) === fingerprint(t);
      const data = {
        ...t,
        id: ids.get(t.id),
        localId: t.id,
        cycleId: cycle.cycleId,
        member: t.executorId,
        dispatcher: direct ? "system" : "leader",
        definition: t,
        dependsOn: t.dependsOn.map((x) => ids.get(x)),
        planRevision: revision,
        generation: (old?.generation || 0) + 1,
        status: same && old.status === "implemented" ? "implemented" : "queued",
        failures: old?.failures || 0,
      };
      this.event(c, old ? "task_update" : "task", data);
    }
    this.update(c, {
      goal: plan.goal,
      scope: plan.scope,
      conventions: plan.conventions,
      contractPaths: plan.contractPaths,
      criteria: plan.criteria,
      policy: plan.policy,
      reason: plan.reason,
      facts: plan.facts,
      planSignature: signature,
      planRevision: revision,
      generation: cycle.generation + 1,
      replans: cycle.replans + (cycle.planRevision ? 1 : 0),
      phase: "executing",
      gates: plan.gates.map((g) => ({
        ...g,
        afterTasks: g.afterTasks.map((x) => ids.get(x)),
        status: "pending",
        evidenceIds: [],
      })),
      issues: [],
      finalCommit: null,
      reviewedCommit: null,
    });
    return { cycleId: cycle.cycleId, planRevision: revision };
  }
  next(s) {
    const cycle = s.cycle;
    if (
      !cycle ||
      ["planning", "blocked", "delivered", "paused"].includes(cycle.phase)
    )
      return;
    if (
      cycle.issues?.some(
        (i) =>
          !i.closed &&
          i.kind === "needs_verification" &&
          !i.verificationAttempted,
      )
    )
      return {
        kind: "investigate",
        unit: cycle.issues.find(
          (i) =>
            !i.closed &&
            i.kind === "needs_verification" &&
            !i.verificationAttempted,
        ),
      };
    const task = cycle.tasks.find((t) => canRunTask(t, cycle, s.questions));
    // Ready checkpoints take priority over dependents; unrelated tasks can still run while a question blocks a gate.
    const gate = cycle.gates.find(
      (g) =>
        g.status === "pending" &&
        !s.questions.some((q) => !q.answered && q.gateIds?.includes(g.id)) &&
        (g.phase === "checkpoint"
          ? g.afterTasks.every((id) =>
              cycle.tasks.some(
                (t) => t.id === id && t.status === "implemented",
              ),
            )
          : cycle.tasks.every((t) => t.status === "implemented")) &&
        (g.kind === "check" ||
          cycle.gates
            .filter(
              (x) =>
                x.kind === "check" &&
                (g.phase !== "checkpoint" || x.phase === "checkpoint"),
            )
            .every((x) => ["passed", "reused"].includes(x.status))),
    );
    if (gate?.phase === "checkpoint") return { kind: "gate", unit: gate };
    if (task) return { kind: "task", unit: task };
    if (gate) return { kind: "gate", unit: gate };
    if (canDeliver(cycle, s.questions)) return { kind: "deliver" };
  }
  valid(c, token) {
    const s = this.state(c),
      cycle = s.cycle;
    return (
      s.status === "working" &&
      cycle?.cycleId === token.cycleId &&
      cycle.planRevision === token.planRevision &&
      cycle.generation === token.generation &&
      (token.kind !== "task" ||
        cycle.tasks.some(
          (t) =>
            t.id === token.unitId &&
            t.activeToken === token.scheduleId &&
            t.status === "running",
        )) &&
      (token.kind !== "gate" ||
        cycle.gates.some(
          (g) =>
            g.id === token.unitId &&
            g.activeToken === token.scheduleId &&
            g.status === "running",
        ))
    );
  }
  gate(c, gateId, patch) {
    this.update(c, {
      gates: this.state(c).cycle.gates.map((g) =>
        g.id === gateId ? { ...g, ...patch } : g,
      ),
    });
  }
  async step(c) {
    let s = this.state(c);
    if (s.cycle && s.status === "working") {
      const environment = fingerprint(verificationEnvironment(this.e.config));
      const stale = s.cycle.gates.filter(
        (g) =>
          g.kind === "check" &&
          ["passed", "reused"].includes(g.status) &&
          !s.cycle.evidence.some(
            (e) =>
              g.evidenceIds.includes(e.evidenceId) &&
              fingerprint(e.environment) === environment,
          ),
      );
      if (stale.length) {
        this.event(c, "evidence_invalidated", {
          cycleId: s.cycleId,
          reason: "environment_changed",
          gateIds: stale.map((g) => g.id),
        });
        this.update(c, {
          gates: s.cycle.gates.map((g) =>
            stale.some((x) => x.id === g.id) || g.kind === "model"
              ? { ...g, status: "pending" }
              : g,
          ),
        });
        s = this.state(c);
      }
    }
    const work = this.next(s);
    if (!work) return;
    if (work.kind === "deliver") return this.deliver(c);
    const cycle = s.cycle,
      unit = work.unit;
    const attempt =
      s.events.filter(
        (e) =>
          e.type === "workflow_start" &&
          e.data.cycleId === cycle.cycleId &&
          e.data.unitId === unit.id,
      ).length + 1;
    const token = {
      cycleId: cycle.cycleId,
      planRevision: cycle.planRevision,
      generation: cycle.generation,
      kind: work.kind,
      unitId: unit.id,
      attempt,
      scheduleId: fingerprint([
        cycle.cycleId,
        cycle.planRevision,
        unit.id,
        work.kind,
        unit.status,
        cycle.finalCommit,
        attempt,
      ]),
    };
    this.event(c, "workflow_start", token);
    if (work.kind === "task")
      this.event(c, "task_update", {
        id: unit.id,
        status: "running",
        activeToken: token.scheduleId,
      });
    else if (work.kind === "gate")
      this.gate(c, unit.id, {
        status: "running",
        activeToken: token.scheduleId,
      });
    try {
      if (work.kind === "task") await this.execute(c, unit, token);
      else if (work.kind === "investigate")
        await this.investigate(c, unit, token);
      else await this.verify(c, unit, token);
    } catch (error) {
      this.event(c, "workflow_failure", {
        ...token,
        error: error.message,
        category: error.retryAt
          ? "rate_limit"
          : error.signal
            ? "interrupted"
            : "environment_or_protocol",
      });
      if (!this.valid(c, token)) return;
      if (error.retryAt) {
        if (work.kind === "task")
          this.event(c, "task_update", {
            id: unit.id,
            status: "rate_wait",
            resumeStatus: unit.status,
          });
        else this.gate(c, unit.id, { status: "rate_wait" });
        this.e.retry(c, unit.id, error.retryAt, () => {
          if (work.kind === "task")
            this.event(c, "task_update", { id: unit.id, status: unit.status });
          else this.gate(c, unit.id, { status: "pending" });
          this.e.pump();
        });
      } else
        this.block(c, "运行环境或协议失败，请修复后继续。", [token.scheduleId]);
    }
  }
  block(c, reason, evidenceIds = []) {
    this.update(c, { phase: "blocked", blockedReason: reason });
    this.event(c, "workflow_blocked", {
      cycleId: this.state(c).cycleId,
      reason,
      evidenceIds,
    });
  }
  async escalate(c, reason, evidenceIds) {
    this.block(c, reason, evidenceIds);
    if (shouldWakePlanner(reason, evidenceIds)) {
      const cycle = this.state(c).cycle;
      if (cycle.replans >= cycle.budgets.replans) return;
      this.event(c, "planner_trigger", {
        cycleId: cycle.cycleId,
        reason,
        evidenceIds,
      });
      await this.e.wake(c, { reason, evidenceIds });
    }
  }
  context(c, role, unit) {
    const s = this.state(c),
      x = s.cycle;
    const common = {
      role,
      project: s.path,
      cycleId: x.cycleId,
      goal: x.goal,
      planRevision: x.planRevision,
      criteria: x.criteria,
      conventions: x.conventions,
    };
    if (role === "executor")
      return {
        ...common,
        task: unit,
        issues: x.issues.filter((i) => i.taskId === unit.id && !i.closed),
        dependencies: unit.dependsOn
          .map((id) => x.tasks.find((t) => t.id === id))
          .map((t) => ({ id: t.id, summary: t.summary, commit: t.commit })),
        answers: s.questions.filter((q) =>
          unit.waitsForQuestions?.includes(q.id),
        ),
        eventReferences: s.events
          .filter(
            (e) =>
              e.data.cycleId === x.cycleId &&
              ["check", "workflow_blocked"].includes(e.type),
          )
          .slice(-5)
          .map((e) => ({
            eventId: e.id,
            type: e.type,
            output: e.data.output?.slice(-3000),
          })),
      };
    return {
      ...common,
      gate: unit,
      reviewedCommit: x.finalCommit,
      tasks: x.tasks.map((t) => ({
        id: t.id,
        title: t.title,
        summary: t.summary,
        scope: t.scope,
        commit: t.commit,
      })),
      checks: x.evidence.filter((e) => e.commit === x.finalCommit),
      issues: x.issues,
      previousReviewedCommit: x.reviewedCommit,
    };
  }
  async execute(c, task, token) {
    const s = this.state(c),
      before = this.e.git(s.path, ["rev-parse", "HEAD"]);
    const member = s.members.find((m) => m.id === task.member);
    const result = await this.e.model(
      c,
      member,
      JSON.stringify(this.context(c, "executor", task)),
      {
        role: "executor",
        purpose: task.status === "repair" ? "repair" : "execute",
        trigger:
          task.status === "repair" ? "blocking_issue" : "dependency_ready",
        cycleId: token.cycleId,
        scheduleId: token.scheduleId,
        taskId: task.id,
        taskRole: "member",
        fresh: true,
      },
    );
    if (!this.valid(c, token)) {
      this.event(c, "workflow_stale_result", token);
      return;
    }
    validateRoleResult("executor", result);
    if (result.completion !== "complete") {
      this.event(c, "task_update", {
        id: task.id,
        status: "blocked",
        advice: result.blockers,
      });
      await this.escalate(c, "contract_invalid", [token.scheduleId]);
      return;
    }
    this.e.git(s.path, ["add", "--all"]);
    this.e.git(s.path, ["commit", "--allow-empty", "-m", task.title]);
    const commit = this.e.git(s.path, ["rev-parse", "HEAD"]),
      files = this.e
        .git(s.path, ["diff", "--name-only", before, commit])
        .split("\n")
        .filter(Boolean);
    this.event(c, "task_update", {
      id: task.id,
      status: "implemented",
      commit,
      summary: result.summary,
      files,
      selfTests: result.selfTests,
      handoff: result.handoff,
    });
    if (
      files.some((f) => !inScope(f, task.scope) || !inScope(f, s.cycle.scope))
    ) {
      await this.escalate(c, "scope_expanded", [token.scheduleId]);
      return;
    }
    const repairing = task.status === "repair";
    this.update(c, {
      finalCommit: commit,
      phase: repairing ? "repairing" : "executing",
      gates: this.state(c).cycle.gates.map((g) =>
        g.phase === "checkpoint" &&
        ["passed", "reused"].includes(g.status) &&
        files.some((f) => inScope(f, g.scope))
          ? { ...g, status: "pending" }
          : g,
      ),
    });
    if (repairing) {
      const x = this.state(c).cycle;
      if (files.some((f) => inScope(f, x.contractPaths || []))) {
        await this.escalate(c, "contract_invalid", [token.scheduleId]);
        return;
      }
      const impacted = x.issues.filter(
        (i) => i.taskId === task.id && !i.closed,
      );
      this.update(c, {
        gates: x.gates.map((g) =>
          g.kind === "check" && g.phase !== "checkpoint"
            ? { ...g, status: "pending", commit: null }
            : g,
        ),
        issues: x.issues.map((i) =>
          impacted.includes(i) ? { ...i, patchCommit: commit } : i,
        ),
      });
      if (impacted.some((i) => i.semantic))
        this.requestRecheck(c, impacted, commit);
    }
    this.event(c, "workflow_complete", { ...token, commit });
  }
  async worktree(c, commit, fn) {
    const s = this.state(c),
      path = join(this.e.config.data, "validation", id());
    mkdirSync(join(this.e.config.data, "validation"), { recursive: true });
    this.e.git(s.path, ["worktree", "add", "--detach", path, commit]);
    try {
      return await fn(path);
    } finally {
      this.e.git(s.path, ["worktree", "remove", "--force", path]);
    }
  }
  async verify(c, gate, token) {
    const s = this.state(c),
      cycle = s.cycle;
    let commit = cycle.finalCommit || this.e.git(s.path, ["rev-parse", "HEAD"]);
    if (this.e.git(s.path, ["status", "--porcelain"])) {
      await this.escalate(c, "ambiguous_recovery", [token.scheduleId]);
      return;
    }
    this.update(c, {
      phase: gate.kind === "check" ? "validating" : "reviewing",
      finalCommit: commit,
    });
    if (gate.kind === "model") return this.review(c, gate, token, commit);
    const tree = this.e.git(s.path, ["rev-parse", `${commit}^{tree}`]);
    const environment = verificationEnvironment(this.e.config),
      fp = checkFingerprint({
        commit,
        tree,
        gate,
        planRevision: cycle.planRevision,
        criteria: cycle.criteria,
        environment,
      });
    const old = reusableEvidence(cycle.evidence, fp, gate);
    const started = new Date().toISOString();
    let result;
    if (old) result = { exitCode: 0, output: "复用正式证据 " + old.evidenceId };
    else
      result = await this.worktree(c, commit, async (path) => {
        const r = await executeCheck(this.e, c, path, gate, token);
        const changes = unexpectedChanges(
          this.e.git.bind(this.e),
          path,
          gate.outputs,
        );
        return {
          ...r,
          ...(changes.length
            ? {
                exitCode: 1,
                output:
                  r.output +
                  "\n验证修改了源码或未声明文件: " +
                  changes.join(","),
              }
            : {}),
        };
      });
    if (!this.valid(c, token)) {
      this.event(c, "workflow_stale_result", token);
      return;
    }
    if (result.interrupted) {
      this.block(c, "检查被中断", [token.scheduleId]);
      return;
    }
    if (
      this.e.git(s.path, ["rev-parse", "HEAD"]) !== commit ||
      this.e.git(s.path, ["status", "--porcelain"])
    ) {
      await this.escalate(c, "ambiguous_recovery", [token.scheduleId]);
      return;
    }
    const evidence = {
      evidenceId: id(),
      cycleId: cycle.cycleId,
      planRevision: cycle.planRevision,
      checkId: gate.id,
      commit,
      tree,
      fingerprint: fp,
      commandSpecHash: fingerprint(gate),
      environment,
      source: old ? "reused" : "executed",
      reusedFrom: old?.evidenceId,
      result: result.exitCode === 0 ? "passed" : "failed",
      exitCode: result.exitCode,
      output: result.output,
      started,
      ended: new Date().toISOString(),
    };
    this.event(c, "check", {
      ...evidence,
      ...token,
      passed: result.exitCode === 0,
      command: gate.commands.join("\n"),
    });
    this.update(c, { evidence: [...this.state(c).cycle.evidence, evidence] });
    this.gate(c, gate.id, {
      status: result.exitCode === 0 ? (old ? "reused" : "passed") : "failed",
      commit,
      planRevision: cycle.planRevision,
      evidenceIds: [evidence.evidenceId],
    });
    if (result.exitCode !== 0) {
      if (
        /cannot find|not found|ENOENT|module_not_found|permission denied|ECONN|ENOTFOUND|429/i.test(
          result.output,
        )
      ) {
        this.event(c, "environment_diagnostic", {
          cycleId: cycle.cycleId,
          checkId: gate.id,
          evidenceId: evidence.evidenceId,
          environment,
          reason: result.output.slice(-2000),
        });
        this.block(c, "检查环境缺失或外部服务失败，请查看正式输出", [
          evidence.evidenceId,
        ]);
        return;
      }
      const task = cycle.tasks.filter((t) => t.status === "implemented").at(-1);
      if (task) {
        const issue = {
          issueId: `check:${gate.id}`,
          taskId: task.id,
          criterionId: gate.criteriaIds[0],
          location: task.files?.[0] || task.scope[0],
          evidence: result.output,
          expected: "正式检查成功",
          checkIds: [gate.id],
          semantic: false,
          kind: "blocking",
          closed: false,
        };
        const x = this.state(c).cycle;
        const prior = x.failureProgress?.findLast((f) => f.checkId === gate.id);
        const progress = {
          checkId: gate.id,
          tree,
          commands: fingerprint(gate.commands),
          error: result.output.replace(/\/tmp\/[^\s:]+/g, "<tmp>").slice(-3000),
        };
        this.update(c, {
          failureProgress: [...(x.failureProgress || []), progress],
          issues: [
            ...x.issues.filter((i) => i.issueId !== issue.issueId),
            issue,
          ],
        });
        if (prior && fingerprint(prior) === fingerprint(progress)) {
          await this.escalate(c, "no_progress", [evidence.evidenceId]);
          return;
        }
        this.queueRepair(c, [issue], [evidence.evidenceId]);
      } else this.block(c, "正式检查失败", [evidence.evidenceId]);
      return;
    }
    this.closeCheckedIssues(c);
    this.event(c, "workflow_complete", {
      ...token,
      commit,
      evidenceId: evidence.evidenceId,
    });
  }
  async review(c, gate, token, commit) {
    const s = this.state(c),
      member = s.members.find((m) => m.id === gate.reviewerId);
    this.event(c, "cycle_review_start", {
      ...token,
      gateId: gate.id,
      from: s.cycle.tasks.at(-1)?.member,
      to: member.id,
      commit,
    });
    const result = await this.worktree(c, commit, async (path) => {
      const r = await this.e.model(
        c,
        member,
        JSON.stringify(this.context(c, "reviewer", gate)),
        {
          role: "reviewer",
          readOnly: true,
          cwd: path,
          fresh: true,
          cycleId: token.cycleId,
          scheduleId: token.scheduleId,
          gateId: gate.id,
          purpose: gate.phase === "recheck" ? "recheck" : "review",
          trigger:
            gate.phase === "checkpoint"
              ? "checkpoint_assumption"
              : "formal_checks_passed",
        },
      );
      if (unexpectedChanges(this.e.git.bind(this.e), path, []).length)
        throw Error("只读审查修改了快照");
      return r;
    });
    if (!this.valid(c, token)) {
      this.event(c, "workflow_stale_result", token);
      return;
    }
    validateRoleResult("reviewer", result);
    if (
      result.reviewedCommit !== commit ||
      gate.criteriaIds.some((id) => !result.criteriaIds.includes(id))
    )
      throw Error("审查未覆盖固定提交或验收标准");
    this.event(c, "cycle_review", {
      ...token,
      gateId: gate.id,
      reviewer: member.id,
      commit,
      ...result,
    });
    this.update(c, {
      ...(gate.phase === "final" && !s.cycle.reviewedCommit
        ? { reviewedCommit: commit }
        : {}),
      advisories: result.advisories,
    });
    for (const issue of [
      ...result.blockingIssues,
      ...result.needsVerification,
    ]) {
      if (
        !s.cycle.tasks.some((t) => t.id === issue.taskId) ||
        !s.cycle.criteria.some((x) => x.id === issue.criterionId) ||
        !issue.issueId ||
        !issue.location ||
        !issue.evidence ||
        !issue.expected ||
        issue.checkIds.some(
          (id) => !s.cycle.gates.some((g) => g.id === id && g.kind === "check"),
        )
      )
        throw Error("审查问题缺少有效位置、标准、证据或检查定义");
    }
    if (result.blockingIssues.length || result.needsVerification.length) {
      const issues = [
        ...result.blockingIssues.map((i) => ({
          ...i,
          kind: "blocking",
          closed: false,
        })),
        ...result.needsVerification.map((i) => ({
          ...i,
          kind: "needs_verification",
          closed: false,
        })),
      ];
      const seen = new Set();
      if (issues.some((i) => seen.has(i.issueId) || !seen.add(i.issueId)))
        throw Error("审查 issueId 重复");
      this.gate(c, gate.id, {
        status: "changes_requested",
        commit,
        reviewedCommit: commit,
        reviewEvidence: result,
        planRevision: token.planRevision,
      });
      this.update(c, {
        phase: "repairing",
        issues: [...s.cycle.issues.filter((i) => i.closed), ...issues],
      });
      if (result.blockingIssues.length)
        this.queueRepair(
          c,
          issues.filter((i) => i.kind === "blocking"),
          [token.scheduleId],
        );
      return;
    }
    this.gate(c, gate.id, {
      status: "passed",
      commit,
      planRevision: token.planRevision,
      reviewedCommit: commit,
      reviewEvidence: result,
      coverage: gate.phase === "recheck" ? "scoped_recheck" : "full",
    });
    if (gate.phase === "recheck") {
      this.update(c, {
        issues: this.state(c).cycle.issues.map((i) =>
          gate.issueIds?.includes(i.issueId)
            ? {
                ...i,
                closed: true,
                closedBy: "scoped_recheck",
                closedCommit: commit,
              }
            : i,
        ),
      });
      this.closeCheckedIssues(c);
    }
    this.event(c, "workflow_complete", { ...token, commit });
  }
  queueRepair(c, issues, evidenceIds) {
    const x = this.state(c).cycle;
    const tasks = [...new Set(issues.map((i) => i.taskId))];
    const total = Object.values(x.repairs).reduce((n, v) => n + v, 0);
    if (
      total + tasks.length > x.budgets.cycleRepairs ||
      tasks.some((id) => (x.repairs[id] || 0) >= x.budgets.taskRepairs)
    ) {
      this.block(c, "自动局部修复预算已达上限，保留成果与证据", evidenceIds);
      return;
    }
    this.update(c, {
      phase: "repairing",
      repairs: {
        ...x.repairs,
        ...Object.fromEntries(
          tasks.map((id) => [id, (x.repairs[id] || 0) + 1]),
        ),
      },
    });
    for (const taskId of tasks) {
      this.event(c, "task_update", {
        id: taskId,
        status: "repair",
        failures: (x.tasks.find((t) => t.id === taskId).failures || 0) + 1,
        advice: issues.filter((i) => i.taskId === taskId),
      });
      this.event(c, "cycle_repair", {
        cycleId: x.cycleId,
        task: taskId,
        from: x.gates.find((g) => g.kind === "model")?.reviewerId,
        to: x.tasks.find((t) => t.id === taskId).member,
        issueIds: issues
          .filter((i) => i.taskId === taskId)
          .map((i) => i.issueId),
        evidenceIds,
      });
    }
  }
  requestRecheck(c, issues, commit) {
    const x = this.state(c).cycle;
    if (x.rechecks >= x.budgets.rechecks) {
      this.block(
        c,
        "范围复查预算已达上限",
        issues.map((i) => i.issueId),
      );
      return;
    }
    const review = x.gates.find(
      (g) => g.kind === "model" && g.phase === "final",
    );
    if (!review) {
      this.block(
        c,
        "语义问题需要独立审查者",
        issues.map((i) => i.issueId),
      );
      return;
    }
    const recheck = {
      ...review,
      id: "recheck:" + id(),
      phase: "recheck",
      status: "pending",
      commit,
      issueIds: issues.map((i) => i.issueId),
      scope: [...new Set(issues.map((i) => i.location.split(":")[0]))],
      criteriaIds: [...new Set(issues.map((i) => i.criterionId))],
      evidenceIds: [],
    };
    this.update(c, {
      rechecks: x.rechecks + 1,
      gates: [...x.gates, recheck],
      phase: "repairing",
    });
  }
  closeCheckedIssues(c) {
    const x = this.state(c).cycle;
    const issues = x.issues.map((i) =>
      !i.closed &&
      i.patchCommit === x.finalCommit &&
      !i.semantic &&
      i.checkIds.length &&
      i.checkIds.every((id) =>
        x.gates.some(
          (g) =>
            g.id === id &&
            ["passed", "reused"].includes(g.status) &&
            g.commit === x.finalCommit,
        ),
      )
        ? { ...i, closed: true, closedBy: "check", closedCommit: x.finalCommit }
        : i,
    );
    const unresolved = issues.some((i) => !i.closed);
    this.update(c, {
      issues,
      ...(!unresolved
        ? {
            gates: x.gates.map((g) =>
              g.kind === "model" && g.status === "changes_requested"
                ? {
                    ...g,
                    status: "passed",
                    commit: x.finalCommit,
                    coverage: "reviewed_plus_checked_patch",
                    patchEvidenceIds: x.evidence
                      .filter(
                        (e) =>
                          e.commit === x.finalCommit && e.result === "passed",
                      )
                      .map((e) => e.evidenceId),
                  }
                : g,
            ),
          }
        : {}),
    });
  }
  async investigate(c, issue, token) {
    this.update(c, {
      issues: this.state(c).cycle.issues.map((i) =>
        i.issueId === issue.issueId ? { ...i, verificationAttempted: true } : i,
      ),
    });
    if (issue.semantic || !issue.checkIds.length) {
      this.requestRecheck(c, [issue], this.state(c).cycle.finalCommit);
      return;
    }
    const x = this.state(c).cycle;
    let failed = false;
    for (const checkId of issue.checkIds) {
      const gate = x.gates.find((g) => g.id === checkId);
      const evidence = x.evidence.findLast(
        (e) => e.checkId === checkId && e.commit === x.finalCommit,
      );
      // Existing matching formal evidence answers the specified verification question.
      if (!evidence || evidence.result !== "passed") failed = true;
      this.event(c, "issue_verification", {
        cycleId: x.cycleId,
        issueId: issue.issueId,
        checkId,
        evidenceId: evidence?.evidenceId,
        result: evidence?.result || "unknown",
      });
    }
    if (!this.valid(c, token)) return;
    if (failed) {
      const confirmed = { ...issue, kind: "blocking" };
      this.update(c, {
        issues: this.state(c).cycle.issues.map((i) =>
          i.issueId === issue.issueId ? confirmed : i,
        ),
      });
      this.queueRepair(c, [confirmed], [token.scheduleId]);
    } else {
      this.update(c, {
        issues: this.state(c).cycle.issues.map((i) =>
          i.issueId === issue.issueId
            ? {
                ...i,
                closed: true,
                closedBy: "verification",
                closedCommit: x.finalCommit,
              }
            : i,
        ),
      });
      this.closeCheckedIssues(c);
    }
  }
  deliver(c) {
    const s = this.state(c),
      x = s.cycle;
    if (x?.phase === "delivered") return x.delivery;
    if (!canDeliver(x, s.questions)) throw Error("批次尚未满足交付条件");
    const environment = verificationEnvironment(this.e.config);
    const stale = x.gates.filter(
      (g) =>
        g.kind === "check" &&
        g.phase === "final" &&
        !x.evidence.some(
          (e) =>
            g.evidenceIds.includes(e.evidenceId) &&
            fingerprint(e.environment) === fingerprint(environment),
        ),
    );
    if (stale.length) {
      this.update(c, {
        phase: "validating",
        gates: x.gates.map((g) =>
          stale.some((v) => v.id === g.id) || g.kind === "model"
            ? { ...g, status: "pending" }
            : g,
        ),
      });
      return;
    }
    if (
      this.e.git(s.path, ["rev-parse", "HEAD"]) !== x.finalCommit ||
      this.e.git(s.path, ["status", "--porcelain"])
    )
      throw Error("交付快照已变化");
    const text = [
      x.goal,
      ...x.tasks.map((t) => `- ${t.title}：${t.summary}`),
      `最终提交：${x.finalCommit}`,
      `检查：${x.gates
        .filter((g) => g.kind === "check")
        .map((g) => g.id + " " + g.status)
        .join("；")}`,
      x.policy === "checks_only"
        ? "按策略无需模型审查"
        : `独立审查提交：${x.reviewedCommit}`,
      x.tasks
        .map((t) => t.handoff)
        .filter(Boolean)
        .join("\n"),
    ].join("\n");
    const delivery = {
      cycleId: x.cycleId,
      finalCommit: x.finalCommit,
      reviewedCommit: x.reviewedCommit,
      policy: x.policy,
      checks: x.evidence,
      reviewCoverage: x.gates.filter((g) => g.kind === "model"),
      unresolvedIssues: x.issues.filter((i) => !i.closed),
      tasks: x.tasks,
      usage: x.tasks
        .map((t) => t.handoff)
        .filter(Boolean)
        .join("\n"),
    };
    this.update(c, { phase: "delivered", delivery });
    this.event(c, "report", { text, ...delivery });
    this.event(c, "status", { status: "done" });
    return delivery;
  }
  resume(c) {
    const s = this.state(c),
      x = s.cycle;
    if (!x) return;
    if (x.phase === "delivered") return;
    if (x.phase === "blocked" && !x.blockedReason?.includes("环境")) return;
    this.update(c, {
      generation: x.generation + 1,
      gates: x.gates.map((g) =>
        [
          "running",
          "rate_wait",
          ...(x.blockedReason?.includes("环境") ? ["failed"] : []),
        ].includes(g.status)
          ? { ...g, status: "pending" }
          : g,
      ),
      phase: x.resumePhase || (x.phase === "blocked" ? "executing" : x.phase),
    });
    this.event(c, "status", { status: "working" });
    if (x.tasks.some((t) => t.status === "running")) {
      this.escalate(
        c,
        "ambiguous_recovery",
        s.events
          .filter((e) => e.type === "workflow_start")
          .slice(-1)
          .map((e) => String(e.id)),
      );
      return;
    }
    for (const task of x.tasks.filter((t) => t.status === "rate_wait"))
      this.event(c, "task_update", {
        id: task.id,
        status: task.resumeStatus || "queued",
      });
    this.e.pump();
  }
  pause(c) {
    const x = this.state(c).cycle;
    if (x)
      this.update(c, {
        generation: x.generation + 1,
        resumePhase: x.phase,
        phase: "paused",
      });
  }
}
