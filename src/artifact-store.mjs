import { mkdirSync, writeFileSync, readFileSync, realpathSync } from "node:fs";
import { join, basename } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { safeFile } from "./static-preview.mjs";
export class ArtifactStore {
  constructor(engine) {
    this.engine = engine;
    this.root = join(engine.config.data, "artifacts");
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
  }
  list(c) {
    return this.engine.state(c).artifacts || [];
  }
  get(c, id) {
    const found = this.list(c).find((a) => a.artifactId === id);
    if (!found) throw Error("该会话没有此产物");
    return found;
  }
  read(c, id, source = false) {
    const a = this.get(c, id),
      root = join(this.root, a.artifactId);
    return {
      artifact: a,
      data: readFileSync(safeFile(root, source ? "source.zip" : a.entry)),
    };
  }
  register(c, metadata, data, sourceZip) {
    const signature = createHash("sha256")
      .update(data)
      .update(
        JSON.stringify([
          metadata.logicalKey,
          metadata.sourceCommit,
          metadata.sourceReferenceCommit,
          metadata.cycleId,
        ]),
      )
      .digest("hex");
    const old = this.list(c).find(
      (a) => a.signature === signature && a.logicalKey === metadata.logicalKey,
    );
    if (old) return old;
    const artifactId = randomUUID(),
      root = join(this.root, artifactId);
    mkdirSync(root, { mode: 0o700 });
    const entry =
      metadata.kind === "static_page" ? "index.html" : basename(metadata.entry);
    writeFileSync(join(root, entry), data, { mode: 0o600 });
    if (sourceZip)
      writeFileSync(join(root, "source.zip"), sourceZip, { mode: 0o600 });
    const a = {
      ...metadata,
      artifactId,
      conversationId: c,
      cycleId: metadata.cycleId ?? null,
      taskId: metadata.taskId ?? null,
      gateId: metadata.gateId ?? null,
      runId: metadata.runId ?? null,
      sourceCommit: metadata.sourceCommit ?? null,
      sourceTreeHash: metadata.sourceTreeHash ?? null,
      artifactVersion:
        this.list(c).filter((x) => x.logicalKey === metadata.logicalKey)
          .length + 1,
      entry,
      createdAt: new Date().toISOString(),
      status: "ready",
      validationStatus: "draft",
      buildEvidenceIds: metadata.buildEvidenceIds || [],
      safeDownloadName:
        metadata.kind === "static_page" ? "preview.html" : entry,
      hasSource: !!sourceZip,
      signature,
    };
    this.engine.event(c, "artifact_ready", a);
    return a;
  }
}
