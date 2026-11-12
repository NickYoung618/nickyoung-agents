import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
export function captureRuntime(root) {
  const startedAt = new Date().toISOString();
  let buildCommit = null,
    branch = null,
    dirty = null,
    contentVersion = null;
  try {
    const git = (args) =>
      execFileSync("git", ["-C", root, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
    buildCommit = git(["rev-parse", "HEAD"]).trim();
    branch = git(["branch", "--show-current"]).trim();
    dirty = !!git(["status", "--porcelain"]);
    if (dirty) {
      const hash = createHash("sha256").update(
        git(["diff", "--binary", "HEAD"]),
      );
      for (const file of git([
        "ls-files",
        "--others",
        "--exclude-standard",
        "-z",
      ])
        .split("\0")
        .filter(Boolean))
        hash.update(file).update(readFileSync(join(root, file)));
      contentVersion = hash.digest("hex");
    } else contentVersion = buildCommit;
  } catch {}
  return Object.freeze({
    buildCommit,
    branch,
    dirty,
    contentVersion,
    startedAt,
    supportedWorkflowVersions: ["legacy", "adaptive_v1"],
    defaultWorkflowVersion: "legacy",
  });
}
