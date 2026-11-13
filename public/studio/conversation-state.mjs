const eventIds=new WeakMap();
export function applyEvent(s,e) {
  if(!eventIds.has(s))eventIds.set(s,new Set(s.events.map(e=>e.id)));
  const seen=eventIds.get(s);
  if(seen.has(e.id))return s;
  seen.add(e.id);
  s.events.push(e);
    const d = e.data;
    if (e.type === "created" || e.type === "project_update")
      Object.assign(s, d);
    if(e.type==='intent')s.intent={...d,eventId:e.id};
    if(e.type==='requirement_status'&&(!s.requirement||(d.sourceMessage||0)>=(s.requirement.sourceMessage||0)))s.requirement={...d,eventId:e.id};
    if (e.type === "status") s.status = d.status;
    if (e.type === "leader_selection") s.leaderSelection = d;
    if (e.type === "recruit") s.members.push({...d});
    if (e.type === "member")
      Object.assign(s.members.find((m) => m.id === d.id) || {}, d);
    if (e.type === "task") s.tasks.push({...d});
    if (e.type === "task_update")
      Object.assign(s.tasks.find((t) => t.id === d.id) || {}, d);
    if (e.type === "question") s.questions.push({ ...d, answered: false });
    if (e.type === "question_closed")
      Object.assign(s.questions.find((q) => q.id === d.id) || {}, {
        answered: true,
        status: "withdrawn",
        reason: d.reason,
      });
    if (e.type === "answer")
      Object.assign(s.questions.find((q) => q.id === d.id) || {}, {
        answered: true,
        answer: d.answer,
      });
  return s;
}
export function project(events) {
 const s={id:events[0]?.conversation,members:[],tasks:[],questions:[],events:[],status:'idle'};
 for(const e of events)applyEvent(s,e);
 return s;
}
