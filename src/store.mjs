import { project } from "../public/studio/conversation-state.mjs";
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
export { project } from "../public/studio/conversation-state.mjs";
export function failureState(failures, design = false) {
  return design
    ? "consultation"
    : failures >= 3
      ? "stopped"
      : failures === 2
        ? "consultation"
        : "repair";
}
