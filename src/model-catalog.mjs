import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

function transport(binary, args) {
  const child = spawn(binary, args, {
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
  });
  let buffer = "",
    stderr = "",
    nextId = 1;
  const pending = new Map();
  function stop() {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
  }
  function fail(error) {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    pending.clear();
  }
  child.stdin.on("error", fail);
  child.stderr.on("data", (chunk) => (stderr += chunk));
  child.on("error", fail);
  child.on("close", () => fail(new Error(stderr.trim() || "目录进程已退出")));
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      const id = event.id ?? event.response?.request_id,
        request = pending.get(String(id));
      if (!request) continue;
      pending.delete(String(id));
      clearTimeout(request.timer);
      if (event.error)
        request.reject(
          new Error(event.error.message || JSON.stringify(event.error)),
        );
      else if (event.response?.subtype === "error")
        request.reject(new Error(event.response.error || "目录请求失败"));
      else request.resolve(event.result ?? event.response?.response);
    }
  });
  return {
    request(method, params, claude = false) {
      const id = String(nextId++);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error("读取模型目录超时"));
          stop();
        }, 20000);
        pending.set(id, { resolve, reject, timer });
        const packet = claude
          ? {
              type: "control_request",
              request_id: id,
              request: { subtype: method, ...params },
            }
          : { id: Number(id), method, params };
        child.stdin.write(JSON.stringify(packet) + "\n", (error) => {
          if (error) {
            clearTimeout(timer);
            pending.delete(id);
            reject(error);
          }
        });
      });
    },
    notify(method) {
      child.stdin.write(JSON.stringify({ method }) + "\n");
    },
    stop,
  };
}

export function codexModels(rows, source = "codex/model/list") {
  return rows.map((m) => ({
    channel: "codex",
    model: m.model || m.slug || m.id,
    name: m.displayName || m.display_name || m.model || m.slug || m.id,
    description: m.description || "",
    efforts: (
      m.supportedReasoningEfforts ||
      m.supported_reasoning_levels ||
      []
    ).map((e) => e.reasoningEffort || e.effort),
    defaultEffort: m.defaultReasoningEffort || m.default_reasoning_level || "",
    hidden: m.hidden ?? m.visibility === "hide",
    inputModalities: m.inputModalities || m.input_modalities || [],
    source,
    discovered: true,
  }));
}
export function claudeModels(rows) {
  const models = [];
  for (const m of rows) {
    const base = {
      channel: "claude",
      model: m.value,
      name: m.displayName || m.value,
      description: m.description || "",
      resolvedModel: m.resolvedModel || "",
      efforts: m.supportedEffortLevels || [],
      defaultEffort: m.defaultEffort || "",
      effortCapability:
        m.supportsEffort === false
          ? "none"
          : m.supportedEffortLevels?.length
            ? "declared"
            : "unknown",
      hidden: false,
      source: "claude/initialize",
      discovered: true,
    };
    models.push(base);
    if (
      m.resolvedModel &&
      m.resolvedModel !== m.value &&
      !models.some((x) => x.model === m.resolvedModel) &&
      !rows.some((x) => x.value === m.resolvedModel)
    )
      models.push({ ...base, model: m.resolvedModel, name: m.resolvedModel });
  }
  return models;
}
async function codexCatalog() {
  const rpc = transport(process.env.NY_CODEX || "codex", [
    "app-server",
    "--stdio",
    "-c",
    'model_provider="openai"',
  ]);
  try {
    const init = await rpc.request("initialize", {
      clientInfo: { name: "nickyoung_catalog", version: "1.0.0" },
    });
    rpc.notify("initialized");
    let cursor = null,
      rows = [];
    do {
      const page = await rpc.request("model/list", {
        includeHidden: true,
        limit: 100,
        cursor,
      });
      rows.push(...page.data);
      cursor = page.nextCursor;
    } while (cursor);
    return {
      id: "codex",
      name: "Codex / GPT",
      status: "discovered",
      source: "codex/model/list",
      version: init?.userAgent || "",
      models: codexModels(rows),
    };
  } catch (error) {
    const path = join(homedir(), ".codex/models_cache.json");
    if (existsSync(path)) {
      const d = JSON.parse(readFileSync(path));
      return {
        id: "codex",
        name: "Codex / GPT",
        status: "cached",
        source: "本机模型缓存",
        error: error.message,
        models: codexModels(d.models || [], "codex/models_cache.json"),
      };
    }
    throw error;
  } finally {
    rpc.stop();
  }
}
async function claudeCatalog() {
  const rpc = transport(process.env.NY_CLAUDE || "claude", [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--strict-mcp-config",
    "--setting-sources",
    "",
    "--tools",
    "",
    "--disable-slash-commands",
    "--settings",
    '{"disableAllHooks":true,"autoMemoryEnabled":false}',
  ]);
  try {
    const response = await rpc.request("initialize", {}, true);
    return {
      id: "claude",
      name: "Claude Code",
      status: "discovered",
      source: "claude/initialize",
      version: response.claude_code_version || "",
      models: claudeModels(response.models || []),
    };
  } finally {
    rpc.stop();
  }
}
export class ModelCatalog {
  constructor(data) {
    this.path = join(data, "model-catalog.json");
    this.value = existsSync(this.path)
      ? JSON.parse(readFileSync(this.path))
      : null;
    this.inflight = null;
  }
  async get(refresh = false) {
    if (this.inflight) return this.inflight;
    if (
      this.value &&
      !refresh &&
      Date.now() - Date.parse(this.value.scannedAt) < 300000
    )
      return this.value;
    this.inflight = this.scan().finally(() => (this.inflight = null));
    return this.inflight;
  }
  async scan() {
    const results = await Promise.allSettled([codexCatalog(), claudeCatalog()]);
    const channels = results.map((r, i) =>
      r.status === "fulfilled"
        ? r.value
        : {
            id: i ? "claude" : "codex",
            name: i ? "Claude Code" : "Codex / GPT",
            status: "unavailable",
            error: r.reason.message,
            models: [],
          },
    );
    this.value = {
      scannedAt: new Date().toISOString(),
      channels: channels.map(({ models, ...channel }) => ({
        ...channel,
        count: models.length,
      })),
      models: channels.flatMap((c) => c.models),
      note: "目录识别不发送生成请求；模型能否被当前账号调用，以真实连接测试为准。",
    };
    writeFileSync(this.path, JSON.stringify(this.value, null, 2), {
      mode: 0o600,
    });
    return this.value;
  }
}
