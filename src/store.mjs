import { DatabaseSync } from "node:sqlite";
export class Store {
  constructor(file) {
    this.db = new DatabaseSync(file);
    this.db.exec(
      `PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,conversation TEXT NOT NULL,type TEXT NOT NULL,data TEXT NOT NULL,time TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,expires INTEGER);`,
    );
  }
  append(conversation, type, data) {
    const time = new Date().toISOString();
    const r = this.db
      .prepare(
        "INSERT INTO events(conversation,type,data,time) VALUES(?,?,?,?)",
      )
      .run(conversation, type, JSON.stringify(data), time);
    return { id: Number(r.lastInsertRowid), conversation, type, data, time };
  }
  events(id) {
    return this.db
      .prepare("SELECT * FROM events WHERE conversation=? ORDER BY id")
      .all(id)
      .map((x) => ({ ...x, data: JSON.parse(x.data) }));
  }
  conversations() {
    return this.db
      .prepare(
        "SELECT DISTINCT conversation FROM events WHERE conversation <> 'system'",
      )
      .all()
      .map((x) => project(this.events(x.conversation)));
  }
}
export function project(events) {
  let s = {
    id: events[0]?.conversation,
    members: [],
    tasks: [],
    questions: [],
    events,
    status: "idle",
  };
  for (const e of events) {
    const d = e.data;
    if (e.type === "created" || e.type === "project_update")
      Object.assign(s, d);
    if (e.type === "status") s.status = d.status;
    if (e.type === "leader_selection") s.leaderSelection = d;
    if (e.type === "recruit") s.members.push(d);
    if (e.type === "member")
      Object.assign(s.members.find((m) => m.id === d.id) || {}, d);
    if (e.type === "task") s.tasks.push(d);
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
  }
  return s;
}
export function failureState(failures, design = false) {
  return design
    ? "consultation"
    : failures >= 3
      ? "stopped"
      : failures === 2
        ? "consultation"
        : "repair";
}
