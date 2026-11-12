export const policies = [
  "checks_only",
  "final_review",
  "checkpoint_plus_final",
];
export function selectPolicy(plan) {
  if (!policies.includes(plan.policy)) throw Error("未知验证策略");
  if (
    plan.policy === "checks_only" &&
    (!plan.facts?.length || !plan.reason?.trim() || !plan.scope?.length)
  )
    return "final_review";
  return plan.policy;
}
export function shouldWakePlanner(reason, evidenceIds = []) {
  return (
    ["new_goal", "goal_changed"].includes(reason) ||
    ([
      "contract_invalid",
      "scope_expanded",
      "no_progress",
      "cross_task_conflict",
      "ambiguous_recovery",
    ].includes(reason) &&
      evidenceIds.length > 0)
  );
}
export function canRunTask(task, cycle, questions = []) {
  return (
    ["queued", "repair"].includes(task.status) &&
    (task.dependsOn || []).every((id) =>
      cycle.tasks.some((t) => t.id === id && t.status === "implemented"),
    ) &&
    (task.gateIds || []).every((id) =>
      cycle.gates.some(
        (g) => g.id === id && ["passed", "reused"].includes(g.status),
      ),
    ) &&
    !(task.waitsForQuestions || []).some((id) =>
      questions.some(
        (q) =>
          q.id === id &&
          (!q.answered || (q.authorization && q.answer !== true)),
      ),
    )
  );
}
export function canDeliver(cycle, questions = []) {
  if (
    !cycle ||
    !cycle.tasks.length ||
    !cycle.finalCommit ||
    cycle.phase === "planning" ||
    cycle.phase === "blocked"
  )
    return false;
  return (
    cycle.tasks.every((t) => t.status === "implemented") &&
    cycle.gates.every((g) =>
      ["passed", "reused", "not_required"].includes(g.status),
    ) &&
    cycle.gates
      .filter((g) => g.kind === "check")
      .every((g) =>
        cycle.evidence?.some(
          (e) =>
            g.evidenceIds?.includes(e.evidenceId) &&
            ["executed", "reused"].includes(e.source) &&
            e.result === "passed" &&
            e.checkId === g.id &&
            e.commit === g.commit &&
            e.planRevision === cycle.planRevision,
        ),
      ) &&
    cycle.gates
      .filter((g) => g.kind === "model")
      .every((g) => g.reviewEvidence) &&
    cycle.gates
      .filter((g) => g.phase === "final")
      .every(
        (g) =>
          g.commit === cycle.finalCommit &&
          g.planRevision === cycle.planRevision,
      ) &&
    !(cycle.issues || []).some((i) => !i.closed) &&
    !questions.some(
      (q) =>
        (!q.answered ||
          (q.authorization && q.answer !== true && q.status !== "withdrawn")) &&
        (!q.cycleId || q.cycleId === cycle.cycleId),
    )
  );
}
export function validatePlan(input, members, { direct = false } = {}) {
  const plan = structuredClone(input);
  if (
    !plan ||
    !Array.isArray(plan.contractPaths) ||
    !plan.goal?.trim() ||
    !plan.tasks?.length ||
    !plan.criteria?.length ||
    !plan.scope?.length
  )
    throw Error("计划缺少目标、范围、任务或验收标准");
  plan.policy = selectPolicy(plan);
  const findMember = (ref) =>
    members.find((m) => m.id === ref || m.name === ref);
  for (const t of plan.tasks) {
    const m = findMember(t.executorId);
    if (!m || m.id === "leader") throw Error("任务需要合法执行者");
    t.executorId = m.id;
    for (const k of ["dependsOn", "gateIds", "waitsForQuestions", "scope"])
      if (!Array.isArray(t[k])) throw Error(`任务缺少 ${k}`);
    if (!t.scope.length) throw Error("任务需要范围");
  }
  const unique = (rows, label) => {
    const ids = rows.map((x) => x.id);
    if (ids.some((x) => !x) || new Set(ids).size !== ids.length)
      throw Error(`${label} id 重复或为空`);
    return new Set(ids);
  };
  const tasks = unique(plan.tasks, "任务"),
    gates = unique(plan.gates, "检查"),
    criteria = unique(plan.criteria, "标准");
  const graph = new Map();
  for (const t of plan.tasks) {
    if (
      t.dependsOn.some((x) => !tasks.has(x)) ||
      t.gateIds.some((x) => !gates.has(x))
    )
      throw Error("依赖不存在");
    graph.set("t:" + t.id, [
      ...t.dependsOn.map((x) => "t:" + x),
      ...t.gateIds.map((x) => "g:" + x),
    ]);
  }
  for (const g of plan.gates) {
    if (
      !["check", "model"].includes(g.kind) ||
      !["checkpoint", "final", "recheck"].includes(g.phase) ||
      !g.scope?.length ||
      !g.criteriaIds?.length ||
      g.criteriaIds.some((x) => !criteria.has(x)) ||
      g.afterTasks.some((x) => !tasks.has(x))
    )
      throw Error("检查范围或引用无效");
    if (
      g.phase === "checkpoint" &&
      (!g.assumption?.trim() ||
        !plan.tasks.some((t) => t.gateIds.includes(g.id)))
    )
      throw Error("检查点必须有假设与受影响任务");
    if (g.kind === "check" && !g.commands?.length) throw Error("检查缺少命令");
    if (g.kind === "model") {
      const m = findMember(g.reviewerId);
      if (
        !m ||
        m.id === "leader" ||
        plan.tasks.some((t) => t.executorId === m.id)
      )
        throw Error("需要独立审查者");
      g.reviewerId = m.id;
    }
    graph.set(
      "g:" + g.id,
      g.afterTasks.map((x) => "t:" + x),
    );
  }
  const done = new Set(),
    visiting = new Set();
  function visit(id) {
    if (visiting.has(id)) throw Error("计划依赖有环");
    if (done.has(id)) return;
    visiting.add(id);
    for (const dep of graph.get(id) || []) visit(dep);
    visiting.delete(id);
    done.add(id);
  }
  for (const id of graph.keys()) visit(id);
  if (
    !plan.gates.some((g) => g.kind === "check" && g.phase === "final") ||
    [...criteria].some(
      (id) =>
        !plan.gates.some(
          (g) =>
            g.kind === "check" &&
            g.phase === "final" &&
            g.criteriaIds.includes(id),
        ),
    )
  )
    throw Error("必需标准缺少正式检查覆盖");
  if (
    plan.policy !== "checks_only" &&
    [...criteria].some(
      (id) =>
        !plan.gates.some(
          (g) =>
            g.kind === "model" &&
            g.phase === "final" &&
            g.criteriaIds.includes(id),
        ),
    )
  )
    throw Error("缺少整体独立审查覆盖");
  if (
    plan.policy === "checks_only" &&
    plan.gates.some((g) => g.kind === "model")
  )
    throw Error("免审策略不能包含模型审查");
  if (
    plan.policy === "checkpoint_plus_final" &&
    !plan.gates.some((g) => g.phase === "checkpoint")
  )
    throw Error("缺少检查点");
  if (direct && (plan.policy !== "checks_only" || !plan.facts.length))
    throw Error("direct 需要完整边界和免审依据");
  return plan;
}
