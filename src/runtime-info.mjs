import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
export function captureRuntime(root) {
  const startedAt = new Date().toISOString();
  if(existsSync(join(root,'release.json'))){const release=JSON.parse(readFileSync(join(root,'release.json')));return Object.freeze({buildCommit:release.revision,branch:null,dirty:false,contentVersion:release.revision,startedAt,supportedWorkflowVersions:['legacy','adaptive_v1'],defaultWorkflowVersion:'legacy'});}
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
      const hash = createHash("sha256");
      const paths = new Set([
        ...git(['diff','--name-only','-z','HEAD']).split('\0'),
        ...git(['ls-files','--others','--exclude-standard','-z']).split('\0'),
      ]);
      for (const file of [...paths].filter(Boolean).sort()) {
        const path = join(root,file);
        hash.update(file).update('\0');
        hash.update(existsSync(path) ? readFileSync(path) : '<deleted>');
      }
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
