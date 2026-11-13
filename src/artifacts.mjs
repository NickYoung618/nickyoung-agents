import { randomUUID, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, existsSync, statSync, realpathSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
const git = (cwd, args, options={}) => execFileSync('git', ['-C',cwd,...args], {encoding:'utf8',maxBuffer:8000000,...options});
export const managedFiles = ['.nickyoung/项目须知.md','.nickyoung/leader-schema.json','.nickyoung/member-schema.json'];
export function productFiles(path) {
  const tracked=new Set(git(path,['ls-files','-z']).split('\0'));
  return [...new Set((git(path,['ls-files','-m','-o','--exclude-standard','-z'])+git(path,['diff','--cached','--name-only','-z'])+(existsSync(join(path,'.nickyoung/artifacts.json'))&&!tracked.has('.nickyoung/artifacts.json')?'.nickyoung/artifacts.json\0':'')).split('\0'))].filter(f=>f && (tracked.has(f)||(!managedFiles.includes(f) && !f.startsWith('.nickyoung/附件/'))));
}
function local(root, file='.') {
  const path=resolve(root,file);
  if(path!==root && !path.startsWith(root+'/')) throw Error('入口超出成果目录');
  if(existsSync(path)){const real=realpathSync(path);if(real!==root && !real.startsWith(root+'/'))throw Error('入口链接超出成果目录');}
  return path;
}
export class Artifacts {
  constructor(store, data, emit=()=>{}, options={}) {
    Object.assign(this,{store,data,emit}); this.previews=new Map(); this.starting=new Map(); this.verifying=new Map(); this.validationRuns=new Map();
    this.ttl=options.ttl || 20*60*1000;
    this.timer=setInterval(()=>{for(const [id,p] of this.previews) if(p.status==='running' && p.expires<Date.now()) this.stop(id,'expired');},1000); this.timer.unref();
  }
  recover(){
    for(const c of this.store.conversations()){const latest=new Map();for(const e of c.events)if(e.type==='artifact_validation')latest.set(e.data.id,e.data);for(const d of latest.values())if(d.status==='running')this.event(c.id,'artifact_validation',{...d,status:'interrupted',reason:'服务重启，验收已中断，请重新验收'});}
    for(const entry of readdirSync(this.data,{withFileTypes:true}))if(entry.isDirectory()&&entry.name.startsWith('validation-'))rmSync(join(this.data,entry.name),{recursive:true,force:true});
  }
  event(c,type,data) {const e=this.store.append(c,type,data);this.emit(e);return e;}
  list(c) {
    const items=new Map(),accepted=new Map();
    for(const e of this.store.events(c)) {
      if(e.type==='artifact') items.set(e.data.id,{...e.data});
      if(e.type==='artifact_validation' && items.has(e.data.id))items.get(e.data.id).validation=e.data;
      if(e.type==='artifact_user_acceptance')accepted.set(e.data.id,e.data);
    }
    return [...items.values()].map(a=>({...a,userAcceptance:accepted.get(a.id)||a.userAcceptance,preview:this.status(a.id)}));
  }
  get(c,id) {const a=this.list(c).find(a=>a.id===id);if(!a)throw Error('成果不存在');return a;}
  snapshot(a) {return join(this.data,'artifacts',a.id);}
  file(a){if(a.verification.status!=='passed')throw Error('成果尚未验证通过');return local(this.snapshot(a),a.entry);}
  async collect(c, task, project) {
    let raw;
    try {raw=git(project,['show',task.commit+':.nickyoung/artifacts.json']);} catch {return [];}
    const manifest=JSON.parse(raw);
    if(!Array.isArray(manifest.artifacts)) throw Error('成果清单必须含 artifacts 数组');
    const created=[];
    for(const d of manifest.artifacts.slice(0,12)) {
      if(!['web','cli','document','library','change'].includes(d.type) || typeof d.name!=='string' || !d.name) throw Error('成果缺少有效类型或名称');
      for(const field of ['start','scenarios','limits'])if(d[field]!==undefined&&!Array.isArray(d[field]))throw Error('成果字段 '+field+' 必须为数组');
      if(d.limits?.some(x=>typeof x!=='string') || d.start?.some(x=>typeof x!=='string') || (d.cwd!==undefined&&typeof d.cwd!=='string') || typeof d.entry!=='string')throw Error('成果路径、命令或限制字段无效');
      if(this.list(c).some(a=>a.commit===task.commit && a.key===(d.key||d.name)))continue;
      const previous=this.list(c).filter(a=>a.key===(d.key||d.name));
      const a={id:randomUUID(),key:d.key||d.name,type:d.type,name:d.name,description:d.description||'',project,conversation:c,task:task.id,version:previous.length+1,commit:task.commit,entry:d.entry||'',cwd:d.cwd||'.',start:d.start||[],example:d.example||null,scenarios:d.scenarios||[],limits:d.limits||[],verification:{status:'failed',time:new Date().toISOString(),evidence:[]},userAcceptance:null};
      try {
        a.files=git(project,['show','--format=','--name-only',task.commit]).trim().split('\n').filter(Boolean);
        a.acceptanceCriteria=task.description||'';
        a.review=this.store.events(c).filter(e=>e.type==='review'&&e.data.commit===task.commit&&e.data.task===task.id).map(e=>({eventId:e.id,...e.data}));
        const root=this.snapshot(a);mkdirSync(root,{recursive:true});
        const archive=git(project,['archive',task.commit],{encoding:null});execFileSync('tar',['-x','-C',root],{input:archive});
        if(!a.entry || !statSync(local(root,a.entry)).isFile())throw Error('成果文件入口不存在');
        const cwd=local(root,a.cwd);a.workingDirectory=cwd;if(!statSync(cwd).isDirectory())throw Error('工作目录不存在');
        if(a.type==='cli'||a.type==='library') {
          if(!a.example?.args?.length || typeof a.example.expected!=='string')throw Error('缺少示例参数及预期输出');
          if(a.example.args.some(x=>typeof x!=='string') || a.example.args.some(x=>/^(--test|test)$/.test(x)))throw Error('测试命令不能当成使用命令');
          if(a.example.args[0].startsWith('-') || !statSync(local(cwd,a.example.args[0])).isFile())throw Error('示例必须指向可执行文件，不能使用 Node 测试或权限开关');
          const output=await this.node(cwd,a.example.args,a.example.input||'',root);
          a.verification.evidence.push({kind:'example',args:a.example.args,input:a.example.input||'',output});
          if(output.trim()!==a.example.expected.trim())throw Error('示例真实输出与预期不符');
        } else if(a.type==='document') a.verification.evidence.push({kind:'document',output:readFileSync(local(root,a.entry),'utf8').slice(0,100000)});
        else if(a.type==='change') {
          const checks=this.store.events(c).filter(e=>e.type==='check'&&e.data.task===task.id&&e.data.commit===task.commit);
          if(!checks.length || checks.some(e=>!e.data.passed))throw Error('本提交缺少通过的机器验收');
          a.verification.evidence=checks.map(e=>({eventId:e.id,kind:'check',...e.data}));
        }
        a.verification.status=a.type==='web'?'needs_preview':'passed';
      }catch(e){a.verification.reason=e.message;}
      this.event(c,'artifact',a);created.push(a);
    }
    return created;
  }
  node(cwd,args,input='',root=cwd) {
    return new Promise((yes,no)=>{const p=spawn(process.execPath,['--permission','--allow-fs-read='+root,'--allow-fs-write='+root,'--max-old-space-size=128',...args],{cwd,env:{PATH:process.env.PATH,HOME:cwd},stdio:['pipe','pipe','pipe'],detached:true});let output='';const t=setTimeout(()=>{try{process.kill(-p.pid,'SIGKILL');}catch{}},15000);p.stdout.on('data',x=>{output+=x;if(output.length>100000)p.kill();});p.stderr.on('data',x=>{output+=x;});p.on('error',no);p.on('close',code=>{clearTimeout(t);code===0?yes(output):no(Error(output||'示例运行失败或超时'));});p.stdin.end(input);});
  }
  status(id) {const p=this.previews.get(id);if(p?.status==='running'&&p.expires<=Date.now())this.stop(id,'expired');return p?{status:p.status,url:p.status==='running'?'/preview/'+p.token+'/':null,expires:p.expires,reason:p.reason}: {status:'stopped'};}
  async start(c,id) {
    if(this.starting.has(id))return this.starting.get(id);
    const pending=this.startVersion(c,id);this.starting.set(id,pending);
    try{return await pending;}catch(e){if(!this.previews.get(id)?.reason){const a=this.get(c,id);this.previews.set(id,{id,conversation:c,commit:a.commit,status:'failed',reason:e.message});this.event(c,'preview',{id,commit:a.commit,status:'failed',reason:e.message});}throw e;}finally{this.starting.delete(id);}
  }
  async startVersion(c,id) {
    const a=this.get(c,id);if(a.type!=='web')throw Error('该成果不是网页');
    const current=this.status(id);if(current.status==='running')return current;
    if([...this.previews.values()].filter(p=>['starting','running'].includes(p.status)).length>=2)throw Error('最多同时运行两个预览，请先停止其他预览');
    if(!statSync(local(this.snapshot(a),a.entry)).isFile())throw Error('成果入口不存在');
    const p={token:randomBytes(24).toString('hex'),status:'starting',expires:Date.now()+this.ttl,root:this.snapshot(a),conversation:c,id,commit:a.commit};this.previews.set(id,p);
    try {
      if(a.start.length) {
        if(a.start[0]!=='node'||a.start.length<2||a.start.some(x=>typeof x!=='string')||a.start.includes('--test'))throw Error('预览启动仅支持 node server.mjs；端口读取 PORT，监听 HOST');
        if(a.start[1].startsWith('-') || !statSync(local(local(p.root,a.cwd),a.start[1])).isFile())throw Error('启动入口必须是快照内的 Node 文件');
        const probe=http.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));p.port=probe.address().port;await new Promise(r=>probe.close(r));if(p.cancelled)throw Error('启动已取消');
        p.child=spawn(process.execPath,['--permission','--allow-fs-read='+p.root,'--allow-fs-write='+p.root,'--max-old-space-size=128',...a.start.slice(1)],{cwd:local(p.root,a.cwd),env:{PATH:process.env.PATH,HOME:p.root,HOST:'127.0.0.1',PORT:String(p.port)},detached:true,stdio:['ignore','pipe','pipe']});
        p.log='';for(const s of [p.child.stdout,p.child.stderr])s.on('data',x=>p.log=(p.log+x).slice(-8000));
        p.child.on('error',e=>{p.reason=e.message;p.status='failed';});
        p.child.on('exit',()=>{if(p.status==='running'){p.status='failed';p.reason=p.log||'预览进程已退出';this.event(c,'preview',{id,commit:a.commit,status:'failed',reason:p.reason});}});
        let ready=false;
        for(let n=0;n<60;n++){if(p.cancelled)throw Error('启动已取消');if(p.child.exitCode!==null)break;try{const r=await fetch(`http://127.0.0.1:${p.port}/`,{signal:AbortSignal.timeout(500)});if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
        if(!ready)throw Error(p.log||'启动后健康检查失败');
      } else {p.static=true;local(p.root,a.entry);}
      if(p.cancelled)throw Error('启动已取消');
      p.status='running';this.event(c,'preview',{id,commit:a.commit,status:'running',time:new Date().toISOString()});
      return this.status(id);
    }catch(e){p.reason=e.message;this.stop(id,p.cancelled?'stopped':'failed');throw e;}
  }
  async verify(c,id) {
    if(this.verifying.has(id))return this.verifying.get(id);
    if(this.verifying.size>=2)throw Error('最多同时执行两个成果验收');
    const pending=this.verifyVersion(c,id);this.verifying.set(id,pending);
    try{return await pending;}finally{this.verifying.delete(id);}
  }
  async verifyVersion(c,id) {
    const a=this.get(c,id);
    delete a.preview;delete a.validation;
    a.verification={status:'failed',time:new Date().toISOString(),commit:a.commit,evidence:[]};
    const runId=randomUUID(),runDir=mkdtempSync(join(this.data,'validation-'));
    const isolated=new Artifacts(this.store,this.data,()=>{});
    isolated.snapshot=()=>runDir;isolated.event=()=>{};
    const run={id:runId,manager:isolated,dir:runDir,cancelled:false};this.validationRuns.set(id,run);
    this.event(c,'artifact_validation',{id,commit:a.commit,runId,status:'running'});
    let browser,deadline;
    try {
      if(!a.scenarios.length || a.scenarios.some(s=>!s.steps?.length || !s.steps.some(step=>step.action==='text')))throw Error('缺少用户场景验收步骤；健康检查通过不代表成果可使用');
      const archive=git(a.project,['archive',a.commit],{encoding:null});execFileSync('tar',['-x','-C',runDir],{input:archive});
      await isolated.start(c,id);if(run.cancelled)throw Error('验收已取消');
      const p=isolated.previews.get(id);
      const { chromium }=await import('playwright');browser=await chromium.launch({headless:true,args:['--no-sandbox']});
      run.browser=browser;if(run.cancelled)throw Error('验收已取消');
      deadline=setTimeout(()=>{run.cancelled=true;browser.close();isolated.stop(id);},60000);
      const page=await browser.newPage({ignoreHTTPSErrors:true});
      // Same opaque-origin boundary as the actual workbench iframe.
      
      // Verify through the real preview proxy when the server supplies its URL.
      if(!this.origin)throw Error('预览验证地址未配置');
      await page.goto(this.origin+'/preview/'+p.token+'/');
      for(const scenario of a.scenarios.slice(0,12)) {
        for(const step of scenario.steps.slice(0,40)) {
          if(step.action==='reload'){await page.reload();continue;}
          const loc=page.locator(step.selector);
          if(step.action==='fill')await loc.fill(step.value,{timeout:5000});
          else if(step.action==='click')await loc.click({timeout:5000});
          else if(step.action==='check')await loc.check({timeout:5000});
          else if(step.action==='text')await page.waitForFunction(({selector,value})=>document.querySelector(selector)?.textContent.includes(value),{selector:step.selector,value:step.value},{timeout:5000});
          else throw Error('未知场景步骤 '+step.action);
        }
        a.verification.evidence.push({kind:'scenario',name:scenario.name,passed:true,steps:scenario.steps});
      }
      a.verification.status='passed';
    }catch(e){a.verification.reason=run.cancelled?'验收已取消或超时':String(e.message).replace(/\/preview\/[a-f0-9]+/g,'/preview/[temporary]');}finally{clearTimeout(deadline);await browser?.close();await isolated.close();this.validationRuns.delete(id);rmSync(runDir,{recursive:true,force:true});}
    this.event(c,'artifact',a);this.event(c,'artifact_validation',{id,commit:a.commit,runId,status:run.cancelled?'cancelled':a.verification.status,reason:a.verification.reason});return this.get(c,id);
  }
  cancelVerification(id){const run=this.validationRuns.get(id);if(run){run.cancelled=true;run.manager.stop(id);run.browser?.close();}return {status:run?'stopping':'stopped'};}
  stop(id,status='stopped') {const p=this.previews.get(id);if(p){p.cancelled=true;if(p.child?.pid)try{process.kill(-p.child.pid,'SIGTERM');const pid=p.child.pid;setTimeout(()=>{try{process.kill(-pid,'SIGKILL');}catch{}},2000).unref();}catch{}p.status=status;this.event(p.conversation,'preview',{id,commit:p.commit,status});}return this.status(id);}
  async serve(req,res,token,path) {
    for(const run of this.validationRuns.values())if([...run.manager.previews.values()].some(p=>p.token===token))return run.manager.serve(req,res,token,path);
    const p=[...this.previews.values()].find(p=>p.token===token);
    if(!p||p.status!=='running'||p.expires<Date.now()){res.writeHead(410,{'Content-Type':'text/plain; charset=utf-8'});res.end('预览已失效，请回成果页重新启动。');return;}
    // Opaque origin sandbox prevents preview scripts from reading assistant cookies or management APIs.
    const headers={'Content-Security-Policy':"sandbox allow-scripts allow-forms; default-src 'self' data: blob: 'unsafe-inline'; connect-src 'self'; frame-ancestors 'self'",'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
    if(req.method==='OPTIONS'){res.writeHead(204,{...headers,'Access-Control-Allow-Methods':'GET, POST, PUT, PATCH, DELETE, OPTIONS','Access-Control-Allow-Headers':'Content-Type'});res.end();return;}
    try {
      if(p.static){if(req.method!=='GET')throw Error('静态预览仅支持读取');const a=this.get(p.conversation,p.id);const file=local(p.root,path.split('?')[0]==='/'?a.entry:decodeURIComponent(path.split('?')[0].slice(1)));const content=readFileSync(file);res.writeHead(200,{...headers,'Content-Type':mime(file)});res.end(content);}
      else {
        const upstream=http.request({host:'127.0.0.1',port:p.port,path,method:req.method,headers:{'content-type':req.headers['content-type']||'text/plain'}},r=>{res.writeHead(r.statusCode,{...headers,'Content-Type':r.headers['content-type']||'text/plain'});r.pipe(res);});
        upstream.on('error',()=>{res.writeHead(502,headers);res.end('预览服务已退出，请重新启动');this.stop(p.id,'failed');});req.pipe(upstream);
      }
    }catch(e){res.writeHead(404,headers);res.end(e.message);}
  }
  restorePlan(c,id) {
    const a=this.get(c,id);const changed=git(a.project,['diff','--name-only','HEAD',a.commit]).trim().split('\n').filter(Boolean);
    const excluded=changed.filter(f=>/(^|\/)(data|node_modules)\//.test(f)||/(^|\/)\.env(?:\.|$)|\.(sqlite(?:3)?|db)(?:-|$)/.test(f));
    const files=changed.filter(f=>!excluded.includes(f));
    const collisions=files.length?git(a.project,['status','--porcelain','--ignored','--untracked-files=all','--',...files]).split('\n').filter(Boolean):[];
    return {id,head:git(a.project,['rev-parse','HEAD']).trim(),target:a.commit,files,excluded,dirty:[...new Set([...productFiles(a.project),...collisions])],scope:'仅恢复列出的 Git 产品文件；排除数据目录、数据库与环境配置。数据库、部署及外部服务不会恢复。'};
  }
  restore(c,id,head) {
    const plan=this.restorePlan(c,id);if(plan.dirty.length)throw Error('项目有未提交改动，恢复已阻止');if(plan.head!==head)throw Error('提交已变化，请重新查看恢复范围');
    if(this.store.conversations().some(s=>s.path===this.get(c,id).project && s.status==='working'))throw Error('项目正在运行任务，不能恢复');
    if(plan.files.length)git(this.get(c,id).project,['restore','--source',plan.target,'--staged','--worktree','--',...plan.files]);
    this.event(c,'artifact_restore',plan);return plan;
  }
  async close(){clearInterval(this.timer);for(const id of this.validationRuns.keys())this.cancelVerification(id);for(const id of this.previews.keys())this.stop(id);await Promise.allSettled([...this.starting.values(),...this.verifying.values()]);await Promise.all([...this.previews.values()].map(p=>p.child&&p.child.exitCode===null&&p.child.signalCode===null?new Promise(r=>p.child.once('close',r)):Promise.resolve()));}
}
export function mime(file) {return {'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.md':'text/plain; charset=utf-8'}[extname(file)]||'text/plain; charset=utf-8';}
