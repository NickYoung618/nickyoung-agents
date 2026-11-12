import { ModelCatalog } from "./model-catalog.mjs";
import { statistics, cycleStatistics } from "./statistics.mjs";
import https from "node:https";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  chmodSync,
} from "node:fs";
import { resolve, join, extname } from "node:path";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { Store } from "./store.mjs";
import { Engine } from "./engine.mjs";
import { runModel } from "./runner.mjs";
const root = resolve(import.meta.dirname, ".."),
  data = resolve(process.env.NY_DATA || join(root, "data"));
mkdirSync(data, { recursive: true, mode: 0o700 });
const configPath = join(data, "config.json");
let config = existsSync(configPath)
  ? JSON.parse(readFileSync(configPath))
  : {
      data,
      workspace: resolve(root, "../nickyoung-workspace"),
      port: 8787,
      host: "0.0.0.0",
      concurrency: 2,
      timeout: 3600000,
      leader: { channel: "codex", model: "gpt-6.1-sol", effort: "high" },
      tiers: [
        {
          id: "main",
          name: "主力",
          channel: "codex",
          model: "gpt-6.1-sol",
          effort: "medium",
          description: "实现、重构和返修",
        },
        {
          id: "helper",
          name: "辅助",
          channel: "codex",
          model: "gpt-6-astra",
          effort: "high",
          description: "审查、验证和调研",
        },
      ],
      names: [
        "砚舟",
        "青禾",
        "时雨",
        "松间",
        "北辰",
        "鹿鸣",
        "云起",
        "南乔",
        "既白",
        "听澜",
        "怀瑾",
      ],
      experience: "",
    };
const save = () => {
  writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  writeFileSync(join(data, "experience.md"), config.experience || "", {
    mode: 0o600,
  });
};
function passwordHash(p, salt) {
  return scryptSync(p, salt, 64).toString("hex");
}
if (!config.password) {
  const password = randomBytes(24).toString("base64url");
  const salt = randomBytes(16).toString("hex");
  config.password = { salt, hash: passwordHash(password, salt) };
  writeFileSync(join(data, "initial-password"), password + "\n", {
    mode: 0o600,
  });
}
save();
if (!config.cert) {
  config.cert = join(data, "cert.pem");
  config.key = join(data, "key.pem");
  save();
}
if (!existsSync(config.cert) || !existsSync(config.key)) {
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      config.key,
      "-out",
      config.cert,
      "-days",
      "365",
      "-subj",
      "/CN=NickYoung",
      "-addext",
      "subjectAltName=IP:43.156.51.71,IP:127.0.0.1,DNS:localhost",
    ],
    { stdio: "ignore" },
  );
  chmodSync(config.key, 0o600);
}
const store = new Store(join(data, "events.sqlite")),
  clients = new Set(),
  attempts = new Map(),
  tested = new Set();
const selectionKey = (s) =>
  JSON.stringify([s.channel, s.model, s.effort ?? ""]);
const engine = new Engine(store, config, save, (e) => {
  for (const r of clients) r.write(`data: ${JSON.stringify(e)}\n\n`);
});
function json(res, status, value) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
}
async function body(req) {
  let s = "";
  for await (const chunk of req) {
    s += chunk;
    if (s.length > 16000000) throw new Error("请求过大");
  }
  return JSON.parse(s || "{}");
}
const catalog = new ModelCatalog(data);
const server = https.createServer(
  { key: readFileSync(config.key), cert: readFileSync(config.cert) },
  async (req, res) => {
    try {
      const url = new URL(req.url, "https://localhost"),
        p = url.pathname;
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "same-origin");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
      );
      if (p === "/internal/team" && req.method === "POST") {
        const token = req.headers.authorization?.replace(/^Bearer /, "");
        if (!engine.teamTokens.has(token))
          return json(res, 403, { error: "团队回合已结束" });
        return json(res, 200, {
          ok: true,
          result: await engine.teamAction(token, await body(req)),
        });
      }
      const cookie = req.headers.cookie?.match(
        /(?:^|; )ny_session=([^;]+)/,
      )?.[1];
      const authed =
        cookie &&
        store.db
          .prepare("SELECT token FROM sessions WHERE token=? AND expires>?")
          .get(cookie, Date.now());
      if (
        req.method !== "GET" &&
        req.headers.origin &&
        req.headers.origin !== `https://${req.headers.host}`
      )
        return json(res, 403, { error: "来源不匹配" });
      if (p === "/api/login" && req.method === "POST") {
        let key = req.socket.remoteAddress,
          a = attempts.get(key) || { count: 0, until: 0 };
        if (a.until > Date.now())
          return json(res, 429, {
            error: `请在 ${Math.ceil((a.until - Date.now()) / 60000)} 分钟后重试`,
          });
        if (a.until) {
          a = { count: 0, until: 0 };
        }
        let b = await body(req);
        if (
          typeof b.password !== "string" ||
          !timingSafeEqual(
            Buffer.from(passwordHash(b.password, config.password.salt), "hex"),
            Buffer.from(config.password.hash, "hex"),
          )
        ) {
          a.count++;
          if (a.count >= 5) a.until = Date.now() + 900000;
          attempts.set(key, a);
          return json(res, 401, { error: "口令错误" });
        }
        attempts.delete(key);
        const token = randomBytes(32).toString("hex");
        store.db
          .prepare("INSERT INTO sessions VALUES(?,?)")
          .run(token, Date.now() + 2592000000);
        res.setHeader(
          "Set-Cookie",
          `ny_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`,
        );
        return json(res, 200, { ok: true });
      }
      if (!authed) {
        if (p === "/login" || p === "/login.js" || p === "/style.css")
          return asset(p, res);
        if (p === "/") {
          res.writeHead(302, { Location: "/login" });
          return res.end();
        }
        return json(res, 401, { error: "请登录" });
      }
      if (p === "/api/logout" && req.method === "POST") {
        store.db.prepare("DELETE FROM sessions WHERE token=?").run(cookie);
        res.setHeader(
          "Set-Cookie",
          "ny_session=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0",
        );
        return json(res, 200, { ok: true });
      }
      if (p === "/api/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store",
          Connection: "keep-alive",
        });
        res.write(": connected\n\n");
        clients.add(res);
        const timer = setInterval(() => {
          if (
            !store.db
              .prepare("SELECT token FROM sessions WHERE token=? AND expires>?")
              .get(cookie, Date.now())
          )
            return res.end();
          res.write(": heartbeat\n\n");
        }, 15000);
        req.on("close", () => {
          clearInterval(timer);
          clients.delete(res);
        });
        return;
      }
      if (p === "/api/ui-version")
        return json(res, 200, { version: "20261113-adaptive-1" });
      if (p === "/api/state") return json(res, 200, store.conversations());
      if (p === "/api/models")
        return json(
          res,
          200,
          (await catalog.get()).models.filter((m) => !m.hidden),
        );
      if (p === "/api/model-catalog" && req.method === "GET")
        return json(res, 200, await catalog.get());
      if (p === "/api/model-catalog/scan" && req.method === "POST")
        return json(res, 200, await catalog.get(true));
      if (p === "/api/config" && req.method === "GET") {
        let { password, ...safe } = config;
        return json(res, 200, safe);
      }
      if (p === "/api/test" && req.method === "POST") {
        let selection = await body(req);
        if (
          !["codex", "claude"].includes(selection.channel) ||
          typeof selection.model !== "string" ||
          !selection.model.trim()
        )
          throw new Error("请选择接入类型并填写模型");
        const entry = (await catalog.get()).models.find(
          (m) => m.channel === selection.channel && m.model === selection.model,
        );
        if (
          entry?.efforts.length &&
          selection.effort &&
          !entry.efforts.includes(selection.effort)
        )
          throw new Error("该模型未声明支持此推理强度：" + selection.effort);
        if (entry?.effortCapability === "none" && selection.effort)
          throw new Error("该模型不支持推理强度，请选择模型默认");
        const started = Date.now();
        const proc = runModel({
          selection,
          cwd: root,
          prompt:
            "最小连通测试。请只返回规定结构，message 写“连接正常”，completion=complete、verdict=pass，其余填空值或空数组。不要调用工具。",
          timeout: 120000,
        });
        const result = await proc.promise;
        tested.add(selectionKey(selection));
        return json(res, 200, {
          ok: true,
          model: result.model,
          duration: Date.now() - started,
        });
      }
      if (p === "/api/config" && req.method === "POST") {
        const b = await body(req);
        if (
          !b.leader ||
          !Array.isArray(b.tiers) ||
          !b.tiers.length ||
          b.tiers.some((t) => !t.id || !t.name) ||
          new Set(b.tiers.map((t) => t.id)).size !== b.tiers.length
        )
          throw new Error("请填写负责人及成员档位");
        for (const selection of [b.leader, ...b.tiers]) {
          const prev = [config.leader, ...config.tiers].find(
            (x) =>
              x.channel === selection.channel &&
              x.model === selection.model &&
              x.effort === selection.effort,
          );
          if (!prev && !tested.has(selectionKey(selection)))
            throw new Error("请先测试所选模型再保存");
        }
        if (
          !Number.isInteger(b.concurrency) ||
          b.concurrency < 1 ||
          b.concurrency > 5 ||
          !Number.isFinite(b.timeout) ||
          b.timeout < 1000
        )
          throw new Error("并发数为 1–5，超时至少 1 秒");
        for (const k of [
          "leader",
          "tiers",
          "names",
          "concurrency",
          "timeout",
          "experience",
        ])
          if (k in b) config[k] = b[k];
        save();
        return json(res, 200, { ok: true });
      }
      if (p === "/api/password" && req.method === "POST") {
        let b = await body(req);
        if (typeof b.password !== "string" || b.password.length < 12)
          throw new Error("新口令至少 12 个字符");
        const salt = randomBytes(16).toString("hex");
        config.password = { salt, hash: passwordHash(b.password, salt) };
        save();
        store.db.exec("DELETE FROM sessions");
        for (const r of clients) r.end();
        return json(res, 200, { ok: true });
      }
      if (p === "/api/conversations" && req.method === "POST") {
        let b = await body(req);
        if (!b.text?.trim()) throw new Error("请输入需求");
        let c = await engine.create(b.text, b.path, { workflowVersion: b.workflowVersion, directPlan: b.directPlan });
        await engine.message(c, b.text, b.files, { intent: b.intent });
        return json(res, 200, { id: c });
      }
      const match = p.match(
        /^\/api\/conversations\/([^/]+)\/(message|pause|resume|answer|member|diff|files|resolve)$/,
      );
      if (match) {
        let [, c, action] = match;
        if (!["diff", "files"].includes(action) && req.method !== "POST")
          return json(res, 405, { error: "需要 POST 请求" });
        let s = engine.state(c);
        if (!s.id) return json(res, 404, { error: "对话不存在" });
        let b = req.method === "POST" ? await body(req) : {};
        if (action === "message") {
          if (!b.text?.trim()) throw new Error("消息不能为空");
          await engine.message(c, b.text, b.files, { intent: b.intent });
        }
        if (action === "pause") engine.pause(c);
        if (action === "resume") engine.resume(c);
        if (action === "answer") {
          if (
            !s.questions.some((q) => q.id === b.id && !q.answered) ||
            typeof b.answer !== "boolean"
          )
            throw new Error("无效回答");
          const question = s.questions.find((q) => q.id === b.id);
          engine.event(c, "answer", { ...b, cycleId: question.cycleId });
          if (question.purpose === "init_repo") {
            if (b.answer) {
              engine.initialize(c);
              engine.event(c, "status", { status: "working" });
              engine.wake(c);
            } else engine.event(c, "status", { status: "cancelled" });
          } else if (s.workflowVersion === "adaptive_v1") engine.pump();
          else engine.wake(c);
        }
        if (action === "member") {
          let m = s.members.find((m) => m.id === b.id);
          if (!m) throw new Error("成员不存在");
          if (!tested.has(selectionKey(b.selection)))
            throw new Error("请先测试模型");
          engine.event(c, "member", {
            channel: b.selection.channel,
            model: b.selection.model,
            effort: b.selection.effort,
            id: b.id,
          });
          if (b.id === "leader") {
            if (b.scope === "global") {
              config.leader = b.selection;
              save();
            } else
              engine.event(c, "leader_selection", {
                channel: b.selection.channel,
                model: b.selection.model,
                effort: b.selection.effort,
              });
          }
          engine.event(c, "model_change", { member: b.id, ...b.selection });
        }
        if (action === "resolve")
          await engine.action(c, { ...b, type: "resolve" });
        if (action === "files") {
          const files = engine
            .git(s.path, [
              "diff",
              "--name-only",
              "-z",
              s.base || s.branch,
              "HEAD",
            ])
            .split("\0")
            .filter(Boolean);
          const file = url.searchParams.get("path");
          if (!file) return json(res, 200, { files });
          if (!files.includes(file)) throw new Error("文件不在改动列表");
          let content,
            deleted = false;
          try {
            content = execFileSync(
              "git",
              ["-C", s.path, "show", "HEAD:" + file],
              { maxBuffer: 8000000, stdio: ["ignore", "pipe", "pipe"] },
            );
          } catch {
            deleted = true;
            content = execFileSync(
              "git",
              ["-C", s.path, "show", (s.base || s.branch) + ":" + file],
              { maxBuffer: 8000000 },
            );
          }
          const diff = engine.git(s.path, [
            "diff",
            s.base || s.branch,
            "HEAD",
            "--",
            file,
          ]);
          const image = /\.(png|jpe?g|gif|webp)$/i.test(file);
          return json(res, 200, {
            file,
            deleted,
            diff,
            image,
            content: image
              ? content.toString("base64")
              : content.toString("utf8"),
          });
        }
        if (action === "diff")
          return json(res, 200, {
            diff: engine
              .git(s.path, ["diff", s.base || s.branch, "HEAD"])
              .slice(0, 100000),
          });
        return json(res, 200, { ok: true });
      }
      if (p === "/api/stats/cycles") return json(res, 200, cycleStatistics(store.conversations()));
      if (p === "/api/stats")
        return json(res, 200, statistics(store.conversations()));
      if (p.startsWith("/api/")) return json(res, 404, { error: "接口不存在" });
      asset(p, res);
    } catch (e) {
      json(res, 400, { error: e.message });
    }
  },
);
function asset(p, res) {
  const files = {
    "/": "index.html",
    "/login": "login.html",
    "/login.js": "login.js",
    "/app.js": "app.js",
    "/vendor.mjs": "vendor.mjs",
    "/event-projection.mjs": "event-projection.mjs",
    "/studio/event-projection.mjs": "studio/event-projection.mjs",
    "/studio/draft-manager.mjs": "studio/draft-manager.mjs",
    "/studio/agent-graph.mjs": "studio/agent-graph.mjs",
    "/style.css": "style.css",
    "/viewport.css": "viewport.css",
    "/ui-package.css": "ui-package.css",
    "/lucide.min.js": "lucide.min.js",
    "/favicon.svg": "favicon.svg",
  };
  if (!files[p]) return json(res, 404, { error: "页面不存在" });
  let f = join(root, "public", files[p]);
  res.writeHead(200, {
    "Content-Type": {
      ".html": "text/html; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".mjs": "application/javascript; charset=utf-8",
      ".svg": "image/svg+xml",
      ".css": "text/css; charset=utf-8",
    }[extname(f)],
    "Cache-Control": "no-store",
  });
  res.end(readFileSync(f));
}
server.on("upgrade", (req, socket) => {
  socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
  socket.destroy();
});
server.on("error", (e) => {
  console.error(`服务无法启动：${e.code} ${e.message}`);
  process.exitCode = 1;
});
server.listen(
  Number(process.env.NY_PORT || config.port),
  process.env.NY_HOST || config.host,
  () => {
    console.log(
      "NickYoung HTTPS listening on " + (process.env.NY_PORT || config.port),
    );
    engine.recover();
  },
);
process.on("SIGTERM", () => {
  engine.shutdown();
  for (const r of clients) r.end();
  server.close(() => process.exit(0));
});
