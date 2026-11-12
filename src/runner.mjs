import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
export const schema = {
  type: "object",
  properties: {
    message: { type: "string" },
    summary: { type: "string" },
    files: { type: "array", items: { type: "string" } },
    verification: { type: "string" },
    blockers: { type: "string" },
    verdict: { type: "string", enum: ["pass", "return"] },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: { type: "string" },
          title: { type: "string" },
          evidence: { type: "string" },
          suggestion: { type: "string" },
        },
        required: ["severity", "title", "evidence", "suggestion"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "message",
    "summary",
    "files",
    "verification",
    "blockers",
    "verdict",
    "issues",
  ],
  additionalProperties: false,
};
export const leaderSchema = {
  type: "object",
  properties: {
    message: { type: "string" },
    actions: {
      type: "array",
      items: {
        type: "object",
        properties: Object.fromEntries(
          [
            "type",
            "name",
            "role",
            "tier",
            "member",
            "reviewer",
            "title",
            "description",
            "text",
            "question",
            "yes",
            "no",
            "task",
            "advice",
            "reason",
          ]
            .map((x) => [x, { type: "string" }])
            .concat([
              ["commands", { type: "array", items: { type: "string" } }],
            ]),
        ),
        required: [
          "type",
          "name",
          "role",
          "tier",
          "member",
          "reviewer",
          "title",
          "description",
          "text",
          "question",
          "yes",
          "no",
          "task",
          "advice",
          "reason",
          "commands",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["message", "actions"],
  additionalProperties: false,
};
leaderSchema.properties.actions.items.properties.participants = {
  type: "array",
  items: { type: "string" },
};
leaderSchema.properties.actions.items.required.push("participants");
leaderSchema.properties.actions.items.properties.replacement = {
  type: "string",
};
leaderSchema.properties.actions.items.required.push("replacement");
schema.properties.questions = {
  type: "array",
  items: {
    type: "object",
    properties: { to: { type: "string" }, text: { type: "string" } },
    required: ["to", "text"],
    additionalProperties: false,
  },
};
schema.required.push("questions");
schema.properties.completion = {
  type: "string",
  enum: ["complete", "blocked"],
};
schema.required.push("completion");
export function processFailure(events, stderr = "", fallback = "回合失败") {
  const error = events.findLast(
    (e) =>
      e.is_api_error_message ||
      e.type === "turn.failed" ||
      e.type === "error" ||
      (e.type === "result" && e.is_error),
  );
  if (!error) return stderr.trim() || fallback;
  const message =
    error.result ||
    error.error?.message ||
    error.message?.content
      ?.filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n") ||
    error.message ||
    JSON.stringify(error);
  return [
    error.api_error_status ? `API ${error.api_error_status}` : "",
    error.api_error_code || error.error?.code || "",
    typeof message === "string" ? message : JSON.stringify(message),
  ]
    .filter(Boolean)
    .join(" · ");
}
export function runProcess(
  bin,
  args,
  { cwd, onEvent = () => {}, timeout = 3600000, env = process.env } = {},
) {
  const child = spawn(bin, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let stderr = "",
    buffer = "",
    timedOut = false;
  const events = [];
  const consume = (line) => {
    if (!line) return;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      event = { type: "output", text: line };
    }
    events.push(event);
    onEvent(event);
  };
  const stop = () => {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null)
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {}
    }, 1500).unref();
  };
  const timer = setTimeout(() => {
    timedOut = true;
    stop();
  }, timeout);
  const promise = new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        consume(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      onEvent({ type: "stderr", text: chunk.toString() });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      consume(buffer);
      if (code !== 0 || timedOut) {
        reject(
          Object.assign(
            new Error(
              timedOut
                ? "回合超时"
                : processFailure(
                    events,
                    stderr,
                    `进程退出 ${code} ${signal || ""}`,
                  ),
            ),
            { events, exitCode: code, signal, timedOut },
          ),
        );
      } else resolve({ events, stderr });
    });
  });
  return { child, stop, promise };
}
export function runModel({
  selection,
  cwd,
  prompt,
  leader = false,
  session,
  onEvent,
  timeout,
  team,
  readOnly = false,
}) {
  const outputSchema = leader ? leaderSchema : schema;
  let bin, args;
  const system = readFileSync(
    new URL(`../prompts/${leader ? "leader" : "member"}.md`, import.meta.url),
    "utf8",
  );
  if (selection.channel === "claude") {
    bin = process.env.NY_CLAUDE || "claude";
    args = [
      "-p",
      prompt,
      "--model",
      selection.model,
      "--output-format",
      "stream-json",
      "--verbose",
      "--strict-mcp-config",
      "--setting-sources",
      "",
      "--disable-slash-commands",
      "--settings",
      JSON.stringify({
        disableAllHooks: true,
        autoMemoryEnabled: false,
      }),
      "--restricted",
      "--tools",
      leader || readOnly ? "Read,Glob,Grep" : "Read,Glob,Grep,Edit,Write",
      "--permission-mode",
      leader || readOnly ? "plan" : "acceptEdits",
      "--system-prompt",
      system,
      "--json-schema",
      JSON.stringify(outputSchema),
    ];
    if (selection.effort) args.push("--effort", selection.effort);
    if (team)
      args.push(
        "--allowedTools",
        team.role === "leader"
          ? "mcp__nickyoung__team_action"
          : "mcp__nickyoung__project_command",
        "--mcp-config",
        JSON.stringify({
          mcpServers: {
            nickyoung: {
              command: process.execPath,
              args: [new URL("./team-mcp.mjs", import.meta.url).pathname],
            },
          },
        }),
      );
    if (session) args.push("--resume", session);
  } else {
    bin = process.env.NY_CODEX || "codex";
    const dir = new URL("../data/schemas", import.meta.url).pathname;
    mkdirSync(dir, { recursive: true });
    const file = join(
      dir,
      leader ? "leader-schema.json" : "member-schema.json",
    );
    writeFileSync(file, JSON.stringify(outputSchema));
    args = [
      "exec",
      "--ignore-user-config",
      "--ignore-rules",
      "--json",
      "-m",
      selection.model,
      "-c",
      `sandbox_mode="${leader || readOnly ? "read-only" : "workspace-write"}"`,
      "-c",
      "sandbox_workspace_write.network_access=true",
      "-c",
      "skills.bundled.enabled=false",
      "-c",
      "skills.include_instructions=false",
    ];
    if (selection.effort)
      args.push(
        "-c",
        `model_reasoning_effort=${JSON.stringify(selection.effort)}`,
      );
    if (team)
      args.push(
        "-c",
        `mcp_servers.nickyoung.command=${JSON.stringify(process.execPath)}`,
        "-c",
        `mcp_servers.nickyoung.args=${JSON.stringify([new URL("./team-mcp.mjs", import.meta.url).pathname])}`,
        "-c",
        'mcp_servers.nickyoung.env_vars=["NY_TEAM_TOKEN","NY_TEAM_URL","NY_TEAM_ROLE"]',
        "-c",
        'mcp_servers.nickyoung.tools.team_action.approval_mode="approve"',
      );
    if (session) args.push("resume", session);
    else
      args.push(
        "--sandbox",
        leader || readOnly ? "read-only" : "workspace-write",
      );
    args.push("--output-schema", file);
    args.push(system + "\n" + prompt);
  }
  const proc = runProcess(bin, args, {
    cwd,
    onEvent,
    timeout,
    env: {
      ...process.env,
      ...(team
        ? {
            NY_TEAM_TOKEN: team.token,
            NY_TEAM_URL: team.url,
            NY_TEAM_ROLE: team.role,
          }
        : {}),
    },
  });
  proc.promise = proc.promise.then(({ events }) => {
    let sid = session,
      result,
      usage,
      actual = selection.model;
    for (const e of events) {
      sid = e.session_id || e.thread_id || sid;
      if (e.type === "system" && e.model) actual = e.model;
      if (e.type === "result") {
        result = e.structured_output || e.result;
        usage = e.usage;
        if (e.is_error)
          throw Object.assign(new Error(processFailure(events)), { events });
      }
      if (e.type === "item.completed" && e.item?.type === "agent_message")
        result = e.item.text;
      if (e.type === "turn.completed") usage = e.usage;
    }
    if (typeof result === "string") {
      try {
        result = JSON.parse(result);
      } catch {
        throw new Error("模型没有返回结构化结果：" + result);
      }
    }
    if (!result || typeof result.message !== "string")
      throw new Error("模型未返回有效结果");
    return { result, session: sid, usage, model: actual };
  });
  return proc;
}
