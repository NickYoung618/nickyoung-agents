import readline from "node:readline";
import https from "node:https";
const properties = Object.fromEntries(
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
    "replacement",
  ].map((k) => [k, { type: "string" }]),
);
for (const k of ["commands", "participants"])
  properties[k] = { type: "array", items: { type: "string" } };
const tool = {
  name: "team_action",
  description:
    "管理尼克杨助手团队：recruit 招募、assign 派活、notice 须知、decision 决定、ask 请示、discuss 讨论、retry 会诊重试、defer 遗留、cancel 取消、reassign 改派、resolve 关联通过任务关闭遗留、experience 经验、finish 交付。派活立即返回。",
  inputSchema: {
    type: "object",
    properties,
    required: ["type"],
    additionalProperties: false,
  },
};
function call(action) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      process.env.NY_TEAM_URL,
      {
        method: "POST",
        rejectUnauthorized: false,
        headers: {
          Authorization: `Bearer ${process.env.NY_TEAM_TOKEN}`,
          "Content-Type": "application/json",
        },
      },
      (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () =>
          res.statusCode === 200 ? resolve(text) : reject(Error(text)),
        );
      },
    );
    req.on("error", reject);
    req.end(JSON.stringify(action));
  });
}
for await (const line of readline.createInterface({ input: process.stdin })) {
  let request;
  try {
    request = JSON.parse(line);
    if (!("id" in request)) continue;
    let result;
    switch (request.method) {
      case "initialize":
        result = {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "nickyoung-team", version: "1.0.0" },
        };
        break;
      case "ping":
        result = {};
        break;
      case "tools/list":
        result = {
          tools:
            process.env.NY_TEAM_ROLE === "leader"
              ? [tool]
              : [
                  {
                    name: "project_command",
                    description:
                      "在当前项目沙箱内执行验收或调研命令。返回真实退出码和输出。",
                    inputSchema: {
                      type: "object",
                      properties: { command: { type: "string" } },
                      required: ["command"],
                      additionalProperties: false,
                    },
                  },
                ],
        };
        break;
      case "tools/call":
        if (!["team_action", "project_command"].includes(request.params.name))
          throw Error("未知工具");
        try {
          result = {
            content: [
              {
                type: "text",
                text: await call(
                  request.params.name === "project_command"
                    ? { type: "project_command", ...request.params.arguments }
                    : request.params.arguments,
                ),
              },
            ],
          };
        } catch (e) {
          result = {
            isError: true,
            content: [{ type: "text", text: e.message }],
          };
        }
        break;
      default:
        throw Error("不支持的方法");
    }
    process.stdout.write(
      JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n",
    );
  } catch (e) {
    if (request?.id !== undefined)
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32603, message: e.message },
        }) + "\n",
      );
  }
}
