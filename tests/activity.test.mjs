import test from "node:test";
import assert from "node:assert/strict";
import { projectActivities } from "../src/activity-projector.mjs";
import { project } from "../src/store.mjs";
import { blankState, applyStateEvent } from "../public/studio/live-state.mjs";
const event = (id, type, data) => ({
  id,
  conversation: "c",
  time: new Date(1700000000000 + id * 100).toISOString(),
  type,
  data,
});
test("工具活动在模型回合结束前可见，开始/结束与文件变更只来自真实事件", () => {
  const events = [
    event(1, "created", { title: "task" }),
    event(2, "recruit", { id: "m" }),
    event(3, "run_start", { member: "m", runId: "r" }),
    event(4, "process", {
      member: "m",
      event: {
        type: "item.started",
        item: {
          type: "command_execution",
          id: "cmd",
          command: "cat src/main.ts",
          status: "in_progress",
          exit_code: null,
        },
      },
    }),
    event(5, "process", {
      member: "m",
      event: {
        type: "item.completed",
        item: {
          type: "file_change",
          id: "file",
          changes: [{ path: "src/main.ts", kind: "update" }],
        },
      },
    }),
  ];
  const s = project(events),
    a = projectActivities(s);
  assert.equal(
    a.recent.find((x) => x.kind === "reading").startedAt,
    events[3].time,
  );
  assert.equal(a.byMember.m.kind, "editing");
  assert.equal(a.byMember.m.startedAt, null);
  assert.equal(a.byMember.m.sourceEventId, 5);
  assert.ok(!s.events.some((e) => e.type === "model_result"));
});
test("结束记录不伪造开始时间，EROFS 是具体环境阻塞，重放不制造重复活动", () => {
  const e = event(9, "process", {
    member: "m",
    event: {
      type: "item.completed",
      item: {
        id: "x",
        type: "command_execution",
        command: "npx playwright install chromium",
        exit_code: 1,
        status: "failed",
        aggregated_output: "EROFS read-only file system",
      },
    },
  });
  const a = projectActivities({ id: "c", tasks: [], events: [e, e] });
  assert.equal(a.recent.length, 1);
  assert.equal(a.recent[0].kind, "blocked");
  assert.equal(a.recent[0].startedAt, null);
  assert.match(a.recent[0].text, /只读/);
});
test("浏览器增量状态与 SQLite 重放使用相同投影；重复 SSE 不重复加入，源事件不被修改", () => {
  const events = [
    event(1, "created", { workflowVersion: "adaptive_v1" }),
    event(2, "recruit", { id: "m", status: "idle" }),
    event(3, "member", { id: "m", status: "running" }),
    event(4, "cycle", { cycleId: "cycle", planRevision: 1, gates: [] }),
    event(5, "task", {
      id: "t",
      cycleId: "cycle",
      planRevision: 1,
      status: "queued",
    }),
    event(6, "task_update", { id: "t", status: "implemented" }),
    event(7, "artifact_ready", { artifactId: "a", kind: "static_page" }),
    event(8, "artifact_validation", {
      artifactId: "a",
      validationStatus: "verified",
    }),
  ];
  const copy = structuredClone(events),
    s = blankState("c");
  for (const e of events) applyStateEvent(s, e);
  assert.deepEqual(s, project(events));
  assert.equal(applyStateEvent(s, events[7]), false);
  assert.deepEqual(events, copy);
  assert.equal(s.members[0].status, "running");
  assert.equal(s.events[1].data.status, "idle");
});
