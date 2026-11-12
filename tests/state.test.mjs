import test from "node:test";
import assert from "node:assert/strict";
import { Store, project, failureState } from "../src/store.mjs";
test("事件重放保留任务、请示及暂停状态", () => {
  let db = new Store(":memory:");
  db.append("a", "created", { title: "任务", path: "/tmp/a" });
  db.append("a", "recruit", { id: "m", name: "砚舟" });
  db.append("a", "task", { id: "t", status: "queued", failures: 0 });
  db.append("a", "task_update", { id: "t", status: "review", commit: "abc" });
  db.append("a", "question", { id: "q", question: "是否继续" });
  db.append("a", "answer", { id: "q", answer: false });
  db.append("a", "status", { status: "paused" });
  let s = project(db.events("a"));
  assert.equal(s.tasks[0].commit, "abc");
  assert.equal(s.questions[0].answer, false);
  assert.equal(s.status, "paused");
  assert.equal(db.conversations().length, 1);
});
test("第一次返修、第二次会诊、第三次停止；方案问题立即会诊", () => {
  assert.equal(failureState(1), "repair");
  assert.equal(failureState(2), "consultation");
  assert.equal(failureState(3), "stopped");
  assert.equal(failureState(1, true), "consultation");
});
