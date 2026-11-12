import test from "node:test";
import assert from "node:assert/strict";
import { previewService } from "./helpers/preview-service.mjs";
test("P0 HTTPS：鉴权预览/下载、会话归属、sandbox、runtime 与实际流程一致", async () => {
  const f = await previewService();
  try {
    assert.equal((await f.request("/api/runtime")).status, 401);
    const runtime = JSON.parse(
      (await f.request("/api/runtime", undefined, f.cookie)).body,
    );
    assert.ok(runtime.buildCommit);
    assert.equal(runtime.defaultWorkflowVersion, "legacy");
    const route = "/api/conversations/animation";
    const built = await f.request(route + "/preview", {}, f.cookie);
    assert.equal(built.status, 200, built.body);
    const a = JSON.parse(built.body).artifacts[0];
    assert.ok(a);
    const content = route + "/artifacts/" + a.artifactId + "/content";
    assert.equal((await f.request(content)).status, 401);
    assert.equal(
      (
        await f.request(
          "/api/conversations/other/artifacts/" + a.artifactId + "/content",
          undefined,
          f.cookie,
        )
      ).status,
      404,
    );
    const page = await f.request(content, undefined, f.cookie);
    assert.match(
      page.headers["content-security-policy"],
      /sandbox allow-scripts/,
    );
    assert.doesNotMatch(
      page.headers["content-security-policy"],
      /allow-same-origin/,
    );
    assert.match(page.body, /requestAnimationFrame/);
    assert.match(page.body, /nickyoung-preview/);
    assert.equal(
      (await f.request(content + "/..%2f..%2fconfig.json", undefined, f.cookie))
        .status,
      404,
    );
    const download = await f.request(
      route + "/artifacts/" + a.artifactId + "/download",
      undefined,
      f.cookie,
    );
    assert.match(download.headers["content-disposition"], /^attachment/);
    const source = await f.request(
      route + "/artifacts/" + a.artifactId + "/source",
      undefined,
      f.cookie,
    );
    assert.equal(source.buffer.subarray(0, 2).toString(), "PK");
    assert.equal(
      (await f.request(route + "/preview", { path: "/etc" }, f.cookie)).status,
      400,
    );
    const state = JSON.parse(
      (await f.request("/api/state", undefined, f.cookie)).body,
    ).find((s) => s.id === "animation");
    assert.equal(state.workflowVersion, "legacy");
    assert.equal(state.artifacts[0].sourceCommit, null);
    assert.equal(state.artifacts[0].validationStatus, "draft");
  } finally {
    await f.close();
  }
});
