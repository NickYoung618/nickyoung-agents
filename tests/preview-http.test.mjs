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

test('P2 HTTPS：真实创建 adaptive direct 会话，创建响应、事件及状态一致；默认创建仍 legacy',async()=>{
  const {plan}=await import('./workflow-fixtures.mjs');
  const f=await previewService();
  try {
    const p=plan(1,'checks_only');
    p.scope=['.nickyoung/'];p.contractPaths=[];p.tasks[0].scope=p.scope;p.tasks[0].executorId='实现';p.gates[0].scope=p.scope;
    p.gates[0].commands=[`node -e "require('node:assert/strict').ok(require('node:fs').existsSync('.nickyoung/项目须知.md'))"`];
    const response=await f.request('/api/conversations',{text:'隔离 direct 标识检查',workflowVersion:'adaptive_v1',directPlan:{members:[{name:'实现',role:'执行',tier:'main'}],plan:p}},f.cookie);
    assert.equal(response.status,200,response.body);
    const created=JSON.parse(response.body);
    assert.equal(created.workflowVersion,'adaptive_v1');
    const runtime=JSON.parse((await f.request('/api/runtime',undefined,f.cookie)).body);
    assert.deepEqual(created.runtimeInfo,runtime);
    let s;
    for(let i=0;i<150;i++){
      s=JSON.parse((await f.request('/api/state',undefined,f.cookie)).body).find(s=>s.id===created.id);
      if(s.status==='done')break;
      await new Promise(r=>setTimeout(r,40));
    }
    assert.equal(s.status,'done',JSON.stringify(s.events.slice(-5)));
    assert.equal(s.events.find(e=>e.type==='created').data.workflowVersion,'adaptive_v1');
    assert.equal(s.cycle.deliveryTarget,'downloadable_source');
    assert.equal(s.events.filter(e=>e.type==='run_start'&&e.data.role==='planner').length,0);
    const legacy=JSON.parse((await f.request('/api/conversations',{text:'隔离默认流程'},f.cookie)).body);
    assert.equal(legacy.workflowVersion,'legacy');
  }finally{await f.close();}
});

test('P2 HTTPS：源码路径与下载包排除凭据，管理目录链接逃逸拒绝，删除工作区后产物仍可访问',async()=>{
  const {writeFileSync,mkdirSync,symlinkSync,unlinkSync,rmSync}=await import('node:fs');
  const {execFileSync}=await import('node:child_process');
  const f=await previewService();
  try{
    writeFileSync(f.path+'/.env','PREVIEW_FIXTURE_SECRET=hidden');
    writeFileSync(f.path+'/private.key','hidden fixture key');
    f.git(['add','-f','.env','private.key']);f.git(['commit','-m','credential exclusion fixture']);
    const route='/api/conversations/animation';
    const {artifacts:[a]}=JSON.parse((await f.request(route+'/preview',{},f.cookie)).body);
    const source=await f.request(route+'/artifacts/'+a.artifactId+'/source',undefined,f.cookie);
    writeFileSync(f.dir+'/source.zip',source.buffer);
    const entries=execFileSync('unzip',['-Z1',f.dir+'/source.zip'],{encoding:'utf8'});
    assert.doesNotMatch(entries,/\.env|private\.key|node_modules|\.git\//);
    assert.match(entries,/src\/animation.ts/);
    assert.equal((await f.request(route+'/source-file?path=README.md')).status,401);
    const sourceFile=await f.request(route+'/source-file?path=README.md',undefined,f.cookie);
    assert.equal(sourceFile.status,200);assert.match(JSON.parse(sourceFile.body).content,/具身智能/);
    for(const path of ['../data/config.json','/etc/passwd','.env','private.key'])assert.equal((await f.request(route+'/source-file?path='+encodeURIComponent(path),undefined,f.cookie)).status,400);
    unlinkSync(f.path+'/src/main.ts');
    const deleted=JSON.parse((await f.request(route+'/source-file?path=src%2Fmain.ts',undefined,f.cookie)).body);
    assert.equal(deleted.deleted,true);assert.match(deleted.diff,/deleted file/);
    symlinkSync(f.data+'/config.json',f.path+'/leak.json');
    assert.equal((await f.request(route+'/source-file?path=leak.json',undefined,f.cookie)).status,400);
    const content=route+'/artifacts/'+a.artifactId+'/content';
    const managed=f.data+'/artifacts/'+a.artifactId+'/index.html';
    unlinkSync(managed);symlinkSync(f.data+'/config.json',managed);
    assert.equal((await f.request(content,undefined,f.cookie)).status,404);
    unlinkSync(managed);writeFileSync(managed,'<h1>managed fixture</h1>');
    rmSync(f.path,{recursive:true,force:true});
    assert.equal((await f.request(content,undefined,f.cookie)).status,200);
    assert.equal((await f.request(route+'/artifacts/'+a.artifactId+'/source',undefined,f.cookie)).status,200);
  }finally{await f.close();}
});
