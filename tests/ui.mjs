import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
const out = new URL('../evidence/ux-vnext/', import.meta.url);
const adaptiveOut=new URL('../evidence/adaptive/ui/',import.meta.url);mkdirSync(adaptiveOut,{recursive:true});
mkdirSync(out, {recursive:true});
const evidence = [], errors = [], streams = new Set();
let createBody,lastMessage;
const currentUiVersion=readFileSync(new URL('../public/index.html',import.meta.url),'utf8').match(/data-ui-version="([^"]+)"/)[1];
let baseline = false, failCreate = true, createCount = 0, version=currentUiVersion;
const makeState = (n=3,count=30) => ({ id:'fixture', title:'为现有项目增加命令行工具并完成独立审查与验收', path:'/isolated/ux-fixture', branch:'ux-fixture',status:'working',
  members:Array.from({length:n},(_,i)=>({id:i===0?'leader':`m${i}`,name:['知行','砚舟','青禾','时雨','松间','北辰','鹿鸣','云起'][i]||`成员${i}`,role:i===0?'负责人':i===2?'审查者':'实现者',model:'fixture-model',effort:'medium',status:i===1?'running':'idle'})),
  tasks:[{id:'t1',title:'实现命令行工具',member:'m1',reviewer:'m2',status:'running',failures:0,description:'实际运行命令验收',commands:['node --test']}],questions:[],
  events:[{id:1,type:'message',time:'2026-11-12T12:00:00Z',data:{member:'user',text:'请增加命令行工具'}},...Array.from({length:count},(_,i)=>({id:i+2,type:i%4?'process':'message',time:'2026-11-12T12:01:00Z',data:i%4?{member:'m1',event:{type:'output',text:'fixture output'}}:{member:'leader',text:`关键进展 ${i}\n${'可追溯的工作说明。'.repeat(24)}`}})),{id:count+2,type:'task',time:'2026-11-12T12:02:00Z',data:{id:'t1',title:'实现命令行工具',member:'m1',reviewer:'m2'}}] });
let state = [makeState()];
const send = () => { for(const stream of streams) stream.write('data: {}\n\n'); };
const server = createServer(async (req,res)=>{
  const url = new URL(req.url,'http://localhost');
  const json = (data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  if(url.pathname==='/api/events'){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});res.write(': ready\n\n');streams.add(res);req.on('close',()=>streams.delete(res));return;}
  if(url.pathname==='/api/state') return json(state);
  if(url.pathname==='/api/ui-version') return json({version:baseline?'20261112-screen-4':version});
  if(url.pathname==='/api/conversations') {let body='';for await(const chunk of req)body+=chunk;createBody=JSON.parse(body);createCount++;await new Promise(r=>setTimeout(r,200)); if(failCreate)return json({error:'fixture 创建失败'},400);const s=makeState();s.id='created-fixture';state.push(s);return json({id:s.id});}
  if(url.pathname.endsWith('/answer')){state[0].questions=[];return json({ok:true});}
  if(url.pathname.endsWith('/pause')){state[0].status='paused';return json({ok:true});}
  if(url.pathname.endsWith('/resume')){state[0].status='working';return json({ok:true});}
  if(url.pathname.endsWith('/message')) {let body='';for await(const chunk of req)body+=chunk;lastMessage=JSON.parse(body);return json({ok:true});}
  if(url.pathname.endsWith('/files')) return json({files:['README.md']});
  if(url.pathname==='/api/config') return json({leader:{channel:'codex',model:'fixture-model',effort:'medium'},tiers:[],names:[],concurrency:2,timeout:60000});
  if(url.pathname==='/api/model-catalog/scan') return json({channels:[],models:[],scannedAt:new Date().toISOString(),note:'隔离目录'});
  if(url.pathname==='/api/model-catalog') return json({channels:[],models:[],scannedAt:new Date().toISOString(),note:'隔离目录'});
  if(url.pathname==='/api/stats') return json([]);
  if(url.pathname==='/api/test') return json({error:'fixture 账号不支持该模型'},400);
  if(url.pathname==='/api/models') return json([]);
  if(url.pathname.startsWith('/api/')) return json({});
  try{
    const file=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));
    const body=baseline?execFileSync('git',['show',`b517b30:public/${file}`],{stdio:['ignore','pipe','ignore']}):readFileSync(new URL(`../public/${file}`,import.meta.url));
    res.writeHead(200,{'Content-Type':file.endsWith('.css')?'text/css':/\.(mjs|js)$/.test(file)?'text/javascript':'text/html'});res.end(body);
  }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
try {
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1536,height:864}});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));
 const load=async()=>{await page.goto(origin);await page.waitForFunction(()=>document.querySelector('#homeRecent button'));};
 baseline=true;await load();await page.screenshot({animations:'disabled',path:new URL('baseline-home.png',out).pathname});await page.click('[data-view-nav="task"]');await page.screenshot({animations:'disabled',path:new URL('baseline-task.png',out).pathname});baseline=false;
 await load();
 await page.locator('details').filter({has:page.locator('#workflowVersion')}).locator('summary').click();await page.selectOption('#workflowVersion','adaptive_v1');await page.fill('#homeInput','创建失败后仍保留的需求');await page.selectOption('#projectSelect','__custom');await page.fill('#path','/isolated/new-project');
 await page.locator('#fileInput').setInputFiles({name:'reference.txt',mimeType:'text/plain',buffer:Buffer.from('fixture attachment')});
 await page.evaluate(()=>{document.querySelector('#homeStart').click();document.querySelector('#homeStart').click();}); await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('发送未完成'));
 assert.equal(await page.inputValue('#homeInput'),'创建失败后仍保留的需求');assert.equal(await page.inputValue('#path'),'/isolated/new-project');assert.equal(createCount,1);assert.equal(createBody.workflowVersion,'adaptive_v1');assert.equal(createBody.files[0].name,'reference.txt');assert.match(await page.locator('#homeAttachments').textContent(),/reference.txt/);
 await page.reload();await page.waitForSelector('#homeRecent button');assert.equal(await page.inputValue('#homeInput'),'创建失败后仍保留的需求');assert.equal(await page.inputValue('#path'),'/isolated/new-project');assert.equal(await page.inputValue('#workflowVersion'),'adaptive_v1');
 evidence.push('创建失败保留需求与项目选择，刷新恢复草稿');
 await page.click('[data-view-nav="task"]');await page.screenshot({animations:'disabled',path:new URL('working-light.png',out).pathname});await page.fill('#input','会话独立草稿');
 await page.click('#executionLog > summary');await page.waitForSelector('#rawEvents details');await page.click('#rawEvents details:last-child > summary');
 const before=await page.evaluate(()=>{const box=document.querySelector('#messages');box.scrollTop=100;return box.scrollTop;});
 const id=state[0].events.at(-1).id+1;state[0].events.push({id,type:'message',time:new Date().toISOString(),data:{member:'leader',text:'新的实际事件'}});send();
 await page.waitForFunction(()=>document.querySelector('#messages').textContent.includes('新的实际事件'));
 assert.ok(await page.locator('#executionLog').getAttribute('open')!==null);assert.equal(await page.inputValue('#input'),'会话独立草稿');assert.ok(Math.abs(await page.locator('#messages').evaluate(n=>n.scrollTop)-before)<4);
 assert.ok(await page.locator('#rawEvents details[open]').count());evidence.push('SSE 更新保留输入、滚动位置和展开日志');
 assert.equal(await page.locator('#updateBanner').isVisible(),false);
 version='new-fixture-version'; await page.evaluate(()=>{for(const item of []){} });
 // Reconnecting re-checks version and must offer a user-controlled update.
 for(const stream of streams) stream.end();
 await page.waitForSelector('#updateBanner:not([hidden])',{timeout:10000});assert.equal(await page.inputValue('#input'),'会话独立草稿');evidence.push('版本变化提示主动更新，保留输入');version=currentUiVersion;
 await page.click('#new');await page.click('#homeRecent button');assert.equal(await page.inputValue('#input'),'会话独立草稿');
 for(const n of [1,2,3,4,6,8]) {
   state=[makeState(n)];send(); await page.waitForFunction(n=>document.querySelectorAll('#liveGraph .ny-node').length===n,n);
   const bounds=await page.locator('#liveGraph .ny-node').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};}));
   for(let i=0;i<bounds.length;i++)for(let j=i+1;j<bounds.length;j++){const a=bounds[i],b=bounds[j];assert.ok(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y,`overlap ${n}`);}
 }
 evidence.push('1/2/3/4/6/8 人布局无重叠');
 state=[makeState(10)];send();await page.waitForFunction(()=>document.querySelector('#liveGraph').textContent.includes('其他 3 人'));assert.equal(await page.locator('.ny-node').count(),8);await page.click('[data-studio-member="__others"]');assert.match(await page.locator('#liveDetailTitle').textContent(),/其他团队成员/);evidence.push('超过 8 人聚合，成员详情可访问');
 state=[makeState()];send();await page.waitForFunction(()=>document.querySelectorAll('.ny-node').length===3);
 await page.emulateMedia({reducedMotion:'reduce'});
 state[0].events.push({id:40,type:'task_update',time:new Date().toISOString(),data:{id:'t1',status:'review'}});send();
 await page.waitForFunction(()=>document.querySelector('#liveEvents').textContent.includes('送审'));
 assert.equal(await page.locator('animateMotion').count(),0);
 await page.emulateMedia({reducedMotion:'no-preference'});
 state[0].events.push({id:41,type:'review',time:new Date().toISOString(),data:{task:'t1',verdict:'return',message:'需要返修'}});send();
 await page.waitForFunction(()=>document.querySelector('#liveEvents').textContent.includes('退回修改'));
 assert.equal(await page.locator('animateMotion').count(),1);
 send();await page.waitForTimeout(350);assert.equal(await page.locator('animateMotion').count(),1);
 await page.click('[data-studio-member="m1"]');const detail=await page.locator('#liveDetailTitle').textContent();
 state[0].status='paused';send();await page.waitForFunction(()=>document.querySelector('#liveStatus').textContent==='已暂停');assert.equal(await page.locator('animateMotion').count(),0);assert.equal(await page.locator('#liveDetailTitle').textContent(),detail);
 evidence.push('新交接单次动画，减少动态效果与暂停无动画，选中成员保持');

 state=[makeState()];send();await page.waitForFunction(()=>document.querySelectorAll('.ny-node').length===3);
 for(const count of [500,2000,5000]) {
   state=[makeState(3,count)];await page.evaluate(()=>performance.clearResourceTimings());const start=performance.now();send();await page.waitForFunction(count=>document.querySelector('#executionLog summary').textContent.includes(String(count+2)),count);
   const ms=performance.now()-start;const renderMs=await page.evaluate(()=>{const r=performance.getEntriesByType('resource').filter(e=>e.name.endsWith('/api/state')).at(-1);return r ? Math.round(performance.now()-r.responseEnd) : null;});const rawNodes=await page.locator('#rawEvents details').count();assert.ok(rawNodes<=103,`raw log rendered too many nodes: ${rawNodes}`);assert.ok(await page.locator('#messages > .message').count()<=8);await page.fill('#input',`历史 ${count} 条仍可输入`);evidence.push({events:count,wallMs:Math.round(ms),renderObservationUpperBoundMs:renderMs,includesSSEDebounce:true});
 }
 state=[makeState(4)];state[0].questions=[{id:'q',question:'是否只允许登录用户访问？',yes:'仅登录用户可用',no:'允许公开访问',answered:false}];send();
 await page.waitForSelector('#questions .question');await page.click('[data-view-nav="decision"]');await page.screenshot({animations:'disabled',path:new URL('decisions-pending-light.png',out).pathname});await page.click('#decisionContent [data-decision="true"]');await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('决定已记录'));evidence.push('决策选项清楚，答复后确认');
 state[0].status='done';state[0].tasks[0].status='passed';state[0].events.push({id:99,type:'task_update',time:new Date().toISOString(),data:{id:'t1',status:'passed'}},{id:100,type:'check',time:new Date().toISOString(),data:{task:'t1',passed:true,command:'node --test',output:'fixture only'}},{id:101,type:'review',time:new Date().toISOString(),data:{task:'t1',verdict:'pass',commit:'fixture123'}},{id:102,type:'report',time:new Date().toISOString(),data:{text:'已完成命令行工具。\n使用：node cli.mjs\n本页是 UI 测试夹具。'}});send();
 await page.click('[data-view-nav="result"]');await page.waitForSelector('.evidence-strip');assert.match(await page.locator('#resultContent').textContent(),/机器验收通过 1 次/);evidence.push('交付摘要和真实事件计数入口');
 for(const mode of ['checks_only','final_review','local_repair','checkpoint_wait','escalation','paused','resumed']) {
   const policy=mode==='checks_only'?'checks_only':mode==='checkpoint_wait'?'checkpoint_plus_final':'final_review';
   const x={cycleId:'cycle-'+mode,policy,reason:'明确范围、可逆修改与客观检查',phase:mode==='checkpoint_wait'?'validating':mode==='escalation'?'blocked':['paused','resumed'].includes(mode)?'executing':'delivered',blockedReason:'公共约定改变，需要有证据升级',tasks:[{id:'t1',title:'实现工具',member:'m1',status:mode==='resumed'?'running':'implemented',summary:'实现完成'}],gates:[{id:'check',kind:'check',status:['checkpoint_wait','resumed'].includes(mode)?'pending':'passed'},...(policy==='checks_only'?[]:[{id:'review',kind:'model',status:['checkpoint_wait','paused','resumed'].includes(mode)?'pending':'passed',coverage:mode==='local_repair'?'reviewed_plus_checked_patch':'full'}])]};
   const a=makeState();a.title='自适应 '+mode;a.workflowVersion='adaptive_v1';a.cycle=x;a.cycleId=x.cycleId;a.tasks=x.tasks;a.status=mode==='paused'?'paused':x.phase==='delivered'?'done':'working';a.members.forEach(m=>m.status=mode==='resumed'&&m.id==='m1'?'running':'idle');
   a.events=[{id:1000,type:'cycle_phase',time:new Date().toISOString(),data:{cycleId:x.cycleId,phase:x.phase}}];
   if(policy!=='checks_only'&&['delivered','blocked'].includes(x.phase))a.events.push({id:1001,type:'cycle_review_start',time:new Date().toISOString(),data:{cycleId:x.cycleId,from:'m1',to:'m2'}});
   if(x.phase==='delivered'&&policy!=='checks_only')a.events.push({id:1002,type:'cycle_review',time:new Date().toISOString(),data:{cycleId:x.cycleId,reviewedCommit:'reviewed-'+mode,criteriaIds:['c'],blockingIssues:mode==='local_repair'?[{issueId:'bug'}]:[],advisories:[],needsVerification:[]}});
   if(mode==='local_repair')a.events.push({id:1004,type:'cycle_repair',time:new Date().toISOString(),data:{cycleId:x.cycleId,from:'m2',to:'m1',issueIds:['bug']}});
   if(x.phase==='delivered')a.events.push({id:1005,type:'report',time:new Date().toISOString(),data:{text:'实现完成，固定提交已验证。',cycleId:x.cycleId,policy,finalCommit:'final-'+mode,reviewedCommit:policy==='checks_only'?null:'reviewed-'+mode,checks:[{result:'passed'}],reviewCoverage:x.gates.filter(g=>g.kind==='model'),tasks:x.tasks,unresolvedIssues:[],usage:'node cli.mjs'}});
   state=[a];send();await page.click('[data-view-nav="task"]');await page.waitForFunction(mode=>document.querySelector('#taskTitle').textContent==='自适应 '+mode,mode);assert.match(await page.locator('#taskCounts').textContent(),/必需检查/);
   if(mode==='checks_only'){await page.click('#statusQuery');assert.equal(lastMessage.intent,'status');assert.match(await page.locator('#nextAction').textContent(),/按策略无需模型审查/);assert.equal(await page.locator('animateMotion').count(),0);assert.ok(!(await page.locator('#liveEvents').textContent()).includes('送审'));}
   if(mode==='local_repair')assert.match(await page.locator('#liveEvents').textContent(),/局部返修/);
   await page.screenshot({animations:'disabled',path:new URL(mode+'-task.png',adaptiveOut).pathname});
   if(x.phase==='delivered'){await page.click('[data-view-nav="result"]');assert.match(await page.locator('#resultContent').textContent(),new RegExp(x.cycleId));if(mode==='checks_only')assert.match(await page.locator('#resultContent').textContent(),/按策略无需模型审查/);if(mode==='local_repair')assert.match(await page.locator('#resultContent').textContent(),/原提交已审查＋后续补丁经指定检查/);await page.screenshot({animations:'disabled',path:new URL(mode+'-result.png',adaptiveOut).pathname});}
 }
 evidence.push('自适应：免审、整体审查、局部修复、检查点等待、升级和暂停均绑定批次真实字段；交付提交与审查覆盖分开');
 state=[makeState(4)];state[0].status='done';state[0].tasks[0].status='passed';state[0].events.push({id:10000,type:'report',time:new Date().toISOString(),data:{text:'旧报告兼容'}});send();
 for(const theme of ['light','dark'])for(const [width,height] of [[1536,864],[1366,768],[1280,720],[800,800],[390,844],[360,740]]) {
   await page.emulateMedia({colorScheme:theme});await page.setViewportSize({width,height});
   for(const view of ['home','task','decision','result','settings']) {
     if(view==='settings'){await page.click('#settings');await page.waitForSelector('.modelrow');}else await page.click(`[data-view-nav="${view}"]`);await page.screenshot({animations:'disabled',path:new URL(`${view}-${width}-${theme}.png`,out).pathname});
     assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow ${width}/${view}`);
     if(view==='task') {const input=await page.locator('#input').boundingBox();assert.ok(input && input.y+input.height<=height,`input ${width}`);}
   }
   if(width<=600) {await page.click('#toggleRight');await page.waitForFunction(()=>document.activeElement.id==='closeTeam');await page.waitForFunction(()=>{const r=document.querySelector('.ny-live').getBoundingClientRect();return r.left>=50 && r.right<=innerWidth+1;});assert.ok(await page.evaluate(()=>[...document.querySelectorAll('.ny-workspace,.ny-columns,.ny-center')].every(n=>n.scrollLeft===0)), '抽屉聚焦不应横向移动工作区');await page.screenshot({animations:'disabled',path:new URL(`drawer-${width}-${theme}.png`,out).pathname});await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.id),'toggleRight');}
 }
 evidence.push('6 个视口 × 深浅色 × 5 个主视图无页面横向溢出；手机抽屉支持 Esc 与焦点返回');
 await page.emulateMedia({colorScheme:'light'});await page.setViewportSize({width:1280,height:720});await page.click('#settings');await page.waitForSelector('.modelrow');const model=await page.inputValue('.modelrow .model');await page.click('#refreshModels');await page.waitForFunction(()=>!document.querySelector('#refreshModels').disabled);assert.equal(await page.inputValue('.modelrow .model'),model);evidence.push('扫描目录保留当前模型配置');await page.click('.testModel');await page.waitForFunction(()=>document.querySelector('.testResult').textContent.includes('连接测试失败'));await page.click('#refreshModels');await page.waitForFunction(()=>!document.querySelector('#refreshModels').disabled);assert.match(await page.locator('.testResult').textContent(),/连接测试失败/);evidence.push('测试失败保留原因，目录扫描不清除测试结果');
 failCreate=false; await page.setViewportSize({width:1280,height:720});await page.click('#new');await page.fill('#homeInput','新建隔离测试项目');await page.selectOption('#projectSelect','');await page.click('#homeStart');await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('已发送'));assert.equal(createCount,2);evidence.push('新建项目成功后进入任务并清理已发送草稿');
 assert.deepEqual(errors,[]);evidence.push('页面脚本异常 0');
 writeFileSync(new URL('browser.json',adaptiveOut),JSON.stringify({fixture:true,checks:evidence,errors},null,2));
 writeFileSync(new URL('browser.json',out),JSON.stringify({fixture:true,baseline:'b517b30',checks:evidence,errors},null,2));
 console.log(JSON.stringify(evidence,null,2));
} catch(error) { console.error(error); throw error; } finally { if(browser)await browser.close();for(const stream of streams)stream.end();server.closeAllConnections();await new Promise(r=>server.close(r)); }
