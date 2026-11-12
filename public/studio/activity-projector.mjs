const short = (value, n = 180) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .slice(0, n);
function kindForCommand(command) {
  return /\b(?:cat|rg|grep|sed|head|tail|ls|pwd|find)\b/.test(command) &&
    !/\b(?:npm|pnpm|yarn|node|pytest|cargo|vite)\b/.test(command)
    ? "reading"
    : "command_running";
}
function failureText(output) {
  if (/EROFS|read-only file system/i.test(output)) return "文件或缓存目录只读";
  if (/ENOTFOUND|EAI_AGAIN/i.test(output)) return "网络解析失败";
  if (/ENOENT|Cannot find module/i.test(output)) return "缺少依赖或文件";
  return null;
}
export function projectActivities(s, { limit = 20 } = {}) {
  const map = new Map(),
    runs = new Map(),
    byMember = {},
    seen = new Set(),
    tasks = new Map();
  const add = (key, e, data) => {
    const prev = map.get(key),
      row = {
        activityId: key,
        sourceEventId: e.id,
        sourceEventIds: [...(prev?.sourceEventIds || []), e.id],
        memberId: e.data.member || data.memberId || "machine",
        conversationId: e.conversation || s.id,
        cycleId: e.data.cycleId ?? null,
        runId: e.data.runId ?? null,
        observedAt: e.time,
        startedAt: prev?.startedAt ?? null,
        endedAt: prev?.endedAt ?? null,
        ...prev,
        ...data,
      };
    row.sourceEventId = e.id;
    row.observedAt = e.time;
    row.sourceEventIds = [...(prev?.sourceEventIds || []), e.id];
    map.set(key, row);
    byMember[row.memberId] = row;
  };
  for (const e of s.events || []) {
    if (e.id !== undefined && seen.has(e.id)) continue;
    seen.add(e.id);
    const d = e.data;
    if (e.type === "task") tasks.set(d.id, { ...d });
    if (e.type === "task_update") Object.assign(tasks.get(d.id) || {}, d);
    if (e.type === "run_start") {
      const task = [...tasks.values()].find(
        (t) =>
          t.id === d.taskId ||
          (t.status === "reviewing" && t.reviewer === d.member),
      );
      const reviewer = d.role === "reviewer" || task?.reviewer === d.member;
      runs.set(d.member, d.runId || "event-" + e.id);
      add("run-" + e.id, e, {
        memberId: d.member,
        kind: reviewer ? "reviewing" : "waiting",
        status: "running",
        text: reviewer
          ? `正在核验 ${task?.title || d.gateId || "批次快照"}${task?.commit ? " · " + task.commit.slice(0, 8) : ""}`
          : "等待模型返回；工具活动会在此更新",
        startedAt: e.time,
        files: [],
      });
    }
    if (["model_result", "run_failed", "run_interrupted"].includes(e.type)) {
      byMember[d.member] = {
        memberId: d.member,
        sourceEventId: e.id,
        observedAt: e.time,
        kind: e.type === "run_failed" ? "blocked" : "idle",
        status:
          e.type === "model_result"
            ? "completed"
            : e.type === "run_failed"
              ? "failed"
              : "stopped",
        text:
          e.type === "model_result"
            ? "回合已结束"
            : short(d.error || "回合已中断"),
        files: [],
      };
    }
    if (e.type === "process") {
      const p = d.event,
        item = p?.item;
      if (item?.type === "command_execution") {
        const key =
            (d.runId || runs.get(d.member) || "unknown") + ":" + item.id,
          finished = p.type === "item.completed",
          error = finished && item.exit_code !== 0 && item.exit_code !== null,
          reason = error ? failureText(item.aggregated_output || "") : null;
        const files = [
          ...new Set(
            (item.command || "").match(
              /[A-Za-z0-9_./-]+\.(?:[cm]?js|[jt]sx?|md|css|json|html|py)\b/g,
            ) || [],
          ),
        ].slice(0, 5);
        add(key, e, {
          kind: reason
            ? "blocked"
            : finished
              ? "command_finished"
              : kindForCommand(item.command || ""),
          status: finished ? (error ? "failed" : "completed") : "running",
          text: reason || short(item.command),
          command: item.command,
          exitCode: item.exit_code ?? null,
          files,
          fileConfidence: "command_mention",
          ...(p.type === "item.started" ? { startedAt: e.time } : {}),
          ...(finished ? { endedAt: e.time } : {}),
        });
      } else if (item?.type === "file_change") {
        add((d.runId || runs.get(d.member) || "unknown") + ":" + item.id, e, {
          kind: "editing",
          status: p.type === "item.completed" ? "completed" : "running",
          text: p.type === "item.completed" ? "已修改文件" : "正在修改文件",
          files: (item.changes || []).map((x) => x.path).filter(Boolean),
          fileConfidence: "reported_tool_path",
          ...(p.type === "item.started" ? { startedAt: e.time } : {}),
          ...(p.type === "item.completed" ? { endedAt: e.time } : {}),
        });
      }
      for (const block of p?.message?.content || []) {
        if (block.type === "tool_use") {
          const input = block.input || {},
            command = input.command;
          add(
            (d.runId || runs.get(d.member) || "unknown") + ":" + block.id,
            e,
            {
              kind: command
                ? kindForCommand(command)
                : /Edit|Write/.test(block.name)
                  ? "editing"
                  : "reading",
              status: "running",
              text: short(command || block.name),
              files: [input.file_path || input.path].filter(Boolean),
              command,
              startedAt: e.time,
            },
          );
        } else if (block.type === "tool_result") {
          const key =
              (d.runId || runs.get(d.member) || "unknown") +
              ":" +
              block.tool_use_id,
            old = map.get(key);
          if (old)
            add(key, e, {
              kind: block.is_error ? "blocked" : "command_finished",
              status: block.is_error ? "failed" : "completed",
              text: block.is_error ? short(block.content) : old.text,
              endedAt: e.time,
            });
        }
      }
    }
    if (e.type === "command_start")
      add(d.commandId, e, {
        memberId: "machine",
        kind: "command_running",
        status: "running",
        command: d.command,
        text: short(d.command),
        startedAt: d.started || e.time,
        files: [],
      });
    if (e.type === "command_result")
      add(d.commandId, e, {
        memberId: "machine",
        kind: "command_finished",
        status: d.interrupted
          ? "stopped"
          : d.exitCode === 0
            ? "completed"
            : "failed",
        text: map.get(d.commandId)?.text || "程序检查结束",
        exitCode: d.exitCode,
        endedAt: d.ended || e.time,
        files: [],
      });
    if (e.type === "check")
      add("check-" + e.id, e, {
        memberId: "machine",
        kind: d.passed
          ? "command_finished"
          : failureText(d.output || "")
            ? "blocked"
            : "command_finished",
        status: d.passed ? "completed" : "failed",
        text: failureText(d.output || "") || short(d.command || "正式检查"),
        command: d.command,
        exitCode: d.exitCode ?? null,
        endedAt: e.time,
        files: [],
      });
    if (e.type === "artifact_ready")
      add("artifact-" + d.artifactId, e, {
        memberId: "machine",
        kind: "artifact_ready",
        status: "completed",
        text:
          d.validationStatus === "verified"
            ? "已验收产物就绪"
            : "草稿产物就绪，尚未验收",
        artifactId: d.artifactId,
        files: [],
        endedAt: e.time,
      });
    if (e.type === "preview_status" && d.status === "failed")
      add("preview-" + e.id, e, {
        memberId: "machine",
        kind: "blocked",
        status: "failed",
        text: short(d.reason),
        files: [],
        endedAt: e.time,
      });
  }
  return {
    recent: [...map.values()]
      .sort((a, b) => a.sourceEventId - b.sourceEventId)
      .slice(-limit),
    byMember,
  };
}
