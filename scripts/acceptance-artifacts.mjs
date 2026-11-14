import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import https from 'node:https';
import { setTimeout as delay } from 'node:timers/promises';
const root=resolve(import.meta.dirname,'..');
const dir=process.env.NY_ACCEPTANCE_RESUME || mkdtempSync(join(tmpdir(),'nickyoung-artifacts-live-'));
const saved=JSON.parse(readFileSync(join(root,'data/config.json'),'utf8'));
const workspace=join(dir,'workspace');mkdirSync(workspace,{recursive:true});
const config={data:dir,workspace,host:'127.0.0.1',port:18889,leader:saved.leader,tiers:saved.tiers.filter(t=>t.channel==='codex'),names:saved.names,concurrency:2,timeout:600000,experience:''};
if(!process.env.NY_ACCEPTANCE_RESUME)writeFileSync(join(dir,'config.json'),JSON.stringify(config),{mode:0o600});
const child=spawn(process.execPath,['src/server.mjs'],{cwd:root,env:{...process.env,NY_DATA:dir,NY_PORT:'18889',NY_HOST:'127.0.0.1'},stdio:['ignore','ignore','inherit']});
let cookie='';
const call=(path,data)=>new Promise((resolve,reject)=>{const req=https.request(`https://127.0.0.1:18889/api/${path}`,{rejectUnauthorized:false,method:data?'POST':'GET',headers:{'Content-Type':'application/json',Cookie:cookie}},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>{if(res.headers['set-cookie'])cookie=res.headers['set-cookie'][0].split(';')[0];const value=JSON.parse(body);res.statusCode===200?resolve(value):reject(Error(JSON.stringify(value)));});});req.on('error',reject);req.end(data?JSON.stringify(data):undefined);});
try{
 let ready=false;for(let n=0;n<100;n++){if(child.exitCode!==null)throw Error('隔离服务启动失败');try{await call('login',{password:readFileSync(join(dir,'initial-password'),'utf8').trim()});ready=true;break;}catch{await delay(100);}}
 if(!ready)throw Error('隔离服务启动超时');
 let r;
 if(process.env.NY_ACCEPTANCE_RESUME)r={id:JSON.parse(readFileSync(join(root,'evidence/artifacts/live-task.json'),'utf8')).conversationId};
 else {
 const project=join(workspace,'existing');mkdirSync(project);writeFileSync(join(project,'greet.mjs'),"console.log('你好，'+(process.argv[2]||'朋友'));\n");
 const {execFileSync}=await import('node:child_process');const git=(args)=>execFileSync('git',['-C',project,...args],{env:{...process.env,GIT_AUTHOR_NAME:'Acceptance',GIT_AUTHOR_EMAIL:'test@local',GIT_COMMITTER_NAME:'Acceptance',GIT_COMMITTER_EMAIL:'test@local'},stdio:'pipe'});git(['init']);git(['add','greet.mjs']);git(['commit','-m','Existing greeting project']);
 r=await call('conversations',{path:project,text:'真实成果闭环验收：在已有 greet.mjs 项目上做一次小改动，将问候改为“您好，张三！”（参数为张三时），输出名为 greeting 的 cli 成果，真实 example.args=["greet.mjs","张三"]、expected="您好，张三！"；再交付名为 todo 的极简零依赖 Node 待办网页，server.mjs 用 PORT/HOST 环境变量监听，入口 index.html，前端用相对 api/todos 地址，服务端 JSON 文件持久化。网页用 #todoInput 输入、#add 添加、#list 显示列表，每项 checkbox 完成后文字包含“已完成”，刷新保留事项和状态。.nickyoung/artifacts.json 声明 web 和 cli 和 change（key=existing-change）三类成果，web start=["node","server.mjs"]，scenarios 实测添加、勾选、刷新后仍已完成，不要 localStorage。写最小 node --test 验收。只派一个实现任务，独立成员审查，通过才报告。仅用现有 Codex 主力档，不改配置不请示，保持功能极小。'});
 }
 console.log('隔离任务已创建',r.id);
 let s;
 for(let n=0;n<1800;n++){s=(await call('state')).find(c=>c.id===r.id);if(['done','error','interrupted','paused'].includes(s.status))break;await delay(1000);}
 const result={isolated:true,dataDirectory:dir,conversationId:r.id,path:s.path,status:s.status,members:s.members.map(m=>({id:m.id,name:m.name,model:m.model,effort:m.effort})),tasks:s.tasks,events:s.events.filter(e=>['run_start','model_result','task','task_update','check','review','report','error','run_failed'].includes(e.type))};
 writeFileSync(join(root,'evidence/artifacts/live-task.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify({id:r.id,status:s.status,tasks:s.tasks.map(t=>({id:t.id,status:t.status,commit:t.commit}))}));
 if(s.status!=='done'||!s.tasks.length||s.tasks.some(t=>t.status!=='passed'))throw Error('真实任务尚未通过');
 let artifacts=await call(`conversations/${r.id}/artifacts`);result.artifacts=artifacts;
 const web=artifacts.find(a=>a.type==='web'),cli=artifacts.find(a=>a.type==='cli');if(!web||!cli)throw Error('未产出结构化成果');
 await call(`conversations/${r.id}/artifacts/${web.id}/start`,{});
 result.web=await call(`conversations/${r.id}/artifacts/${web.id}/verify`,{});
 if(result.web.verification.status!=='passed')throw Error('网页场景未通过：'+result.web.verification.reason);
 // Browser uses the actual delivery UI, with no user acceptance button clicked.
 const {chromium}=await import('playwright');const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try {const context=await browser.newContext({ignoreHTTPSErrors:true});await context.addCookies([{name:'ny_session',value:cookie.split('=')[1],url:'https://127.0.0.1:18889'}]);const page=await context.newPage();await page.goto('https://127.0.0.1:18889');await page.click('[data-view-nav="result"]');await page.locator(`[data-artifact="${web.id}"] [data-artifact-action="start"]`).click();await page.waitForSelector('.artifact-card iframe');const frame=page.frameLocator('.artifact-card iframe');await frame.locator('#todoInput').fill('浏览器真实操作');await frame.locator('#add').click();await frame.locator('#list').getByText('浏览器真实操作').waitFor();await page.screenshot({path:join(root,'evidence/artifacts/live-workbench.png'),fullPage:true});const isolation=await frame.locator('body').evaluate(async()=>{let parentBlocked=false,cookieBlocked=false;try{parent.document.body;}catch{parentBlocked=true;}try{document.cookie;}catch{cookieBlocked=true;}let apiBlocked=false,apiStatus=null;try{const response=await fetch('/api/state',{credentials:'include'});apiStatus=response.status;apiBlocked=!response.ok;}catch{apiBlocked=true;}return{parentBlocked,cookieBlocked,apiBlocked,apiStatus};});if(!isolation.parentBlocked||!isolation.cookieBlocked||!isolation.apiBlocked)throw Error('预览隔离失败');result.browser={added:'浏览器真实操作',isolation,userAcceptance:false};
 await page.locator(`[data-artifact="${cli.id}"] summary`).filter({hasText:'继续修改'}).click();await page.locator(`[data-artifact="${cli.id}"] textarea`).fill('把问候改成“欢迎，张三！”（参数张三时），更新 greeting 的 example.expected，保持 key 和其他成果功能。只做这一个小改动，重新机器验收和独立审查。');await page.locator(`[data-artifact="${cli.id}"] [data-artifact-action="feedback"]`).click();await delay(1000);
 }finally{await browser.close();}
 for(let n=0;n<1800;n++){s=(await call('state')).find(c=>c.id===r.id);if(['done','error','interrupted','paused'].includes(s.status))break;await delay(1000);}
 artifacts=await call(`conversations/${r.id}/artifacts`);result.revision={status:s.status,artifacts,events:s.events};
 writeFileSync(join(root,'evidence/artifacts/live-task.json'),JSON.stringify(result,null,2));
 const newer=artifacts.find(a=>a.key===cli.key&&a.version>cli.version);if(!newer||newer.verification.status!=='passed')throw Error('反馈新版未通过');
 console.log('网页、CLI、已有项目修改及从成果页反馈新版均通过',dir);
}finally{child.kill('SIGTERM');await new Promise(r=>child.once('close',r));}
