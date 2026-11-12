export function graphPositions(members, width, height) {
  const positions = new Map();
  if (!members.length) return positions;
  if (members.length === 1) { positions.set(members[0].id, { x: width / 2, y: height / 2 }); return positions; }
  if (members.length === 2) { members.forEach((m,i) => positions.set(m.id, {x:width/2,y:i ? height-48 : 48})); return positions; }
  const rows = Math.ceil(members.length / 2);
  members.forEach((m, i) => {
    const solo = members.length % 2 && i === members.length - 1;
    positions.set(m.id, { x: solo ? width / 2 : (i % 2 ? width - 56 : 56), y: 48 + Math.floor(i / 2) * (height - 96) / (rows - 1 || 1) });
  });
  return positions;
}
export function studioEdges(s) {
  if (!s) return [];
  const find = id => s.members.find(m => m.id === id || m.name === id)?.id;
  const tasks = new Map(s.tasks.map(t => [t.id, t]));
  return s.events.flatMap(e => {
    const d = e.data, t = tasks.get(d.task || d.id);
    let from, to, label;
    if (e.type === 'task') { from = 'leader'; to = d.member; label = '派发任务'; }
    if (e.type === 'task_update' && d.status === 'review') { from = t?.member; to = t?.reviewer; label = '送审'; }
    if (e.type === 'review') { from = t?.reviewer; to = d.verdict === 'pass' ? 'leader' : t?.member; label = d.verdict === 'pass' ? '审查通过' : '退回修改'; }
    if (e.type === 'member_question' || e.type === 'member_answer') { from = d.from; to = d.to; label = e.type === 'member_question' ? '提问' : '答复'; }
    if (!find(from) || !find(to) || find(from) === find(to)) return [];
    return [{ id: e.id, from: find(from), to: find(to), label, time: e.time, task: t?.title, event: e }];
  });
}
