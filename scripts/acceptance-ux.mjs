import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import https from 'node:https';
import { setTimeout as delay } from 'node:timers/promises';
const root=resolve(import.meta.dirname,'..');
const dir=mkdtempSync(join(tmpdir(),'nickyoung-ux-live-'));
const saved=JSON.parse(readFileSync(join(root,'data/config.json'),'utf8'));
const workspace=join(dir,'workspace');mkdirSync(workspace);
const config={data:dir,workspace,host:'127.0.0.1',port:18879,leader:saved.leader,tiers:saved.tiers.filter(t=>t.channel==='codex'),names:saved.names,concurrency:2,timeout:600000,experience:''};
writeFileSync(join(dir,'config.json'),JSON.stringify(config),{mode:0o600});
const child=spawn(process.execPath,['src/server.mjs'],{cwd:root,env:{...process.env,NY_DATA:dir,NY_PORT:'18879',NY_HOST:'127.0.0.1'},stdio:'ignore'});
let cookie='';
const call=(path,data)=>new Promise((resolve,reject)=>{const req=https.request(`https://127.0.0.1:18879/api/${path}`,{rejectUnauthorized:false,method:data?'POST':'GET',headers:{'Content-Type':'application/json',Cookie:cookie}},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>{if(res.headers['set-cookie'])cookie=res.headers['set-cookie'][0].split(';')[0];const value=JSON.parse(body);res.statusCode===200?resolve(value):reject(Error(JSON.stringify(value)));});});req.on('error',reject);req.end(data?JSON.stringify(data):undefined);});
try{
 let ready=false;for(let n=0;n<100;n++){if(child.exitCode!==null)throw Error('隔离服务启动失败');try{await call('login',{password:readFileSync(join(dir,'initial-password'),'utf8').trim()});ready=true;break;}catch{await delay(100);}}
 if(!ready)throw Error('隔离服务启动超时');
 const r=await call('conversations',{text:'界面优化后的最小真实端到端验收。请新建一个极小的零依赖 Node 项目，只交付 greet.mjs 导出 greet(name) 返回 `你好，${name}`，README.md 写明 node --test，一项 node:test 验证中文姓名。只派一个实现任务，由另一名成员实际运行 node --test 并独立审查后收工。实现和审查都使用现有 codex 主力档，禁止 Claude，不更改任何配置，不需要请示或额外功能。必须真实提交、机器验收和独立审查通过才报告。'});
 console.log('隔离任务已创建',r.id);
 let s;
 for(let n=0;n<600;n++){s=(await call('state')).find(c=>c.id===r.id);if(['done','error','interrupted','paused'].includes(s.status))break;await delay(1000);}
 const result={isolated:true,conversationId:r.id,path:s.path,status:s.status,members:s.members.map(m=>({id:m.id,name:m.name,model:m.model,effort:m.effort})),tasks:s.tasks,events:s.events.filter(e=>['run_start','model_result','task','task_update','check','review','report','error','run_failed'].includes(e.type))};
 writeFileSync(join(root,'evidence/ux-vnext/live-task.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify({id:r.id,status:s.status,tasks:s.tasks.map(t=>({id:t.id,status:t.status,commit:t.commit}))}));
 if(s.status!=='done'||!s.tasks.length||s.tasks.some(t=>t.status!=='passed'))throw Error('真实任务尚未通过，详见 live-task.json');
}finally{child.kill('SIGTERM');await new Promise(r=>child.once('close',r));}
