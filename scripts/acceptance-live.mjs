import https from "node:https";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
const root = resolve(import.meta.dirname, ".."),
  cookie = readFileSync(join(root, "data/qa-cookie"), "utf8");
export const call = (path, data) =>
  new Promise((resolve, reject) => {
    const req = https.request(
      "https://localhost:8787/api/" + path,
      {
        rejectUnauthorized: false,
        method: data ? "POST" : "GET",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () =>
          res.statusCode === 200
            ? resolve(JSON.parse(body))
            : reject(Error(body)),
        );
      },
    );
    req.on("error", reject);
    req.end(data ? JSON.stringify(data) : undefined);
  });
const r = await call("conversations", {
  text: "这是小项目验收：做一个 Node 命令行名字列表工具，支持 add 和 list，数据重启后还在。用两个独立成员完成实现和审查，两人都从主力档招募（GPT-6.1-Sol / medium），不要招辅助档，不使用 Opus。先开一轮讨论，议题是数据文件选 JSON 还是 CSV，两人各讲一句理由，你记录结论。这个文件格式确实需要我选：随后用是/否卡片问“是否使用 JSON 保存？”，写明两种选择的影响，等待我回答。等待期间先派一个不依赖格式的任务：创建 README.md，写清工具名、只在本地保存、需要 Node 24；验收命令检查 README 包含 Node 24。这个任务必须经过另一位成员实测审查。选定格式后再派一项很小的实现任务，添加两个 node:test 用例，机器验和另一位成员审查通过后交付。新任务开始必须读项目须知。请记住当前节省额度偏好，命令执行均用主力成员，不要改全局模型设置。",
});
writeFileSync(join(root, "data/live-acceptance-id"), r.id);
console.log("ID", r.id);
