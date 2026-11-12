import { existsSync, readFileSync, readdirSync, lstatSync } from "node:fs";
import { join, extname } from "node:path";
import { execFileSync } from "node:child_process";
import { ArtifactStore } from "./artifact-store.mjs";
import { bundleStatic, safeFile } from "./static-preview.mjs";
const buildCommand = (c) =>
  /^\s*(?:npm|pnpm|yarn)\s+(?:run\s+)?build(?:\s|$)/.test(c) ||
  /^\s*(?:npx\s+)?vite\s+build(?:\s|$)/.test(c);
export class PreviewManager {
  constructor(engine) {
    this.engine = engine;
    this.store = new ArtifactStore(engine);
    this.active = new Map();
    this.pending = new Map();
  }
  status(c, patch) {
    this.engine.event(c, "preview_status", patch);
  }
  async request(c, options = {}) {
    const s = this.engine.state(c);
    if (!s.id || !s.path) throw Error("对话不存在");
    this.pending.set(c, options);
    if (this.active.has(s.path)) {
      await this.active.get(s.path);
      if (this.pending.has(c)) return this.request(c, this.pending.get(c));
      return this.store.list(c);
    }
    const job = (async () => {
      while (this.pending.has(c)) {
        const input = this.pending.get(c);
        this.pending.delete(c);
        await this.generate(c, input);
      }
    })();
    this.active.set(s.path, job);
    try {
      await job;
    } finally {
      this.active.delete(s.path);
    }
    return this.store.list(c);
  }
  sourceZip(cwd, commit) {
    if (!commit) return null;
    const paths = this.engine
      .git(cwd, ["ls-tree", "-r", "--name-only", "-z", commit])
      .split("\0")
      .filter(
        (f) =>
          f &&
          !f
            .split("/")
            .some(
              (p) =>
                (p.startsWith(".") && p !== ".gitignore") ||
                p === "node_modules",
            ) &&
          /\.(?:[cm]?js|[jt]sx?|json|html|css|scss|md|svg|png|webp|gitignore)$/i.test(
            f,
          ),
      );
    if (!paths.length) return null;
    return execFileSync(
      "git",
      ["-C", cwd, "archive", "--format=zip", commit, "--", ...paths],
      { maxBuffer: 32 * 1024 * 1024 },
    );
  }
  async generate(c, input) {
    const s = this.engine.state(c),
      cwd = input.cwd || s.path,
      commit = input.sourceCommit || null;
    this.status(c, {
      status: "building",
      reason: "正在整理静态产物，继续保留上次成功版本",
      startedAt: new Date().toISOString(),
    });
    try {
      const dist = join(cwd, "dist"),
        root = existsSync(join(dist, "index.html")) ? dist : cwd;
      if (!existsSync(join(root, "index.html")))
        throw Error(
          "尚无静态页面产物；需要后台服务的项目暂不支持内嵌预览，可查看文件与改动",
        );
      const observed = this.engine.git(cwd, ["rev-parse", "HEAD"]);
      if (commit && observed !== commit)
        throw Error("构建提交已变化，本次产物未登记");
      const html = await bundleStatic(root);
      if (commit && this.engine.git(cwd, ["diff", "HEAD"]))
        throw Error("源码在预览整理期间发生变化");
      const a = this.store.register(
        c,
        {
          kind: "static_page",
          title: "作品预览",
          logicalKey: "page",
          sourceCommit: commit,
          sourceReferenceCommit: observed,
          sourceTreeHash: commit
            ? this.engine.git(cwd, ["rev-parse", commit + "^{tree}"])
            : null,
          provenance: commit
            ? "fixed_commit_build"
            : "existing_output_unattested",
          cycleId: input.cycleId ?? s.cycleId ?? null,
          taskId: input.taskId ?? null,
          gateId: input.gateId ?? null,
          runId: input.runId ?? null,
          buildEvidenceIds: input.buildEvidenceIds || [],
          entry: "index.html",
        },
        html,
        this.sourceZip(cwd, observed),
      );
      this.status(c, {
        status: "ready",
        artifactId: a.artifactId,
        reason: "静态预览可用；验收状态另行显示",
        readyAt: new Date().toISOString(),
      });
      this.validate(c);
      return a;
    } catch (error) {
      this.status(c, {
        status: "failed",
        reason: error.message.slice(0, 1200),
        failedAt: new Date().toISOString(),
      });
      this.engine.event(c, "artifact_failed", {
        reason: error.message.slice(0, 1200),
        cycleId: input.cycleId ?? s.cycleId ?? null,
        buildEvidenceIds: input.buildEvidenceIds || [],
      });
      return null;
    }
  }
  async completed(c, { cwd, command, commit, ...metadata }) {
    if (buildCommand(command))
      await this.request(c, { cwd, sourceCommit: commit, ...metadata });
    if (/(?:test:e2e|playwright\s+test)/.test(command))
      this.collectEvidence(c, cwd, commit, metadata);
  }
  collectEvidence(c, cwd, commit, metadata = {}) {
    const root = join(cwd, "test-results");
    if (!existsSync(root)) return;
    let count = 0;
    const walk = (dir, prefix = "") => {
      for (const name of readdirSync(dir)) {
        const rel = prefix + name,
          p = join(dir, name);
        if (++count > 128) return;
        if (lstatSync(p).isSymbolicLink()) continue;
        if (lstatSync(p).isDirectory()) {
          walk(p, rel + "/");
          continue;
        }
        if (
          ![".png", ".jpg", ".jpeg", ".webp", ".json", ".txt"].includes(
            extname(name),
          )
        )
          continue;
        try {
          const data = readFileSync(safeFile(root, rel));
          this.store.register(
            c,
            {
              kind: /\.(png|jpe?g|webp)$/.test(name) ? "image" : "evidence",
              title: rel,
              logicalKey: "test-results/" + rel,
              entry: name,
              sourceCommit: commit,
              sourceTreeHash: commit
                ? this.engine.git(cwd, ["rev-parse", commit + "^{tree}"])
                : null,
              ...metadata,
            },
            data,
          );
        } catch {}
      }
    };
    walk(root);
  }
  validate(c) {
    const s = this.engine.state(c);
    for (const a of this.store.list(c)) {
      if (a.validationStatus === "verified" || !a.sourceCommit) continue;
      const verified =
        s.workflowVersion === "adaptive_v1"
          ? s.cycles?.some(
              (x) =>
                x.phase === "delivered" &&
                x.cycleId === a.cycleId &&
                x.finalCommit === a.sourceCommit,
            )
          : s.tasks.some(
              (t) =>
                t.status === "passed" &&
                t.commit === a.sourceCommit &&
                (!a.taskId || a.taskId === t.id),
            );
      if (verified)
        this.engine.event(c, "artifact_validation", {
          artifactId: a.artifactId,
          validationStatus: "verified",
        });
    }
  }
}
