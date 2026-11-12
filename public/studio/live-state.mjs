export function blankState(id) {
  return {
    id,
    workflowVersion: "legacy",
    cycles: [],
    members: [],
    tasks: [],
    questions: [],
    artifacts: [],
    preview: { status: "unavailable", reason: "尚无已登记的静态产物" },
    events: [],
    status: "idle",
  };
}
export function applyStateEvent(s, e, { append = true } = {}) {
  if (append && e.id !== undefined && s.events.at(-1)?.id >= e.id) return false;
  if (append) s.events.push(e);
  const d = structuredClone(e.data);
  if (["created", "project_update"].includes(e.type)) Object.assign(s, d);
  if (e.type === "cycle") {
    if (!s.cycles.some((x) => x.cycleId === d.cycleId)) s.cycles.push(d);
    s.cycleId = d.cycleId;
  }
  if (e.type === "cycle_update")
    Object.assign(s.cycles.find((x) => x.cycleId === d.cycleId) || {}, d);
  if (e.type === "status") s.status = d.status;
  if (e.type === "leader_selection") s.leaderSelection = d;
  if (e.type === "recruit" && !s.members.some((x) => x.id === d.id))
    s.members.push(d);
  if (e.type === "member")
    Object.assign(s.members.find((x) => x.id === d.id) || {}, d);
  if (e.type === "task" && !s.tasks.some((x) => x.id === d.id)) s.tasks.push(d);
  if (e.type === "task_update")
    Object.assign(s.tasks.find((x) => x.id === d.id) || {}, d);
  if (e.type === "question" && !s.questions.some((x) => x.id === d.id))
    s.questions.push({ ...d, answered: false });
  if (e.type === "question_closed")
    Object.assign(s.questions.find((x) => x.id === d.id) || {}, {
      answered: true,
      status: "withdrawn",
      reason: d.reason,
    });
  if (e.type === "answer")
    Object.assign(s.questions.find((x) => x.id === d.id) || {}, {
      answered: true,
      answer: d.answer,
    });
  if (
    e.type === "artifact_ready" &&
    !s.artifacts.some((a) => a.artifactId === d.artifactId)
  )
    s.artifacts.push(d);
  if (e.type === "artifact_validation")
    Object.assign(
      s.artifacts.find((a) => a.artifactId === d.artifactId) || {},
      d,
    );
  if (e.type === "preview_status") Object.assign(s.preview, d);
  for (const cycle of s.cycles)
    cycle.tasks = s.tasks.filter(
      (t) =>
        t.cycleId === cycle.cycleId && t.planRevision === cycle.planRevision,
    );
  s.cycle = s.cycles.find((x) => x.cycleId === s.cycleId);
  return true;
}
