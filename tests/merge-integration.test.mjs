import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import https from 'node:https';
import {Store,project} from '../src/store.mjs';
import {captureRuntime} from '../src/runtime-info.mjs';
import {launchFixture} from './artifact-repair-fixture.mjs';

test('整合：自适应批次、静态草稿和成果目标经过投影落盘及重启后保持一致',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ny-merged-state-')),file=join(dir,'events.sqlite');let store=new Store(file);
 store.append('c','created',{title:'integrated',workflowVersion:'adaptive_v1'});
 store.append('c','cycle',{cycleId:'cycle',planRevision:1,phase:'executing',gates:[]});
 store.append('c','task',{id:'task',cycleId:'cycle',planRevision:1,status:'queued'});
 store.append('c','task_update',{id:'task',status:'implemented'});
 store.append('c','artifact_ready',{artifactId:'static',status:'ready',kind:'static_page'});
 store.append('c','intent',{goal:'保留两种成果',criteria:'验证当前提交'});
 for(let n=0;n<120;n++)store.append('c','process',{text:'stream '+n});
 const replay=project(store.events('c')),cached=store.state('c');assert.deepEqual(cached.cycle,replay.cycle);assert.deepEqual(cached.artifacts,replay.artifacts);assert.equal(cached.intent.goal,'保留两种成果');store.db.close();
 store=new Store(file);assert.equal(store.state('c').cycle.tasks[0].status,'implemented');assert.equal(store.state('c').artifacts[0].artifactId,'static');store.db.close();
});

test('整合：同一会话的结构化成果与静态预览可分别列出、下载和运行',async()=>{
 const f=await launchFixture(18945);try{
  const c=f.source.conversationId,base=`conversations/${c}`,before=(await f.call(base+'/artifacts')).body;assert.ok(Array.isArray(before));
  writeFileSync(join(before[0].project,'index.html'),'<h1>独立静态草稿</h1>');
  const built=await f.call(base+'/preview',{});assert.equal(built.status,200);const draft=built.body.artifacts.find(a=>a.kind==='static_page');assert.ok(draft);
  const list=(await f.call(base+'/artifacts?view=preview')).body;assert.ok(list.artifacts.some(a=>a.artifactId===draft.artifactId));assert.equal((await f.call(base+'/artifacts')).body.length,before.length);
  const download=await new Promise((yes,no)=>https.get(f.origin+`/api/${base}/artifacts/${draft.artifactId}/download`,{rejectUnauthorized:false,headers:{Cookie:'ny_session='+f.token}},res=>{let data='';res.on('data',x=>data+=x);res.on('end',()=>yes({status:res.statusCode,data}));}).on('error',no));assert.equal(download.status,200);assert.match(download.data,/独立静态草稿/);
  const web=before.filter(a=>a.type==='web').at(-1),started=await f.call(f.base(web)+'/start',{});assert.equal(started.status,200);assert.equal(started.body.preview.status,'running');assert.equal((await f.call(f.base(web))).body.commit,web.commit);
 }finally{await f.close();}
});

test('整合：固定发布目录的运行标识使用发布提交，不误报外层工作区 HEAD',()=>{
 const root=mkdtempSync(join(tmpdir(),'ny-runtime-release-'));writeFileSync(join(root,'release.json'),JSON.stringify({revision:'immutable-release-commit'}));const actual=captureRuntime(root);assert.equal(actual.buildCommit,'immutable-release-commit');assert.equal(actual.dirty,false);assert.ok(actual.supportedWorkflowVersions.includes('adaptive_v1'));
});
